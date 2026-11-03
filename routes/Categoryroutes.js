const express = require("express")
const router = express.Router()
const { getCategories } = require("../controller/Categorycontroller.js")

router.get("/", getCategories)

module.exports = router