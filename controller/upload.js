const multer = require('multer')

// Instead of writing files to disk (or relying on a helper package to
// auto-forward them to Cloudinary), we hold each upload in memory
// temporarily — as a raw buffer — and upload it to Cloudinary ourselves,
// in the controller.
const upload = multer({ storage: multer.memoryStorage() })

module.exports = upload