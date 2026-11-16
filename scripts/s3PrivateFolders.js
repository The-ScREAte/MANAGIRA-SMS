#!/usr/bin/env node
// Makes Managira's file storage private. Afterwards only the pictures and videos of the public
// folders (school websites, logos, announcements, help-center pictures) and the sign-in banners
// can be read without a link Managira signs; every student file needs one. Every request must use
// HTTPS, access control lists stay off, and browsers may only read, from Managira's own sites.
// The rules are in utils/storagePolicy.js; docs/security/STORAGE.md has the full procedure.
//
//   node scripts/s3PrivateFolders.js                    shows what would change; changes nothing
//   node scripts/s3PrivateFolders.js --apply            saves the current settings to a file, then
//                                                       applies the new ones and checks the result
//   node scripts/s3PrivateFolders.js --restore <file>   puts saved settings back exactly
//
//   --bucket <name>   another bucket than S3_BUCKET_NAME (its region: --region, else AWS_REGION)
//   --no-database     don't read the sign-in banners' files from the database (they become private)
//   --verbose         print the whole policy
//
// Apply only once the app version that opens files through signed links is deployed.
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const s3sdk = require("@aws-sdk/client-s3");
const storagePolicy = require("../utils/storagePolicy");
const storedFiles = require("../utils/storedFiles");

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const bucket = option("--bucket") || process.env.S3_BUCKET_NAME;
const region = option("--region") || process.env.AWS_REGION;
const s3 = new s3sdk.S3Client({
  region,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});

// A setting that was never set reads as null.
async function read(command, pick, missing) {
  try {
    return pick(await s3.send(command));
  } catch (error) {
    if (missing.includes(error.name) || missing.includes(error.Code)) return null;
    throw error;
  }
}

async function currentSettings() {
  return {
    bucket,
    savedAt: new Date().toISOString(),
    policy: await read(new s3sdk.GetBucketPolicyCommand({ Bucket: bucket }), (r) => JSON.parse(r.Policy), ["NoSuchBucketPolicy"]),
    publicAccessBlock: await read(new s3sdk.GetPublicAccessBlockCommand({ Bucket: bucket }), (r) => r.PublicAccessBlockConfiguration, ["NoSuchPublicAccessBlockConfiguration"]),
    cors: await read(new s3sdk.GetBucketCorsCommand({ Bucket: bucket }), (r) => r.CORSRules, ["NoSuchCORSConfiguration"]),
  };
}

const bannerKeys = () => (args.includes("--no-database") ? Promise.resolve([]) : storagePolicy.bannerKeysFromDatabase());

async function listAll() {
  const objects = [];
  let token;
  do {
    const page = await s3.send(new s3sdk.ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    (page.Contents || []).forEach((o) => objects.push({ key: o.Key, size: o.Size }));
    token = page.IsTruncated ? page.NextContinuationToken : null;
  } while (token);
  return objects;
}

const folderOf = (key) => {
  const parts = key.split("/");
  if (parts.length === 1) return "(top level)";
  return parts[0] === "images" && parts.length > 2 ? `images/${parts[1]}/` : `${parts[0]}/`;
};

function report(objects, extras, hidden = new Set()) {
  const byFolder = new Map();
  objects.forEach(({ key }) => {
    const row = byFolder.get(folderOf(key)) || { public: 0, private: 0 };
    row[storagePolicy.accessOf(key, extras, hidden)] += 1;
    byFolder.set(folderOf(key), row);
  });
  console.log(`\n${"Folder".padEnd(30)}${"Public".padStart(8)}${"Private".padStart(9)}`);
  [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([folder, row]) => {
    console.log(`${folder.padEnd(30)}${String(row.public).padStart(8)}${String(row.private).padStart(9)}`);
  });
  const total = objects.reduce((sum, { key }) => sum + (storagePolicy.accessOf(key, extras, hidden) === "public" ? 1 : 0), 0);
  console.log(`${"All files".padEnd(30)}${String(total).padStart(8)}${String(objects.length - total).padStart(9)}`);
}

// Reads one public and one private file without any credentials, as a visitor would.
async function check(objects, extras, hidden = new Set()) {
  const publicOne = objects.find(({ key }) => storagePolicy.accessOf(key, extras, hidden) === "public");
  const privateOne = objects.find(({ key }) => storagePolicy.accessOf(key, extras, hidden) === "private");
  const status = async (key) => {
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    try { await response.body?.cancel(); } catch { /* only the status matters */ }
    return response.status;
  };
  const results = [];
  if (publicOne) results.push(["a public picture", publicOne.key, await status(publicOne.key), 200]);
  if (privateOne) results.push(["a private file", privateOne.key, await status(privateOne.key), 403]);
  results.forEach(([what, key, got, wanted]) => console.log(`  ${got === wanted ? "ok  " : "FAIL"} ${what} answers ${got} without a signed link (${key})`));
  return results.every(([, , got, wanted]) => got === wanted);
}

async function restore(file) {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  // Backups made before this script saved every setting hold only the policy.
  const settings = saved.Statement ? { bucket, policy: saved, publicAccessBlock: undefined, cors: undefined } : saved;
  if (settings.bucket && settings.bucket !== bucket) throw new Error(`That file is for ${settings.bucket}, not ${bucket}.`);
  if (settings.policy) await s3.send(new s3sdk.PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(settings.policy) }));
  else await s3.send(new s3sdk.DeleteBucketPolicyCommand({ Bucket: bucket }));
  if (settings.publicAccessBlock !== undefined) {
    if (settings.publicAccessBlock) await s3.send(new s3sdk.PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: settings.publicAccessBlock }));
    else await s3.send(new s3sdk.DeletePublicAccessBlockCommand({ Bucket: bucket }));
  }
  if (settings.cors !== undefined) {
    if (settings.cors) await s3.send(new s3sdk.PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: settings.cors } }));
    else await s3.send(new s3sdk.DeleteBucketCorsCommand({ Bucket: bucket }));
  }
  console.log(`Restored ${bucket}'s settings from ${file}.`);
}

