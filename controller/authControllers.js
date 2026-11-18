const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const pool = require("../config/db.js")
const {
  normalizeEmail, normalizePhone, phoneVariants,
  checkFullName, checkEmail, checkPhone,
} = require("../utilis/validators.js")

const SALT_ROUNDS = 10

function signToken(userId, role) {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: "7d" })
}

// ONE function builds the "user" object every endpoint returns, so login,
// register, /me and "edit account" can never drift apart again. (They had:
// /me forgot isOnboarded, so a page refresh bounced finished artisans back
// to the onboarding wizard.)
async function buildUser(userId) {
  const [rows] = await pool.query(
    "SELECT user_id, full_name, email, phone_number, role FROM users WHERE user_id = ?",
    [userId]
  )
  if (rows.length === 0) return null
  const row = rows[0]

  let isOnboarded = null
  let onboardingStage = null
  if (row.role === "artisan") {
    const [artisanRows] = await pool.query(
      "SELECT is_onboarded, onboarding_stage FROM artisans WHERE user_id = ?",
      [userId]
    )
    if (artisanRows.length > 0) {
      isOnboarded = !!artisanRows[0].is_onboarded
      onboardingStage = artisanRows[0].onboarding_stage
    }
  }

  return {
    id: row.user_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_number,
    role: row.role,
    isOnboarded,
    onboardingStage,
  }
}

// Which of email / phone is already used by SOMEONE ELSE? Returns
// { field, message } or null. `exceptUserId` lets a user keep their own values.
async function findDuplicate({ email, phone }, exceptUserId = 0) {
  if (email) {
    const [rows] = await pool.query(
      "SELECT user_id FROM users WHERE email = ? AND user_id <> ?",
      [email, exceptUserId]
    )
    if (rows.length > 0) {
      return { field: "email", message: "This email is already registered. Log in to continue where you stopped." }
    }
  }
  if (phone) {
    const variants = phoneVariants(phone)
    const [rows] = await pool.query(
      "SELECT user_id FROM users WHERE phone_number IN (?, ?, ?) AND user_id <> ?",
      [...variants, exceptUserId]
    )
    if (rows.length > 0) {
      return { field: "phone", message: "This phone number is already registered. Log in to continue where you stopped." }
    }
  }
  return null
}

// Two requests can pass the check above at the same instant. The UNIQUE keys
// in MySQL are the last line of defence; translate that raw error into the
// same friendly answer.
function duplicateFromDbError(error) {
  if (error.code !== "ER_DUP_ENTRY") return null
  const text = String(error.sqlMessage || error.message)
  if (text.includes("phone_number")) {
    return { field: "phone", message: "This phone number is already registered. Log in to continue where you stopped." }
  }
  return { field: "email", message: "This email is already registered. Log in to continue where you stopped." }
}

