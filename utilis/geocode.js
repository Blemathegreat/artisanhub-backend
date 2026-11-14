const pool = require("../config/db.js")

// Nominatim (OpenStreetMap) is free, but its usage policy says:
//   - max 1 request per second
//   - send a User-Agent that identifies your app
// We obey both here, in ONE place, so no other file can break the rules.
const USER_AGENT =
  process.env.GEOCODER_USER_AGENT || "ArtisanHub/1.0 (set GEOCODER_USER_AGENT in .env)"
const MIN_GAP_MS = 1100

let lastCallAt = 0
let queue = Promise.resolve()

// Runs jobs one after another, at least MIN_GAP_MS apart. If 20 people
// search at once, they simply wait their turn instead of hammering Nominatim.
function throttled(job) {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastCallAt = Date.now()
    return job()
  })
  queue = run.catch(() => {}) // one failed job must not block the next ones
  return run
}

// Remember searches that found nothing for 10 minutes, so a typo like
// "Ikorodu Lagoss" doesn't hit Nominatim again on every keystroke.
const misses = new Map()
const MISS_TTL_MS = 10 * 60 * 1000

// "Street, , Lagos,  Nigeria" -> "street, lagos, nigeria"
function normalize(text) {
  return String(text)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ")
    .toLowerCase()
}

async function callNominatim(address) {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ng`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Nominatim responded ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

// Turns text like "Ikeja, Lagos, Nigeria" into { latitude, longitude }.
// Returns null when the place genuinely can't be found.
// THROWS when the lookup itself failed (network down) so callers can tell
// "place doesn't exist" apart from "we couldn't check".
async function geocodeAddress(address) {
  const normalized = normalize(address)
  if (!normalized) return null

  const missUntil = misses.get(normalized)
  if (missUntil && missUntil > Date.now()) return null

  // 1. Our own cache first: free and instant.
  const [cached] = await pool.query(
    "SELECT latitude, longitude FROM geocode_cache WHERE query_text = ?",
    [normalized]
  )
  if (cached.length > 0) {
    return { latitude: Number(cached[0].latitude), longitude: Number(cached[0].longitude) }
  }

  // 2. Not cached: ask Nominatim, politely.
  const results = await throttled(() => callNominatim(normalized))

  if (!Array.isArray(results) || results.length === 0) {
    misses.set(normalized, Date.now() + MISS_TTL_MS)
    return null
  }

  const latitude = parseFloat(results[0].lat)
  const longitude = parseFloat(results[0].lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  // INSERT IGNORE: if two requests geocode the same text at the same moment,
  // the second insert is silently skipped instead of crashing on the UNIQUE key.
  await pool.query(
    "INSERT IGNORE INTO geocode_cache (query_text, latitude, longitude) VALUES (?, ?, ?)",
    [normalized, latitude, longitude]
  )

  return { latitude, longitude }
}

module.exports = { geocodeAddress }
