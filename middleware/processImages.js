const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

const MAX_WIDTH = 1200;
const MAX_HEIGHT = 1200;
const THUMB_SIZE = 300;
const QUALITY = 80;

/**
 * Post-process uploaded images with sharp.
 * Resizes to max 1200px, converts to WebP, creates thumbnail.
 * Updates req.files in-place so downstream routes see processed paths.
 */
async function processImages(req, res, next) {
  if (!req.files || req.files.length === 0) return next();

  const processed = [];

  for (const file of req.files) {
    const dir = path.dirname(file.path);
    const baseName = path.basename(file.filename, path.extname(file.filename));
    const outName = `${baseName}.webp`;
    const thumbName = `${baseName}-thumb.webp`;
    const outPath = path.join(dir, outName);
    const thumbPath = path.join(dir, thumbName);

    try {
      // Resize main image and convert to WebP
      await sharp(file.path)
        .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(outPath);

      // Create thumbnail
      await sharp(file.path)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: QUALITY })
        .toFile(thumbPath);

      // Delete original
      await fs.unlink(file.path);

      // Update file metadata
      file.filename = outName;
      file.path = outPath;
      file.mimetype = 'image/webp';
      file.size = (await fs.stat(outPath)).size;

      processed.push(file);
    } catch (err) {
      console.error('Image processing error:', err.message);
      // Keep original if processing fails
      processed.push(file);
    }
  }

  req.files = processed;
  next();
}

module.exports = processImages;
