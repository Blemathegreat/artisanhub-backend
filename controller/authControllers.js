const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const pool = require("../config/db.js")
const SALT_ROUNDS = 10

async function register(req, res) {
  try {
    const { fullName, email, phone, password, role } = req.body;

    if (!fullName || !email || !phone || !password || !role) {
      return res.status(400).json({ message: "All fields are required" })
    }
    if (!["artisan", "customer"].includes(role)) {
      return res.status(400).json({ message: "Role must be either artisan or customer" })
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long" })
    }

    const [existing] = await pool.query(
      "SELECT user_id FROM users WHERE email = ? OR phone_number = ?",
      [email, phone]
    )
    if (existing.length > 0) {
      return res.status(409).json({ message: "Email or phone number is already registered" })
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)

    const [result] = await pool.query(
      "INSERT INTO users (full_name, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [fullName, email, phone, hashedPassword, role]
    )
    const insertedId = result.insertId

    if (role === "artisan") {
      await pool.query("INSERT INTO artisans (user_id) VALUES (?)", [insertedId])
    }

    const token = jwt.sign(
      { id: insertedId, role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    )

    return res.status(201).json({
      message: "User registered successfully",
      token,
      user: { id: insertedId, fullName, email, role }
    })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    const [rows] = await pool.query(
      "SELECT user_id, full_name, email, password_hash, role FROM users WHERE email = ?",
      [email]
    )
    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const user = rows[0]
    const isMatch = await bcrypt.compare(password, user.password_hash)
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    // For artisans specifically, also check how far they've gotten
    // through onboarding — customers don't have this concept at all.
    let isOnboarded = null
    let onboardingStage = null

    if (user.role === "artisan") {
      const [artisanRows] = await pool.query(
        "SELECT is_onboarded, onboarding_stage FROM artisans WHERE user_id = ?",
        [user.user_id]
      )
      if (artisanRows.length > 0) {
        isOnboarded = !!artisanRows[0].is_onboarded
        onboardingStage = artisanRows[0].onboarding_stage
      }
    }

    const token = jwt.sign(
      { id: user.user_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    )

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.user_id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isOnboarded,
        onboardingStage,
      }
    })

  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function getme(req, res) {
  try {
    const [rows] = await pool.query(
      "SELECT user_id, full_name, email, phone_number, role FROM users WHERE user_id = ?",
      [req.user.id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" })
    }
    const user = rows[0]
    return res.status(200).json({
      user: { id: user.user_id, fullName: user.full_name, email: user.email, phone: user.phone_number, role: user.role }
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { register, login, getme, }