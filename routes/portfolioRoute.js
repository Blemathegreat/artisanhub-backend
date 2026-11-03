const express = require("express")
const router = express.Router()
const upload = require("../config/upload")
const authMiddleware = require("../middleware/authMiddleware")
const { uploadPortfolioItem, getMyPortfolio, setCoverImage } = require("../controller/POrtfolioController")

router.post("/", authMiddleware, upload.single("file"), uploadPortfolioItem)
router.get("/me", authMiddleware, getMyPortfolio)
router.put("/:id/cover", authMiddleware, setCoverImage)

module.exports = router