#!/usr/bin/env node
// Copies Managira's file storage into a bucket in the United States, set up as
// utils/storagePolicy.js says: private except the public site pictures, HTTPS only, encrypted,
// access control lists off, versioned (old versions kept 30 days), browsers read-only from
// Managira's sites. Files keep their names, so everything stored keeps working once the server
// lists the old bucket in S3_LEGACY_BUCKETS (utils/storedFiles.js). Procedure:
// docs/security/STORAGE.md.
//
//   node scripts/s3MoveToUs.js --to <bucket> --region us-west-2            shows what would happen
//   node scripts/s3MoveToUs.js --to <bucket> --region us-west-2 --apply    makes the bucket if it's
//                                                                          new, sets it up, copies
//   (run --apply again any time: it copies only files that are new or changed since)
//
//   --from <bucket> --from-region <region>   the bucket copied from (S3_BUCKET_NAME, AWS_REGION)
//   --no-database                            don't read the sign-in banners from the database
//   --delete-extra                           also remove files in the new bucket that the old one
//                                            no longer has (a file deleted since the first copy).
//                                            Only before the server uses the new bucket: after
//                                            that, new uploads are only in the new bucket.
"use strict";

require("dotenv").config();
const s3sdk = require("@aws-sdk/client-s3");
const storagePolicy = require("../utils/storagePolicy");
const storedFiles = require("../utils/storedFiles");

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const apply = args.includes("--apply");
const from = { bucket: option("--from") || process.env.S3_BUCKET_NAME, region: option("--from-region") || process.env.AWS_REGION };
const to = { bucket: option("--to"), region: option("--region") || "us-west-2" };
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY };
const source = new s3sdk.S3Client({ region: from.region, credentials });
const target = new s3sdk.S3Client({ region: to.region, credentials });

const COPY_AT_ONCE = 8;
const SINGLE_COPY_LIMIT = 5 * 1024 ** 3; // larger files need a copy in parts; Managira's files are far smaller

async function listAll(client, bucket) {
  const objects = new Map();
  let token;
  do {
    const page = await client.send(new s3sdk.ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    (page.Contents || []).forEach((o) => objects.set(o.Key, { size: o.Size, modified: o.LastModified }));
    token = page.IsTruncated ? page.NextContinuationToken : null;
  } while (token);
  return objects;
}

// "missing", "ours" (exists and this account can use it), or stops for a name someone else holds.
async function targetState() {
  try {
    await target.send(new s3sdk.HeadBucketCommand({ Bucket: to.bucket }));
    const location = (await target.send(new s3sdk.GetBucketLocationCommand({ Bucket: to.bucket }))).LocationConstraint || "us-east-1";
    if (location !== to.region) throw new Error(`${to.bucket} is in ${location}, not ${to.region}.`);
    return "ours";
  } catch (error) {
    const status = error.$metadata?.httpStatusCode;
    if (status === 404 || error.name === "NotFound" || error.name === "NoSuchBucket") return "missing";
    if (status === 403) throw new Error(`The bucket name ${to.bucket} belongs to another account, or these keys can't use it. Choose another name.`);
    throw error;
  }
}

async function setUp(state, banners, privateKeys = []) {
  if (state === "missing") {
    await target.send(new s3sdk.CreateBucketCommand({
      Bucket: to.bucket,
      ObjectOwnership: "BucketOwnerEnforced",
      ...(to.region === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: to.region } }),
    }));
    console.log(`Made ${to.bucket} in ${to.region}.`);
  }
  await target.send(new s3sdk.PutBucketOwnershipControlsCommand({ Bucket: to.bucket, OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] } }));
  await target.send(new s3sdk.PutPublicAccessBlockCommand({ Bucket: to.bucket, PublicAccessBlockConfiguration: { ...storagePolicy.PUBLIC_ACCESS_BLOCK } }));
  await target.send(new s3sdk.PutBucketEncryptionCommand({ Bucket: to.bucket, ServerSideEncryptionConfiguration: storagePolicy.ENCRYPTION }));
  await target.send(new s3sdk.PutBucketVersioningCommand({ Bucket: to.bucket, VersioningConfiguration: { Status: "Enabled" } }));
  await target.send(new s3sdk.PutBucketLifecycleConfigurationCommand({ Bucket: to.bucket, LifecycleConfiguration: { Rules: storagePolicy.LIFECYCLE_RULES.map((rule) => ({ ...rule })) } }));
  await target.send(new s3sdk.PutBucketCorsCommand({ Bucket: to.bucket, CORSConfiguration: { CORSRules: storagePolicy.CORS_RULES.map((rule) => ({ ...rule })) } }));
  await target.send(new s3sdk.PutBucketPolicyCommand({ Bucket: to.bucket, Policy: JSON.stringify(storagePolicy.bucketPolicy(to.bucket, { extraPublicKeys: banners, privateKeys })) }));
  console.log("Set up: private except the public site pictures, HTTPS only, encrypted, versioned, access lists off.");
}

