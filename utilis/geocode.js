const pool = require("../config/db.js")

// Turns a plain-text address/location into real coordinates.
// Checks our own cache first, only calls Nominatim if we've genuinely
// never geocoded this exact text before.
async function geocodeAddress(address) {
  const normalized = address.trim().toLowerCase()

  // 1. Check the cache first — no network call needed if we already have it
  const [cached] = await pool.query(
    "SELECT latitude, longitude FROM geocode_cache WHERE query_text = ?",
    [normalized]
  )
  if (cached.length > 0) {
    return { latitude: cached[0].latitude, longitude: cached[0].longitude }
  }

  // 2. Not cached — actually call Nominatim
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`

  const response = await fetch(url, {
    headers: {
      // Nominatim's usage policy requires a real, identifying User-Agent —
      // requests without one can be rejected or blocked.
      "User-Agent": "ArtisanHub/1.0 (student project)",
    },
  })
  const results = await response.json()

  // Nominatim found nothing matching this text at all
  if (!results || results.length === 0) {
    return null
  }

  const latitude = parseFloat(results[0].lat)
  const longitude = parseFloat(results[0].lon)

  
  await pool.query(
    "INSERT INTO geocode_cache (query_text, latitude, longitude) VALUES (?, ?, ?)",
    [normalized, latitude, longitude]
  )

  return { latitude, longitude }
}

module.exports = { geocodeAddress }