const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { s3Client } = require("../config/s3");
const db = require("../config/db");
const pdfParse = require("pdf-parse");
const Papa = require("papaparse");
const { Readable } = require("stream");
const path = require("path");
const bcrypt = require("bcryptjs");
const puppeteer = require("puppeteer");
const fs = require("fs");
const ejs = require("ejs");
const axios = require("axios");
const { sendEmailSafely } = require("../utils/emailHelper");
const { getOrganizationWebsiteInfo } = require("../utils/schoolWebsiteAccess");
const { buildStudentDisplayId, getOrganizationStudentIdSettings } = require("../utils/studentIdDisplay");
const { formatDisplayDate, formatDisplayName } = require("../utils/organizationDisplayPreferences");
// Lightweight async wrapper to avoid dependency errors
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const organizationCache = {};
const CACHE_DURATION = 10 * 60 * 1000; // Cache organization data for 10 minutes
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

// Ensure signature metadata columns exist (safe to call multiple times)
let ensuredSignatureMeta = false;
async function ensureSignatureMetaColumns(dbClient) {
  if (ensuredSignatureMeta) return;
  try {
    await dbClient.query(
      "ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS signature_name TEXT"
    );
    await dbClient.query(
      "ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS signature_title TEXT"
    );
    await dbClient.query(
      "ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS display_settings JSONB"
    );
    ensuredSignatureMeta = true;
  } catch (err) {
    console.error("[ensureSignatureMetaColumns] Failed to add columns", err);
  }
}

let ensuredScoreRemarkGradeColumn = false;
async function ensureScoreRemarkGradeColumn(dbClient) {
  if (ensuredScoreRemarkGradeColumn) return;
  try {
    await dbClient.query(
      "ALTER TABLE score_remarks ADD COLUMN IF NOT EXISTS grade_label TEXT"
    );
    ensuredScoreRemarkGradeColumn = true;
  } catch (err) {
    console.error("[ensureScoreRemarkGradeColumn] Failed to add column", err);
  }
}

let ensuredScoreRemarkRangeUniqueConstraint = false;
async function ensureScoreRemarkRangeUniqueConstraint(dbClient) {
  if (ensuredScoreRemarkRangeUniqueConstraint) return;
  try {
    await dbClient.query(`
      WITH ranked AS (
        SELECT
          ctid,
          ROW_NUMBER() OVER (
            PARTITION BY organization_id, class_id, term_id, from_percentage, to_percentage
            ORDER BY id DESC
          ) AS rn
        FROM score_remarks
      )
      DELETE FROM score_remarks s
      USING ranked r
      WHERE s.ctid = r.ctid
        AND r.rn > 1
    `);

    await dbClient.query("ALTER TABLE score_remarks DROP CONSTRAINT IF EXISTS score_remarks_unique");
    await dbClient.query("ALTER TABLE score_remarks DROP CONSTRAINT IF EXISTS unique_organization_class_score");
    await dbClient.query("ALTER TABLE score_remarks DROP CONSTRAINT IF EXISTS unique_score_remark");

    await dbClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'score_remarks_unique'
            AND conrelid = 'score_remarks'::regclass
        ) THEN
          ALTER TABLE score_remarks
          ADD CONSTRAINT score_remarks_unique
          UNIQUE (organization_id, class_id, term_id, from_percentage, to_percentage);
        END IF;
      END
      $$;
    `);

    ensuredScoreRemarkRangeUniqueConstraint = true;
  } catch (err) {
    console.error("[ensureScoreRemarkRangeUniqueConstraint] Failed to ensure range-based unique constraint", err);
  }
}

let ensuredScoreRemarkDefaultStateTable = false;
async function ensureScoreRemarkDefaultStateTable(dbClient) {
  if (ensuredScoreRemarkDefaultStateTable) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS score_remark_default_state (
      organization_id INT NOT NULL,
      class_id INT NOT NULL,
      term_id INT NOT NULL,
      defaults_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (organization_id, class_id, term_id)
    )
  `);
  ensuredScoreRemarkDefaultStateTable = true;
}

let ensuredStudentReportManualAttendanceColumn = false;
async function ensureStudentReportManualAttendanceColumn(dbClient) {
  if (ensuredStudentReportManualAttendanceColumn) return;
  try {
    await dbClient.query(
      "ALTER TABLE student_reports ADD COLUMN IF NOT EXISTS manual_attendance_present_days INTEGER"
    );
    await dbClient.query(
      "ALTER TABLE student_reports ADD COLUMN IF NOT EXISTS manual_attendance_total_days INTEGER"
    );
    ensuredStudentReportManualAttendanceColumn = true;
  } catch (err) {
    console.error("[ensureStudentReportManualAttendanceColumn] Failed to add column", err);
  }
}

let ensuredStudentReportPaygiraManualDataColumn = false;
async function ensureStudentReportPaygiraManualDataColumn(dbClient) {
  if (ensuredStudentReportPaygiraManualDataColumn) return;
  try {
    await dbClient.query(
      "ALTER TABLE student_reports ADD COLUMN IF NOT EXISTS paygira_manual_data JSONB"
    );
    ensuredStudentReportPaygiraManualDataColumn = true;
  } catch (err) {
    console.error("[ensureStudentReportPaygiraManualDataColumn] Failed to add column", err);
  }
}

let ensuredReportPaygiraManualOverridesTable = false;
async function ensureReportPaygiraManualOverridesTable(dbClient) {
  if (ensuredReportPaygiraManualOverridesTable) return;
  try {
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS report_paygira_manual_overrides (
        id SERIAL PRIMARY KEY,
        organization_id INT NOT NULL,
        class_id INT NOT NULL,
        term_id INT NOT NULL,
        student_id INT NULL,
        fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS report_paygira_manual_overrides_class_unique
      ON report_paygira_manual_overrides (organization_id, class_id, term_id)
      WHERE student_id IS NULL
    `);
    await dbClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS report_paygira_manual_overrides_student_unique
      ON report_paygira_manual_overrides (organization_id, class_id, term_id, student_id)
      WHERE student_id IS NOT NULL
    `);
    ensuredReportPaygiraManualOverridesTable = true;
  } catch (err) {
    console.error("[ensureReportPaygiraManualOverridesTable] Failed to ensure table", err);
  }
}

function parsePositiveIntArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0))];
}

async function getScopedTermRecord(dbClient, organizationId, termId) {
  if (!Number.isFinite(Number(termId))) return null;

  const termResult = await dbClient.query(
    `SELECT t.term_id, t.school_year_id, t.term_name, sy.year_label
     FROM terms t
     JOIN school_years sy ON sy.id = t.school_year_id
     WHERE t.term_id = $1 AND t.organization_id = $2 AND sy.organization_id = $2
     LIMIT 1`,
    [termId, organizationId]
  );

  return termResult.rows[0] || null;
}

async function getScopedClassIds(dbClient, organizationId, classIds) {
  const normalizedClassIds = parsePositiveIntArray(classIds);
  if (!normalizedClassIds.length) return [];

  const result = await dbClient.query(
    `SELECT class_id
     FROM classes
     WHERE organization_id = $1 AND class_id = ANY($2::int[])
     ORDER BY class_id ASC`,
    [organizationId, normalizedClassIds]
  );

  return result.rows
    .map((row) => Number(row.class_id))
    .filter((classId) => Number.isFinite(classId) && classId > 0);
}

async function getScopedStudentIdsForClassTerm(dbClient, organizationId, classId, termId, studentIds) {
  const normalizedStudentIds = parsePositiveIntArray(studentIds);
  if (!normalizedStudentIds.length) return [];

  const result = await dbClient.query(
    `SELECT DISTINCT es.student_id
     FROM enrolled_students es
     JOIN enrollments e ON es.enrollment_id = e.enrollment_id
     WHERE es.class_id = $1
       AND e.term_id = $2
       AND e.organization_id = $3
       AND es.student_id = ANY($4::int[])
     ORDER BY es.student_id ASC`,
    [classId, termId, organizationId, normalizedStudentIds]
  );

  return result.rows
    .map((row) => Number(row.student_id))
    .filter((studentId) => Number.isFinite(studentId) && studentId > 0);
}

function normalizePaygiraManualField(field, index, sourceClassId) {
  if (!field || typeof field !== "object") return null;

  const label = String(field.label || "").trim();
  if (!label) return null;

  const keyCandidate = String(field.key || "").trim();
  const key = keyCandidate || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `field_${index + 1}`;
  const defaultValueRaw = field.defaultValue;
  const defaultValue = defaultValueRaw === undefined || defaultValueRaw === null ? "" : String(defaultValueRaw).trim();

  const applyToClasses = parsePositiveIntArray(field.applyToClasses);
  if (Number.isFinite(sourceClassId) && sourceClassId > 0 && !applyToClasses.includes(sourceClassId)) {
    applyToClasses.unshift(sourceClassId);
  }

  return {
    key,
    label,
    defaultValue,
    applyToClasses,
  };
}

function normalizePaygiraManualFields(fields, sourceClassId) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field, index) => normalizePaygiraManualField(field, index, sourceClassId))
    .filter(Boolean);
}

function normalizePaygiraManualTotal(total, index, allowedFieldKeys = []) {
  if (!total || typeof total !== 'object') return null;

  const label = String(total.label || '').trim();
  if (!label) return null;

  const keyCandidate = String(total.key || '').trim();
  const key = keyCandidate || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `total_${index + 1}`;

  const allowedSet = new Set((Array.isArray(allowedFieldKeys) ? allowedFieldKeys : []).map((k) => String(k || '').trim()).filter(Boolean));
  const rawFieldKeys = Array.isArray(total.fieldKeys) ? total.fieldKeys : [];
  const normalizedFieldKeys = [...new Set(
    rawFieldKeys
      .map((k) => String(k || '').trim())
      .filter((k) => k && (allowedSet.size === 0 || allowedSet.has(k)))
  )];

  return {
    key,
    label,
    fieldKeys: normalizedFieldKeys,
    showOnReport: total.showOnReport !== false,
  };
}

function normalizePaygiraManualTotals(totals, allowedFieldKeys = []) {
  if (!Array.isArray(totals)) return [];
  return totals
    .map((total, index) => normalizePaygiraManualTotal(total, index, allowedFieldKeys))
    .filter(Boolean);
}

function buildReportPaygiraManualTotalsRows(fields, totals) {
  const safeFields = Array.isArray(fields) ? fields : [];
  const safeTotals = Array.isArray(totals) ? totals : [];

  const valueByKey = {};
  const labelByKey = {};
  safeFields.forEach((field) => {
    const key = String(field?.key || '').trim();
    if (!key) return;
    labelByKey[key] = String(field?.label || key).trim() || key;
    const numericValue = Number.parseFloat(String(field?.value ?? '').replace(/,/g, ''));
    valueByKey[key] = Number.isFinite(numericValue) ? numericValue : null;
  });

  return safeTotals
    .filter((total) => total && total.showOnReport !== false)
    .map((total) => {
      const selectedKeys = Array.isArray(total.fieldKeys)
        ? total.fieldKeys.map((k) => String(k || '').trim()).filter(Boolean)
        : [];

      const parts = selectedKeys.map((key) => {
        const label = labelByKey[key] || key;
        const value = valueByKey[key];
        return {
          key,
          label,
          value,
          displayValue: Number.isFinite(value) ? String(value) : '-',
        };
      });

      const numericParts = parts.filter((part) => Number.isFinite(part.value));
      const totalValue = numericParts.reduce((sum, part) => sum + Number(part.value || 0), 0);
      const valueDisplay = Number.isFinite(totalValue)
        ? (Number.isInteger(totalValue) ? String(totalValue) : totalValue.toFixed(2))
        : '-';
      const details = parts.length
        ? parts.map((part) => `${part.label}: ${part.displayValue}`).join(' + ')
        : 'No fields selected';

      return {
        key: String(total.key || '').trim(),
        label: String(total.label || '').trim() || 'Total',
        value: valueDisplay,
        details,
        fieldKeys: selectedKeys,
        parts,
      };
    });
}

function normalizeGradePresentationConfig(rawConfig) {
  const safe = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const rawMode = String(safe.mode || '').trim().toLowerCase();
  const mode = (rawMode === 'numbers' || rawMode === 'both') ? rawMode : 'letters';
  const showNumberTotalOnReport = mode === 'numbers' && safe.showNumberTotalOnReport === true;
  return {
    mode,
    showNumberTotalOnReport,
  };
}

function parseGradeLabelParts(label) {
  const text = String(label || '').trim();
  if (!text) return { letters: '', number: null };
  const numberMatch = text.match(/-?\d+(?:\.\d+)?/);
  const number = numberMatch ? Number(numberMatch[0]) : null;
  const letters = text
    .replace(/-?\d+(?:\.\d+)?/g, ' ')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();
  return {
    letters,
    number: Number.isFinite(number) ? number : null,
  };
}

function formatGradeByPresentation(label, mode) {
  const safeMode = (mode === 'numbers' || mode === 'both') ? mode : 'letters';
  const original = String(label || '').trim();
  const parts = parseGradeLabelParts(original);

  if (safeMode === 'numbers') {
    if (Number.isFinite(parts.number)) return String(parts.number);
    return original || '-';
  }

  if (safeMode === 'both') {
    // Keep custom grade labels exactly as configured in Grade Mapping.
    return original || '-';
  }

  // Letters mode should also display the exact saved label when present.
  return original || '-';
}

function resolveClosestScoreRemarkRule(percentage, rules) {
  const value = Number(percentage);
  if (!Number.isFinite(value) || !Array.isArray(rules) || rules.length === 0) {
    return null;
  }

  const normalizedRules = rules
    .map((rule) => {
      const rawFrom = rule?.fromPercentage ?? rule?.from_percentage ?? rule?.from;
      const rawTo = rule?.toPercentage ?? rule?.to_percentage ?? rule?.to;
      const from = Number.parseFloat(rawFrom);
      const to = Number.parseFloat(rawTo);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
      return {
        from: Math.min(from, to),
        to: Math.max(from, to),
        rule,
      };
    })
    .filter(Boolean);

  if (normalizedRules.length === 0) return null;

  const inRangeRule = normalizedRules.find((entry) => value >= entry.from && value <= entry.to);
  if (inRangeRule) return inRangeRule.rule;

  // Clamp to nearest boundary for out-of-range values.
  let minRule = normalizedRules[0];
  let maxRule = normalizedRules[0];
  normalizedRules.forEach((entry) => {
    if (entry.from < minRule.from) minRule = entry;
    if (entry.to > maxRule.to) maxRule = entry;
  });

  if (value < minRule.from) return minRule.rule;
  if (value > maxRule.to) return maxRule.rule;

  // For internal gaps, use the closest immediate rule.
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  normalizedRules.forEach((entry) => {
    const distance = value < entry.from
      ? entry.from - value
      : value > entry.to
        ? value - entry.to
        : 0;

    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
      return;
    }

    if (distance === bestDistance && best) {
      // Tie-break toward lower band to keep grading conservative.
      if (entry.to < best.to) {
        best = entry;
      }
    }
  });

  return best ? best.rule : null;
}

function normalizeReportPaygiraManualField(field, index) {
  if (!field || typeof field !== "object") return null;
  const label = String(field.label || "").trim();
  if (!label) return null;
  const keyCandidate = String(field.key || "").trim();
  const key = keyCandidate || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `field_${index + 1}`;
  const valueRaw = field.value;
  const value = valueRaw === undefined || valueRaw === null ? "" : String(valueRaw);
  const totalKeyRaw = String(field.totalKey || "").trim();
  const totalKey = totalKeyRaw || "";
  return { key, label, value, totalKey };
}

function normalizeReportPaygiraManualFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field, index) => normalizeReportPaygiraManualField(field, index))
    .filter(Boolean);
}

function getDefaultGradeLabel(percentage) {
  const value = Number(percentage);
  if (!Number.isFinite(value)) return "-";
  if (value >= 90) return "A";
  if (value >= 80) return "B";
  if (value >= 70) return "C";
  return "D";
}

function resolveGradeLabelFromRule(rule, percentage) {
  const configured = String(rule?.gradeLabel || "").trim();
  if (configured) return configured;
  return getDefaultGradeLabel(percentage);
}

function getDefaultScoreRemark(percentage) {
  const value = Number(percentage);
  if (!Number.isFinite(value)) return "No Remark";
  if (value >= 90) return "Excellent";
  if (value >= 80) return "Very Good";
  if (value >= 70) return "Good";
  return "Needs Improvement";
}

function buildDefaultScoreRemarkRows() {
  const ranges = [
    { from: 90, to: 100 },
    { from: 80, to: 89 },
    { from: 70, to: 79 },
    { from: 0, to: 69 },
  ];

  return ranges.map((r) => ({
    from: r.from,
    to: r.to,
    gradeLabel: getDefaultGradeLabel((r.from + r.to) / 2),
    remark: getDefaultScoreRemark((r.from + r.to) / 2),
  }));
}

async function setDefaultsSuppressedState(dbClient, organizationId, classId, termId, suppressed) {
  await ensureScoreRemarkDefaultStateTable(dbClient);
  await dbClient.query(
    `
      INSERT INTO score_remark_default_state (organization_id, class_id, term_id, defaults_suppressed)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (organization_id, class_id, term_id)
      DO UPDATE SET defaults_suppressed = EXCLUDED.defaults_suppressed
    `,
    [organizationId, classId, termId, suppressed]
  );
}

async function seedDefaultRowsIfEmpty(dbClient, organizationId, classId, termId) {
  const defaults = buildDefaultScoreRemarkRows();
  const existingRows = await getClassScoreRemarksRows(dbClient, organizationId, classId, termId);

  // Only seed defaults for a truly empty class/term configuration.
  // If any row already exists, user has started customizing and we must not
  // auto-create additional defaults that can clash with remark uniqueness.
  if (existingRows.length > 0) {
    return;
  }

  const existingRangeKeys = new Set(
    existingRows.map((row) => `${Number(row.from_percentage)}-${Number(row.to_percentage)}`)
  );

  for (const row of defaults) {
    const rangeKey = `${Number(row.from)}-${Number(row.to)}`;
    if (existingRangeKeys.has(rangeKey)) {
      continue;
    }

    // Constraint-independent upsert by exact range.
    const existingRangeResult = await dbClient.query(
      `
        SELECT id
        FROM score_remarks
        WHERE organization_id = $1
          AND class_id = $2
          AND term_id = $3
          AND from_percentage = $4
          AND to_percentage = $5
        ORDER BY id DESC
        LIMIT 1
      `,
      [organizationId, classId, termId, row.from, row.to]
    );

    const existingRangeRow = existingRangeResult.rows[0] || null;
    if (existingRangeRow) {
      await dbClient.query(
        `
          UPDATE score_remarks
          SET remark = $1,
              grade_label = $2
          WHERE id = $3
        `,
        [row.remark, row.gradeLabel, existingRangeRow.id]
      );
    } else {
      await dbClient.query(
        `
          INSERT INTO score_remarks (organization_id, class_id, term_id, remark, grade_label, from_percentage, to_percentage)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `,
        [organizationId, classId, termId, row.remark, row.gradeLabel, row.from, row.to]
      );
    }
  }

  await setDefaultsSuppressedState(dbClient, organizationId, classId, termId, false);
}

function getDefaultRowForRange(fromPct, toPct) {
  return buildDefaultScoreRemarkRows().find(
    (row) => Number(row.from) === Number(fromPct) && Number(row.to) === Number(toPct)
  ) || null;
}

