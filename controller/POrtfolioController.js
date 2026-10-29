const pool = require("../config/db.js")
const cloudinary = require("../config/Cloudinary.js")
const streamifier = require("streamifier")

// Cloudinary's upload_stream function uses old-style callbacks, not
// Promises — so we can't just `await` it directly. This helper wraps
// it in a Promise, so the rest of our code can use async/await like normal.
function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "artisanhub/portfolio", resource_type: "auto" },
      (error, result) => {
        if (error) return reject(error)
        resolve(result)
      }
    )
    // Turns the in-memory buffer into a stream, then feeds it into
    // Cloudinary's upload stream — this is the actual upload happening.
    streamifier.createReadStream(buffer).pipe(uploadStream)
  })
}

// Small helper so we don't repeat the same lookup in every function
async function findArtisanId(userId) {
  const [rows] = await pool.query(
    "SELECT id FROM artisans WHERE user_id = ?",
    [userId]
  )
  return rows.length > 0 ? rows[0].id : null
}

async function uploadPortfolioItem(req, res) {
  let uploaded = null   // remembers the Cloudinary result so we can delete it if the DB fails
  let connection = null

  try {
    const artisanId = await findArtisanId(req.user.id)
    if (!artisanId) {
      return res.status(404).json({ message: "Artisan profile not found" })
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file was uploaded" })
    }

    // Slow network call FIRST, before we open a transaction
    uploaded = await uploadBufferToCloudinary(req.file.buffer)
    const mediaUrl = uploaded.secure_url
    const mediaType = uploaded.resource_type === "video" ? "video" : "image"

    connection = await pool.getConnection()
    await connection.beginTransaction()

    // Lock this artisan's row: simultaneous uploads now take turns
    await connection.query(
      "SELECT id FROM artisans WHERE id = ? FOR UPDATE",
      [artisanId]
    )

    const [coverRows] = await connection.query(
      "SELECT id FROM portfolio_items WHERE artisan_id = ? AND is_cover = 1",
      [artisanId]
    )

    // The SERVER decides: first image with no existing cover becomes the cover
    const isCover = mediaType === "image" && coverRows.length === 0

    const [insertResult] = await connection.query(
      "INSERT INTO portfolio_items (artisan_id, media_type, media_url, is_cover) VALUES (?, ?, ?, ?)",
      [artisanId, mediaType, mediaUrl, isCover]
    )

    await connection.commit()

    return res.status(201).json({
      message: "Portfolio item uploaded successfully",
      item: { id: insertResult.insertId, mediaType, mediaUrl, isCover },
    })
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {})

    // DB failed but the file is already on Cloudinary: remove it
    if (uploaded) {
      cloudinary.uploader
        .destroy(uploaded.public_id, { resource_type: uploaded.resource_type })
        .catch((err) => console.error("Cloudinary cleanup failed:", err))
    }

    console.error("Portfolio upload error:", error)
    return res.status(500).json({ message: "Internal server error" })
  } finally {
    if (connection) connection.release()
  }
}

async function setCoverImage(req, res) {
  let connection = null

  try {
    const itemId = Number(req.params.id)
    if (!Number.isInteger(itemId)) {
      return res.status(400).json({ message: "Invalid portfolio item id" })
    }

    const artisanId = await findArtisanId(req.user.id)
    if (!artisanId) {
      return res.status(404).json({ message: "Artisan profile not found" })
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()

    await connection.query(
      "SELECT id FROM artisans WHERE id = ? FOR UPDATE",
      [artisanId]
    )

    // Ownership check: the photo must belong to THIS artisan
    const [itemRows] = await connection.query(
      "SELECT id, media_type FROM portfolio_items WHERE id = ? AND artisan_id = ?",
      [itemId, artisanId]
    )
    if (itemRows.length === 0) {
      await connection.rollback()
      return res.status(404).json({ message: "Portfolio item not found" })
    }
    if (itemRows[0].media_type !== "image") {
      await connection.rollback()
      return res.status(400).json({ message: "Only images can be the cover" })
    }

    // Order matters: clear the old cover FIRST, then set the new one
    await connection.query(
      "UPDATE portfolio_items SET is_cover = 0 WHERE artisan_id = ?",
      [artisanId]
    )
    await connection.query(
      "UPDATE portfolio_items SET is_cover = 1 WHERE id = ?",
      [itemId]
    )

    await connection.commit()
    return res.status(200).json({ message: "Cover image updated", coverId: itemId })
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {})
    console.error("Set cover error:", error)
    return res.status(500).json({ message: "Internal server error" })
  } finally {
    if (connection) connection.release()
  }
}



async function getMyPortfolio(req, res) {
  try {
    const userId = req.user.id

    const [artisanRows] = await pool.query(
      "SELECT id FROM artisans WHERE user_id = ?",
      [userId]
    )
    if (artisanRows.length === 0) {
      return res.status(404).json({ message: "Artisan profile not found" })
    }
    const artisanId = artisanRows[0].id

    const [items] = await pool.query(
      "SELECT id, media_type, media_url, is_cover, created_at FROM portfolio_items WHERE artisan_id = ? ORDER BY created_at DESC",
      [artisanId]
    )

    return res.status(200).json({ items })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { uploadPortfolioItem, getMyPortfolio, setCoverImage }