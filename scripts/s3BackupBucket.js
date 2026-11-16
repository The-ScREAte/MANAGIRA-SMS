#!/usr/bin/env node
// Makes the private bucket the nightly database backups go to (docs/BACKUPS.md): in the United
// States, nothing public at all (every public access block on), HTTPS only, encrypted, access
// control lists off, and versioned so a backup removed by mistake can be recovered for 7 days. Backups are encrypted by Managira before they leave
// the server; this keeps the bucket itself locked as well.
//
//   node scripts/s3BackupBucket.js --bucket <name> --region us-west-2            shows what it would do
//   node scripts/s3BackupBucket.js --bucket <name> --region us-west-2 --apply    makes and sets it up
//
// Running --apply again on the same bucket only puts the settings back.
"use strict";

require("dotenv").config();
const s3sdk = require("@aws-sdk/client-s3");
const storagePolicy = require("../utils/storagePolicy");

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const bucket = option("--bucket") || process.env.BACKUP_S3_BUCKET;
const region = option("--region") || process.env.BACKUP_AWS_REGION || "us-west-2";
const keepDays = Math.max(7, Number(process.env.BACKUP_KEEP_DAYS) || 30);
const s3 = new s3sdk.S3Client({
  region,
  credentials: {
    accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const policy = (name) => ({
  Version: "2012-10-17",
  Statement: [{
    Sid: "HttpsOnly",
    Effect: "Deny",
    Principal: "*",
    Action: "s3:*",
    Resource: [`arn:aws:s3:::${name}`, `arn:aws:s3:::${name}/*`],
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  }],
});

(async () => {
  if (!bucket) throw new Error("Name the bucket: --bucket <name>.");
  if (!/^us-(east|west)-\d$/.test(region)) throw new Error(`${region} isn't a United States region.`);
  if (bucket === process.env.S3_BUCKET_NAME) throw new Error("Backups need a bucket of their own, not the uploads bucket.");

  let exists = false;
  try {
    await s3.send(new s3sdk.HeadBucketCommand({ Bucket: bucket }));
    exists = true;
  } catch (error) {
    const status = error.$metadata?.httpStatusCode;
    if (status === 403) throw new Error(`The name ${bucket} belongs to another account, or these keys can't use it.`);
    if (status !== 404 && error.name !== "NotFound") throw error;
  }
  console.log(`${bucket} (${region}): ${exists ? "exists; its settings will be put back" : "will be made"}.`);
  console.log(`Settings: all public access blocked, HTTPS only, AES-256 at rest, access lists off, versioned (a removed backup stays recoverable 7 days). Managira keeps ${keepDays} days and always the newest.`);
  if (!args.includes("--apply")) {
    console.log("Nothing changed. Run with --apply.");
    return;
  }

  if (!exists) {
    await s3.send(new s3sdk.CreateBucketCommand({
      Bucket: bucket,
      ObjectOwnership: "BucketOwnerEnforced",
      ...(region === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: region } }),
    }));
  }
  await s3.send(new s3sdk.PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
  }));
  await s3.send(new s3sdk.PutBucketOwnershipControlsCommand({ Bucket: bucket, OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] } }));
  await s3.send(new s3sdk.PutBucketEncryptionCommand({ Bucket: bucket, ServerSideEncryptionConfiguration: storagePolicy.ENCRYPTION }));
  await s3.send(new s3sdk.PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
  await s3.send(new s3sdk.PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: [{
        ID: "backups-expire",
        Status: "Enabled",
        Filter: { Prefix: "" },
        // Managira removes backups past BACKUP_KEEP_DAYS itself and always keeps the newest, so
        // storage never expires a backup on its own; a removed one stays recoverable for 7 days.
        NoncurrentVersionExpiration: { NoncurrentDays: 7 },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
      }],
    },
  }));
  await s3.send(new s3sdk.PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy(bucket)) }));
  console.log("Done. On the server set:");
  console.log(`  BACKUP_S3_BUCKET=${bucket}`);
  console.log(`  BACKUP_AWS_REGION=${region}`);
  console.log("  BACKUP_ENCRYPTION_KEY=<the key you made; keep a copy in a password manager>");
  console.log("  BACKUPS_ENABLED=true");
})().catch((error) => {
  console.error("Backup bucket setup failed:", error.name || "", error.message);
  process.exit(1);
});
