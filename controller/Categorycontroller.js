const pool = require("../config/db.js")

async function getCategories(req, res) {
  try {
    const [categories] = await pool.query("SELECT id, name FROM categories ORDER BY name")
    return res.status(200).json({ categories })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { getCategories }