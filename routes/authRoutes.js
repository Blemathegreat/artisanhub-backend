const express = require("express")
const authMiddleware = require("../middleware/authMiddleware.js")
const router = express.Router()

const { login, register, getme, updateMe } = require("../controller/authControllers.js")

router.post("/register", register)
router.post("/login", login)
router.get("/me", authMiddleware, getme)
router.put("/me", authMiddleware, updateMe)

module.exports = router
