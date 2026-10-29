const express = require("express")
const authMiddleware = require("../middleware/authmiddleware.js")
const router = express.Router()

const {login, register, getme} = require("../controller/authControllers.js")
 router.post("/register", register)
    router.post("/login", login)
    router.get("/me", authMiddleware, getme)
module.exports = router      
