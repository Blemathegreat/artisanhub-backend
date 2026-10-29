const express = require("express")
const router = express.Router()
const { updateBusinessInfo, completeOnboarding, getMyArtisanProfile } = require("../controller/ArtisanController.js")
const authMiddleware = require("../middleware/authmiddleware")

router.put("/me", authMiddleware, updateBusinessInfo)
router.post("/me/complete", authMiddleware, completeOnboarding)
router.get("/me", authMiddleware, getMyArtisanProfile)

module.exports = router