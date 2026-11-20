"use strict";

// Removing a school's files from storage when the school is permanently deleted (its database rows
// go with it; its pictures, PDFs and uploads must not stay behind). Every folder the app writes
// for one school is listed here: a new per-school folder belongs in `prefixesFor`.
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");

const prefixesFor = (organizationId) => {
  const id = String(Number(organizationId));
  if (!/^\d+$/.test(id) || Number(id) <= 0) return [];
  return [
    `images/logos/${id}/`, `images/studentimages/${id}/`, `images/pending-students/${id}/`,
    `images/guardianimages/${id}/`, `images/guardians/${id}/`, `images/profiles/${id}/`,
    `images/publicdashboard/${id}/`, `videos/publicdashboard/${id}/`, `images/website/org_${id}/`,
    `images/transportation/drivers/${id}/`, `images/announcements/${id}/`, `images/transcript_signature/${id}/`,
    `images/reportsignature/${id}/`, `images/transcriptsignature/${id}/`, `images/questions/${id}/`,
    `signatures/${id}/`, `report-cards/org_${id}/`, `merit-sheets/org_${id}/`, `transcripts/org_${id}/`,
    `mira-reports/org_${id}/`, `migrations/org_${id}/`, `staff-about/${id}/`, `student-documents/${id}/`,
    `question-help/${id}/`, `parent-resources/${id}/`, `custom-forms/${id}/`, `school-signup/${id}/`,
  ];
};

let client = null;
const s3 = () => {
  if (!client) client = new S3Client({ region: process.env.AWS_REGION });
  return client;
};

// Delete every file under a school's folders. Returns how many were removed; never throws (a
// failure is logged, and the next clean-up can finish the job).
async function removeSchool(organizationId) {
  const bucket = process.env.S3_BUCKET_NAME;
  let removed = 0;
  if (!bucket) return removed;
  try {
    for (const prefix of prefixesFor(organizationId)) {
      let token;
      do {
        const page = await s3().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents || []).map((object) => ({ Key: object.Key }));
        if (keys.length) {
          await s3().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
          removed += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
  } catch (error) {
    console.error(`[School files] removing school ${organizationId}'s files:`, error.message);
  }
  return removed;
}

module.exports = { prefixesFor, removeSchool };
