// One-off helper: gives every live artisan who has NO map pin a pin.
//
// Run it from the backend folder, with your .env pointing at the database
// you want to fix (local, or Aiven via the Render values):
//
//     node scripts/backfillCoordinates.js
//
// It is slow on purpose (Nominatim allows 1 request per second) and safe to
// run twice: it only touches artisans whose latitude is still empty.
require("dotenv").config()
const pool = require("../config/db.js")
const { geocodeAddress } = require("../utilis/geocode.js")

function join(parts) {
  return parts.map((p) => (p || "").trim()).filter(Boolean).join(", ")
}

async function main() {
  const [artisans] = await pool.query(
    `SELECT id, business_name, address, area, city, state
     FROM artisans
     WHERE is_onboarded = TRUE AND (latitude IS NULL OR longitude IS NULL)`
  )
  console.log(`${artisans.length} artisan(s) need a map pin.`)

  let done = 0
  for (const a of artisans) {
    try {
      let precision = "exact"
      let coords = await geocodeAddress(join([a.address, a.area, a.city, a.state, "Nigeria"]))
      if (!coords) {
        precision = "approximate"
        coords = await geocodeAddress(join([a.city, a.state, "Nigeria"]))
      }
      if (!coords) {
        console.log(`  - ${a.business_name}: could not locate, skipped`)
        continue
      }
      await pool.query(
        "UPDATE artisans SET latitude = ?, longitude = ?, location_precision = ? WHERE id = ?",
        [coords.latitude, coords.longitude, precision, a.id]
      )
      done++
      console.log(`  + ${a.business_name}: ${precision} pin saved`)
    } catch (error) {
      console.log(`  ! ${a.business_name}: lookup failed (${error.message})`)
    }
  }
  console.log(`Finished. ${done} of ${artisans.length} updated.`)
  await pool.end()
}

main()
