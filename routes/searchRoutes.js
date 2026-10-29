const express = require("express")
const router = express.Router()
const { getArtisans, getArtisanById } = require("../controller/SearchController")

// No authMiddleware here on purpose — search must work for
// logged-out visitors browsing the site too.
router.get("/", getArtisans)
router.get("/:id", getArtisanById)

module.exports = router