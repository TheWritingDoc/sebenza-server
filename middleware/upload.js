const multer = require('multer');
const path = require('path');

/**
 * Uploads go to Supabase Storage (bucket `uploads` is public; `secure-docs`
 * holds KYC/trust documents and is private — served via signed URLs).
 * Falls back to local disk when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are
 * missing so `npm run dev` works without credentials.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const storageEnabled = !!(SUPABASE_URL && SERVICE_KEY);

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !storageEnabled) {
  console.warn('WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in production. Uploads will fall back to local disk and will be lost on redeploy.');
}

let supabase = null;
if (storageEnabled) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// KYC and identity documents live in the private bucket.
const PRIVATE_FOLDERS = new Set(['trust', 'ids', 'selfies', 'kyc']);
function bucketFor(folder) {
  const root = String(folder || 'misc').split('/')[0];
  return PRIVATE_FOLDERS.has(root) ? 'secure-docs' : 'uploads';
}

// ── Local-dev disk fallback ─────────────────────────────────────────────
const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');
const fs = require('fs');
if (!storageEnabled) {
  ['proof', 'ids', 'selfies', 'profiles', 'services', 'jobs', 'trust', 'misc'].forEach(d => {
    const dir = path.join(UPLOADS_BASE, d);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(UPLOADS_BASE, resolveFolder(file.fieldname)));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const memoryStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, and WebP images are allowed.`), false);
  }
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error(`Invalid file extension: ${ext}. Only .jpg, .jpeg, .png, and .webp files are allowed.`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storageEnabled ? memoryStorage : diskStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB per file
    files: 10
  },
  fileFilter
});

function resolveFolder(fieldname) {
  if (fieldname === 'idFront' || fieldname === 'idBack') return 'ids';
  if (fieldname === 'selfie') return 'selfies';
  if (fieldname === 'profileImage') return 'profiles';
  if (['proofImages', 'completionPhotos', 'workProofPhotos', 'photos', 'stopPhotos'].includes(fieldname)) return 'proof';
  if (fieldname === 'jobImages' || fieldname === 'jobPostImages' || fieldname === 'issuePhotos') return 'jobs';
  if (fieldname === 'images') return 'services';
  if (fieldname === 'trustDoc') return 'trust';
  return 'misc';
}

async function uploadFile(file, folder) {
  if (!storageEnabled) {
    const folderPath = resolveFolder(file.fieldname);
    return `/uploads/${folderPath}/${file.filename}`;
  }

  const bucket = bucketFor(folder);
  const safeName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9-_]/g, '-');
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const objectPath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}-${safeName}${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  if (bucket === 'uploads') {
    return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  }
  // Private documents (KYC/ID): store only a reference to the object, NOT a
  // long-lived URL. A short-lived signed URL is minted on each authenticated
  // read (see signSecureUrl / verification.js), so a leaked link expires in
  // minutes instead of a year.
  return `${SECURE_SCHEME}${bucket}/${objectPath}`;
}

// Marker for stored private-doc references, e.g. "securedoc://secure-docs/trust/id/123.png".
const SECURE_SCHEME = 'securedoc://';

/**
 * Mint a short-lived signed URL for a stored private-doc reference.
 * @param {string} stored - value saved by uploadFile (securedoc://bucket/path)
 * @param {number} expiresSeconds - default 5 minutes
 * @returns {Promise<string|null>} signed URL, or null if not a secure ref
 */
async function signSecureUrl(stored, expiresSeconds = 300) {
  if (!storageEnabled || typeof stored !== 'string' || !stored.startsWith(SECURE_SCHEME)) return null;
  const rest = stored.slice(SECURE_SCHEME.length); // "bucket/path/to/obj"
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const bucket = rest.slice(0, slash);
  const objectPath = rest.slice(slash + 1);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresSeconds);
  if (error) throw new Error(`Storage sign failed: ${error.message}`);
  return data.signedUrl;
}

async function uploadFiles(files, folder) {
  if (!Array.isArray(files)) return [];
  return Promise.all(files.map(file => uploadFile(file, folder)));
}

module.exports = upload;
module.exports.uploadFile = uploadFile;
module.exports.uploadFiles = uploadFiles;
module.exports.signSecureUrl = signSecureUrl;
module.exports.storageEnabled = storageEnabled;
module.exports.resolveFolder = resolveFolder;
