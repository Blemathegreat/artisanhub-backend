require("dotenv").config()
const express = require("express")
const cors = require("cors")
const pool = require("./config/db.js")

const authRoutes = require("./routes/authRoutes.js")
const artisanRoutes = require("./routes/artisanRoute.js")
const categoryRoutes = require("./routes/Categoryroutes.js")
const portfolioRoutes = require("./routes/portfolioRoute.js")
const serviceRoutes = require("./routes/Serviceroute.js")
const SearchRouter = require("./routes/searchRoutes.js")

const app = express()

// ---- CORS: only YOUR website may call this API from a browser ----
// FRONTEND_URL can hold several addresses separated by commas, e.g.
//   https://artisanhub.vercel.app,https://www.artisanhub.com
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter(Boolean)
allowedOrigins.push("http://localhost:5173", "http://127.0.0.1:5173")

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = not a browser (Postman, curl, health checks): allow.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      return callback(new Error("CORS_BLOCKED"))
    },
  })
)
app.use(express.json({ limit: "1mb" }))

// ---- Health check: Render and uptime monitors call this ----
app.get("/", (req, res) => res.json({ status: "ok", service: "artisanhub-api" }))
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1")
    res.json({ status: "ok", database: "up" })
  } catch (error) {
    res.status(503).json({ status: "degraded", database: "down" })
  }
})

// ---- Routes ----
// ORDER MATTERS: Express uses the FIRST route that matches, so the specific
// path (/api/artisans/search) must come BEFORE the general one (/api/artisans).
app.use("/api/artisans/search", SearchRouter)
app.use("/api/artisans", artisanRoutes)
app.use("/api/categories", categoryRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/portfolio", portfolioRoutes)
app.use("/api/services", serviceRoutes)

// ---- Unknown URL -> clean JSON instead of an HTML error page ----
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` })
})

// ---- Last line of defence: no stack traces leak to the browser ----
app.use((error, req, res, next) => {
  if (error.message === "CORS_BLOCKED") {
    return res.status(403).json({ message: "This website is not allowed to use the API" })
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON in request body" })
  }
  console.log(error)
  res.status(500).json({ message: "Internal server error" })
})

const port = process.env.PORT || 5000
app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