async function register(req, res) {
  try {
    const { fullName, password, role } = req.body
    const email = normalizeEmail(req.body.email)
    const phone = normalizePhone(req.body.phone)

    if (!fullName || !email || !phone || !password || !role) {
      return res.status(400).json({ message: "All fields are required" })
    }
    if (!["artisan", "customer"].includes(role)) {
      return res.status(400).json({ message: "Role must be either artisan or customer" })
    }
    const problem = checkFullName(fullName) || checkEmail(email) || checkPhone(phone)
    if (problem) return res.status(400).json({ message: problem })
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long" })
    }

    // ADE CAME BACK. He started signing up earlier, never finished, and is now
    // filling the sign-up form AGAIN with the same email. If the password he
    // typed matches the one he chose the first time, he has proved he is the
    // same person, so we treat this as "log me in and take me where I stopped"
    // instead of failing on the UNIQUE email. Without a matching password we
    // never log anyone in (otherwise anybody who knew Ade's email could).
    const [sameEmail] = await pool.query(
      "SELECT user_id, password_hash, role FROM users WHERE email = ?",
      [email]
    )
    if (sameEmail.length > 0 && role === "artisan" && sameEmail[0].role === "artisan") {
      const passwordMatches = await bcrypt.compare(password, sameEmail[0].password_hash)
      if (passwordMatches) {
        const [artisanRows] = await pool.query(
          "SELECT is_onboarded FROM artisans WHERE user_id = ?",
          [sameEmail[0].user_id]
        )
        const unfinished = artisanRows.length > 0 && !artisanRows[0].is_onboarded
        if (unfinished) {
          return res.status(200).json({
            message: "Welcome back! Continuing where you stopped.",
            resumed: true,
            token: signToken(sameEmail[0].user_id, "artisan"),
            user: await buildUser(sameEmail[0].user_id),
          })
        }
      }
    }

    const duplicate = await findDuplicate({ email, phone })
    if (duplicate) return res.status(409).json(duplicate)

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS)

    let insertedId
    try {
      const [result] = await pool.query(
        "INSERT INTO users (full_name, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, ?)",
        [String(fullName).trim(), email, phone, hashedPassword, role]
      )
      insertedId = result.insertId
    } catch (dbError) {
      const duplicateRace = duplicateFromDbError(dbError)
      if (duplicateRace) return res.status(409).json(duplicateRace)
      throw dbError
    }

    if (role === "artisan") {
      await pool.query("INSERT INTO artisans (user_id) VALUES (?)", [insertedId])
    }

    return res.status(201).json({
      message: "User registered successfully",
      token: signToken(insertedId, role),
      user: await buildUser(insertedId),
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function login(req, res) {
  try {
    const email = normalizeEmail(req.body.email)
    const { password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    const [rows] = await pool.query(
      "SELECT user_id, password_hash, role FROM users WHERE email = ?",
      [email]
    )
    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    const isMatch = await bcrypt.compare(password, rows[0].password_hash)
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" })
    }

    return res.status(200).json({
      message: "Login successful",
      token: signToken(rows[0].user_id, rows[0].role),
      user: await buildUser(rows[0].user_id),
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function getme(req, res) {
  try {
    const user = await buildUser(req.user.id)
    if (!user) return res.status(404).json({ message: "User not found" })
    return res.status(200).json({ user })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

// PUT /api/auth/me — "I went back and want to fix my name / email / phone".
// Only the fields that are sent change. Uniqueness is checked against OTHER
// users, so keeping your own email or phone never counts as a clash.
// (Role and password are deliberately NOT editable here.)
async function updateMe(req, res) {
  try {
    const userId = req.user.id
    const changes = {}

    if (req.body.fullName !== undefined) {
      const problem = checkFullName(req.body.fullName)
      if (problem) return res.status(400).json({ message: problem, field: "fullName" })
      changes.full_name = String(req.body.fullName).trim()
    }
    if (req.body.email !== undefined) {
      const email = normalizeEmail(req.body.email)
      const problem = checkEmail(email)
      if (problem) return res.status(400).json({ message: problem, field: "email" })
      changes.email = email
    }
    if (req.body.phone !== undefined) {
      const phone = normalizePhone(req.body.phone)
      const problem = checkPhone(phone)
      if (problem) return res.status(400).json({ message: problem, field: "phone" })
      changes.phone_number = phone
    }

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ message: "Nothing to update" })
    }

    const duplicate = await findDuplicate(
      { email: changes.email, phone: changes.phone_number },
      userId
    )
    if (duplicate) return res.status(409).json(duplicate)

    // Column names come from the fixed list above, never from the request,
    // so building the SET clause this way is safe.
    const setClause = Object.keys(changes).map((column) => `${column} = ?`).join(", ")
    try {
      await pool.query(
        `UPDATE users SET ${setClause} WHERE user_id = ?`,
        [...Object.values(changes), userId]
      )
    } catch (dbError) {
      const duplicateRace = duplicateFromDbError(dbError)
      if (duplicateRace) return res.status(409).json(duplicateRace)
      throw dbError
    }

    return res.status(200).json({
      message: "Account updated",
      user: await buildUser(userId),
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Internal server error" })
  }
}

module.exports = { register, login, getme, updateMe }
