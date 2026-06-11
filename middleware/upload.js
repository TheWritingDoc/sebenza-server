const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Base uploads directory — always project root, regardless of where server starts
const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');

// Ensure directories exist
const dirs = [
  path.join(UPLOADS_BASE, 'proof'),
  path.join(UPLOADS_BASE, 'ids'),
  path.join(UPLOADS_BASE, 'selfies'),
  path.join(UPLOADS_BASE, 'profiles'),
  path.join(UPLOADS_BASE, 'services'),
  path.join(UPLOADS_BASE, 'jobs')
];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'idFront' || file.fieldname === 'idBack') {
      cb(null, path.join(UPLOADS_BASE, 'ids'));
    } else if (file.fieldname === 'selfie') {
      cb(null, path.join(UPLOADS_BASE, 'selfies'));
    } else if (file.fieldname === 'profileImage') {
      cb(null, path.join(UPLOADS_BASE, 'profiles'));
    } else if (file.fieldname === 'proofImages' || file.fieldname === 'completionPhotos' || file.fieldname === 'workProofPhotos') {
      cb(null, path.join(UPLOADS_BASE, 'proof'));
    } else if (file.fieldname === 'jobImages') {
      cb(null, path.join(UPLOADS_BASE, 'proof'));
    } else if (file.fieldname === 'images') {
      // Service creation images
      cb(null, path.join(UPLOADS_BASE, 'services'));
    } else if (file.fieldname === 'jobPostImages' || file.fieldname === 'issuePhotos') {
      cb(null, path.join(UPLOADS_BASE, 'jobs'));
    } else {
      cb(null, UPLOADS_BASE);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

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
  storage: storage,
  limits: { 
    fileSize: 15 * 1024 * 1024, // 15MB per file
    files: 10 // Max 10 files per upload
  },
  fileFilter: fileFilter
});

module.exports = upload;
