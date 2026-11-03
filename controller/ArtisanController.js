const pool = require("../config/db.js")
const { geocodeAddress } = require("../utilis/geocode.js")

async function updateBusinessInfo(req, res) {
  try {
    const userId = req.user.id

    const {
      businessName,
      category,
      state,
      city,
      area,
      address,
      homeService,
      experience,
      description,
    } = req.body

    if (!businessName || !category || !state || !city || !address) {
      return res.status(400).json({ message: "Business name, category, state, city, and address are required" })
    }

    if (!["yes", "no"].includes(homeService)) {
      return res.status(400).json({ message: "Home service must be either yes or no" })
    }

    if (experience === undefined || experience === null || isNaN(experience) || experience < 0) {
      return res.status(400).json({ message: "Experience must be a valid non-negative number" })
    }

    const [categoryRows] = await pool.query(
      "SELECT id FROM categories WHERE name = ?",
      [category]
    )
    if (categoryRows.length === 0) {
      return res.status(400).json({ message: "Invalid category" })
    }
    const categoryId = categoryRows[0].id

    const homeServiceValue = homeService === "yes"

    // Geocode the full address — treated as "best effort", NOT required.
    // If it fails for any reason (vague address, Nominatim down, etc.),
    // we still save everything else normally, just without coordinates.
    const fullAddress = `${address}, ${area || ''}, ${city}, ${state}, Nigeria`
let latitude = null
let longitude = null
let locationPrecision = null  

try {
  let coords = await geocodeAddress(fullAddress)

  if (coords) {
    latitude = coords.latitude
    longitude = coords.longitude
    locationPrecision = 'exact'
  } else {
   
    const fallbackAddress = `${city}, ${state}, Nigeria`
    coords = await geocodeAddress(fallbackAddress)

    if (coords) {
      latitude = coords.latitude
      longitude = coords.longitude
      locationPrecision = 'approximate'
    }
  }
} catch (geoError) {
  console.log("Geocoding failed (non-blocking):", geoError)
}

    await pool.query(
      `UPDATE artisans
       SET business_name = ?, category_id = ?, state = ?, city = ?, area = ?,
           address = ?, home_service = ?, experience_years = ?, description = ?,
           latitude = ?, longitude = ?, onboarding_stage = ?
       WHERE user_id = ?`,
      [
        businessName, categoryId, state, city, area,
        address, homeServiceValue, experience, description,
        latitude, longitude,
        "business_info_done",
        userId,
      ]
    )

    return res.status(200).json({
      message: "Business info updated successfully",
      artisan: {
        userId, businessName, category, state, city, area, address,
        homeService: homeServiceValue, experience, description,
      },
      locationPrecision,
    })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function completeOnboarding(req, res) {
  try {
    const userId = req.user.id

    const [artisanRows] = await pool.query(
      "SELECT id, business_name, category_id FROM artisans WHERE user_id = ?",
      [userId]
    )
    if (artisanRows.length === 0) {
      return res.status(404).json({ message: "Artisan profile not found" })
    }
    const artisan = artisanRows[0]

    if (!artisan.business_name || !artisan.category_id) {
      return res.status(400).json({
        message: "Please add a business name and category before completing onboarding."
      })
    }

    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS imageCount FROM portfolio_items WHERE artisan_id = ? AND media_type = 'image'",
      [artisan.id]
    )
    if (countRows[0].imageCount < 3) {
      return res.status(400).json({
        message: "Please upload at least 3 portfolio images before completing onboarding."
      })
    }

    await pool.query(
      "UPDATE artisans SET is_onboarded = TRUE, onboarding_stage = 'completed' WHERE user_id = ?",
      [userId]
    )

    return res.status(200).json({
      message: "Onboarding completed successfully! You're now live on ArtisanHub."
    })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function getMyArtisanProfile(req, res) {
  try {
    const userId = req.user.id

    const [rows] = await pool.query(
      `SELECT a.business_name, c.name AS category, a.state, a.city, a.area, a.address,
              a.home_service, a.experience_years, a.description
       FROM artisans a
       LEFT JOIN categories c ON a.category_id = c.id
       WHERE a.user_id = ?`,
      [userId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: "Artisan profile not found" })
    }

    const artisan = rows[0]
    return res.status(200).json({
      businessName: artisan.business_name,
      category: artisan.category,
      state: artisan.state,
      city: artisan.city,
      area: artisan.area,
      address: artisan.address,
      homeService: artisan.home_service ? "yes" : "no",
      experience: artisan.experience_years,
      description: artisan.description,
    })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { updateBusinessInfo, completeOnboarding, getMyArtisanProfile }