(async () => {
  if (!bucket || !region) throw new Error("Set S3_BUCKET_NAME and AWS_REGION (or pass --bucket and --region).");
  if (args[0] === "--restore") return restore(args[1]);

  const [current, banners, signups, objects] = await Promise.all([
    currentSettings(),
    bannerKeys(),
    args.includes("--no-database") ? [] : storagePolicy.signupDocumentKeysFromDatabase(),
    listAll(),
  ]);
  const extras = new Set(banners.filter((key) => !storedFiles.isPublicKey(key)));
  const hidden = new Set(signups.filter((key) => storedFiles.isPublicKey(key)));
  const policy = storagePolicy.bucketPolicy(bucket, { extraPublicKeys: [...extras], privateKeys: [...hidden] });

  console.log(`Bucket ${bucket} (${region}), ${objects.length} files.`);
  console.log(`Now: ${current.policy ? `${current.policy.Statement.length} policy statement(s)` : "no policy"}; public access block ${JSON.stringify(current.publicAccessBlock)}; CORS ${JSON.stringify(current.cors)}`);
  console.log(`New policy: ${policy.Statement.map((s) => `${s.Sid} (${[].concat(s.Resource).length})`).join(", ")}; ${Buffer.byteLength(JSON.stringify(policy))} bytes.`);
  if (args.includes("--verbose")) console.log(JSON.stringify(policy, null, 2));
  console.log(`Sign-in banners kept public by name: ${extras.size}; sign-up documents kept private by name: ${hidden.size}${args.includes("--no-database") ? " (database not read)" : ""}.`);
  report(objects, extras, hidden);

  if (!args.includes("--apply")) {
    console.log("\nNothing changed. Run with --apply to make the private files private.");
    return;
  }

  const backup = path.join(process.cwd(), `s3-policy-backup-${bucket}-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(current, null, 2), { mode: 0o600 });
  console.log(`\nSaved the current settings to ${backup}.`);
  await s3.send(new s3sdk.PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: { ...storagePolicy.PUBLIC_ACCESS_BLOCK } }));
  await s3.send(new s3sdk.PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
  await s3.send(new s3sdk.PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: storagePolicy.CORS_RULES.map((rule) => ({ ...rule })) } }));
  await s3.send(new s3sdk.PutBucketEncryptionCommand({ Bucket: bucket, ServerSideEncryptionConfiguration: storagePolicy.ENCRYPTION }));
  console.log("Applied. Checking as a visitor:");
  const ok = await check(objects, extras, hidden);
  console.log(ok ? `Done. To undo: node scripts/s3PrivateFolders.js --restore ${path.basename(backup)}` : `Something isn't as expected. To undo: node scripts/s3PrivateFolders.js --restore ${path.basename(backup)}`);
  if (!ok) process.exitCode = 1;
})().catch((error) => {
  console.error("Storage settings update failed:", error.name || "", error.message);
  process.exit(1);
});
