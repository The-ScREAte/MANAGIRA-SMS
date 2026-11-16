const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const s3ObjectUrl = require("../utils/publicImageUrl").s3ObjectUrl;
require("dotenv").config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Upload to S3
const uploadToS3 = async (file) => {
  // Define the safe upload directory
  const uploadDir = path.resolve(__dirname, "../uploads"); // adjust this to your actual multer disk storage destination

  // Only allow the base filename (prevents ../../ etc)
  const safeFilename = path.basename(file.filename); // not originalname!
  const safePath = path.join(uploadDir, safeFilename);

  // Read the file from the safe path asynchronously to avoid blocking the event loop.
  const fileContent = await fsp.readFile(safePath);

  // A random part makes a stored file's address impossible to guess; the original name (made safe)
  // stays readable at the end. `file.prefix` puts it in a folder (images/ads/ for the public
  // sign-in banners; everything else is private: utils/storedFiles.js).
  const original = String(file.originalname || "file");
  const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
  const base = path.basename(original, path.extname(original)).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/_+/g, "_").slice(0, 60) || "file";
  const prefix = /^[a-z0-9-]+(\/[a-z0-9-]+)*\/$/i.test(String(file.prefix || "")) ? String(file.prefix) : "";
  const fileName = `${prefix}${Date.now()}-${require("crypto").randomUUID()}-${base}${ext}`;
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    Body: fileContent,
    ContentType: file.mimetype,
    // Optional, e.g. files whose name never changes can be cached by browsers for good.
    ...(file.cacheControl ? { CacheControl: file.cacheControl } : {}),
  };

  try {
    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    return {
      Location: s3ObjectUrl(fileName),
      Key: fileName,
    };
  } finally {
    // Cleanup temporary multer disk file after upload attempt.
    if (safePath) {
      try {
        await fsp.unlink(safePath);
      } catch (cleanupError) {
        // Ignore cleanup errors so upload response behavior is not affected.
      }
    }
  }
};

// Delete from S3
const deleteFromS3 = async (key) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  };

  const command = new DeleteObjectCommand(params);
  await s3Client.send(command);
};

module.exports = {
  s3Client,
  PutObjectCommand,
  GetObjectCommand,
  uploadToS3,
  deleteFromS3, // ✅ Now exported
};
