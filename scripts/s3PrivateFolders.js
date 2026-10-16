#!/usr/bin/env node
// Makes private S3 folders unreadable without a signed link, while public
// images (logos, website media) stay public.
//
//   node scripts/s3PrivateFolders.js            preview the new bucket policy (no change)
//   node scripts/s3PrivateFolders.js --apply    apply it (saves the current policy first)
//   node scripts/s3PrivateFolders.js --restore <file>   put a saved policy back
//
// Apply only after the app version that serves these folders through signed
// links is deployed.
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { S3Client, GetBucketPolicyCommand, PutBucketPolicyCommand } = require("@aws-sdk/client-s3");

const PRIVATE_FOLDERS = ["migrations/"];
const bucket = process.env.S3_BUCKET_NAME;
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});

(async () => {
  const args = process.argv.slice(2);

  if (args[0] === "--restore") {
    const saved = fs.readFileSync(args[1], "utf8");
    await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: saved }));
    console.log(`Restored bucket policy from ${args[1]}.`);
    return;
  }

  const current = JSON.parse((await s3.send(new GetBucketPolicyCommand({ Bucket: bucket }))).Policy);
  const next = {
    ...current,
    Statement: current.Statement.map((statement) => {
      const isPublicRead = statement.Effect === "Allow" && statement.Principal === "*" &&
        [].concat(statement.Action).includes("s3:GetObject") && statement.Resource === `arn:aws:s3:::${bucket}/*`;
      if (!isPublicRead) return statement;
      const { Resource, ...rest } = statement;
      // Public read for everything except the private folders.
      return { ...rest, NotResource: PRIVATE_FOLDERS.map((folder) => `arn:aws:s3:::${bucket}/${folder}*`) };
    }),
  };

  console.log("Current policy:\n" + JSON.stringify(current, null, 2));
  console.log("\nNew policy:\n" + JSON.stringify(next, null, 2));

  if (!args.includes("--apply")) {
    console.log("\nPreview only. Run with --apply to make these folders private: " + PRIVATE_FOLDERS.join(", "));
    return;
  }

  const backup = path.join(process.cwd(), `s3-policy-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(current, null, 2));
  await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(next) }));
  console.log(`\nApplied. Previous policy saved to ${backup} (restore with --restore ${path.basename(backup)}).`);
})().catch((error) => {
  console.error("S3 policy update failed:", error.name, error.message);
  process.exit(1);
});
