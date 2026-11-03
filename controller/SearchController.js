const pool = require("../config/db.js")
const { geocodeAddress } = require("../utilis/geocode.js")

async function getArtisans(req, res) {
  try {
    const { category, near, minDistance, maxDistance, sortBy } = req.query

    let customerCoords = null
    if (near) {
      try {
        customerCoords = await geocodeAddress(`${near}, Nigeria`)
      } catch (geoError) {
        console.log("Customer location geocoding failed (non-blocking):", geoError)
      }
    }

    let sql
    const params = []

    if (customerCoords) {
      sql = `
        SELECT a.id, a.business_name, c.name AS category, a.city, a.area,
               a.home_service, a.experience_years, a.description,
               u.phone_number AS phone,
               (SELECT media_url FROM portfolio_items
                WHERE artisan_id = a.id AND is_cover = TRUE
                ORDER BY id LIMIT 1) AS cover_image,
               (6371 * acos(
                   cos(radians(?)) * cos(radians(a.latitude)) *
                   cos(radians(a.longitude) - radians(?)) +
                   sin(radians(?)) * sin(radians(a.latitude))
               )) AS distance_km
        FROM artisans a
        LEFT JOIN categories c ON a.category_id = c.id
        LEFT JOIN users u ON a.user_id = u.user_id
        WHERE a.is_onboarded = TRUE
          AND a.latitude IS NOT NULL
          AND a.longitude IS NOT NULL
      `
      params.push(customerCoords.latitude, customerCoords.longitude, customerCoords.latitude)
    } else {
      sql = `
        SELECT a.id, a.business_name, c.name AS category, a.city, a.area,
               a.home_service, a.experience_years, a.description,
               u.phone_number AS phone,
               (SELECT media_url FROM portfolio_items
                WHERE artisan_id = a.id AND is_cover = TRUE
                ORDER BY id LIMIT 1) AS cover_image,
               NULL AS distance_km
        FROM artisans a
        LEFT JOIN categories c ON a.category_id = c.id
        LEFT JOIN users u ON a.user_id = u.user_id
        WHERE a.is_onboarded = TRUE
      `
      if (near) {
        sql += " AND a.city LIKE ?"
        params.push(`%${near}%`)
      }
    }

    if (category) {
      sql += " AND c.name = ?"
      params.push(category)
    }

    // Range filtering — supports BOTH a lower bound (minDistance) and
    // upper bound (maxDistance), matching a UI built around ranges
    // like "5–10 km", not just a single "within X km" cutoff.
    if (customerCoords && (minDistance || maxDistance)) {
      const conditions = []
      if (minDistance) {
        conditions.push("distance_km >= ?")
        params.push(parseFloat(minDistance))
      }
      if (maxDistance) {
        conditions.push("distance_km <= ?")
        params.push(parseFloat(maxDistance))
      }
      sql += " HAVING " + conditions.join(" AND ")
    }

    if (customerCoords && sortBy === 'nearest') {
      sql += " ORDER BY distance_km ASC"
    }

    const [artisans] = await pool.query(sql, params)

    return res.status(200).json({ artisans })

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

    return res.status(200).json({
      artisan: rows[0],
      portfolio: portfolioItems,
    })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { getArtisans, getArtisanById }