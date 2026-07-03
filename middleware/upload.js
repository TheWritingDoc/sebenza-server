const multer = require('multer');
const path = require('path');
const { Readable } = require('stream');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary. In production these must be set or uploads are impossible.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const isProd = process.env.NODE_ENV === 'production';
const cloudinaryEnabled = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

if (isProd && !cloudinaryEnabled) {
  console.warn('WARNING: Cloudinary credentials are not set in production. Uploads will fall back to local disk and will be lost on redeploy. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to enable persistent uploads.');
}

// Fallback disk storage for local development when Cloudinary is not configured.
// This keeps `npm run dev` working without credentials, but production is protected
// by the fail-fast check above.
const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');
const fs = require('fs');
if (!cloudinaryEnabled) {
  const dirs = [
    path.join(UPLOADS_BASE, 'proof'),
    path.join(UPLOADS_BASE, 'ids'),
    path.join(UPLOADS_BASE, 'selfies'),
    path.join(UPLOADS_BASE, 'profiles'),
    path.join(UPLOADS_BASE, 'services'),
    path.join(UPLOADS_BASE, 'jobs')
  ];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = resolveFolder(file.fieldname);
    cb(null, path.join(UPLOADS_BASE, folder));
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
  storage: cloudinaryEnabled ? memoryStorage : diskStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB per file
    files: 10 // Max 10 files per upload
  },
  fileFilter: fileFilter
});

function resolveFolder(fieldname) {
  if (fieldname === 'idFront' || fieldname === 'idBack') return 'ids';
  if (fieldname === 'selfie') return 'selfies';
  if (fieldname === 'profileImage') return 'profiles';
  if (['proofImages', 'completionPhotos', 'workProofPhotos', 'photos', 'stopPhotos'].includes(fieldname)) return 'proof';
  if (fieldname === 'jobImages' || fieldname === 'jobPostImages' || fieldname === 'issuePhotos') return 'jobs';
  if (fieldname === 'images') return 'services';
  return 'misc';
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    Readable.from(buffer).pipe(stream);
  });
}

async function uploadFile(file, folder) {
  if (!cloudinaryEnabled) {
    // Local fallback: return the same relative path shape the old code used.
    const folderPath = resolveFolder(file.fieldname);
    return `/uploads/${folderPath}/${file.filename}`;
  }

  const result = await uploadBuffer(file.buffer, {
    folder: `sebenza/${folder}`,
    resource_type: 'image',
    // Keep original filename as part of the public_id for easier debugging.
    public_id: `${Date.now()}-${Math.round(Math.random() * 1E9)}-${path.parse(file.originalname).name}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
    // Moderate for inappropriate content on KYC and proof photos.
    moderation: folder.startsWith('kyc') || folder === 'proof' ? 'aws_rek' : undefined
  });

  return result.secure_url;
}

async function uploadFiles(files, folder) {
  if (!Array.isArray(files)) return [];
  return Promise.all(files.map(file => uploadFile(file, folder)));
}

module.exports = upload;
module.exports.uploadFile = uploadFile;
module.exports.uploadFiles = uploadFiles;
module.exports.cloudinaryEnabled = cloudinaryEnabled;
module.exports.resolveFolder = resolveFolder;
