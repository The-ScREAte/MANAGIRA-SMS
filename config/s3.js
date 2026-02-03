const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
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

  // Read the file from the safe path
  const fileContent = fs.readFileSync(safePath);

  const fileName = `${Date.now()}-${file.originalname}`;
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    Body: fileContent,
    ContentType: file.mimetype,
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  return {
    Location: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`,
    Key: fileName,
  };
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
