"use strict";

// The settings Managira's file storage (an S3 bucket) is kept at. Used by
// scripts/s3PrivateFolders.js (the current bucket) and scripts/s3MoveToUs.js (a new bucket in the
// United States), so both buckets follow exactly the same rules.
//
// - Nothing is public except the pictures and videos of the public folders (school websites,
//   logos, announcements, help-center pictures: utils/storedFiles.js) and the sign-in banners
//   stored before they had a folder of their own. Every other file (report cards, transcripts,
//   photos, signatures, form answers, documents) opens only through a link Managira signs for a
//   few minutes, after checking who is asking.
// - Every request must use HTTPS.
// - Access control lists are switched off (the bucket owner owns every file).
// - Files are encrypted at rest (AES-256), and SSE-C is refused.
// - Browsers may only read, and only from Managira's own sites.

const { PUBLIC_PREFIXES, PUBLIC_EXTENSIONS, isPublicKey, isSafeKey } = require("./storedFiles");

// S3 refuses a bucket policy over 20 KB.
const POLICY_LIMIT_BYTES = 20 * 1024;

const SITE_ORIGINS = Object.freeze(["https://managira.com", "https://*.managira.com"]);

// A key that can be named exactly in a policy: no wildcards, no "." or ".." parts.
const nameable = (key) => isSafeKey(key) && !/[*?]/.test(String(key));

function bucketPolicy(bucket, { extraPublicKeys = [], privateKeys = [] } = {}) {
  const arn = `arn:aws:s3:::${bucket}`;
  const pictures = [];
  for (const prefix of PUBLIC_PREFIXES) {
    for (const ext of PUBLIC_EXTENSIONS) {
      pictures.push(`${arn}/${prefix}*.${ext}`, `${arn}/${prefix}*.${ext.toUpperCase()}`);
    }
  }
  const statements = [
    { Sid: "PublicSitePictures", Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: pictures },
  ];
  const extras = [...new Set(extraPublicKeys.map((key) => String(key || "").trim()))]
    .filter((key) => key && nameable(key) && !isPublicKey(key))
    .sort()
    .map((key) => `${arn}/${key}`);
  if (extras.length) {
    statements.push({ Sid: "PublicSignInBanners", Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: extras });
  }
  // Files that sit in a public folder but must stay private (a school's sign-up documents uploaded
  // as pictures before they had a folder of their own): refused to anyone without a signed link.
  const hidden = [...new Set(privateKeys.map((key) => String(key || "").trim()))]
    .filter((key) => key && nameable(key) && isPublicKey(key))
    .sort()
    .map((key) => `${arn}/${key}`);
  if (hidden.length) {
    statements.push({
      Sid: "PrivateSignUpDocuments",
      Effect: "Deny",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: hidden,
      Condition: { StringEquals: { "aws:PrincipalType": "Anonymous" } },
    });
  }
  statements.push({
    Sid: "HttpsOnly",
    Effect: "Deny",
    Principal: "*",
    Action: "s3:*",
    Resource: [arn, `${arn}/*`],
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  });
  const policy = { Version: "2012-10-17", Statement: statements };
  const size = Buffer.byteLength(JSON.stringify(policy));
  if (size > POLICY_LIMIT_BYTES) throw new Error(`The bucket policy would be ${size} bytes; S3 allows ${POLICY_LIMIT_BYTES}.`);
  return policy;
}

// Public pictures are allowed by the policy; access control lists stay off.
const PUBLIC_ACCESS_BLOCK = Object.freeze({
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: false,
  RestrictPublicBuckets: false,
});

const ENCRYPTION = Object.freeze({
  Rules: [{
    ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
    BucketKeyEnabled: true,
    BlockedEncryptionTypes: { EncryptionType: ["SSE-C"] },
  }],
});

const CORS_RULES = Object.freeze([
  { AllowedMethods: ["GET", "HEAD"], AllowedOrigins: [...SITE_ORIGINS], AllowedHeaders: ["*"], MaxAgeSeconds: 3000 },
]);

// Versioning keeps a deleted or overwritten file for 30 days, then removes the old copy.
const LIFECYCLE_RULES = Object.freeze([
  {
    ID: "keep-old-versions-30-days",
    Status: "Enabled",
    Filter: { Prefix: "" },
    NoncurrentVersionExpiration: { NoncurrentDays: 30 },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
  },
]);

// The sign-in banners stored at the top of the bucket before they had a public folder of their own
// (read-only; the database login needs nothing more than SELECT on login_ads).
async function bannerKeysFromDatabase(connectionString = process.env.DB_CONNECTION_STRING) {
  if (!connectionString) throw new Error("DB_CONNECTION_STRING isn't set (or run with --no-database).");
  const { Client } = require("pg");
  const client = new Client({ connectionString, ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false });
  await client.connect();
  try {
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const exists = (await client.query("SELECT to_regclass('public.login_ads') IS NOT NULL AS ok")).rows[0].ok;
    if (!exists) return [];
    const { rows } = await client.query("SELECT s3_key, media_url FROM login_ads WHERE media_type IN ('image', 'video')");
    const { keyOf } = require("./storedFiles");
    return rows.map((row) => row.s3_key || keyOf(row.media_url)).filter(Boolean);
  } finally {
    await client.end();
  }
}

// Schools' sign-up documents (organizations.proof_of_existence_1/2), read-only: the ones stored in a
// public folder are kept private by the policy's PrivateSignUpDocuments statement.
async function signupDocumentKeysFromDatabase(connectionString = process.env.DB_CONNECTION_STRING) {
  if (!connectionString) throw new Error("DB_CONNECTION_STRING isn't set (or run with --no-database).");
  const { Client } = require("pg");
  const client = new Client({ connectionString, ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : false });
  await client.connect();
  try {
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const { rows } = await client.query(
      `SELECT proof_of_existence_1 AS value FROM organizations WHERE COALESCE(proof_of_existence_1, '') <> ''
       UNION SELECT proof_of_existence_2 FROM organizations WHERE COALESCE(proof_of_existence_2, '') <> ''`
    );
    const { keyOf } = require("./storedFiles");
    return rows.map((row) => keyOf(row.value)).filter(Boolean);
  } finally {
    await client.end();
  }
}

// Whether the policy lets anyone read a file ("public") or only a signed link ("private").
const accessOf = (key, extraPublicKeys = new Set(), privateKeys = new Set()) => (!privateKeys.has(key) && (isPublicKey(key) || extraPublicKeys.has(key)) ? "public" : "private");

module.exports = {
  POLICY_LIMIT_BYTES,
  SITE_ORIGINS,
  bucketPolicy,
  PUBLIC_ACCESS_BLOCK,
  ENCRYPTION,
  CORS_RULES,
  LIFECYCLE_RULES,
  bannerKeysFromDatabase,
  signupDocumentKeysFromDatabase,
  accessOf,
};
