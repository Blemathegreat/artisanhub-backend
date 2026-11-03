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