async function getClassScoreRemarksRows(dbClient, organizationId, classId, termId) {
  const rowsResult = await dbClient.query(
    `
      SELECT *
      FROM score_remarks
      WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
      ORDER BY from_percentage ASC, id ASC
    `,
    [organizationId, classId, termId]
  );
  return rowsResult.rows;
}

// Helper functions for S3 actions
async function uploadToS3(key, file) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  try {
    await s3Client.send(command);
    return key;
  } catch (error) {
        throw new Error("Could not upload file to S3.");
  }
}

async function getFromS3(key) {
  try {
    // Return the full URL to the image in S3 (public access assumed)
    return `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
  } catch (error) {
        throw new Error("Could not retrieve image from S3.");
  }
}

// Helper function to get correct ordinal suffix
function getOrdinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

async function deleteFromS3(key) {
  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  });

  try {
    await s3Client.send(command);
  } catch (error) {
        throw new Error("Could not delete file from S3.");
  }
}

// Helper function to fetch and cache organization details
async function getCachedOrganizationDetails(organizationId, db) {
  const cacheKey = `org_${organizationId}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return cachedData; // Data is already parsed
  }

  const organizationResult = await db.query(
    `
        SELECT organization_name, organization_address, organization_country, organization_province, organization_phone, email, logo_path 
        FROM organizations 
        WHERE organization_id = $1
    `,
    [organizationId]
  );

  const organization = organizationResult.rows[0];
  if (organization) {
    cache.set(cacheKey, organization); // Cache the data
  }

  return organization;
}

const assignScoreRemark = async (percentage, organizationId, db) => {
  const cacheKey = `remark_${organizationId}_${percentage}`;
  const cachedRemark = cache.get(cacheKey);
  if (cachedRemark) {
    return cachedRemark; // Data is already parsed in Node-Cache
  }

  const remarkResult = await db.query(
    `
        SELECT remark FROM score_remarks
        WHERE organization_id = $1
        AND $2::numeric BETWEEN from_percentage AND to_percentage
        LIMIT 1
    `,
    [organizationId, percentage]
  );

  const remark = remarkResult.rows[0]
    ? remarkResult.rows[0].remark
    : "No Remarks";

  cache.set(cacheKey, remark); // Cache the data
  return remark;
};

