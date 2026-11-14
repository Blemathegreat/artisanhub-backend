const pool = require("../config/db.js")

const MAX_SERVICES_PER_ARTISAN = 20

// Finds the artisan profile that belongs to the logged-in user.
async function findArtisanId(userId) {
  const [rows] = await pool.query("SELECT id FROM artisans WHERE user_id = ?", [userId])
  return rows.length > 0 ? rows[0].id : null
}

// Validates the form body. Returns { error } or { values }.
function readServiceBody(body) {
  const serviceName = String(body.serviceName || "").trim()
  const description = String(body.description || "").trim()
  const rawPrice = body.startingPrice

  if (!serviceName) return { error: "Service name is required" }
  if (serviceName.length > 100) return { error: "Service name must be 100 characters or less" }
  if (description.length > 255) return { error: "Description must be 255 characters or less" }

  let startingPrice = null
  if (rawPrice !== "" && rawPrice !== null && rawPrice !== undefined) {
    startingPrice = Number(rawPrice)
    if (!Number.isFinite(startingPrice) || startingPrice < 0 || startingPrice > 99999999) {
      return { error: "Starting price must be a valid number" }
    }
  }

  return { values: { serviceName, description: description || null, startingPrice } }
}

async function getMyServices(req, res) {
  try {
    const artisanId = await findArtisanId(req.user.id)
    if (!artisanId) return res.status(404).json({ message: "Artisan profile not found" })

    const [services] = await pool.query(
      "SELECT id, service_name, description, starting_price FROM artisan_services WHERE artisan_id = ? ORDER BY id DESC",
      [artisanId]
    )
    return res.status(200).json({ services })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function addService(req, res) {
  try {
    const artisanId = await findArtisanId(req.user.id)
    if (!artisanId) return res.status(404).json({ message: "Artisan profile not found" })

    const { error, values } = readServiceBody(req.body)
    if (error) return res.status(400).json({ message: error })

    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS total FROM artisan_services WHERE artisan_id = ?",
      [artisanId]
    )
    if (countRows[0].total >= MAX_SERVICES_PER_ARTISAN) {
      return res.status(400).json({
        message: `You can list up to ${MAX_SERVICES_PER_ARTISAN} services. Remove one to add another.`,
      })
    }

    const [result] = await pool.query(
      "INSERT INTO artisan_services (artisan_id, service_name, description, starting_price) VALUES (?, ?, ?, ?)",
      [artisanId, values.serviceName, values.description, values.startingPrice]
    )
    return res.status(201).json({ message: "Service added", id: result.insertId })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function updateService(req, res) {
  try {
    const serviceId = Number(req.params.id)
    if (!Number.isInteger(serviceId)) return res.status(400).json({ message: "Invalid service id" })

    const artisanId = await findArtisanId(req.user.id)
    if (!artisanId) return res.status(404).json({ message: "Artisan profile not found" })

    const { error, values } = readServiceBody(req.body)
    if (error) return res.status(400).json({ message: error })

    // "AND artisan_id = ?" is the ownership check: you can only edit YOUR services.
    const [result] = await pool.query(
      `UPDATE artisan_services
       SET service_name = ?, description = ?, starting_price = ?
       WHERE id = ? AND artisan_id = ?`,
      [values.serviceName, values.description, values.startingPrice, serviceId, artisanId]
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: "Service not found" })

    return res.status(200).json({ message: "Service updated" })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function deleteService(req, res) {
  try {
    const serviceId = Number(req.params.id)
    if (!Number.isInteger(serviceId)) return res.status(400).json({ message: "Invalid service id" })

    const artisanId = await findArtisanId(req.user.id)
    if (!artisanId) return res.status(404).json({ message: "Artisan profile not found" })

    const [result] = await pool.query(
      "DELETE FROM artisan_services WHERE id = ? AND artisan_id = ?",
      [serviceId, artisanId]
    )
    if (result.affectedRows === 0) return res.status(404).json({ message: "Service not found" })

    return res.status(200).json({ message: "Service deleted" })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { getMyServices, addService, updateService, deleteService }
