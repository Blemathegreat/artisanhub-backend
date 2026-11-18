// Account-field rules, kept in ONE place so register and "edit my account"
// can never disagree. These mirror the Zod schema on the frontend.

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

// Nigerian numbers arrive in several spellings for the SAME phone:
//   08012345678   +2348012345678   2348012345678   0801 234 5678
// We always store the plain local form (08012345678) so the UNIQUE rule on
// phone_number works, otherwise one person could register the same phone twice.
function normalizePhone(value) {
  const compact = String(value || "").replace(/[\s\-()]/g, "")
  if (compact.startsWith("+234")) return `0${compact.slice(4)}`
  if (compact.startsWith("234")) return `0${compact.slice(3)}`
  return compact
}

// Every spelling a phone might already be stored under (older rows may
// not have been normalized), used when checking "is this number taken?".
function phoneVariants(localPhone) {
  const rest = localPhone.slice(1)
  return [localPhone, `+234${rest}`, `234${rest}`]
}

const NG_PHONE = /^0[789][01]\d{8}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Each checker returns an error message, or null when the value is fine.
function checkFullName(value) {
  const name = String(value || "").trim()
  if (name.length < 3) return "Full name must be at least 3 characters"
  if (name.length > 60) return "Full name is too long"
  return null
}

function checkEmail(value) {
  if (!EMAIL.test(value)) return "Please enter a valid email address"
  if (value.length > 150) return "Email is too long"
  return null
}

function checkPhone(value) {
  if (!NG_PHONE.test(value)) return "Enter a valid Nigerian phone number (e.g. 08012345678)"
  return null
}

module.exports = {
  normalizeEmail, normalizePhone, phoneVariants,
  checkFullName, checkEmail, checkPhone,
}
