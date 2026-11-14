const pool = require("../config/db.js")
const { geocodeAddress } = require("../utilis/geocode.js")

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 60

// Turns "abc" / "" / undefined into null instead of NaN.
function toNumber(value) {
  if (value === undefined || value === null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Works out WHERE the customer is searching from. Two ways:
//   1. the browser sent exact GPS (?lat=..&lng=..)  -> trust it
//   2. the customer typed a place (?near=Ikeja)     -> geocode it
// Never throws: a geocoder problem must not break the whole search page.
async function resolveCustomerPoint(query) {
  const lat = toNumber(query.lat)
  const lng = toNumber(query.lng)
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { point: { latitude: lat, longitude: lng }, source: "gps", found: true }
  }

  const near = (query.near || "").trim()
  if (!near) return { point: null, source: null, found: true }

  try {
    const point = await geocodeAddress(`${near}, Nigeria`)
    if (point) return { point, source: "text", found: true }
    return { point: null, source: "text", found: false }
  } catch (error) {
    console.log("Customer location geocoding failed (non-blocking):", error.message)
    return { point: null, source: "text", found: false }
  }
}

async function getArtisans(req, res) {
  try {
    const category = (req.query.category || "").trim()
    const near = (req.query.near || "").trim()
    const minDistance = toNumber(req.query.minDistance)
    const maxDistance = toNumber(req.query.maxDistance)
    const sortBy = req.query.sortBy === "newest" ? "newest" : "nearest"

    const pageSize = Math.min(Math.max(toNumber(req.query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const page = Math.max(Math.floor(toNumber(req.query.page) || 1), 1)
    const offset = (page - 1) * pageSize

    const { point, source, found } = await resolveCustomerPoint(req.query)

    // ---- INNER query: one row per live artisan, with distance attached ----
    const innerParams = []
    let distanceExpr = "NULL"
    if (point) {
      // Haversine formula = straight-line distance between two GPS points.
      // LEAST/GREATEST keep acos() inside its legal range (-1..1), because
      // tiny floating-point errors can push it to 1.0000000002 and give NULL.
      distanceExpr = `ROUND(6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(?)) * cos(radians(a.latitude)) *
          cos(radians(a.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(a.latitude))
        ))), 1)`
      innerParams.push(point.latitude, point.longitude, point.latitude)
    }

    let inner = `
      SELECT a.id, a.business_name, c.name AS category,
             a.city, a.state, a.area, a.home_service, a.experience_years,
             a.description, a.latitude, a.longitude, a.location_precision,
             u.phone_number AS phone,
             (SELECT media_url FROM portfolio_items
              WHERE artisan_id = a.id AND is_cover = TRUE
              ORDER BY id LIMIT 1) AS cover_image,
             ${distanceExpr} AS distance_km
      FROM artisans a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN users u ON a.user_id = u.user_id
      WHERE a.is_onboarded = TRUE`

    if (category) {
      inner += " AND c.name = ?"
      innerParams.push(category)
    }

    // The customer typed a place we could NOT locate: fall back to matching
    // the words against city / area / state so they still see something useful.
    if (near && !point) {
      inner += " AND (a.city LIKE ? OR a.area LIKE ? OR a.state LIKE ?)"
      const like = `%${near}%`
      innerParams.push(like, like, like)
    }

    // ---- OUTER query: filter / sort / page on the computed distance ----
    // (a derived table lets us use the distance_km alias in plain WHERE,
    //  and lets us COUNT the matches for pagination.)
    let outerWhere = " WHERE 1 = 1"
    const outerParams = []
    if (point && minDistance !== null) {
      outerWhere += " AND distance_km >= ?"
      outerParams.push(minDistance)
    }
    if (point && maxDistance !== null) {
      outerWhere += " AND distance_km <= ?"
      outerParams.push(maxDistance)
    }

    // Artisans with no saved coordinates are kept, but sorted LAST, so nobody
    // silently disappears from search just because their pin is missing.
    const orderBy =
      point && sortBy === "nearest"
        ? " ORDER BY distance_km IS NULL, distance_km ASC, id DESC"
        : " ORDER BY id DESC"

    const baseParams = [...innerParams, ...outerParams]

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM (${inner}) t ${outerWhere}`,
      baseParams
    )
    const total = countRows[0].total

    const [rows] = await pool.query(
      `SELECT * FROM (${inner}) t ${outerWhere} ${orderBy} LIMIT ? OFFSET ?`,
      [...baseParams, pageSize, offset]
    )

    // mysql2 returns DECIMAL columns as strings ("6.52440000"). Convert them
    // to real numbers once here, so the frontend never has to think about it.
    const artisans = rows.map((row) => ({
      ...row,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      distance_km: row.distance_km === null ? null : Number(row.distance_km),
      home_service: !!row.home_service,
    }))

    return res.status(200).json({
      artisans,
      total,
      page,
      pageSize,
      hasMore: offset + artisans.length < total,
      meta: {
        locationSource: source,   // 'gps' | 'text' | null
        locationFound: found,     // false = customer typed a place we couldn't locate
        searchedPoint: point,
      },
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function getArtisanById(req, res) {
  try {
    const { id } = req.params

    const [rows] = await pool.query(
      `SELECT a.id, a.business_name, c.name AS category, a.city, a.area, a.state,
              a.home_service, a.experience_years, a.description,
              a.latitude, a.longitude, a.location_precision,
              u.phone_number AS phone
       FROM artisans a
       LEFT JOIN categories c ON a.category_id = c.id
       LEFT JOIN users u ON a.user_id = u.user_id
       WHERE a.id = ? AND a.is_onboarded = TRUE`,
      [id]
    )

    if (rows.length === 0) {
      return res.status(404).json({ message: "Artisan not found" })
    }

    const [portfolioItems] = await pool.query(
      "SELECT id, media_type, media_url, is_cover FROM portfolio_items WHERE artisan_id = ? ORDER BY is_cover DESC, created_at DESC",
      [id]
    )

    const [services] = await pool.query(
      "SELECT id, service_name, description, starting_price FROM artisan_services WHERE artisan_id = ? ORDER BY id",
      [id]
    )

    const artisan = rows[0]
    artisan.latitude = artisan.latitude === null ? null : Number(artisan.latitude)
    artisan.longitude = artisan.longitude === null ? null : Number(artisan.longitude)
    artisan.home_service = !!artisan.home_service

    return res.status(200).json({
      artisan,
      portfolio: portfolioItems,
      services,
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { getArtisans, getArtisanById }