const copySource = (key) => `${from.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function copyOne(key) {
  await target.send(new s3sdk.CopyObjectCommand({
    Bucket: to.bucket,
    Key: key,
    CopySource: copySource(key),
    MetadataDirective: "COPY", // keeps the type, caching and download name the file was stored with
    ServerSideEncryption: "AES256",
  }));
}

async function inTurns(items, work) {
  let next = 0;
  let done = 0;
  const failed = [];
  await Promise.all(Array.from({ length: Math.min(COPY_AT_ONCE, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (error) {
        failed.push([item, error.name || error.message]);
      }
      done += 1;
      if (done % 50 === 0 || done === items.length) console.log(`  ${done} of ${items.length}`);
    }
  }));
  return failed;
}

(async () => {
  if (!from.bucket || !from.region) throw new Error("Set S3_BUCKET_NAME and AWS_REGION (or pass --from and --from-region).");
  if (!to.bucket) throw new Error("Name the new bucket: --to <bucket>.");
  if (!/^us-(east|west)-\d$/.test(to.region)) throw new Error(`${to.region} isn't a United States region (us-east-1, us-east-2, us-west-1, us-west-2).`);
  if (to.bucket === from.bucket) throw new Error("The new bucket must have another name than the old one.");
  if (args.includes("--delete-extra") && String(process.env.S3_BUCKET_NAME || "") === to.bucket) {
    throw new Error("The server already uses the new bucket, so files only there are new uploads: --delete-extra would remove them.");
  }

  const [state, banners, signups, files] = await Promise.all([
    targetState(),
    args.includes("--no-database") ? [] : storagePolicy.bannerKeysFromDatabase(),
    args.includes("--no-database") ? [] : storagePolicy.signupDocumentKeysFromDatabase(),
    listAll(source, from.bucket),
  ]);
  const copied = state === "ours" ? await listAll(target, to.bucket) : new Map();
  // A file needs copying when the new bucket doesn't have it, or has an older or different copy.
  const toCopy = [...files.entries()]
    .filter(([key, file]) => {
      const there = copied.get(key);
      return !there || there.size !== file.size || there.modified < file.modified;
    })
    .map(([key]) => key);
  const tooLarge = toCopy.filter((key) => files.get(key).size > SINGLE_COPY_LIMIT);
  const extra = [...copied.keys()].filter((key) => !files.has(key));
  const bytes = toCopy.reduce((sum, key) => sum + files.get(key).size, 0);

  console.log(`From ${from.bucket} (${from.region}): ${files.size} files.`);
  console.log(`To ${to.bucket} (${to.region}): ${state === "missing" ? "a new bucket" : `${copied.size} files already there`}.`);
  console.log(`To copy: ${toCopy.length} files, ${(bytes / 1e6).toFixed(1)} MB.${extra.length ? ` In the new bucket only: ${extra.length}${args.includes("--delete-extra") ? " (to remove)" : " (kept; --delete-extra removes them)"}.` : ""}`);
  if (tooLarge.length) throw new Error(`${tooLarge.length} file(s) are over 5 GB and need a copy in parts: ${tooLarge.slice(0, 5).join(", ")}`);

  if (!apply) {
    console.log("\nNothing changed. Run with --apply to set up the new bucket and copy the files.");
    return;
  }

  await setUp(state, banners.filter((key) => !storedFiles.isPublicKey(key)), signups.filter((key) => storedFiles.isPublicKey(key)));
  console.log("Copying:");
  const failed = toCopy.length ? await inTurns(toCopy, copyOne) : [];
  if (args.includes("--delete-extra") && extra.length) {
    await inTurns(extra, (key) => target.send(new s3sdk.DeleteObjectCommand({ Bucket: to.bucket, Key: key })));
  }

  // Every file of the old bucket must now be in the new one, the same size.
  const after = await listAll(target, to.bucket);
  const missing = [...files.entries()].filter(([key, file]) => !after.has(key) || after.get(key).size !== file.size).map(([key]) => key);
  if (failed.length || missing.length) {
    failed.slice(0, 10).forEach(([key, why]) => console.log(`  not copied: ${key} (${why})`));
    console.log(`\n${missing.length} file(s) aren't in the new bucket yet. Run --apply again.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${files.size} files are in ${to.bucket}. Next, on the server (Render › Environment):`);
  console.log(`  S3_BUCKET_NAME=${to.bucket}`);
  console.log(`  AWS_REGION=${to.region}`);
  console.log(`  S3_LEGACY_BUCKETS=${from.bucket}`);
  console.log("Then run --apply once more to copy anything uploaded in between (docs/security/STORAGE.md).");
})().catch((error) => {
  console.error("Storage copy failed:", error.name || "", error.message);
  process.exit(1);
});