const printController = (db) => ({
  printStudentReport: async (req, res) => {
    const { classId, termId, studentId } = req.query;
    const organizationId = req.session.organizationId;
    await ensureSignatureMetaColumns(db);
    await ensureScoreRemarkGradeColumn(db);
    await ensureStudentReportManualAttendanceColumn(db);
    await ensureStudentReportPaygiraManualDataColumn(db);
    // Validate inputs
    if (!organizationId) {
      return res.status(400).send("Organization ID is not set in session.");
    }

    if (!classId || isNaN(classId)) {
      return res.status(400).send("Invalid or missing classId.");
    }

    if (!termId || isNaN(termId)) {
      return res.status(400).send("Invalid or missing termId.");
    }

    const parsedClassId = parseInt(classId, 10);
    const parsedTermId = parseInt(termId, 10);
    const parsedStudentId =
      studentId && !isNaN(studentId) ? parseInt(studentId, 10) : null;

    try {
      // Fetch organization details
      const organization = await getCachedOrganizationDetails(
        organizationId,
        db
      );
      if (!organization) {
        return res.status(404).send("Organization not found.");
      }

      const websiteInfo = await getOrganizationWebsiteInfo(db, organizationId);

      const logoUrl = organization.logo_path
        ? await getFromS3(organization.logo_path)
        : null;

      // Fetch class and term details
      const [classResult, termResult, allClassesResult] = await Promise.all([
        db.query(
          "SELECT * FROM classes WHERE class_id = $1 AND organization_id = $2",
          [parsedClassId, organizationId]
        ),
        db.query(
          `SELECT t.term_name, t.start_date, t.end_date, sy.year_label
                     FROM terms t
                     JOIN school_years sy ON t.school_year_id = sy.id
                     WHERE t.term_id = $1 AND t.organization_id = $2`,
          [parsedTermId, organizationId]
        ),
        db.query(
          "SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_id ASC",
          [organizationId]
        ),
      ]);

      const classData = classResult.rows[0];
      const term = termResult.rows[0];
      const allClasses = allClassesResult.rows || [];

      if (!classData) {
        return res
          .status(404)
          .send("Class not found for the given class ID and organization ID.");
      }

      if (!term) {
        return res.status(404).send("Term not found for the given term ID.");
      }

      // Fetch status settings
      const statusSettingsResult = await db.query(
        `SELECT cut_off_point, promoted_class, repeated_class, school_reopen_date, activate_promotion, term_end_date
         FROM status_settings
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
         LIMIT 1`,
        [organizationId, parsedClassId, parsedTermId]
      );

      const statusSettings = statusSettingsResult.rows[0] || {};
      const cutOffPoint = statusSettings.cut_off_point || 50;
      const orgDateDisplayFormat = req.session?.dateDisplayFormat;
      const orgNameDisplayFormat = req.session?.nameDisplayFormat;
      const schoolReopenDate = statusSettings.school_reopen_date
        ? formatDisplayDate(statusSettings.school_reopen_date, orgDateDisplayFormat)
        : "TBA";
      const termEndDate = statusSettings.term_end_date
        ? formatDisplayDate(statusSettings.term_end_date, orgDateDisplayFormat)
        : formatDisplayDate(term.end_date, orgDateDisplayFormat);

      const promotedClassId = statusSettings.promoted_class;
      const repeatedClassId = statusSettings.repeated_class;

      // Fetch promoted/repeated class names
      const [promotedClassName, repeatedClassName] = await Promise.all([
        promotedClassId
          ? db
              .query("SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2", [
                promotedClassId,
                organizationId,
              ])
              .then((res) => res.rows[0]?.class_name || "No Promoted Class")
          : "No Promoted Class",
        repeatedClassId
          ? db
              .query("SELECT class_name FROM classes WHERE class_id = $1 AND organization_id = $2", [
                repeatedClassId,
                organizationId,
              ])
              .then((res) => res.rows[0]?.class_name || "No Repeated Class")
          : "No Repeated Class",
      ]);

      // Fetch saved reports (filtered by studentId if provided)
      const savedReportsQuery = parsedStudentId
        ? `SELECT student_id, conduct_remarks, attitude_remarks, interest_remarks, teacher_remarks, manual_attendance_present_days, manual_attendance_total_days, paygira_manual_data
         FROM student_reports
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = $4`
        : `SELECT student_id, conduct_remarks, attitude_remarks, interest_remarks, teacher_remarks, manual_attendance_present_days, manual_attendance_total_days, paygira_manual_data
         FROM student_reports
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`;

      const savedReportsParams = parsedStudentId
        ? [organizationId, parsedClassId, parsedTermId, parsedStudentId]
        : [organizationId, parsedClassId, parsedTermId];

      const savedReportsResult = await db.query(
        savedReportsQuery,
        savedReportsParams
      );

      const savedReportsMap = Object.fromEntries(
        savedReportsResult.rows.map((report) => [report.student_id, report])
      );

      // Fetch attendance days
      const totalDaysResult = await db.query(
        `SELECT COUNT(*) AS total_days
                 FROM generate_series($1::date, LEAST($2::date, CURRENT_DATE), '1 day') AS all_dates
                 WHERE EXTRACT(ISODOW FROM all_dates) < 6`,
        [term.start_date, term.end_date]
      );
      const totalDays = totalDaysResult.rows[0]?.total_days || 0;

      // Fetch students, subjects, remarks, and scores
      const studentFilterId = parsedStudentId || null;

      const [
        studentsResult,
        subjectsResult,
        remarksResult,
        scoreRemarksResult,
        reportSettingsResult,
        attendanceResult,
        indivScoresResult,
        subjectPositionsResult,
        allAssessmentsResult,
        studentIdSettings,
      ] = await Promise.all([
        db.query(
          `SELECT es.student_id, s.custom_student_id, s.first_name, s.last_name, s.image_url, c.class_name
             FROM enrolled_students es
             JOIN students s ON es.student_id = s.student_id
             JOIN enrollments e ON es.enrollment_id = e.enrollment_id
             JOIN classes c ON es.class_id = c.class_id
             WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3
               AND ($4::int IS NULL OR es.student_id = $4)`,
          [parsedClassId, parsedTermId, organizationId, studentFilterId]
        ),
        db.query(
          "SELECT subject_id, subject_name FROM subjects WHERE class_id = $1 AND organization_id = $2",
          [parsedClassId, organizationId]
        ),
        db.query(
          "SELECT id, remark, remark_type FROM remarks WHERE organization_id = $1",
          [organizationId]
        ),
        db.query(
          `SELECT
             from_percentage AS "fromPercentage",
             to_percentage AS "toPercentage",
             remark,
             grade_label AS "gradeLabel"
           FROM score_remarks
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, parsedClassId, parsedTermId]
        ),
        db.query(
          "SELECT signature_image_path, signature_name, signature_title, display_settings FROM report_settings WHERE class_id = $1 AND term_id = $2 AND organization_id = $3",
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT student_id, COUNT(*) FILTER (WHERE status = 'Present') AS present_days
             FROM attendance_records
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
             GROUP BY student_id`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT ar.student_id, ar.assessment_id, COALESCE(ar.score, 0) AS score
             FROM assessment_results ar
             WHERE ar.class_id = $1 AND ar.term_id = $2 AND ar.organization_id = $3`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT student_id, subject_id, position
             FROM student_positions
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        db.query(
          `SELECT assessment_id, subject_id, title, category, max_score, COALESCE(scale_base, 100) AS scale_base
             FROM assessments
             WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
             ORDER BY category, assessment_id`,
          [parsedClassId, parsedTermId, organizationId]
        ),
        getOrganizationStudentIdSettings(db, organizationId),
      ]);

      // --- Build individual score lookup: studentId_assessmentId → score ---
      const indivScoresMap = {};
      indivScoresResult.rows.forEach((row) => {
        indivScoresMap[`${row.student_id}_${row.assessment_id}`] = parseFloat(row.score) || 0;
      });

      // --- Build subject position lookup ---
      const subjectPositionsMap = {};
      subjectPositionsResult.rows.forEach((row) => {
        subjectPositionsMap[`${row.student_id}_${row.subject_id}`] = row.position || null;
      });

      // --- All assessments for this class+term ---
      const allAssessments = allAssessmentsResult.rows;

      // --- Scale base per subject (max scale_base across assessments for that subject) ---
      const scaleBasesMap = {};
      allAssessments.forEach((a) => {
        const cur = scaleBasesMap[a.subject_id] || 0;
        scaleBasesMap[a.subject_id] = Math.max(cur, parseInt(a.scale_base) || 100);
      });

      // --- Build display settings with defaults (undefined or null = ON) ---
      const rawDS = reportSettingsResult.rows[0]?.display_settings || {};
      const colVis = rawDS.columns || {};
      const secVis = rawDS.sections || {};
      const paygiraBillsRaw = secVis.paygiraBills || {};
      const paygiraAutoRaw = paygiraBillsRaw.auto || {};
      const paygiraMetricsRaw = paygiraAutoRaw.metrics || {};
      const paygiraFutureRaw = paygiraAutoRaw.future || {};
      const paygiraManualRaw = paygiraBillsRaw.manual || {};
      const paygiraManualFieldsRaw = Array.isArray(paygiraManualRaw.fields) ? paygiraManualRaw.fields : [];
      const paygiraManualFields = normalizePaygiraManualFields(paygiraManualFieldsRaw, parsedClassId);
      const paygiraManualTotalsRaw = Array.isArray(paygiraManualRaw.totals) ? paygiraManualRaw.totals : [];
      const paygiraManualTotals = normalizePaygiraManualTotals(paygiraManualTotalsRaw, paygiraManualFields.map((field) => field.key));
      const gradePresentation = normalizeGradePresentationConfig(secVis.gradePresentation);
      const displaySettings = {
        columns: {
          classScore:      colVis.classScore      !== false,
          examsScore:      colVis.examsScore      !== false,
          otherScore:      colVis.otherScore      !== false,
          totalScore:      colVis.totalScore      !== false,
          scaledScore:     colVis.scaledScore     !== false,
          totalPercentage: colVis.totalPercentage !== false,
          grade:           colVis.grade           !== false,
          position:        colVis.position        !== false,
          remarksCol:      colVis.remarksCol      !== false,
        },
        sections: {
          teacherRemarks:  secVis.teacherRemarks  !== false,
          conductRemarks:  secVis.conductRemarks  !== false,
          attitudeRemarks: secVis.attitudeRemarks !== false,
          interestRemarks: secVis.interestRemarks !== false,
          gradeKey:        secVis.gradeKey        !== false,
          gradePresentation,
          attendance:      secVis.attendance      !== false,
          turnOffAutoAttendance: secVis.turnOffAutoAttendance === true,
          manualAttendanceOutOf: Number.isFinite(Number(secVis.manualAttendanceOutOf)) && Number(secVis.manualAttendanceOutOf) > 0
            ? Number(secVis.manualAttendanceOutOf)
            : null,
          paygiraBills: {
            enabled: paygiraBillsRaw.enabled === true,
            mode: paygiraBillsRaw.mode === 'manual' ? 'manual' : 'auto',
            auto: {
              scope: paygiraAutoRaw.scope === 'future' ? 'future' : 'past',
              dateFrom: paygiraAutoRaw.dateFrom || '',
              dateTo: paygiraAutoRaw.dateTo || '',
              future: {
                action: paygiraFutureRaw.action === 'custom' ? 'custom' : 'create',
                billName: String(paygiraFutureRaw.billName || '').trim(),
                createLink: '/account/settings/finance',
              },
              metrics: {
                totalPaid: paygiraMetricsRaw.totalPaid !== false,
                defaultArrears: paygiraMetricsRaw.defaultArrears !== false,
                latePayments: paygiraMetricsRaw.latePayments !== false,
                totalBilled: paygiraMetricsRaw.totalBilled !== false,
                totalOutstanding: paygiraMetricsRaw.totalOutstanding !== false,
                lastPaymentDate: paygiraMetricsRaw.lastPaymentDate !== false,
              },
            },
            manual: {
              fields: paygiraManualFields,
              totals: paygiraManualTotals,
            },
          },
          promotion:       secVis.promotion       !== false,
        },
      };

      // --- Build enabled assessment ID sets per category (respects sub-item toggles) ---
      const CLASS_CATS  = ['Class Assessment'];
      const EXAMS_CATS  = ['Exams Assessment', 'Exam Assessment'];
      const OTHER_CATS  = ['Other', 'Other Assessment'];

      function buildEnabledSet(masterOn, items, categories) {
        if (!masterOn) return new Set();
        const result = new Set();
        for (const a of allAssessments) {
          if (!categories.includes(a.category)) continue;
          // items keyed by title; absent/null = default ON, explicit false = OFF
          if ((items[a.title] ?? true) !== false) result.add(a.assessment_id);
        }
        return result;
      }

      const enabledClassIds = buildEnabledSet(displaySettings.columns.classScore, colVis.classScore_items || {}, CLASS_CATS);
      const enabledExamsIds = buildEnabledSet(displaySettings.columns.examsScore, colVis.examsScore_items || {}, EXAMS_CATS);
      const enabledOtherIds = buildEnabledSet(displaySettings.columns.otherScore, colVis.otherScore_items || {}, OTHER_CATS);

      // Helper: sum individual scores for enabled assessments
      function getFilteredScore(studentId, subjectId, enabledIds) {
        let total = 0;
        for (const a of allAssessments) {
          if (a.subject_id !== subjectId) continue;
          if (!enabledIds.has(a.assessment_id)) continue;
          total += indivScoresMap[`${studentId}_${a.assessment_id}`] || 0;
        }
        return total;
      }

      // Helper: sum max_scores for enabled assessments (to recalculate percentage)
      function getFilteredMaxScore(subjectId, enabledIds) {
        let total = 0;
        for (const a of allAssessments) {
          if (a.subject_id !== subjectId) continue;
          if (!enabledIds.has(a.assessment_id)) continue;
          total += parseFloat(a.max_score || 0);
        }
        return total;
      }

      const students = studentsResult.rows.map((student) => ({
        ...student,
        display_name:
          formatDisplayName(student, orgNameDisplayFormat) ||
          [student.first_name, student.last_name].filter(Boolean).join(" ").trim(),
        display_student_id: buildStudentDisplayId(student, studentIdSettings),
      }));
      const allSubjects = subjectsResult.rows;
      const teacherRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "teacher"
      );
      const conductRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "conduct"
      );
      const interestRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "interest"
      );
      const attitudeRemarks = remarksResult.rows.filter(
        (r) => r.remark_type === "attitude"
      );
      const scoreRemarks = scoreRemarksResult.rows;
      const signatureImagePath =
        reportSettingsResult.rows[0]?.signature_image_path;
      const signatureName = reportSettingsResult.rows[0]?.signature_name || null;
      const signatureTitle = reportSettingsResult.rows[0]?.signature_title || null;
      const signatureImageUrl = signatureImagePath
        ? await getFromS3(signatureImagePath)
        : null;

      const attendanceMap = Object.fromEntries(
        attendanceResult.rows.map((record) => [
          record.student_id,
          record.present_days || 0,
        ])
      );

      await ensureReportPaygiraManualOverridesTable(db);
      const studentIds = students.map((student) => Number(student.student_id)).filter((id) => Number.isFinite(id) && id > 0);
      const paygiraOverrideRowsResult = studentIds.length
        ? await db.query(
            `SELECT student_id, fields
             FROM report_paygira_manual_overrides
             WHERE organization_id = $1
               AND class_id = $2
               AND term_id = $3
               AND (student_id IS NULL OR student_id = ANY($4::int[]))`,
            [organizationId, parsedClassId, parsedTermId, studentIds]
          )
        : { rows: [] };
      const classLevelOverrideRow = paygiraOverrideRowsResult.rows.find((row) => row.student_id === null);
      const classLevelOverrideFields = normalizeReportPaygiraManualFields(classLevelOverrideRow?.fields || []);
      const studentLevelOverrideMap = new Map(
        paygiraOverrideRowsResult.rows
          .filter((row) => row.student_id !== null)
          .map((row) => [Number(row.student_id), normalizeReportPaygiraManualFields(row.fields || [])])
      );
      const templatePaygiraRows = (displaySettings.sections.paygiraBills?.manual?.fields || [])
        .map((field, index) => normalizeReportPaygiraManualField({
          key: field.key,
          label: field.label,
          value: field.defaultValue,
        }, index))
        .filter(Boolean);

      // Process students
      const getCategoryScore = (studentId, subjectId, categories) =>
        categories.reduce(
          (total, categoryName) =>
            total +
            parseFloat(scoresMap[`${studentId}_${subjectId}_${categoryName}`] || 0),
          0
        );

      students.forEach((student) => {
        const savedReport = savedReportsMap[student.student_id] || {};

        student.conductRemarks = savedReport.conduct_remarks || "";
        student.attitudeRemarks = savedReport.attitude_remarks || "";
        student.interestRemarks = savedReport.interest_remarks || "";
        student.teacherRemarks = savedReport.teacher_remarks || "";
        student.manualAttendancePresentDays = Number.isFinite(Number(savedReport.manual_attendance_present_days))
          ? Number(savedReport.manual_attendance_present_days)
          : null;
        student.manualAttendanceTotalDays = Number.isFinite(Number(savedReport.manual_attendance_total_days))
          ? Number(savedReport.manual_attendance_total_days)
          : null;
        student.paygiraManualData = (savedReport.paygira_manual_data && typeof savedReport.paygira_manual_data === 'object')
          ? savedReport.paygira_manual_data
          : {};
        const studentSpecificOverride = studentLevelOverrideMap.get(Number(student.student_id));
        if (Array.isArray(studentSpecificOverride) && studentSpecificOverride.length > 0) {
          student.paygiraManualResolvedFields = studentSpecificOverride;
        } else if (classLevelOverrideFields.length > 0) {
          student.paygiraManualResolvedFields = classLevelOverrideFields;
        } else {
          student.paygiraManualResolvedFields = templatePaygiraRows;
        }
        student.paygiraManualTotalsRows = buildReportPaygiraManualTotalsRows(
          student.paygiraManualResolvedFields,
          displaySettings.sections.paygiraBills?.manual?.totals || []
        );

        let totalScoreSum = 0;
        let totalPercentageSum = 0;
        let subjectCount = 0;
        let totalGradeNumericScore = 0;

        // ✅ NEW: Assign class position to student
        student.positionInClass = student.class_position
          ? `${student.class_position}${getOrdinalSuffix(
              student.class_position
            )}`
          : "-";

        student.subjects = allSubjects.map((subject) => {
          const classScore = getFilteredScore(student.student_id, subject.subject_id, enabledClassIds);
          const examsScore = getFilteredScore(student.student_id, subject.subject_id, enabledExamsIds);
          const otherScore = getFilteredScore(student.student_id, subject.subject_id, enabledOtherIds);

          const totalScore = classScore + examsScore + otherScore;

          // Recalculate percentage from enabled max scores
          const enabledAllIds = new Set([...enabledClassIds, ...enabledExamsIds, ...enabledOtherIds]);
          const filteredMaxScore = getFilteredMaxScore(subject.subject_id, enabledAllIds);
          const totalPercentage = filteredMaxScore > 0
            ? parseFloat((totalScore / filteredMaxScore * 100).toFixed(2))
            : 0;

          // Recalculate grade from score remarks
          const matchingRule = resolveClosestScoreRemarkRule(totalPercentage, scoreRemarks);
          const grade = totalScore > 0
            ? (matchingRule
                ? resolveGradeLabelFromRule(matchingRule, totalPercentage)
                : getDefaultGradeLabel(totalPercentage))
            : "-";
          const gradeMode = displaySettings.sections?.gradePresentation?.mode || 'letters';
          const parsedGradeParts = parseGradeLabelParts(grade);
          const gradeDisplay = totalScore > 0 ? formatGradeByPresentation(grade, gradeMode) : '-';
          if (totalScore > 0 && Number.isFinite(parsedGradeParts.number)) {
            totalGradeNumericScore += Number(parsedGradeParts.number);
          }

          // Recalculate remarks column
          const remarks = totalScore > 0 ? (matchingRule ? matchingRule.remark : "-") : "-";

          const scaleBase = scaleBasesMap[subject.subject_id] || 100;
          const scaledScore = totalScore > 0
            ? `${(totalPercentage / 100 * scaleBase).toFixed(2)} / ${scaleBase}` : "-";

          if (totalScore > 0) {
            totalPercentageSum += totalPercentage;
            subjectCount++;
          }
          totalScoreSum += totalScore;

          // Subject position (from DB — reflects official full-score ranking)
          const subjectPos = subjectPositionsMap[`${student.student_id}_${subject.subject_id}`];

          return {
            subject_name: subject.subject_name,
            classAssessmentScore: classScore > 0 ? classScore.toFixed(2) : "-",
            examsAssessmentScore: examsScore > 0 ? examsScore.toFixed(2) : "-",
            otherAssessmentScore: otherScore > 0 ? otherScore.toFixed(2) : "-",
            totalScore: totalScore > 0 ? totalScore.toFixed(2) : "-",
            scaledScore,
            totalPercentage: totalScore > 0 ? `${totalPercentage} %` : "-",
            grade: gradeDisplay,
            gradeRaw: grade,
            gradeNumeric: Number.isFinite(parsedGradeParts.number) ? Number(parsedGradeParts.number) : null,
            remarks,
            position: totalScore > 0 && subjectPos
              ? `${subjectPos}${getOrdinalSuffix(subjectPos)}`
              : "-",
          };
        });
        

        student.totalScoreSum = totalScoreSum;
        student.overallPercentage =
          subjectCount > 0
            ? (totalPercentageSum / subjectCount).toFixed(2)
            : "0.00";
        student.totalGradeNumericScore = Number(totalGradeNumericScore.toFixed(2));

        student.attendance = {
          presentDays: attendanceMap[student.student_id] || 0,
          totalDays,
        };

        student.promotionClass =
          student.overallPercentage >= cutOffPoint
            ? promotedClassName
            : repeatedClassName;
        student.promotionStatus =
          student.overallPercentage >= cutOffPoint ? "Promoted" : "Repeated";
      });

      if (displaySettings.sections.paygiraBills.enabled && displaySettings.sections.paygiraBills.mode === 'auto' && students.length) {
        const paygiraCfg = displaySettings.sections.paygiraBills;
        const metrics = paygiraCfg.auto?.metrics || {};
        const dateFrom = paygiraCfg.auto?.dateFrom || null;
        const dateTo = paygiraCfg.auto?.dateTo || null;
        const studentIds = students.map((s) => Number(s.student_id)).filter((id) => Number.isFinite(id));

        try {
          const paymentsFilterClauses = ["p.organization_id = $1", "p.student_id = ANY($2::int[])"];
          const assignmentsFilterClauses = ["a.organization_id = $1", "a.student_id = ANY($2::int[])", "a.status <> 'cancelled'", "COALESCE(b.status, 'active') <> 'cancelled'"];
          const paymentsParams = [organizationId, studentIds];
          const assignmentsParams = [organizationId, studentIds];

          if (dateFrom) {
            paymentsParams.push(dateFrom);
            paymentsFilterClauses.push(`p.received_at::date >= $${paymentsParams.length}::date`);
            assignmentsParams.push(dateFrom);
            assignmentsFilterClauses.push(`b.due_date >= $${assignmentsParams.length}::date`);
          }
          if (dateTo) {
            paymentsParams.push(dateTo);
            paymentsFilterClauses.push(`p.received_at::date <= $${paymentsParams.length}::date`);
            assignmentsParams.push(dateTo);
            assignmentsFilterClauses.push(`b.due_date <= $${assignmentsParams.length}::date`);
          }

          const [paymentsAggResult, assignmentsAggResult, assignmentLifetimeAggResult, creditsAggResult] = await Promise.all([
            db.query(
              `SELECT
                 p.student_id,
                 COALESCE(SUM(CASE WHEN p.is_refund = TRUE THEN -ABS(p.amount) ELSE p.amount END), 0) AS total_paid,
                 COUNT(*) FILTER (WHERE b.due_date IS NOT NULL AND p.received_at::date > b.due_date) AS payment_events_after_due,
                 MAX(p.received_at) AS last_payment_at
               FROM finance_payments p
               LEFT JOIN finance_bills b ON b.bill_id = p.bill_id
               WHERE ${paymentsFilterClauses.join(' AND ')}
               GROUP BY p.student_id`,
              paymentsParams,
            ),
            db.query(
              `SELECT
                 a.student_id,
                 COALESCE(SUM(a.amount + COALESCE(a.late_fee_applied, 0)), 0) AS total_billed_in_range,
                 COALESCE(SUM(a.amount_paid), 0) AS total_paid_assignments_in_range,
                 COALESCE(SUM(GREATEST((a.amount + COALESCE(a.late_fee_applied, 0)) - COALESCE(a.amount_paid, 0), 0)), 0) AS outstanding_in_range,
                 COALESCE(SUM(CASE WHEN a.status = 'defaulted' THEN GREATEST((a.amount + COALESCE(a.late_fee_applied, 0)) - COALESCE(a.amount_paid, 0), 0) ELSE 0 END), 0) AS default_arrears,
                 COUNT(*) FILTER (WHERE a.status IN ('overdue', 'defaulted')) AS late_assignments,
                 COUNT(*) FILTER (WHERE GREATEST((a.amount + COALESCE(a.late_fee_applied, 0)) - COALESCE(a.amount_paid, 0), 0) > 0) AS open_bill_count
               FROM finance_bill_assignments a
               JOIN finance_bills b ON b.bill_id = a.bill_id
               WHERE ${assignmentsFilterClauses.join(' AND ')}
               GROUP BY a.student_id`,
              assignmentsParams,
            ),
            db.query(
              `SELECT
                 a.student_id,
                 COALESCE(SUM(a.amount + COALESCE(a.late_fee_applied, 0)), 0) AS total_billed_lifetime,
                 COALESCE(SUM(a.amount_paid), 0) AS total_paid_lifetime,
                 COALESCE(SUM(GREATEST((a.amount + COALESCE(a.late_fee_applied, 0)) - COALESCE(a.amount_paid, 0), 0)), 0) AS outstanding_lifetime,
                 COUNT(*) FILTER (WHERE a.status = 'defaulted') AS defaulted_bill_count,
                 COUNT(*) FILTER (WHERE a.status = 'never_paid') AS never_paid_bill_count,
                 COUNT(*) FILTER (WHERE a.status = 'partial') AS partial_bill_count,
                 COUNT(*) FILTER (WHERE a.status = 'overdue') AS overdue_bill_count
               FROM finance_bill_assignments a
               JOIN finance_bills b ON b.bill_id = a.bill_id
               WHERE a.organization_id = $1
                 AND a.student_id = ANY($2::int[])
                 AND a.status <> 'cancelled'
                 AND COALESCE(b.status, 'active') <> 'cancelled'
               GROUP BY a.student_id`,
              [organizationId, studentIds],
            ),
            db.query(
              `SELECT student_id, COALESCE(amount, 0) AS credit_amount
               FROM finance_student_credits
               WHERE organization_id = $1 AND student_id = ANY($2::int[])`,
              [organizationId, studentIds],
            ),
          ]);

          const paymentsByStudent = Object.fromEntries(
            paymentsAggResult.rows.map((row) => [String(row.student_id), row])
          );
          const assignmentsByStudent = Object.fromEntries(
            assignmentsAggResult.rows.map((row) => [String(row.student_id), row])
          );
          const assignmentLifetimeByStudent = Object.fromEntries(
            assignmentLifetimeAggResult.rows.map((row) => [String(row.student_id), row])
          );
          const creditsByStudent = Object.fromEntries(
            creditsAggResult.rows.map((row) => [String(row.student_id), Number(row.credit_amount || 0)])
          );

          students.forEach((student) => {
            const paymentRow = paymentsByStudent[String(student.student_id)] || {};
            const assignmentRow = assignmentsByStudent[String(student.student_id)] || {};
            const lifetimeRow = assignmentLifetimeByStudent[String(student.student_id)] || {};
            const studentCredit = Number(creditsByStudent[String(student.student_id)] || 0);
            const totalPaidValue = (dateFrom || dateTo)
              ? Number(paymentRow.total_paid || 0)
              : Number(lifetimeRow.total_paid_lifetime || assignmentRow.total_paid_assignments_in_range || 0);
            const totalBilledValue = (dateFrom || dateTo)
              ? Number(assignmentRow.total_billed_in_range || 0)
              : Number(lifetimeRow.total_billed_lifetime || assignmentRow.total_billed_in_range || 0);
            const grossOutstandingValue = (dateFrom || dateTo)
              ? Number(assignmentRow.outstanding_in_range || 0)
              : Number(lifetimeRow.outstanding_lifetime || assignmentRow.outstanding_in_range || 0);
            const outstandingValue = Math.max(grossOutstandingValue - studentCredit, 0);
            const latePaymentsValue = Number(assignmentRow.late_assignments || 0);
            const defaultedBillCount = Number(lifetimeRow.defaulted_bill_count || 0);
            const neverPaidBillCount = Number(lifetimeRow.never_paid_bill_count || 0);
            const partialBillCount = Number(lifetimeRow.partial_bill_count || 0);
            const overdueBillCount = Number(lifetimeRow.overdue_bill_count || 0);
            let primaryStatus = 'Clear';
            if (outstandingValue > 0) {
              if (defaultedBillCount > 0) primaryStatus = 'Defaulted';
              else if (neverPaidBillCount > 0 && totalPaidValue <= 0) primaryStatus = 'Never Paid';
              else if (partialBillCount > 0 || totalPaidValue > 0) primaryStatus = 'Partial';
              else if (overdueBillCount > 0) primaryStatus = 'Overdue';
              else primaryStatus = 'Owing';
            }
            const autoRows = [];
            if (metrics.totalPaid) {
              autoRows.push({ label: 'Total Paid', value: totalPaidValue.toFixed(2) });
            }
            if (metrics.defaultArrears) {
              autoRows.push({ label: 'Default Arrears', value: Number(assignmentRow.default_arrears || 0).toFixed(2) });
            }
            if (metrics.latePayments) {
              autoRows.push({ label: 'Late / Overdue Bills', value: String(latePaymentsValue) });
            }
            if (metrics.totalBilled) {
              autoRows.push({ label: 'Total Billed', value: totalBilledValue.toFixed(2) });
            }
            if (metrics.totalOutstanding) {
              autoRows.push({ label: 'Outstanding', value: outstandingValue.toFixed(2) });
            }
            if (metrics.lastPaymentDate) {
              autoRows.push({ label: 'Last Payment Date', value: paymentRow.last_payment_at ? formatDisplayDate(paymentRow.last_payment_at, orgDateDisplayFormat) : '-' });
            }
            if (outstandingValue > 0) {
              autoRows.push({ label: 'Paygira Status', value: primaryStatus });
            }
            if (studentCredit > 0) {
              autoRows.push({ label: 'Credit Balance', value: studentCredit.toFixed(2) });
            }
            student.paygiraAutoRows = autoRows;
          });
        } catch (paygiraErr) {
          console.error('[printStudentReport] Failed to load paygira auto data', paygiraErr);
          students.forEach((student) => {
            student.paygiraAutoRows = [];
          });
        }
      } else {
        students.forEach((student) => {
          student.paygiraAutoRows = [];
        });
      }



      // Assign class position based on overall percentage
// Assign class position based on overall percentage
students
  .filter((s) => !isNaN(parseFloat(s.overallPercentage)))
  .sort(
    (a, b) =>
      parseFloat(b.overallPercentage) - parseFloat(a.overallPercentage)
  )
  .forEach((student, index, arr) => {
    if (
      index > 0 &&
      parseFloat(student.overallPercentage) ===
        parseFloat(arr[index - 1].overallPercentage)
    ) {
      student.class_position = arr[index - 1].class_position; // Tie: same position as previous
    } else {
      student.class_position = index + 1; // Otherwise assign current index + 1
    }

    // Add ordinal suffix
    student.positionInClass = `${student.class_position}${getOrdinalSuffix(student.class_position)}`;

    // ✅ INSERT PROMOTION CLASS ID SETTING HERE
    if (student.overallPercentage >= cutOffPoint) {
      student.promotionClass = promotedClassName;
      student.promotionStatus = "Promoted";
      student.promotionClassId = promotedClassId; // ✅ SET promotion class id
    } else {
      student.promotionClass = repeatedClassName;
      student.promotionStatus = "Repeated";
      student.promotionClassId = repeatedClassId; // ✅ SET repeated class id
    }
  });

      // ✅ Auto-save promotion status to student_reports so promotion scheduler has data
      if (statusSettings.activate_promotion && cutOffPoint > 0) {
        try {
          const autoSavePromises = students
            .filter(s => s.promotionStatus && s.promotionClassId)
            .map(student =>
              db.query(
                `INSERT INTO student_reports (
                  organization_id, class_id, term_id, student_id,
                  promotion_status, promotion_class_id
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (organization_id, class_id, term_id, student_id)
                DO UPDATE SET
                  promotion_status = EXCLUDED.promotion_status,
                  promotion_class_id = EXCLUDED.promotion_class_id,
                  updated_at = CURRENT_TIMESTAMP`,
                [
                  organizationId,
                  parsedClassId,
                  parsedTermId,
                  student.student_id,
                  student.promotionStatus,
                  student.promotionClassId,
                ]
              )
            );
          await Promise.all(autoSavePromises);
          console.log(`[printStudentReport] Auto-saved promotion status for ${autoSavePromises.length} students`);
        } catch (autoSaveErr) {
          console.error("[printStudentReport] Auto-save promotion status failed (non-blocking):", autoSaveErr.message);
        }
      }

      // Render the report
      res.render("print/printStudentReport", {
        title: "Student Final Report",
        students,
        orgName: organization.organization_name || "Default School Name",
        orgAddress: organization.organization_address,
        orgCountry: organization.organization_country,
        orgProvince: organization.organization_province,
        orgPhone: organization.organization_phone,
        email: organization.email,
        logoUrl,
        signatureImageUrl,
        signatureName,
        signatureTitle,
        term,
        schoolYearLabel: term.year_label || "No School Year Available",
        termEndDate,
        teacherRemarks,
        conductRemarks,
        interestRemarks,
        attitudeRemarks,
        scoreRemarks,
        classId: parsedClassId,
        termId: parsedTermId,
        schoolReopenDate,
        promotedClass: promotedClassName,
        repeatedClass: repeatedClassName,
        activatePromotion: statusSettings.activate_promotion,
        remarks: {
          teacher: teacherRemarks,
          conduct: conductRemarks,
          interest: interestRemarks,
          attitude: attitudeRemarks,
        },
        promotedClassId,
        repeatedClassId,
        displaySettings,
        paygiraManualResolvedByStudent: Object.fromEntries(
          students.map((student) => [
            student.student_id,
            Array.isArray(student.paygiraManualResolvedFields) ? student.paygiraManualResolvedFields : [],
          ])
        ),
        reportStudentOptions: students.map((student) => ({
          student_id: Number(student.student_id),
          name: student.display_name,
        })),
        reportClassOptions: allClasses.map((cls) => ({
          class_id: Number(cls.class_id),
          class_name: cls.class_name,
        })),
        hasSchoolWebsite: websiteInfo.hasWebsite,
        schoolWebsiteHost: websiteInfo.websiteHost,
        reportYear: new Date().getFullYear(),
      });
    } catch (error) {
            res.status(500).send("Failed to generate student report.");
    }
  },

  reportSettingsPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
    await ensureSignatureMetaColumns(db);
    await ensureScoreRemarkGradeColumn(db);
    await ensureScoreRemarkDefaultStateTable(db);
    await ensureScoreRemarkRangeUniqueConstraint(db);

    try {
      const organizationClassesResult = await db.query(
        `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name ASC`,
        [organizationId],
      );
      const organizationClasses = organizationClassesResult.rows;

      const currentTermResult = await db.query(
        `SELECT term_id FROM terms WHERE organization_id = $1 AND current = TRUE ORDER BY start_date DESC LIMIT 1`,
        [organizationId],
      );

      let fallbackTermId = currentTermResult.rows[0]?.term_id;
      if (!fallbackTermId) {
        const latestTermResult = await db.query(
          `SELECT term_id FROM terms WHERE organization_id = $1 ORDER BY start_date DESC LIMIT 1`,
          [organizationId],
        );
        fallbackTermId = latestTermResult.rows[0]?.term_id;
      }

      if (organizationClasses.length === 0 || !fallbackTermId) {
        return res.render("print/reportSettings", {
          title: "Report Settings",
          statusSettings: {},
          groupedStatusSettings: [],
          remarks: [],
          scoreRemarks: [],
          availableClasses: [],
          signatureImageUrl: null,
          signatureName: null,
          signatureTitle: null,
          signatureGroups: {},
          transcriptSignatureGroups: {},
          statusSettingsClasses: [],
          enrolledClasses: organizationClasses,
          classId: null,
          termId: fallbackTermId || null,
          setupRequired: true,
          setupMessage: "This is for classes. Kindly start by adding classes and setting up your school first to be able to access it.",
          messages: req.flash(),
        });
      }

      let resolvedClassId = classId;
      let resolvedTermId = termId;

      if (!resolvedClassId || isNaN(resolvedClassId) || !resolvedTermId || isNaN(resolvedTermId)) {
        return res.redirect(
          `/print/reportSettings?classId=${organizationClasses[0].class_id}&termId=${fallbackTermId}`,
        );
      }

      const parsedClassId = parseInt(resolvedClassId, 10);
      const parsedTermId = parseInt(resolvedTermId, 10);

      // Validate that classId belongs to current organization
      const classCheck = await db.query(
        `SELECT class_id FROM classes WHERE class_id = $1 AND organization_id = $2`,
        [parsedClassId, organizationId]
      );
      if (classCheck.rows.length === 0) {
        // ClassId doesn't belong to this org, redirect to fallback
        return res.redirect(`/print/reportSettings?classId=${organizationClasses[0].class_id}&termId=${parsedTermId}`);
      }
  
      // Fetch all classes with saved status settings for the given term
      const savedClassesResult = await db.query(
        `SELECT DISTINCT class_id FROM status_settings 
         WHERE organization_id = $1 AND term_id = $2`,
        [organizationId, parsedTermId]
      );
      const statusSettingsClasses = savedClassesResult.rows.map(
        (row) => row.class_id
      );
  
      // Fetch enrolled classes
      const enrolledClasses = organizationClasses;

      await ensureScoreRemarkDefaultStateTable(db);

      // Ensure each class has real default rows (with DB ids) unless the class
      // explicitly suppressed defaults by deleting all its rows.
      const initialDefaultsStateResult = await db.query(
        `
          SELECT class_id, defaults_suppressed
          FROM score_remark_default_state
          WHERE organization_id = $1 AND term_id = $2
        `,
        [organizationId, parsedTermId]
      );
      const initialDefaultsSuppressedMap = {};
      initialDefaultsStateResult.rows.forEach((row) => {
        initialDefaultsSuppressedMap[String(row.class_id)] = !!row.defaults_suppressed;
      });

      for (const cls of enrolledClasses) {
        const cid = Number(cls.class_id);
        if (initialDefaultsSuppressedMap[String(cid)] === true) {
          continue;
        }
        await seedDefaultRowsIfEmpty(db, organizationId, cid, parsedTermId);
      }
  
      // Fetch remarks
      const remarksResult = await db.query(
        `SELECT id, remark, remark_type FROM remarks 
         WHERE organization_id = $1`,
        [organizationId]
      );
      const remarks = remarksResult.rows || [];
  
      // Fetch score remarks for all classes in this term
      const scoreRemarksResult = await db.query(
        `SELECT * FROM score_remarks 
         WHERE organization_id = $1 AND term_id = $2
         ORDER BY class_id, from_percentage ASC`,
        [organizationId, parsedTermId]
      );
      const scoreRemarks = scoreRemarksResult.rows || [];

      const defaultsStateResult = await db.query(
        `
          SELECT class_id, defaults_suppressed
          FROM score_remark_default_state
          WHERE organization_id = $1 AND term_id = $2
        `,
        [organizationId, parsedTermId]
      );
      const defaultsSuppressedMap = {};
      defaultsStateResult.rows.forEach((row) => {
        defaultsSuppressedMap[String(row.class_id)] = !!row.defaults_suppressed;
      });
  
      // Fetch signature image for this class/term
      const reportSettingsResult = await db.query(
        `SELECT signature_image_path, signature_name, signature_title, display_settings FROM report_settings 
         WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
        [organizationId, parsedClassId, parsedTermId]
      );
      const reportSettings = reportSettingsResult.rows[0];
      let signatureImageUrl = null;
      const signatureName = reportSettings?.signature_name || null;
      const signatureTitle = reportSettings?.signature_title || null;
      if (reportSettings && reportSettings.signature_image_path) {
        signatureImageUrl = await getFromS3(reportSettings.signature_image_path);
      }

      // Fetch display settings for ALL enrolled classes (for the dynamic per-class Advanced panel)
      const enrolledClassIds = enrolledClasses.map(c => c.class_id);
      const allClassDsResult = await db.query(
        `SELECT class_id, display_settings FROM report_settings
         WHERE organization_id = $1 AND term_id = $2 AND class_id = ANY($3::int[])`,
        [organizationId, parsedTermId, enrolledClassIds]
      );
      const allDisplaySettingsMap = {};
      enrolledClasses.forEach(cls => {
        const row = allClassDsResult.rows.find(r => r.class_id === cls.class_id);
        const raw = row?.display_settings || {};
        const col = raw.columns || {};
        const sec = raw.sections || {};
        const paygiraBillsRaw = sec.paygiraBills || {};
        const paygiraAutoRaw = paygiraBillsRaw.auto || {};
        const paygiraMetricsRaw = paygiraAutoRaw.metrics || {};
        const paygiraFutureRaw = paygiraAutoRaw.future || {};
        const paygiraManualRaw = paygiraBillsRaw.manual || {};
        const paygiraManualFieldsRaw = Array.isArray(paygiraManualRaw.fields) ? paygiraManualRaw.fields : [];
        const paygiraManualFields = normalizePaygiraManualFields(paygiraManualFieldsRaw, cls.class_id);
        const paygiraManualTotalsRaw = Array.isArray(paygiraManualRaw.totals) ? paygiraManualRaw.totals : [];
        const paygiraManualTotals = normalizePaygiraManualTotals(paygiraManualTotalsRaw, paygiraManualFields.map((field) => field.key));
        const gradePresentation = normalizeGradePresentationConfig(sec.gradePresentation);
        allDisplaySettingsMap[cls.class_id] = {
          columns: {
            classScore:       col.classScore       !== false,
            classScore_items: col.classScore_items  || {},
            examsScore:       col.examsScore        !== false,
            examsScore_items: col.examsScore_items   || {},
            otherScore:       col.otherScore        !== false,
            otherScore_items: col.otherScore_items   || {},
            totalScore:       col.totalScore        !== false,
            scaledScore:      col.scaledScore       !== false,
            totalPercentage:  col.totalPercentage   !== false,
            grade:            col.grade             !== false,
            position:         col.position          !== false,
            remarksCol:       col.remarksCol        !== false,
          },
          sections: {
            teacherRemarks:  sec.teacherRemarks  !== false,
            conductRemarks:  sec.conductRemarks  !== false,
            attitudeRemarks: sec.attitudeRemarks !== false,
            interestRemarks: sec.interestRemarks !== false,
            gradeKey:        sec.gradeKey        !== false,
            gradePresentation,
            attendance:      sec.attendance      !== false,
            turnOffAutoAttendance: sec.turnOffAutoAttendance === true,
            manualAttendanceOutOf: Number.isFinite(Number(sec.manualAttendanceOutOf)) && Number(sec.manualAttendanceOutOf) > 0
              ? Number(sec.manualAttendanceOutOf)
              : null,
            paygiraBills: {
              enabled: paygiraBillsRaw.enabled === true,
              mode: paygiraBillsRaw.mode === 'manual' ? 'manual' : 'auto',
              auto: {
                scope: paygiraAutoRaw.scope === 'future' ? 'future' : 'past',
                dateFrom: paygiraAutoRaw.dateFrom || '',
                dateTo: paygiraAutoRaw.dateTo || '',
                future: {
                  action: paygiraFutureRaw.action === 'custom' ? 'custom' : 'create',
                  billName: String(paygiraFutureRaw.billName || '').trim(),
                  createLink: '/account/settings/finance',
                },
                metrics: {
                  totalPaid: paygiraMetricsRaw.totalPaid !== false,
                  defaultArrears: paygiraMetricsRaw.defaultArrears !== false,
                  latePayments: paygiraMetricsRaw.latePayments !== false,
                  totalBilled: paygiraMetricsRaw.totalBilled !== false,
                  totalOutstanding: paygiraMetricsRaw.totalOutstanding !== false,
                  lastPaymentDate: paygiraMetricsRaw.lastPaymentDate !== false,
                },
              },
              manual: {
                fields: paygiraManualFields,
                totals: paygiraManualTotals,
              },
            },
            promotion:       sec.promotion       !== false,
          },
        };
      });

      // Fetch assessments for ALL enrolled classes (unique titles per class, for sub-toggle items)
      const allClassAssessmentsResult = await db.query(
        `SELECT class_id, title, category FROM assessments
         WHERE term_id = $1 AND organization_id = $2 AND class_id = ANY($3::int[])
         GROUP BY class_id, title, category
         ORDER BY class_id, category, MIN(assessment_id)`,
        [parsedTermId, organizationId, enrolledClassIds]
      );
      const allAssessmentsByCategoryMap = {};
      allClassAssessmentsResult.rows.forEach(a => {
        if (!allAssessmentsByCategoryMap[a.class_id]) allAssessmentsByCategoryMap[a.class_id] = {};
        const key = a.category || 'Other';
        if (!allAssessmentsByCategoryMap[a.class_id][key]) allAssessmentsByCategoryMap[a.class_id][key] = [];
        allAssessmentsByCategoryMap[a.class_id][key].push({ title: a.title });
      });

      // Fetch all signature groups for current term
      const signatureClassesResult = await db.query(
        `SELECT DISTINCT class_id, signature_image_path, signature_name, signature_title FROM report_settings 
         WHERE organization_id = $1 AND term_id = $2 AND signature_image_path IS NOT NULL`,
        [organizationId, parsedTermId]
      );
  
      const signatureGroups = {};
      for (const row of signatureClassesResult.rows) {
        if (!signatureGroups[row.signature_image_path]) {
          signatureGroups[row.signature_image_path] = {
            classes: [],
            signature_image_url: await getFromS3(row.signature_image_path),
            signature_name: row.signature_name || null,
            signature_title: row.signature_title || null,
          };
        }
        const classInfo = enrolledClasses.find(
          (c) => c.class_id === row.class_id
        );
        signatureGroups[row.signature_image_path].classes.push({
          class_id: row.class_id,
          class_name: classInfo?.class_name || "Unknown Class",
        });
      }
      
      console.log(`[reportSettingsPage] Found ${Object.keys(signatureGroups).length} signature groups for term ${parsedTermId}:`, 
        Object.entries(signatureGroups).map(([path, data]) => ({
          path: path.substring(path.lastIndexOf('/') + 1),
          classes: data.classes.map(c => c.class_name).join(', ')
        }))
      );
  
      const assignedClassIds = signatureClassesResult.rows.map(
        (row) => row.class_id
      );
      const availableClasses = enrolledClasses.filter(
        (c) => !assignedClassIds.includes(c.class_id)
      );

      // Fetch transcript signatures (term_id = -1)
      const transcriptSignatureClassesResult = await db.query(
        `SELECT DISTINCT class_id, signature_image_path, signature_name, signature_title FROM report_settings 
         WHERE organization_id = $1 AND term_id = -1 AND signature_image_path IS NOT NULL`,
        [organizationId]
      );

      const transcriptSignatureGroups = {};
      for (const row of transcriptSignatureClassesResult.rows) {
        if (!transcriptSignatureGroups[row.signature_image_path]) {
          transcriptSignatureGroups[row.signature_image_path] = {
            classes: [],
            signature_image_url: await getFromS3(row.signature_image_path),
            signature_name: row.signature_name || null,
            signature_title: row.signature_title || null,
          };
        }
        const classInfo = enrolledClasses.find(
          (c) => c.class_id === row.class_id
        );
        transcriptSignatureGroups[row.signature_image_path].classes.push({
          class_id: row.class_id,
          class_name: classInfo?.class_name || "Unknown Class",
        });
      }
      
      console.log(`[reportSettingsPage] Found ${Object.keys(transcriptSignatureGroups).length} transcript signature groups:`, 
        Object.entries(transcriptSignatureGroups).map(([path, data]) => ({
          path: path.substring(path.lastIndexOf('/') + 1),
          classes: data.classes.map(c => c.class_name).join(', ')
        }))
      );
  
      // ✅ Fetch grouped status settings for this term only
      const groupedStatusSettingsResult = await db.query(
        `SELECT 
          promoted_class, 
          repeated_class, 
          activate_promotion, 
          cut_off_point, 
          school_reopen_date,
          array_agg(class_id ORDER BY class_id ASC) AS classes
        FROM status_settings
        WHERE organization_id = $1 AND term_id = $2
        GROUP BY promoted_class, repeated_class, activate_promotion, cut_off_point, school_reopen_date`,
        [organizationId, parsedTermId]
      );
  
      // ✅ Map with correct typing
      const groupedStatusSettings = groupedStatusSettingsResult.rows.map(
        (setting) => ({
          ...setting,
          promoted_class: setting.promoted_class
            ? parseInt(setting.promoted_class)
            : null,
          repeated_class: setting.repeated_class
            ? parseInt(setting.repeated_class)
            : null,
          classes: setting.classes.map((id) => parseInt(id)),
        })
      );

      // Fetch assessments for this class+term grouped by category (for display settings UI)
      // GROUP BY title+category so each assessment name appears only once (assessments are per-subject)
      const assessmentsForSettingsResult = await db.query(
        `SELECT title, category FROM assessments
         WHERE class_id = $1 AND term_id = $2 AND organization_id = $3
         GROUP BY title, category
         ORDER BY category, MIN(assessment_id)`,
        [parsedClassId, parsedTermId, organizationId]
      );
      const assessmentsByCategory = {};
      assessmentsForSettingsResult.rows.forEach((a) => {
        const key = a.category || 'Other';
        if (!assessmentsByCategory[key]) assessmentsByCategory[key] = [];
        assessmentsByCategory[key].push({ title: a.title });
      });

      // Build display settings with defaults for the settings UI
      const rawDS2 = reportSettings?.display_settings || {};
      const colVis2 = rawDS2.columns || {};
      const secVis2 = rawDS2.sections || {};
      const paygiraBillsRaw2 = secVis2.paygiraBills || {};
      const paygiraAutoRaw2 = paygiraBillsRaw2.auto || {};
      const paygiraMetricsRaw2 = paygiraAutoRaw2.metrics || {};
      const paygiraFutureRaw2 = paygiraAutoRaw2.future || {};
      const paygiraManualRaw2 = paygiraBillsRaw2.manual || {};
      const paygiraManualFieldsRaw2 = Array.isArray(paygiraManualRaw2.fields) ? paygiraManualRaw2.fields : [];
      const paygiraManualFields2 = normalizePaygiraManualFields(paygiraManualFieldsRaw2, parsedClassId);
      const paygiraManualTotalsRaw2 = Array.isArray(paygiraManualRaw2.totals) ? paygiraManualRaw2.totals : [];
      const paygiraManualTotals2 = normalizePaygiraManualTotals(paygiraManualTotalsRaw2, paygiraManualFields2.map((field) => field.key));
      const gradePresentation2 = normalizeGradePresentationConfig(secVis2.gradePresentation);
      const currentDisplaySettings = {
        columns: {
          classScore:      colVis2.classScore      !== false,
          classScore_items: colVis2.classScore_items || {},
          examsScore:      colVis2.examsScore      !== false,
          examsScore_items: colVis2.examsScore_items || {},
          otherScore:      colVis2.otherScore      !== false,
          otherScore_items: colVis2.otherScore_items || {},
          totalScore:      colVis2.totalScore      !== false,
          scaledScore:     colVis2.scaledScore     !== false,
          totalPercentage: colVis2.totalPercentage !== false,
          grade:           colVis2.grade           !== false,
          position:        colVis2.position        !== false,
          remarksCol:      colVis2.remarksCol      !== false,
        },
        sections: {
          teacherRemarks:  secVis2.teacherRemarks  !== false,
          conductRemarks:  secVis2.conductRemarks  !== false,
          attitudeRemarks: secVis2.attitudeRemarks !== false,
          interestRemarks: secVis2.interestRemarks !== false,
          gradeKey:        secVis2.gradeKey        !== false,
          gradePresentation: gradePresentation2,
          attendance:      secVis2.attendance      !== false,
          turnOffAutoAttendance: secVis2.turnOffAutoAttendance === true,
          manualAttendanceOutOf: Number.isFinite(Number(secVis2.manualAttendanceOutOf)) && Number(secVis2.manualAttendanceOutOf) > 0
            ? Number(secVis2.manualAttendanceOutOf)
            : null,
          paygiraBills: {
            enabled: paygiraBillsRaw2.enabled === true,
            mode: paygiraBillsRaw2.mode === 'manual' ? 'manual' : 'auto',
            auto: {
              scope: paygiraAutoRaw2.scope === 'future' ? 'future' : 'past',
              dateFrom: paygiraAutoRaw2.dateFrom || '',
              dateTo: paygiraAutoRaw2.dateTo || '',
              future: {
                action: paygiraFutureRaw2.action === 'custom' ? 'custom' : 'create',
                billName: String(paygiraFutureRaw2.billName || '').trim(),
                createLink: '/account/settings/finance',
              },
              metrics: {
                totalPaid: paygiraMetricsRaw2.totalPaid !== false,
                defaultArrears: paygiraMetricsRaw2.defaultArrears !== false,
                latePayments: paygiraMetricsRaw2.latePayments !== false,
                totalBilled: paygiraMetricsRaw2.totalBilled !== false,
                totalOutstanding: paygiraMetricsRaw2.totalOutstanding !== false,
                lastPaymentDate: paygiraMetricsRaw2.lastPaymentDate !== false,
              },
            },
            manual: {
              fields: paygiraManualFields2,
              totals: paygiraManualTotals2,
            },
          },
          promotion:       secVis2.promotion       !== false,
        },
      };

      res.render("print/reportSettings", {
        title: "Report Settings",
        statusSettings: {},
        groupedStatusSettings,
        remarks,
        scoreRemarks,
        defaultsSuppressedMap,
        availableClasses,
        signatureImageUrl,
        signatureName,
        signatureTitle,
        signatureGroups,
        transcriptSignatureGroups,
        statusSettingsClasses,
        enrolledClasses,
        classId: parsedClassId,
        termId: parsedTermId,
        setupRequired: false,
        setupMessage: null,
        assessmentsByCategory,
        currentDisplaySettings,
        allDisplaySettingsMap,
        allAssessmentsByCategoryMap,
        messages: req.flash(),
      });
    } catch (error) {
      console.error("[reportSettingsPage] error", error);
      res.status(500).send("Failed to load report settings page.");
    }
  },

  saveDisplaySettings: async (req, res) => {
    const { classId, termId, activatePromotion } = req.query;
    const organizationId = req.session.organizationId;
    if (!organizationId || !classId || !termId)
      return res.status(400).json({ error: 'Missing parameters' });
    try {
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);
      if (!Number.isFinite(parsedClassId) || !Number.isFinite(parsedTermId)) {
        return res.status(400).json({ error: 'Invalid classId or termId' });
      }

      const [scopedClassIds, scopedTerm, organizationClassesResult] = await Promise.all([
        getScopedClassIds(db, organizationId, [parsedClassId]),
        getScopedTermRecord(db, organizationId, parsedTermId),
        db.query(`SELECT class_id FROM classes WHERE organization_id = $1 ORDER BY class_id ASC`, [organizationId]),
      ]);

      if (!scopedClassIds.length || !scopedTerm) {
        return res.status(404).json({ error: 'Class or term not found for this organization' });
      }

      const organizationClassIdSet = new Set(
        organizationClassesResult.rows
          .map((row) => Number(row.class_id))
          .filter((classIdValue) => Number.isFinite(classIdValue) && classIdValue > 0)
      );

      const displaySettings = req.body && typeof req.body === 'object' ? req.body : {};

      // Normalize manual Paygira fields and keep class apply metadata consistent.
      const sections = displaySettings.sections && typeof displaySettings.sections === 'object'
        ? displaySettings.sections
        : {};
      const paygiraBills = sections.paygiraBills && typeof sections.paygiraBills === 'object'
        ? sections.paygiraBills
        : {};
      const paygiraManual = paygiraBills.manual && typeof paygiraBills.manual === 'object'
        ? paygiraBills.manual
        : {};
      const gradePresentationRaw = sections.gradePresentation && typeof sections.gradePresentation === 'object'
        ? sections.gradePresentation
        : {};
      const normalizedManualFields = normalizePaygiraManualFields(paygiraManual.fields, parsedClassId)
        .map((field) => ({
          ...field,
          applyToClasses: parsePositiveIntArray(field.applyToClasses).filter((targetClassId) => organizationClassIdSet.has(targetClassId)),
        }));
      const normalizedManualTotals = normalizePaygiraManualTotals(
        paygiraManual.totals,
        normalizedManualFields.map((field) => field.key)
      );

      const normalizedDisplaySettings = {
        ...displaySettings,
        sections: {
          ...sections,
          paygiraBills: {
            ...paygiraBills,
            manual: {
              ...paygiraManual,
              fields: normalizedManualFields,
              totals: normalizedManualTotals,
            },
          },
          gradePresentation: normalizeGradePresentationConfig(gradePresentationRaw),
        },
      };

      await db.query(
        `INSERT INTO report_settings (organization_id, class_id, term_id, display_settings)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, class_id, term_id)
         DO UPDATE SET display_settings = $4`,
        [organizationId, parsedClassId, parsedTermId, JSON.stringify(normalizedDisplaySettings)]
      );

      // Apply manual field definitions to selected classes per field.
      const fieldCopiesByClass = new Map();
      normalizedManualFields.forEach((field) => {
        const applyTargets = parsePositiveIntArray(field.applyToClasses).filter((cid) => cid !== parsedClassId);
        applyTargets.forEach((targetClassId) => {
          if (!fieldCopiesByClass.has(targetClassId)) fieldCopiesByClass.set(targetClassId, []);
          fieldCopiesByClass.get(targetClassId).push({
            ...field,
            applyToClasses: [targetClassId],
          });
        });
      });

      for (const [targetClassId, incomingFields] of fieldCopiesByClass.entries()) {
        if (!incomingFields.length) continue;

        const existingResult = await db.query(
          `SELECT display_settings
           FROM report_settings
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
           LIMIT 1`,
          [organizationId, targetClassId, parsedTermId]
        );

        const existingDisplaySettings = existingResult.rows[0]?.display_settings || {};
        const existingSections = existingDisplaySettings.sections && typeof existingDisplaySettings.sections === 'object'
          ? existingDisplaySettings.sections
          : {};
        const existingPaygiraBills = existingSections.paygiraBills && typeof existingSections.paygiraBills === 'object'
          ? existingSections.paygiraBills
          : {};
        const existingPaygiraManual = existingPaygiraBills.manual && typeof existingPaygiraBills.manual === 'object'
          ? existingPaygiraBills.manual
          : {};
        const existingFieldsRaw = Array.isArray(existingPaygiraManual.fields) ? existingPaygiraManual.fields : [];
        const existingFields = normalizePaygiraManualFields(existingFieldsRaw, targetClassId);

        const mergedByKey = new Map(existingFields.map((field) => [field.key, field]));
        incomingFields.forEach((field) => {
          mergedByKey.set(field.key, field);
        });

        const mergedFields = Array.from(mergedByKey.values());
        const existingTotalsRaw = Array.isArray(existingPaygiraManual.totals) ? existingPaygiraManual.totals : [];
        const incomingTotals = normalizedManualTotals
          .filter((total) => Array.isArray(total.fieldKeys) && total.fieldKeys.some((fieldKey) => mergedByKey.has(fieldKey)))
          .map((total) => ({
            ...total,
            fieldKeys: total.fieldKeys.filter((fieldKey) => mergedByKey.has(fieldKey)),
          }));
        const mergedTotalsByKey = new Map(
          normalizePaygiraManualTotals(existingTotalsRaw, mergedFields.map((field) => field.key)).map((total) => [total.key, total])
        );
        incomingTotals.forEach((total) => {
          mergedTotalsByKey.set(total.key, total);
        });
        const mergedTotals = normalizePaygiraManualTotals(
          Array.from(mergedTotalsByKey.values()),
          mergedFields.map((field) => field.key)
        );

        const mergedDisplaySettings = {
          ...existingDisplaySettings,
          sections: {
            ...existingSections,
            paygiraBills: {
              ...existingPaygiraBills,
              manual: {
                ...existingPaygiraManual,
                fields: mergedFields,
                totals: mergedTotals,
              },
            },
          },
        };

        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, display_settings)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET display_settings = $4`,
          [organizationId, targetClassId, parsedTermId, JSON.stringify(mergedDisplaySettings)]
        );
      }

      // Also persist activate_promotion to status_settings if provided
      if (activatePromotion !== undefined) {
        const apBool = activatePromotion === 'true';
        const updateResult = await db.query(
          `UPDATE status_settings
           SET activate_promotion = $4
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, parsedClassId, parsedTermId, apBool]
        );

        if (updateResult.rowCount === 0) {
          await db.query(
            `INSERT INTO status_settings (organization_id, class_id, term_id, activate_promotion)
             VALUES ($1, $2, $3, $4)`,
            [organizationId, parsedClassId, parsedTermId, apBool]
          );
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[saveDisplaySettings]', err);
      res.status(500).json({ error: 'Failed to save' });
    }
  },

  deleteStatusSettings: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      await db.query(
        `DELETE FROM status_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
        [organizationId, classId, termId]
      );
      req.flash("success_msg", "Status settings deleted.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error_msg", "Failed to delete.");
      res.redirect(`/print/reportSettings?classId=${classId}`);
    }
  },
  
  updateReportSettings: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
    const { schoolReopenDate, activatePromotion } = req.body;

    try {
      const activatePromotionStatus = activatePromotion === "on"; // If checked, this will be 'on'

      await db.query(
        `
                UPDATE status_settings 
                SET school_reopen_date = $1, activate_promotion = $2 
                WHERE organization_id = $3 AND class_id = $4 AND term_id = $5
            `,
        [schoolReopenDate, activatePromotionStatus, organizationId, classId, termId]
      );

      req.flash("success", "Settings updated successfully");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to update settings.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  savePromotionSettings: async (req, res) => {
    const {
      cutOffPoint,
      promotedClass,
      repeatedClass,
      schoolReopenDate,
      termEndDate,
      activatePromotion,
      selectedStatusClasses,
      classId: formClassId,
      termId: formTermId,
    } = req.body;
  
    const organizationId = req.session.organizationId;
    const fallbackClassId = formClassId || req.query.classId;
    const termId = formTermId || req.query.termId;
  
    try {
      console.log("[savePromotionSettings] incoming", {
        cutOffPoint,
        promotedClass,
        repeatedClass,
        schoolReopenDate,
        termEndDate,
        activatePromotion,
        selectedStatusClasses,
        formClassId,
        formTermId,
        queryClassId: req.query.classId,
        queryTermId: req.query.termId,
      });

      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      if (!termId || isNaN(termId)) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      const parsedTermId = parseInt(termId, 10);
      const parsedClassId = parseInt(formClassId || fallbackClassId, 10);
  
      if (isNaN(parsedClassId) || isNaN(parsedTermId)) {
        req.flash("error", "Invalid class or term ID.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      let classesToApply = Array.isArray(selectedStatusClasses)
        ? selectedStatusClasses.map((id) => parseInt(id, 10))
        : selectedStatusClasses
        ? [parseInt(selectedStatusClasses, 10)]
        : [parsedClassId];

      classesToApply = classesToApply.filter((id) => !isNaN(id));

      if (!classesToApply.length) {
        req.flash("error", "No class selected for status settings.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }
  
      const validClassIds = await getScopedClassIds(db, organizationId, classesToApply);
      if (validClassIds.length !== classesToApply.length) {
        req.flash("error", "One or more selected classes are outside this organization.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }

      const scopedTerm = await getScopedTermRecord(db, organizationId, parsedTermId);
      if (!scopedTerm) {
        req.flash("error", "Selected term is outside this organization.");
        return res.redirect(
          `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
        );
      }

      for (const classIdToSave of validClassIds) {
        const updateResult = await db.query(
          `UPDATE status_settings SET
            cut_off_point = $1,
            promoted_class = $2,
            repeated_class = $3,
            school_reopen_date = $4,
            term_end_date = $5,
            activate_promotion = $6
          WHERE organization_id = $7 AND class_id = $8 AND term_id = $9`,
          [
            parseInt(cutOffPoint, 10) || null,
            promotedClass || null,
            repeatedClass || null,
            schoolReopenDate || null,
            termEndDate || null,
            activatePromotion === "on",
            organizationId,
            classIdToSave,
            parsedTermId,
          ]
        );

        if (updateResult.rowCount === 0) {
          await db.query(
            `INSERT INTO status_settings (
              organization_id, class_id, term_id, cut_off_point, promoted_class,
              repeated_class, school_reopen_date, term_end_date, activate_promotion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              organizationId,
              classIdToSave,
              parsedTermId,
              parseInt(cutOffPoint, 10) || null,
              promotedClass || null,
              repeatedClass || null,
              schoolReopenDate || null,
              termEndDate || null,
              activatePromotion === "on",
            ]
          );
        }
      }
  
      req.flash("success", "Promotion settings processed.");
      res.redirect(
        `/print/reportSettings?classId=${fallbackClassId}&termId=${parsedTermId}`
      );
    } catch (error) {
      console.error("[savePromotionSettings] error", error);
            req.flash("error", "Error saving promotion settings.");
      res.redirect(
        `/print/reportSettings?classId=${fallbackClassId}&termId=${termId}`
      );
    }
  },
  

  saveRemarks: async (req, res) => {
    const organizationId = req.session.organizationId;
    const remarks = req.body["remarks[]"] || req.body.remarks || [];
    const remarkTypes = req.body["remarkType[]"] || req.body.remarkType || [];
    const { classId, termId } = req.query; // Get classId and termId from the query parameters

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(`/print/reportSettings`);
    }

    try {
      // Convert remarks and remarkTypes to arrays if they are single values
      const remarksArray = Array.isArray(remarks) ? remarks : [remarks];
      const remarkTypesArray = Array.isArray(remarkTypes)
        ? remarkTypes
        : [remarkTypes];

      // Insert each remark and corresponding remark type
      for (let i = 0; i < remarksArray.length; i++) {
        await db.query(
          `
                    INSERT INTO remarks (organization_id, remark, remark_type)
                    VALUES ($1, $2, $3)
                `,
          [organizationId, remarksArray[i], remarkTypesArray[i]]
        );
      }

      req.flash("success", "Remarks saved successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to save remarks.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteRemark: async (req, res) => {
    const { id } = req.params;
    const { classId, termId } = req.query; // Get classId and termId from the query parameters
    const organizationId = req.session.organizationId;

    try {
      if (!organizationId) {
        req.flash("error", "Unauthorized.");
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
      }
      // Tenant boundary: remark id must belong to caller's org.
      await db.query(
        "DELETE FROM remarks WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );
      req.flash("success", "Remark deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Error deleting remark.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  saveScoreRemarks: async (req, res) => {
    await ensureScoreRemarkGradeColumn(db);
    await ensureScoreRemarkRangeUniqueConstraint(db);
    const { remark, grade_label, from_percentage, to_percentage, classId, entryType } = req.body;
    const organizationId = req.session.organizationId;
    const termId = req.body.termId;

    console.log("[saveScoreRemarks] incoming", {
      remark,
      grade_label,
      from_percentage,
      to_percentage,
      termId,
      classId,
      organizationId,
    });

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(`/print/reportSettings?termId=${termId || ""}`);
      }

      if (!termId || isNaN(termId)) {
        req.flash("error", "Invalid or missing term ID.");
        return res.redirect(`/print/reportSettings`);
      }

      if (!classId || isNaN(classId)) {
        req.flash("error", "Invalid or missing class ID.");
        return res.redirect(`/print/reportSettings?termId=${termId}`);
      }

      const normalizedRemark = String(remark || "").trim();
      const normalizedGradeLabelInput = String(grade_label || "").trim();

      if (entryType === "remark" && !normalizedRemark) {
        req.flash("error", "Remark text is required.");
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
      }

      if (entryType === "grade" && !normalizedGradeLabelInput) {
        req.flash("error", "Grade label is required.");
        return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
      }

      const parsedTermId = parseInt(termId, 10);
      const parsedClassId = parseInt(classId, 10);
      const fromPct = parseFloat(from_percentage);
      const toPct = parseFloat(to_percentage);
      const formatRangeLabel = (fromValue, toValue) => `${Number(fromValue)}% - ${Number(toValue)}%`;

      const classOwnershipCheck = await db.query(
        `
          SELECT class_id
          FROM classes
          WHERE class_id = $1
            AND organization_id = $2
          LIMIT 1
        `,
        [parsedClassId, organizationId]
      );
      if (!classOwnershipCheck.rows.length) {
        req.flash("error", "Access denied: selected class does not belong to your organization.");
        return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
      }

      if (
        Number.isNaN(fromPct) ||
        Number.isNaN(toPct) ||
        fromPct > toPct
      ) {
        req.flash("error", "Provide a valid percentage range (numeric values, from <= to).");
        return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
      }

      const existingRangeResult = await db.query(
        `
          SELECT id, remark, grade_label
          FROM score_remarks
          WHERE organization_id = $1
            AND class_id = $2
            AND term_id = $3
            AND from_percentage = $4
            AND to_percentage = $5
          ORDER BY id DESC
          LIMIT 1
        `,
        [organizationId, parsedClassId, parsedTermId, fromPct, toPct]
      );

      const existingRangeRow = existingRangeResult.rows[0] || null;
      if (existingRangeRow) {
        req.flash(
          "error",
          `Range ${formatRangeLabel(fromPct, toPct)} already exists for this class/term (remark: ${existingRangeRow.remark || "-"}, grade: ${existingRangeRow.grade_label || "-"}). Use Edit to modify it.`
        );
        return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
      }

      const overlapRangeResult = await db.query(
        `
          SELECT id, from_percentage, to_percentage, remark, grade_label
          FROM score_remarks
          WHERE organization_id = $1
            AND class_id = $2
            AND term_id = $3
            AND from_percentage <= $4
            AND to_percentage >= $5
          ORDER BY from_percentage ASC
          LIMIT 1
        `,
        [organizationId, parsedClassId, parsedTermId, toPct, fromPct]
      );
      const overlapRangeRow = overlapRangeResult.rows[0] || null;
      if (overlapRangeRow) {
        req.flash(
          "error",
          `Range ${formatRangeLabel(fromPct, toPct)} overlaps existing range ${formatRangeLabel(overlapRangeRow.from_percentage, overlapRangeRow.to_percentage)} for this class/term (remark: ${overlapRangeRow.remark || "-"}, grade: ${overlapRangeRow.grade_label || "-"}).`
        );
        return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
      }

      const matchingDefaultRow = getDefaultRowForRange(fromPct, toPct);
      const finalGradeLabel = normalizedGradeLabelInput || matchingDefaultRow?.gradeLabel || getDefaultGradeLabel((fromPct + toPct) / 2);
      const finalRemark = normalizedRemark || matchingDefaultRow?.remark || getDefaultScoreRemark((fromPct + toPct) / 2);

      if (entryType === "remark") {
        const existingRemarkResult = await db.query(
          `
            SELECT id, from_percentage, to_percentage
            FROM score_remarks
            WHERE organization_id = $1
              AND class_id = $2
              AND term_id = $3
              AND lower(trim(remark)) = lower(trim($4))
            ORDER BY id DESC
            LIMIT 1
          `,
          [organizationId, parsedClassId, parsedTermId, finalRemark]
        );

        const existingRemarkRow = existingRemarkResult.rows[0] || null;
        if (existingRemarkRow) {
          req.flash(
            "error",
            `Remark "${finalRemark}" already exists for range ${formatRangeLabel(existingRemarkRow.from_percentage, existingRemarkRow.to_percentage)} in this class/term. Use a different remark text.`
          );
          return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
        }
      }

      await db.query(
        `
          INSERT INTO score_remarks (organization_id, class_id, term_id, remark, grade_label, from_percentage, to_percentage)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [organizationId, parsedClassId, parsedTermId, finalRemark, finalGradeLabel, fromPct, toPct]
      );

      req.flash("success", entryType === "grade" ? "Grade mapping saved successfully." : "Score remark saved successfully.");
      return res.redirect(`/print/reportSettings?classId=${parsedClassId}&termId=${parsedTermId}`);
    } catch (error) {
      console.error("[saveScoreRemarks] error", error);
      req.flash("error", "Failed to save score remark.");
      return res.redirect(`/print/reportSettings?classId=${classId || ""}&termId=${termId || ""}`);
    }
  },

  deleteScoreRemark: async (req, res) => {
    const { id } = req.params;
    const { termId, classId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      if (!termId) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect("/print/reportSettings");
      }

      const parsedTermId = parseInt(termId, 10);

      await db.query(
        "DELETE FROM score_remarks WHERE id = $1 AND organization_id = $2",
        [id, organizationId]
      );

      if (classId && !Number.isNaN(Number(classId))) {
        const parsedClassId = Number(classId);
        const remainingRows = await getClassScoreRemarksRows(
          db,
          organizationId,
          parsedClassId,
          parsedTermId
        );
        await setDefaultsSuppressedState(
          db,
          organizationId,
          parsedClassId,
          parsedTermId,
          remainingRows.length === 0
        );
      }

      req.flash("success", "Score remark deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId || ""}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Error deleting score remark.");
      res.redirect(`/print/reportSettings?classId=${classId || ""}&termId=${termId}`);
    }
  },

  saveScoreRemarksAjax: async (req, res) => {
    await ensureScoreRemarkGradeColumn(db);
    await ensureScoreRemarkDefaultStateTable(db);
    await ensureScoreRemarkRangeUniqueConstraint(db);
    const {
      remark,
      grade_label,
      from_percentage,
      to_percentage,
      termId,
      selectedClasses,
      entryType,
      rowId,
      action,
    } = req.body;
    const organizationId = req.session.organizationId;

    console.log("[saveScoreRemarksAjax] incoming", {
      entryType,
      remark,
      grade_label,
      from_percentage,
      to_percentage,
      termId,
      selectedClasses,
      organizationId,
    });

    try {
      if (!organizationId) {
        return res.json({ success: false, message: "Organization ID is not set in session." });
      }

      if (!termId || isNaN(termId)) {
        return res.json({ success: false, message: "Invalid or missing term ID." });
      }

      if (!selectedClasses || !Array.isArray(selectedClasses) || selectedClasses.length === 0) {
        return res.json({ success: false, message: "Please select at least one class." });
      }

      const normalizedRemark = String(remark || "").trim();
      const normalizedGradeLabelInput = String(grade_label || "").trim();

      if (action !== "deleteDefault" && entryType === "remark" && !normalizedRemark) {
        return res.json({ success: false, message: "Remark text is required." });
      }

      if (action !== "deleteDefault" && entryType === "grade" && !normalizedGradeLabelInput) {
        return res.json({ success: false, message: "Grade label is required." });
      }

      const parsedTermId = parseInt(termId, 10);
      const fromPct = parseFloat(from_percentage);
      const toPct = parseFloat(to_percentage);
      const parsedRowId = Number(rowId);
      const formatRangeLabel = (fromValue, toValue) => `${Number(fromValue)}% - ${Number(toValue)}%`;
      const parsedSelectedClassIds = selectedClasses
        .map((classId) => parseInt(classId, 10))
        .filter((classId) => Number.isInteger(classId) && classId > 0);

      if (parsedSelectedClassIds.length !== selectedClasses.length) {
        return res.json({ success: false, message: "Invalid class selection." });
      }

      const classOwnershipResult = await db.query(
        `
          SELECT class_id
          FROM classes
          WHERE organization_id = $1
            AND class_id = ANY($2::int[])
        `,
        [organizationId, parsedSelectedClassIds]
      );
      const allowedClassIds = new Set(classOwnershipResult.rows.map((row) => Number(row.class_id)));
      const unauthorizedClassId = parsedSelectedClassIds.find((classId) => !allowedClassIds.has(classId));
      if (unauthorizedClassId) {
        return res.json({
          success: false,
          message: `Access denied: class ${unauthorizedClassId} does not belong to your organization.`,
        });
      }

      if (
        Number.isNaN(fromPct) ||
        Number.isNaN(toPct) ||
        fromPct > toPct
      ) {
        return res.json({ success: false, message: "Provide a valid percentage range (numeric values, from <= to)." });
      }

      const savedRemarks = [];
      const classRowsMap = {};

      if (Number.isInteger(parsedRowId) && parsedRowId > 0) {
        const editableRowResult = await db.query(
          `
            SELECT id, class_id, term_id, remark, grade_label, from_percentage, to_percentage
            FROM score_remarks
            WHERE id = $1 AND organization_id = $2
            LIMIT 1
          `,
          [parsedRowId, organizationId]
        );

        if (!editableRowResult.rows.length) {
          return res.json({ success: false, message: "Could not find the record to edit." });
        }

        const editableRow = editableRowResult.rows[0];
        const targetClassId = Number(editableRow.class_id);
        const finalFromPct = Number.isNaN(fromPct) ? Number(editableRow.from_percentage) : fromPct;
        const finalToPct = Number.isNaN(toPct) ? Number(editableRow.to_percentage) : toPct;
        const finalGradeLabel = normalizedGradeLabelInput || editableRow.grade_label || getDefaultGradeLabel((finalFromPct + finalToPct) / 2);
        const finalRemark = normalizedRemark || editableRow.remark || "No Remark";

        if (
          Number.isNaN(finalFromPct) ||
          Number.isNaN(finalToPct) ||
          finalFromPct > finalToPct
        ) {
          return res.json({ success: false, message: "Provide a valid percentage range (numeric values, from <= to)." });
        }

        const rangeConflictResult = await db.query(
          `
            SELECT id, remark, grade_label
            FROM score_remarks
            WHERE organization_id = $1
              AND class_id = $2
              AND term_id = $3
              AND from_percentage = $4
              AND to_percentage = $5
              AND id <> $6
            ORDER BY id DESC
            LIMIT 1
          `,
          [organizationId, targetClassId, parsedTermId, finalFromPct, finalToPct, parsedRowId]
        );
        const rangeConflictRow = rangeConflictResult.rows[0] || null;
        if (rangeConflictRow) {
          return res.json({
            success: false,
            message: `Class ${targetClassId}: range ${formatRangeLabel(finalFromPct, finalToPct)} already exists (remark: ${rangeConflictRow.remark || "-"}, grade: ${rangeConflictRow.grade_label || "-"}).`,
          });
        }

        const overlapRangeResult = await db.query(
          `
            SELECT id, from_percentage, to_percentage, remark, grade_label
            FROM score_remarks
            WHERE organization_id = $1
              AND class_id = $2
              AND term_id = $3
              AND from_percentage <= $4
              AND to_percentage >= $5
              AND id <> $6
            ORDER BY from_percentage ASC
            LIMIT 1
          `,
          [organizationId, targetClassId, parsedTermId, finalToPct, finalFromPct, parsedRowId]
        );
        const overlapRangeRow = overlapRangeResult.rows[0] || null;
        if (overlapRangeRow) {
          return res.json({
            success: false,
            message: `Class ${targetClassId}: range ${formatRangeLabel(finalFromPct, finalToPct)} overlaps existing range ${formatRangeLabel(overlapRangeRow.from_percentage, overlapRangeRow.to_percentage)} (remark: ${overlapRangeRow.remark || "-"}, grade: ${overlapRangeRow.grade_label || "-"}).`,
          });
        }

        if (entryType === "remark") {
          const remarkConflictResult = await db.query(
            `
              SELECT id, from_percentage, to_percentage
              FROM score_remarks
              WHERE organization_id = $1
                AND class_id = $2
                AND term_id = $3
                AND lower(trim(remark)) = lower(trim($4))
                AND id <> $5
              ORDER BY id DESC
              LIMIT 1
            `,
            [organizationId, targetClassId, parsedTermId, finalRemark, parsedRowId]
          );
          const remarkConflictRow = remarkConflictResult.rows[0] || null;
          if (remarkConflictRow) {
            return res.json({
              success: false,
              message: `Class ${targetClassId}: remark "${finalRemark}" already exists for range ${formatRangeLabel(remarkConflictRow.from_percentage, remarkConflictRow.to_percentage)}.`,
            });
          }
        }

        const editedResult = await db.query(
          `
            UPDATE score_remarks
            SET from_percentage = $1,
                to_percentage = $2,
                remark = $3,
                grade_label = $4,
                term_id = $5,
                class_id = $6
            WHERE id = $7
            RETURNING *
          `,
          [finalFromPct, finalToPct, finalRemark, finalGradeLabel, parsedTermId, targetClassId, parsedRowId]
        );

        await setDefaultsSuppressedState(db, organizationId, targetClassId, parsedTermId, false);
        classRowsMap[String(targetClassId)] = await getClassScoreRemarksRows(db, organizationId, targetClassId, parsedTermId);

        return res.json({
          success: true,
          savedRemarks: editedResult.rows,
          classRowsMap,
          message: entryType === "grade" ? "Grade mapping updated successfully." : "Score remark updated successfully.",
        });
      }

      for (const parsedClassId of parsedSelectedClassIds) {

        if (action === "deleteDefault") {
          continue;
        }

        const existingRangeResult = await db.query(
          `
            SELECT id, remark, grade_label
            FROM score_remarks
            WHERE organization_id = $1
              AND class_id = $2
              AND term_id = $3
              AND from_percentage = $4
              AND to_percentage = $5
            ORDER BY id DESC
            LIMIT 1
          `,
          [organizationId, parsedClassId, parsedTermId, fromPct, toPct]
        );
        const existingRangeRow = existingRangeResult.rows[0] || null;
        if (existingRangeRow) {
          return res.json({
            success: false,
            message: `Class ${parsedClassId}: range ${formatRangeLabel(fromPct, toPct)} already exists (remark: ${existingRangeRow.remark || "-"}, grade: ${existingRangeRow.grade_label || "-"}).`,
          });
        }

        const overlapRangeResult = await db.query(
          `
            SELECT id, from_percentage, to_percentage, remark, grade_label
            FROM score_remarks
            WHERE organization_id = $1
              AND class_id = $2
              AND term_id = $3
              AND from_percentage <= $4
              AND to_percentage >= $5
            ORDER BY from_percentage ASC
            LIMIT 1
          `,
          [organizationId, parsedClassId, parsedTermId, toPct, fromPct]
        );
        const overlapRangeRow = overlapRangeResult.rows[0] || null;
        if (overlapRangeRow) {
          return res.json({
            success: false,
            message: `Class ${parsedClassId}: range ${formatRangeLabel(fromPct, toPct)} overlaps existing range ${formatRangeLabel(overlapRangeRow.from_percentage, overlapRangeRow.to_percentage)} (remark: ${overlapRangeRow.remark || "-"}, grade: ${overlapRangeRow.grade_label || "-"}).`,
          });
        }

        if (entryType === "remark") {
          const matchingDefaultRow = getDefaultRowForRange(fromPct, toPct);
          const finalRemarkForValidation = normalizedRemark || matchingDefaultRow?.remark || getDefaultScoreRemark((fromPct + toPct) / 2);
          const existingRemarkResult = await db.query(
            `
              SELECT id, from_percentage, to_percentage
              FROM score_remarks
              WHERE organization_id = $1
                AND class_id = $2
                AND term_id = $3
                AND lower(trim(remark)) = lower(trim($4))
              ORDER BY id DESC
              LIMIT 1
            `,
            [organizationId, parsedClassId, parsedTermId, finalRemarkForValidation]
          );
          const existingRemarkRow = existingRemarkResult.rows[0] || null;
          if (existingRemarkRow) {
            return res.json({
              success: false,
              message: `Class ${parsedClassId}: remark "${finalRemarkForValidation}" already exists for range ${formatRangeLabel(existingRemarkRow.from_percentage, existingRemarkRow.to_percentage)}.`,
            });
          }
        }
      }

      for (const parsedClassId of parsedSelectedClassIds) {

        if (action === "deleteDefault") {
          await db.query(
            `
              DELETE FROM score_remarks
              WHERE ctid IN (
                SELECT ctid
                FROM score_remarks
                WHERE organization_id = $1
                  AND class_id = $2
                  AND term_id = $3
                  AND from_percentage = $4
                  AND to_percentage = $5
                LIMIT 1
              )
            `,
            [organizationId, parsedClassId, parsedTermId, fromPct, toPct]
          );

          const remainingRows = await getClassScoreRemarksRows(db, organizationId, parsedClassId, parsedTermId);
          await setDefaultsSuppressedState(db, organizationId, parsedClassId, parsedTermId, remainingRows.length === 0);
          classRowsMap[String(parsedClassId)] = remainingRows;
          continue;
        }

        const matchingDefaultRow = getDefaultRowForRange(fromPct, toPct);
        const finalGradeLabel = normalizedGradeLabelInput || matchingDefaultRow?.gradeLabel || getDefaultGradeLabel((fromPct + toPct) / 2);
        const finalRemark = normalizedRemark || matchingDefaultRow?.remark || getDefaultScoreRemark((fromPct + toPct) / 2);

        let result;
        try {
          result = await db.query(
            `
              INSERT INTO score_remarks (organization_id, class_id, term_id, remark, grade_label, from_percentage, to_percentage)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              RETURNING *
            `,
            [organizationId, parsedClassId, parsedTermId, finalRemark, finalGradeLabel, fromPct, toPct]
          );
        } catch (insertError) {
          if (insertError?.code === "23505" && insertError?.constraint === "unique_score_remark") {
            return res.json({
              success: false,
              message: `Class ${parsedClassId}: remark "${finalRemark}" already exists in this term. Use a different score remark text for this range.`,
            });
          }
          throw insertError;
        }

        savedRemarks.push(result.rows[0]);
        await setDefaultsSuppressedState(db, organizationId, parsedClassId, parsedTermId, false);
        classRowsMap[String(parsedClassId)] = await getClassScoreRemarksRows(db, organizationId, parsedClassId, parsedTermId);
      }

      return res.json({
        success: true,
        savedRemarks,
        classRowsMap,
        message:
          action === "deleteDefault"
            ? (entryType === "grade" ? "Default grade mapping deleted successfully." : "Default score remark deleted successfully.")
            : (entryType === "grade" ? "Grade mapping saved successfully." : "Score remark saved successfully."),
      });
    } catch (error) {
      console.error("[saveScoreRemarksAjax] error", error);
      return res.json({ success: false, message: "Failed to save score remark." });
    }
  },

  uploadSignatureImage: async (req, res) => {
    const { file } = req;
    const organizationId = req.session.organizationId;
    const { classId, termId, applyAllClasses, selectedSignatureClasses, signatureName, signatureTitle } =
      req.body;
    await ensureSignatureMetaColumns(db);

    if (!file) {
      req.flash("error", "No signature provided.");
      return res.redirect(
        `/print/reportSettings?classId=${classId}&termId=${termId}`
      );
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(
          `/print/reportSettings?classId=${classId}&termId=${termId}`
        );
      }

      if (!termId) {
        req.flash("error", "Invalid or missing termId.");
        return res.redirect(`/print/reportSettings?classId=${classId}`);
      }

      let classesToApply = [];
      if (applyAllClasses) {
        const allClassesResult = await db.query(
          "SELECT class_id FROM classes WHERE organization_id = $1",
          [organizationId]
        );
        classesToApply = allClassesResult.rows.map((row) => row.class_id);
      } else if (Array.isArray(selectedSignatureClasses)) {
        classesToApply = selectedSignatureClasses.map((id) => parseInt(id, 10));
      } else if (selectedSignatureClasses) {
        classesToApply = [parseInt(selectedSignatureClasses, 10)];
      } else if (classId) {
        classesToApply = [parseInt(classId, 10)];
      }

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `signature-${timestamp}-${randomSuffix}.png`;
      const key = `images/reportsignature/${organizationId}/${filename}`;
      const uploadedKey = await uploadToS3(key, file);
      
      console.log(`[uploadSignatureImage] Created new signature: ${filename} for classes:`, classesToApply);

      for (const currentClassId of classesToApply) {
        // Get the existing signature path for this class
        const existingSignatureResult = await db.query(
          `SELECT signature_image_path 
           FROM report_settings 
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, currentClassId, termId]
        );

        const existingSignaturePath = existingSignatureResult.rows[0]?.signature_image_path;

        // Insert or update the new signature image path
        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path, signature_name, signature_title)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path,
                         signature_name = EXCLUDED.signature_name,
                         signature_title = EXCLUDED.signature_title`,
          [organizationId, currentClassId, termId, uploadedKey, signatureName || null, signatureTitle || null]
        );

        // Check if old signature is still used by other classes
        if (existingSignaturePath && existingSignaturePath !== uploadedKey) {
          const otherUsesResult = await db.query(
            `SELECT COUNT(*) as count 
             FROM report_settings 
             WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3`,
            [organizationId, termId, existingSignaturePath]
          );

          const otherUsesCount = parseInt(otherUsesResult.rows[0]?.count || 0);

          // If no other classes use this signature, delete it from S3
          if (otherUsesCount === 0) {
            const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
            let oldSignatureKey = existingSignaturePath;
            if (existingSignaturePath.startsWith(s3Prefix)) {
              oldSignatureKey = existingSignaturePath.substring(s3Prefix.length);
            }
            await deleteFromS3(oldSignatureKey);
            console.log(`[uploadSignatureImage] Deleted orphaned signature: ${oldSignatureKey}`);
          }
        }
      }

      req.flash("success", "Signature image uploaded successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to upload signature image.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteSignatureImage: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId, termId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(
        `/print/reportSettings?classId=${classId}&termId=${termId}`
      );
    }

    if (!termId) {
      req.flash("error", "Invalid or missing termId.");
      return res.redirect(`/print/reportSettings?classId=${classId}`);
    }

    try {
      const result = await db.query(
        "SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );
      const signatureImagePath = result.rows[0]?.signature_image_path;

      if (signatureImagePath) {
        // Remove the S3 URL prefix to get the key if needed
        const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
        let oldSignatureKey = signatureImagePath;
        if (signatureImagePath.startsWith(s3Prefix)) {
          oldSignatureKey = signatureImagePath.substring(s3Prefix.length);
        }
        await deleteFromS3(oldSignatureKey);
      }

      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );

      req.flash("success", "Signature image deleted successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
            req.flash("error", "Failed to delete signature image.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteSignatureForClass: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId, termId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }

    if (!termId || !classId) {
      req.flash("error", "Invalid or missing parameters.");
      return res.redirect(`/print/reportSettings`);
    }

    try {
      // Get the signature path before deleting
      const sigResult = await db.query(
        "SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );
      const signaturePath = sigResult.rows[0]?.signature_image_path;

      // Remove the signature assignment for this class
      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, termId]
      );

      // Check if this signature is used by any other class
      if (signaturePath) {
        const otherClassesResult = await db.query(
          "SELECT COUNT(*) as count FROM report_settings WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
          [organizationId, termId, signaturePath]
        );

        const otherClassesCount = parseInt(otherClassesResult.rows[0]?.count || 0);

        // If no other classes use this signature, delete it from S3
        if (otherClassesCount === 0) {
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          let signatureKey = signaturePath;
          if (signaturePath.startsWith(s3Prefix)) {
            signatureKey = signaturePath.substring(s3Prefix.length);
          }
          await deleteFromS3(signatureKey);
          console.log(`[deleteSignatureForClass] Deleted orphaned signature from S3: ${signatureKey}`);
        }
      }

      req.flash("success", "Signature removed from class successfully.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    } catch (error) {
      console.error("[deleteSignatureForClass] error", error);
      req.flash("error", "Failed to remove signature.");
      res.redirect(`/print/reportSettings?classId=${classId}&termId=${termId}`);
    }
  },

  deleteEntireSignature: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { signaturePath, termId } = req.query;

    if (!organizationId) {
      req.flash("error", "Organization ID is not set in session.");
      return res.redirect(`/print/reportSettings?termId=${termId}`);
    }

    if (!termId || !signaturePath) {
      req.flash("error", "Invalid or missing parameters.");
      return res.redirect(`/print/reportSettings?termId=${termId}`);
    }

    try {
      // Remove signature from all classes in this organization and term
      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
        [organizationId, termId, signaturePath]
      );

      // Delete the signature file from S3
      const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
      let signatureKey = signaturePath;
      if (signaturePath.startsWith(s3Prefix)) {
        signatureKey = signaturePath.substring(s3Prefix.length);
      }
      await deleteFromS3(signatureKey);

      console.log(`[deleteEntireSignature] Deleted signature: ${signatureKey}`);
      req.flash("success", "Signature deleted successfully from all classes.");
      res.redirect(`/print/reportSettings?termId=${termId}`);
    } catch (error) {
      console.error("[deleteEntireSignature] error", error);
      req.flash("error", "Failed to delete signature.");
      res.redirect(`/print/reportSettings?termId=${termId}`);
    }
  },

  addClassesToSignature: async (req, res) => {
    const { signaturePath, termId, selectedClasses } = req.body;
    const organizationId = req.session.organizationId;

    console.log("[addClassesToSignature] incoming", {
      signaturePath,
      termId,
      selectedClasses,
      organizationId,
    });

    try {
      if (!organizationId) {
        return res.json({ success: false, message: "Organization ID is not set in session." });
      }

      if (!termId || !signaturePath || !Array.isArray(selectedClasses) || selectedClasses.length === 0) {
        return res.json({ success: false, message: "Invalid parameters." });
      }

      const parsedTermId = parseInt(termId, 10);

      // Add signature to selected classes
      for (const classId of selectedClasses) {
        const parsedClassId = parseInt(classId, 10);
        
        await db.query(
          `
            INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (organization_id, class_id, term_id)
            DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path
          `,
          [organizationId, parsedClassId, parsedTermId, signaturePath]
        );
      }

      console.log("[addClassesToSignature] Successfully added classes to signature");
      res.json({ success: true });
    } catch (error) {
      console.error("[addClassesToSignature] error", error);
      res.json({ success: false, message: "Failed to add classes to signature." });
    }
  },

  // Transcript Signature Methods
  uploadTranscriptSignature: async (req, res) => {
    const { file } = req;
    const organizationId = req.session.organizationId;
    const { selectedTranscriptClasses, transcriptSignatureName, transcriptSignatureTitle } = req.body;
    await ensureSignatureMetaColumns(db);

    if (!file) {
      req.flash("error", "No signature provided.");
      return res.redirect(`/print/reportSettings`);
    }

    try {
      if (!organizationId) {
        req.flash("error", "Organization ID is not set in session.");
        return res.redirect(`/print/reportSettings`);
      }

      const normalizedTranscriptClasses = Array.isArray(selectedTranscriptClasses)
        ? selectedTranscriptClasses
        : selectedTranscriptClasses
        ? [selectedTranscriptClasses]
        : [];

      if (normalizedTranscriptClasses.length === 0) {
        req.flash("error", "Please select at least one class.");
        return res.redirect(`/print/reportSettings`);
      }

      const classesToApply = normalizedTranscriptClasses.map((id) => parseInt(id, 10));
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const filename = `transcript-signature-${timestamp}-${randomSuffix}.png`;
      const key = `images/transcriptsignature/${organizationId}/${filename}`;
      const uploadedKey = await uploadToS3(key, file);
      
      console.log(`[uploadTranscriptSignature] Created new transcript signature: ${filename} for classes:`, classesToApply);

      const transcriptTermId = -1; // Transcript signatures use term_id = -1

      for (const currentClassId of classesToApply) {
        // Get existing transcript signature
        const existingSignatureResult = await db.query(
          `SELECT signature_image_path 
           FROM report_settings 
           WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
          [organizationId, currentClassId, transcriptTermId]
        );

        const existingSignaturePath = existingSignatureResult.rows[0]?.signature_image_path;

        // Insert or update
        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path, signature_name, signature_title)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path,
                         signature_name = EXCLUDED.signature_name,
                         signature_title = EXCLUDED.signature_title`,
          [organizationId, currentClassId, transcriptTermId, uploadedKey, transcriptSignatureName || null, transcriptSignatureTitle || null]
        );

        // Cleanup old signature if orphaned
        if (existingSignaturePath && existingSignaturePath !== uploadedKey) {
          const otherUsesResult = await db.query(
            `SELECT COUNT(*) as count 
             FROM report_settings 
             WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3`,
            [organizationId, transcriptTermId, existingSignaturePath]
          );

          const otherUsesCount = parseInt(otherUsesResult.rows[0]?.count || 0);

          if (otherUsesCount === 0) {
            const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
            let oldSignatureKey = existingSignaturePath;
            if (existingSignaturePath.startsWith(s3Prefix)) {
              oldSignatureKey = existingSignaturePath.substring(s3Prefix.length);
            }
            await deleteFromS3(oldSignatureKey);
            console.log(`[uploadTranscriptSignature] Deleted orphaned signature: ${oldSignatureKey}`);
          }
        }
      }

      req.flash("success", "Transcript signature uploaded successfully.");
      res.redirect(`/print/reportSettings`);
    } catch (error) {
      console.error("[uploadTranscriptSignature] error", error);
      req.flash("error", "Failed to upload transcript signature.");
      res.redirect(`/print/reportSettings`);
    }
  },

  deleteTranscriptSignatureForClass: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { classId } = req.query;

    try {
      const transcriptTermId = -1;

      const sigResult = await db.query(
        "SELECT signature_image_path FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, transcriptTermId]
      );
      const signaturePath = sigResult.rows[0]?.signature_image_path;

      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND class_id = $2 AND term_id = $3",
        [organizationId, classId, transcriptTermId]
      );

      if (signaturePath) {
        const otherClassesResult = await db.query(
          "SELECT COUNT(*) as count FROM report_settings WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
          [organizationId, transcriptTermId, signaturePath]
        );

        const otherClassesCount = parseInt(otherClassesResult.rows[0]?.count || 0);

        if (otherClassesCount === 0) {
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          let signatureKey = signaturePath;
          if (signaturePath.startsWith(s3Prefix)) {
            signatureKey = signaturePath.substring(s3Prefix.length);
          }
          await deleteFromS3(signatureKey);
          console.log(`[deleteTranscriptSignatureForClass] Deleted orphaned signature: ${signatureKey}`);
        }
      }

      req.flash("success", "Transcript signature removed from class.");
      res.redirect(`/print/reportSettings`);
    } catch (error) {
      console.error("[deleteTranscriptSignatureForClass] error", error);
      req.flash("error", "Failed to remove transcript signature.");
      res.redirect(`/print/reportSettings`);
    }
  },

  deleteEntireTranscriptSignature: async (req, res) => {
    const organizationId = req.session.organizationId;
    const { signaturePath } = req.query;

    try {
      const transcriptTermId = -1;

      await db.query(
        "UPDATE report_settings SET signature_image_path = NULL WHERE organization_id = $1 AND term_id = $2 AND signature_image_path = $3",
        [organizationId, transcriptTermId, signaturePath]
      );

      const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
      let signatureKey = signaturePath;
      if (signaturePath.startsWith(s3Prefix)) {
        signatureKey = signaturePath.substring(s3Prefix.length);
      }
      await deleteFromS3(signatureKey);

      console.log(`[deleteEntireTranscriptSignature] Deleted signature: ${signatureKey}`);
      req.flash("success", "Transcript signature deleted successfully.");
      res.redirect(`/print/reportSettings`);
    } catch (error) {
      console.error("[deleteEntireTranscriptSignature] error", error);
      req.flash("error", "Failed to delete transcript signature.");
      res.redirect(`/print/reportSettings`);
    }
  },

  addClassesToTranscriptSignature: async (req, res) => {
    const { signaturePath, selectedClasses } = req.body;
    const organizationId = req.session.organizationId;

    try {
      if (!organizationId) {
        return res.json({ success: false, message: "Organization ID is not set in session." });
      }

      if (!signaturePath || !Array.isArray(selectedClasses) || selectedClasses.length === 0) {
        return res.json({ success: false, message: "Invalid parameters." });
      }

      const transcriptTermId = -1;

      for (const classId of selectedClasses) {
        const parsedClassId = parseInt(classId, 10);
        
        await db.query(
          `INSERT INTO report_settings (organization_id, class_id, term_id, signature_image_path)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (organization_id, class_id, term_id)
           DO UPDATE SET signature_image_path = EXCLUDED.signature_image_path`,
          [organizationId, parsedClassId, transcriptTermId, signaturePath]
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[addClassesToTranscriptSignature] error", error);
      res.json({ success: false, message: "Failed to add classes to transcript signature." });
    }
  },

  meritSheetPage: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      // Fetch organization details
      const organizationResult = await db.query(
        `
            SELECT organization_name, logo_path 
            FROM organizations 
            WHERE organization_id = $1
        `,
        [organizationId]
      );

      const organization = organizationResult.rows[0];
      if (!organization) {
        return res.status(404).send("Organization not found.");
      }

      const logoUrl = organization.logo_path
        ? `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${organization.logo_path}`
        : null;

      // Fetch class, term, and school year information
      const classDetailsResult = await db.query(
        `
            SELECT c.class_name, t.term_name, sy.year_label
            FROM classes c
            JOIN terms t ON c.class_id = $1 AND t.term_id = $2
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE c.organization_id = $3
        `,
        [classId, termId, organizationId]
      );

      if (classDetailsResult.rows.length === 0) {
        return res.status(404).send("Class or term details not found.");
      }

      const {
        class_name: className,
        term_name: termName,
        year_label: schoolYear,
      } = classDetailsResult.rows[0];

      const studentIdSettings = await getOrganizationStudentIdSettings(db, organizationId);
      const orgNameDisplayFormat = req.session?.nameDisplayFormat;

      // Fetch subjects for the class
      const subjectsResult = await db.query(
        `
            SELECT subject_id, subject_name
            FROM subjects
            WHERE class_id = $1 AND organization_id = $2
        `,
        [classId, organizationId]
      );

      const subjects = await Promise.all(
        subjectsResult.rows.map(async (subject) => {
          const assessmentsResult = await db.query(
            `
                SELECT assessment_id, title, weight, category
                FROM assessments
                WHERE subject_id = $1 AND class_id = $2 AND term_id = $3 AND organization_id = $4
            `,
            [subject.subject_id, classId, termId, organizationId]
          );

          return {
            ...subject,
            assessments: assessmentsResult.rows,
          };
        })
      );

      // Render the page with organization name and logo
      res.render("print/meritSheetPage", {
        title: "Merit Sheet Page",
        classId,
        termId,
        className,
        termName,
        schoolYear,
        subjects,
        meritSheet: [], // Initialize meritSheet to avoid ReferenceError
        orgName: organization.organization_name,
        logoUrl: logoUrl,
      });
    } catch (error) {
            res.status(500).send("Failed to load merit sheet page.");
    }
  },

  getAssessmentsForSubject: async (req, res) => {
    const { subjectId, classId, termId } = req.query;
    const organizationId = req.session.organizationId;

    try {
      // Fetch assessments for the specified subject, class, term, and organization
      const assessmentsResult = await db.query(
        `
            SELECT a.assessment_id, a.title, a.weight, a.category, a.max_score
            FROM assessments a
            WHERE a.subject_id = $1 AND a.class_id = $2 AND a.term_id = $3 AND a.organization_id = $4
        `,
        [subjectId, classId, termId, organizationId]
      );

      res.json(assessmentsResult.rows);
    } catch (error) {
            res.status(500).send("Failed to fetch assessments.");
    }
  },

  generateMeritSheet: async (req, res) => {
    const organizationId = req.session.organizationId;

    // Accept payload from POST body or GET query; fall back to last run for refreshes
    const payload = req.method === 'GET' ? req.query : req.body;
    let { classId, termId, selectedSubjects, selectedAssessments } = payload;

    // Helper to normalize ids from array, comma string, or single value
    const normalizeIds = (input) => {
      if (!input) return [];
      if (Array.isArray(input)) return input.map((id) => Number(id)).filter((n) => !Number.isNaN(n));
      if (typeof input === 'string' && input.includes(',')) {
        return input
          .split(',')
          .map((id) => Number(id.trim()))
          .filter((n) => !Number.isNaN(n));
      }
      const single = Number(input);
      return Number.isNaN(single) ? [] : [single];
    };

    // Fall back to last successful run stored in session when refreshing
    if ((!classId || !termId || !selectedSubjects || !selectedAssessments) && req.session.lastMeritSheet) {
      const last = req.session.lastMeritSheet;
      classId = classId || last.classId;
      termId = termId || last.termId;
      if (!selectedSubjects) selectedSubjects = last.selectedSubjectIds;
      if (!selectedAssessments) selectedAssessments = last.selectedAssessmentIds;
      console.log('[generateMeritSheet] Using cached session data:', { classId, termId, selectedSubjects, selectedAssessments });
    }

    const subjectIds = normalizeIds(selectedSubjects);
    const assessmentIds = normalizeIds(selectedAssessments);

    try {
      if (!classId || !termId || !organizationId || !subjectIds.length || !assessmentIds.length) {
        // Redirect to the base page if we don't have enough info (e.g., first load without form submit)
        console.log('[generateMeritSheet] Missing required data, redirecting to base page');
        return res.redirect('/print/meritSheetPage');
      }

      // Parse as integers
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);

      if (isNaN(parsedClassId) || isNaN(parsedTermId)) {
        console.log('[generateMeritSheet] Invalid IDs after parsing:', { parsedClassId, parsedTermId });
        req.flash('error', 'Invalid class or term ID.');
        return res.redirect('/print/meritSheetPage');
      }

      console.log('[generateMeritSheet] Proceeding with:', { parsedClassId, parsedTermId, subjectIds, assessmentIds });

      // Fetch organization details
      const organizationResult = await db.query(
        `
            SELECT organization_name, logo_path
            FROM organizations
            WHERE organization_id = $1
        `,
        [organizationId]
      );
      const organization = organizationResult.rows[0];

      if (!organization) {
        return res.status(404).send("Organization not found.");
      }

      const studentIdSettings = await getOrganizationStudentIdSettings(db, organizationId);
      const orgNameDisplayFormat = req.session?.nameDisplayFormat;

      const logoUrl = organization.logo_path
        ? `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${organization.logo_path}`
        : null;

      // Fetch class, term, and school year details
      const classDetailsResult = await db.query(
        `
            SELECT c.class_name, t.term_name, sy.year_label
            FROM classes c
            JOIN terms t ON t.term_id = $1 AND t.organization_id = $2
            JOIN school_years sy ON t.school_year_id = sy.id
            WHERE c.class_id = $3 AND c.organization_id = $2
        `,
        [parsedTermId, organizationId, parsedClassId]
      );

      if (classDetailsResult.rows.length === 0) {
        req.flash("error", "Class or term details not found. Please regenerate.");
        const qs = parsedClassId && parsedTermId ? `?classId=${parsedClassId}&termId=${parsedTermId}` : "";
        return res.redirect(`/print/meritSheetPage${qs}`);
      }

      const {
        class_name: className,
        term_name: termName,
        year_label: schoolYear,
      } = classDetailsResult.rows[0];

      // Fetch selected subjects and assessments
      const subjectsResult = await db.query(
        `
            SELECT subject_id, subject_name
            FROM subjects
            WHERE subject_id = ANY($1::int[]) AND class_id = $2 AND organization_id = $3
        `,
        [subjectIds, parsedClassId, organizationId]
      );

      const selectedSubjectsData = await Promise.all(
        subjectsResult.rows.map(async (subject) => {
          const assessmentsResult = await db.query(
            `
                SELECT assessment_id, title, weight, category, max_score
                FROM assessments
                WHERE assessment_id = ANY($1::int[]) AND subject_id = $2 AND class_id = $3 AND term_id = $4 AND organization_id = $5
            `,
            [assessmentIds, subject.subject_id, parsedClassId, parsedTermId, organizationId]
          );

          return {
            ...subject,
            assessments: assessmentsResult.rows,
          };
        })
      );

      // Fetch students enrolled in the class for the given term.
      const studentsResult = await db.query(
        `SELECT es.student_id, s.custom_student_id, s.first_name, s.last_name
         FROM enrolled_students es
         JOIN students s ON es.student_id = s.student_id
         JOIN enrollments e ON es.enrollment_id = e.enrollment_id
         WHERE es.class_id = $1
           AND e.term_id = $2
           AND e.organization_id = $3`,
        [parsedClassId, parsedTermId, organizationId]
      );

      const students = studentsResult.rows;

      // Fetch students' assessment scores used in merit-sheet computation.
      const scoresResult = await db.query(
        `
            SELECT
              ar.student_id,
              a.subject_id,
              a.title AS assessment_title,
              ar.score,
              COALESCE(
                (
                  SELECT NULLIF(sr.grade_label, '')
                  FROM score_remarks sr
                  WHERE sr.organization_id = $3
                    AND sr.class_id = $1
                    AND sr.term_id = $2
                  ORDER BY
                    CASE
                      WHEN ar.total_percentage >= sr.from_percentage
                           AND ar.total_percentage <= sr.to_percentage THEN 0
                      ELSE 1
                    END,
                    CASE
                      WHEN ar.total_percentage > sr.to_percentage THEN ar.total_percentage - sr.to_percentage
                      WHEN ar.total_percentage < sr.from_percentage THEN sr.from_percentage - ar.total_percentage
                      ELSE 0
                    END,
                    sr.from_percentage DESC
                  LIMIT 1
                ),
                CASE
                  WHEN ar.total_percentage IS NULL THEN NULL
                  WHEN ar.total_percentage >= 90 THEN 'A'
                  WHEN ar.total_percentage >= 80 THEN 'B'
                  WHEN ar.total_percentage >= 70 THEN 'C'
                  ELSE 'D'
                END
              ) AS grade,
              a.weight
            FROM assessment_results ar
            JOIN assessments a ON ar.assessment_id = a.assessment_id
            WHERE ar.class_id = $1 AND ar.term_id = $2 AND ar.organization_id = $3
        `,
        [parsedClassId, parsedTermId, organizationId]
      );

      const scores = scoresResult.rows;

      // Process students and attach scores, grades, and positions
      const meritSheetData = students.map((student) => {
        const studentScores = selectedSubjectsData.map((subject) => {
          const subjectAssessments = subject.assessments.map((assessment) => {
            const scoreData = scores.find(
              (score) =>
                score.student_id === student.student_id &&
                score.subject_id === subject.subject_id &&
                score.assessment_title === assessment.title
            );

            return {
              title: assessment.title,
              score: scoreData ? scoreData.score : "-",
              grade: scoreData ? scoreData.grade : "-",
              weight: assessment.weight,
            };
          });

          const totalSubjectScore = subjectAssessments.reduce(
            (total, assessment) => {
              return (
                total +
                (assessment.score !== "-" ? parseFloat(assessment.score) : 0)
              );
            },
            0
          );

          return {
            subjectName: subject.subject_name,
            assessments: subjectAssessments,
            totalScore: totalSubjectScore,
          };
        });

        const totalScore = studentScores.reduce(
          (total, subject) => total + subject.totalScore,
          0
        );
        const averageScore = totalScore / studentScores.length;

        return {
          studentId: buildStudentDisplayId(student, studentIdSettings),
          name:
            formatDisplayName(student, orgNameDisplayFormat) ||
            [student.first_name, student.last_name].filter(Boolean).join(" ").trim(),
          scores: studentScores,
          totalScore: totalScore.toFixed(2),
          averageScore: averageScore.toFixed(2),
        };
      });

      // Sort students by total score and assign positions
      meritSheetData.sort((a, b) => b.totalScore - a.totalScore);
      const hasAnyRecordedScore = meritSheetData.some((student) =>
        Array.isArray(student.scores) &&
        student.scores.some((subject) =>
          Array.isArray(subject.assessments) &&
          subject.assessments.some((assessment) => assessment.score !== "-" && assessment.score !== null)
        )
      );

      meritSheetData.forEach((student, index) => {
        student.position = hasAnyRecordedScore
          ? `${index + 1}${getOrdinalSuffix(index + 1)}`
          : "-";
      });

      // Cache last run to support refresh on the same URL (before render in case render fails)
      req.session.lastMeritSheet = {
        classId: parsedClassId,
        termId: parsedTermId,
        selectedSubjectIds: subjectIds,
        selectedAssessmentIds: assessmentIds,
      };

      res.render("print/meritSheetPage", {
        title: "Merit Sheet",
        orgName: organization.organization_name,
        logoUrl,
        className,
        termName,
        schoolYear,
        subjects: selectedSubjectsData,
        meritSheet: meritSheetData,
      });
    } catch (error) {
            console.error('[generateMeritSheet] Failed:', error);
            res.status(500).send("Failed to generate merit sheet.");
    }
  },

  saveReportChanges: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
    const { studentReports } = req.body;
  
    if (!organizationId || !classId || !termId || !studentReports) {
      return res.status(400).send("Missing required fields.");
    }
  
    try {
      await ensureStudentReportManualAttendanceColumn(db);
      await ensureStudentReportPaygiraManualDataColumn(db);
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);

      if (!Number.isFinite(parsedClassId) || !Number.isFinite(parsedTermId)) {
        return res.status(400).send("Invalid class or term.");
      }

      const [scopedClassIds, scopedTerm] = await Promise.all([
        getScopedClassIds(db, organizationId, [parsedClassId]),
        getScopedTermRecord(db, organizationId, parsedTermId),
      ]);

      if (!scopedClassIds.length || !scopedTerm) {
        return res.status(404).send("Class or term not found for this organization.");
      }

      const requestedStudentIds = parsePositiveIntArray(studentReports.map((studentReport) => studentReport?.studentId));
      const validStudentIds = await getScopedStudentIdsForClassTerm(
        db,
        organizationId,
        parsedClassId,
        parsedTermId,
        requestedStudentIds,
      );
      const validStudentIdSet = new Set(validStudentIds);

      if (requestedStudentIds.length !== validStudentIds.length) {
        return res.status(400).send("One or more students do not belong to the selected class and term.");
      }
  
      for (const studentReport of studentReports) {
        const {
          studentId,
          conductRemarks,
          attitudeRemarks,
          interestRemarks,
          teacherRemarks,
          promotionStatus,       // ✅ from frontend
          promotionClassId,      // ✅ from frontend
          manualAttendancePresentDays,
          manualAttendanceTotalDays,
          paygiraManualData,
        } = studentReport;
  
        if (!studentId || isNaN(studentId) || studentId <= 0) {
                    continue; // skip invalid rows
        }

        if (!validStudentIdSet.has(Number(studentId))) {
          continue;
        }
  
        const manualAttendanceProvided = Object.prototype.hasOwnProperty.call(studentReport, "manualAttendancePresentDays");
        let manualAttendanceValue = null;
        if (manualAttendanceProvided && manualAttendancePresentDays !== "" && manualAttendancePresentDays !== null && manualAttendancePresentDays !== undefined) {
          const parsedManualAttendance = parseInt(manualAttendancePresentDays, 10);
          manualAttendanceValue = Number.isFinite(parsedManualAttendance) && parsedManualAttendance >= 0
            ? parsedManualAttendance
            : null;
        }

        const manualAttendanceTotalProvided = Object.prototype.hasOwnProperty.call(studentReport, "manualAttendanceTotalDays");
        let manualAttendanceTotalValue = null;
        if (manualAttendanceTotalProvided && manualAttendanceTotalDays !== "" && manualAttendanceTotalDays !== null && manualAttendanceTotalDays !== undefined) {
          const parsedManualAttendanceTotal = parseInt(manualAttendanceTotalDays, 10);
          manualAttendanceTotalValue = Number.isFinite(parsedManualAttendanceTotal) && parsedManualAttendanceTotal >= 0
            ? parsedManualAttendanceTotal
            : null;
        }

        const paygiraManualDataProvided = Object.prototype.hasOwnProperty.call(studentReport, "paygiraManualData");
        const paygiraManualDataValue = paygiraManualDataProvided && paygiraManualData && typeof paygiraManualData === 'object' && !Array.isArray(paygiraManualData)
          ? paygiraManualData
          : null;

        await db.query(
          `
            INSERT INTO student_reports (
              organization_id, class_id, term_id, student_id, 
              conduct_remarks, attitude_remarks, interest_remarks, teacher_remarks,
              promotion_status, promotion_class_id, manual_attendance_present_days, manual_attendance_total_days, paygira_manual_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (organization_id, class_id, term_id, student_id)
            DO UPDATE SET
              conduct_remarks = EXCLUDED.conduct_remarks,
              attitude_remarks = EXCLUDED.attitude_remarks,
              interest_remarks = EXCLUDED.interest_remarks,
              teacher_remarks = EXCLUDED.teacher_remarks,
              promotion_status = EXCLUDED.promotion_status,
              promotion_class_id = EXCLUDED.promotion_class_id,
              manual_attendance_present_days = CASE
                WHEN $14 THEN EXCLUDED.manual_attendance_present_days
                ELSE student_reports.manual_attendance_present_days
              END,
              manual_attendance_total_days = CASE
                WHEN $15 THEN EXCLUDED.manual_attendance_total_days
                ELSE student_reports.manual_attendance_total_days
              END,
              paygira_manual_data = CASE
                WHEN $16 THEN EXCLUDED.paygira_manual_data
                ELSE student_reports.paygira_manual_data
              END,
              updated_at = CURRENT_TIMESTAMP
          `,
          [
            organizationId,
            parsedClassId,
            parsedTermId,
            studentId,
            conductRemarks,
            attitudeRemarks,
            interestRemarks,
            teacherRemarks,
            promotionStatus,
            promotionClassId ? parseInt(promotionClassId, 10) : null, // ensure numeric or null
            manualAttendanceValue,
            manualAttendanceTotalValue,
            paygiraManualDataValue,
            manualAttendanceProvided,
            manualAttendanceTotalProvided,
            paygiraManualDataProvided,
          ]
        );
      }
  
      res.status(200).send("Changes saved successfully.");
    } catch (error) {
            res.status(500).send("Failed to save report changes.");
    }
  },

  savePaygiraReportOverrides: async (req, res) => {
    const { classId, termId } = req.query;
    const organizationId = req.session.organizationId;
    const { studentId, fields, applyToAllStudents, applyToAllClasses, selectedStudentIds, selectedClassIds } = req.body || {};

    if (!organizationId || !classId || !termId) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    try {
      await ensureReportPaygiraManualOverridesTable(db);
      const parsedClassId = parseInt(classId, 10);
      const parsedTermId = parseInt(termId, 10);
      const parsedStudentId = parseInt(studentId, 10);
      const shouldApplyAllStudents = applyToAllStudents === true;
      const shouldApplyAllClasses = applyToAllClasses === true;
      const normalizedSelectedStudents = parsePositiveIntArray(selectedStudentIds);
      const normalizedSelectedClasses = parsePositiveIntArray(selectedClassIds);

      if (!Number.isFinite(parsedClassId) || !Number.isFinite(parsedTermId)) {
        return res.status(400).json({ success: false, error: "Invalid class or term." });
      }

      const [scopedClassIds, scopedTerm] = await Promise.all([
        getScopedClassIds(db, organizationId, [parsedClassId]),
        getScopedTermRecord(db, organizationId, parsedTermId),
      ]);

      if (!scopedClassIds.length || !scopedTerm) {
        return res.status(404).json({ success: false, error: "Class or term not found for this organization." });
      }

      if (!shouldApplyAllStudents && !Number.isFinite(parsedStudentId) && normalizedSelectedStudents.length === 0) {
        return res.status(400).json({ success: false, error: "Student is required when not applying to all students." });
      }

      const normalizedFields = normalizeReportPaygiraManualFields(fields);
      if (!normalizedFields.length) {
        return res.status(400).json({ success: false, error: "No valid fields to save." });
      }

      let targetClassIds = [parsedClassId];
      if (shouldApplyAllStudents) {
        if (shouldApplyAllClasses) {
          targetClassIds = (await db.query(
            `SELECT class_id FROM classes WHERE organization_id = $1 ORDER BY class_id ASC`,
            [organizationId]
          )).rows.map((row) => Number(row.class_id)).filter((id) => Number.isFinite(id) && id > 0);
        } else if (normalizedSelectedClasses.length > 0) {
          targetClassIds = await getScopedClassIds(db, organizationId, normalizedSelectedClasses);
          if (targetClassIds.length !== normalizedSelectedClasses.length) {
            return res.status(400).json({ success: false, error: "One or more selected classes are outside this organization." });
          }
        }
      }

      const targetStudentIds = shouldApplyAllStudents
        ? []
        : (normalizedSelectedStudents.length > 0 ? normalizedSelectedStudents : [parsedStudentId]);

      if (!shouldApplyAllStudents) {
        const validStudentIds = await getScopedStudentIdsForClassTerm(
          db,
          organizationId,
          parsedClassId,
          parsedTermId,
          targetStudentIds,
        );

        if (validStudentIds.length !== targetStudentIds.length) {
          return res.status(400).json({ success: false, error: "One or more selected students are outside the active class or term." });
        }
      }

      const writeAsClassLevel = shouldApplyAllStudents;

      for (const targetClassId of targetClassIds) {
        if (writeAsClassLevel) {
          await db.query(
            `INSERT INTO report_paygira_manual_overrides (organization_id, class_id, term_id, student_id, fields, updated_at)
             VALUES ($1, $2, $3, NULL, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (organization_id, class_id, term_id) WHERE student_id IS NULL
             DO UPDATE SET fields = EXCLUDED.fields, updated_at = CURRENT_TIMESTAMP`,
            [organizationId, targetClassId, parsedTermId, JSON.stringify(normalizedFields)]
          );

          // Ensure class-level truly applies to every student by removing student-specific overrides.
          await db.query(
            `DELETE FROM report_paygira_manual_overrides
             WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id IS NOT NULL`,
            [organizationId, targetClassId, parsedTermId]
          );
        } else {
          for (const targetStudentId of targetStudentIds) {
            await db.query(
              `INSERT INTO report_paygira_manual_overrides (organization_id, class_id, term_id, student_id, fields, updated_at)
               VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
               ON CONFLICT (organization_id, class_id, term_id, student_id) WHERE student_id IS NOT NULL
               DO UPDATE SET fields = EXCLUDED.fields, updated_at = CURRENT_TIMESTAMP`,
              [organizationId, parsedClassId, parsedTermId, targetStudentId, JSON.stringify(normalizedFields)]
            );
          }
        }
      }

      return res.json({
        success: true,
        targetClassCount: targetClassIds.length,
        appliedToAllStudents: writeAsClassLevel,
      });
    } catch (error) {
      console.error("[savePaygiraReportOverrides]", error);
      return res.status(500).json({ success: false, error: "Failed to save Paygira overrides." });
    }
  },
  
  

  migrationPage: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/dashboard");
      }

      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: `migrations/org_${organizationId}/`, // ✅ Restrict to org's folder
      });

      const { Contents } = await s3Client.send(listCommand);

      const uploadedFiles = (Contents || []).map((file) => ({
        file_name: file.Key.split("/").pop(),
        s3_url: `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${file.Key}`,
      }));

      res.render("print/migration", {
        title: "Data Migration",
        uploadedFiles,
        results: [],
        query: "",
        fileUrl: null,
      });
    } catch (error) {
      req.flash("error", "Failed to load migration page.");
      res.redirect("/dashboard");
    }
  },

  // Upload File to S3 & Save Metadata in DB
  uploadFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/print/migration");
      }

      if (!req.file) {
        req.flash("error", "No file uploaded.");
        return res.redirect("/print/migration");
      }

      const fileKey = `migrations/org_${organizationId}/${Date.now()}_${
        req.file.originalname
      }`;
      const fileType = req.file.mimetype;

      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: fileType,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));

      req.flash("success", "File uploaded successfully.");
      res.redirect("/print/migration");
    } catch (error) {
            req.flash("error", "Failed to upload file.");
      res.redirect("/print/migration");
    }
  },

  searchFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/print/migration");
      }

      const { query } = req.query;
      if (!query) {
        req.flash("error", "Enter a name to search.");
        return res.redirect("/print/migration");
      }

      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: `migrations/org_${organizationId}/`, // ✅ Restrict search to org
      });

      const { Contents } = await s3Client.send(listCommand);

      let results = [];
      let fileUrl = null;

      for (let file of Contents || []) {
        if (file.Key.toLowerCase().includes(query.toLowerCase())) {
          fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${file.Key}`;
          results.push({ file: file.Key, url: fileUrl });
        }
      }

      res.render("print/migration", {
        title: "Data Migration",
        results,
        query,
        fileUrl,
        uploadedFiles: Contents || [],
      });
    } catch (error) {
            req.flash("error", "Search failed.");
      res.redirect("/print/migration");
    }
  },

  previewFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Unauthorized access." });
      }

      const { key } = req.params;
      if (!key.startsWith(`migrations/org_${organizationId}/`)) {
        return res
          .status(403)
          .json({ error: "File does not belong to your organization." });
      }

      const fileUrl = await getFromS3(key);
      if (!fileUrl) {
        return res.status(404).json({ error: "File not found in S3." });
      }

      res.json({ fileUrl });
    } catch (error) {
            res.status(500).json({ error: "Failed to preview file." });
    }
  },

  deleteFile: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      if (!organizationId) {
        req.flash("error", "Organization ID is missing.");
        return res.redirect("/print/migration");
      }

      const { key } = req.params;
      if (!key) {
        req.flash("error", "Invalid file key.");
        return res.redirect("/print/migration");
      }

      // Construct full key for S3 (ensure correct path)
      const fullKey = `migrations/org_${organizationId}/${key}`;

      // Check if file exists in S3 before attempting to delete
      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: fullKey,
      });

      const { Contents } = await s3Client.send(listCommand);
      if (!Contents || Contents.length === 0) {
        req.flash("error", "File does not exist or is unauthorized.");
        return res.redirect("/print/migration");
      }

      // Proceed with deletion
      await deleteFromS3(fullKey);

      req.flash("success", "File deleted successfully.");
      res.redirect("/print/migration");
    } catch (error) {
            req.flash("error", "Failed to delete file.");
      res.redirect("/print/migration");
    }
  },

  // Get guardian emails for selected students
  getGuardianEmails: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { studentIds } = req.query;

      if (!organizationId || !studentIds) {
        return res.status(400).json({ success: false, message: "Missing parameters." });
      }

      const ids = studentIds.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "No valid student IDs." });
      }

      // Fetch students with their guardian emails (new guardian_profiles + legacy guardians table)
      const result = await db.query(
        `SELECT s.student_id,
                s.first_name,
                s.last_name,
                c.class_name,
                COALESCE(
                  jsonb_agg(DISTINCT jsonb_build_object('email', ge.email, 'relationship', ge.relationship))
                  FILTER (WHERE ge.email IS NOT NULL),
                  '[]'::jsonb
                ) AS emails
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.class_id
         LEFT JOIN (
           -- Modern guardian profiles mapped through guardian_students
           SELECT gs.student_id,
                  gp.email,
                  COALESCE(gs.relationship, 'Guardian') AS relationship
           FROM guardian_students gs
           JOIN guardian_profiles gp
             ON gp.guardian_id = gs.guardian_id
            AND gp.organization_id = $2
           WHERE gp.email IS NOT NULL

           UNION ALL

           -- Legacy guardians table fallback
           SELECT g.student_id,
                  g.email,
                  'Guardian' AS relationship
           FROM guardians g
           WHERE g.organization_id = $2
             AND g.email IS NOT NULL
         ) ge ON ge.student_id = s.student_id
         WHERE s.student_id = ANY($1)
           AND s.organization_id = $2
         GROUP BY s.student_id, s.first_name, s.last_name, c.class_name
         ORDER BY s.last_name, s.first_name`,
        [ids, organizationId]
      );

      return res.json({ success: true, students: result.rows });
    } catch (error) {
      console.error('[getGuardianEmails] Error:', error);
      return res.status(500).json({ success: false, message: "Failed to fetch emails." });
    }
  },

  // Email reports to guardians (queued/background processing)
  emailReports: async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { classId, termId, password, emailData } = req.body;

      if (!organizationId || !password || !emailData || !classId || !termId) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
      }

      // Verify password - try user first, then org
      let passwordMatch = false;
      const userId = req.session.userId || (req.session.user && req.session.user.user_id);
      
      if (userId) {
        const userResult = await db.query('SELECT password FROM users WHERE user_id = $1 AND organization_id = $2', [userId, organizationId]);
        if (userResult.rows.length > 0 && userResult.rows[0].password) {
          passwordMatch = await bcrypt.compare(password, userResult.rows[0].password);
        }
      }
      if (!passwordMatch) {
        const orgResult = await db.query('SELECT password FROM organizations WHERE organization_id = $1', [organizationId]);
        if (orgResult.rows.length > 0) {
          passwordMatch = await bcrypt.compare(password, orgResult.rows[0].password);
        }
      }
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: "Incorrect password." });
      }

      // Create batch ID
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Insert all email jobs into database
      for (const item of emailData) {
        const { studentId, emails } = item;
        if (!emails || emails.length === 0) continue;

        // Get student name
        const studentResult = await db.query(
          'SELECT first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2',
          [studentId, organizationId]
        );
        if (!studentResult.rows.length) continue;
        
        const student = studentResult.rows[0];
        const studentName = `${student.first_name} ${student.last_name}`;

        await db.query(
          `INSERT INTO email_history (organization_id, class_id, term_id, user_id, batch_id, student_id, student_name, recipient_emails, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [organizationId, classId, termId, userId, batchId, studentId, studentName, emails]
        );
      }

      // Start background processing (don't await)
      const { processEmailBatch } = require('../utils/emailQueueProcessor');
      setImmediate(() => {
        processEmailBatch(batchId, organizationId, classId, termId, req.protocol, req.get('host'), req.headers.cookie);
      });

      return res.json({ 
        success: true, 
        message: `Email batch queued successfully. Check history for status.`,
        batchId
      });
    } catch (error) {
      console.error('[emailReports] Error:', error);
      return res.status(500).json({ success: false, message: "Failed to queue reports." });
    }
  },

  /**
   * Email history endpoint - returns all email jobs
   */
  getEmailHistory: asyncHandler(async (req, res) => {
    try {
      const organizationId = req.session.organizationId;
      const { class_id, term_id } = req.query;

      if (!organizationId) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
      }
      
      let query = `
        SELECT 
          id, batch_id, student_name, recipient_emails, status, 
          error_message, pdf_generated, sent_at, created_at
        FROM email_history
        WHERE organization_id = $1
      `;
      const params = [organizationId];
      
      if (class_id) {
        params.push(class_id);
        query += ` AND class_id = $${params.length}`;
      }
      
      if (term_id) {
        params.push(term_id);
        query += ` AND term_id = $${params.length}`;
      }
      
      query += ` ORDER BY created_at DESC LIMIT 500`;
      
      const result = await db.query(query, params);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error('[getEmailHistory] Error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch email history' });
    }
  }),

  /**
   * Retry failed email
   */
  retryFailedEmail: asyncHandler(async (req, res) => {
    try {
      const { emailIds } = req.body; // Array of email_history ids to retry
      const sessionOrganizationId = req.session.organizationId;

      if (!sessionOrganizationId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
        return res.status(400).json({ success: false, message: 'No email IDs provided' });
      }

      // Tenant boundary: only consider email_history rows that belong to
      // the caller's organization. This filters out any foreign ids and
      // prevents mutating other tenants' email job state.
      const ownedResult = await db.query(
        `SELECT id, batch_id, organization_id, class_id, term_id
           FROM email_history
          WHERE id = ANY($1) AND organization_id = $2`,
        [emailIds, sessionOrganizationId]
      );

      if (ownedResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Email not found' });
      }

      const ownedIds = ownedResult.rows.map(r => r.id);
      const { batch_id, organization_id, class_id, term_id } = ownedResult.rows[0];

      // Reset status to pending (org-scoped)
      await db.query(
        `UPDATE email_history
            SET status = 'pending', error_message = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ANY($1) AND organization_id = $2`,
        [ownedIds, sessionOrganizationId]
      );

      // Trigger background processing for these specific emails
      const { processEmailBatch } = require('../utils/emailQueueProcessor');
      const protocol = req.protocol;
      const host = req.get('host');
      const cookies = req.headers.cookie;

      setImmediate(() => {
        processEmailBatch(batch_id, organization_id, class_id, term_id, protocol, host, cookies, ownedIds);
      });

      res.json({ success: true, message: `Retrying ${ownedIds.length} email(s)...` });
    } catch (error) {
      console.error('[retryFailedEmail] Error:', error);
      res.status(500).json({ success: false, message: 'Failed to retry emails' });
    }
  }),

});

module.exports = printController;
