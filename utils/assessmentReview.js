"use strict";
// "Review tests before students see them": a school setting, off by default. Off: saving a test's
// questions makes it available to students at once. On: a manager or supervisor (not the author)
// approves it first. Stored in tenant_settings.review_tests (database/migrations/2027-01-10_assessment_simplify.sql);
// until that column exists the setting reads as off.
const MISSING = new Set(["42P01", "42703"]);

async function required(db, organizationId) {
  try {
    const { rows } = await db.query("SELECT review_tests FROM tenant_settings WHERE organization_id = $1", [Number(organizationId)]);
    return Boolean(rows[0] && rows[0].review_tests);
  } catch (error) {
    if (MISSING.has(error.code)) return false;
    throw error;
  }
}

async function setRequired(db, organizationId, value, userId = null) {
  try {
    await db.query(
      `INSERT INTO tenant_settings (organization_id, review_tests, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (organization_id) DO UPDATE SET review_tests = EXCLUDED.review_tests, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [Number(organizationId), Boolean(value), userId === null ? null : String(userId)]
    );
  } catch (error) {
    if (MISSING.has(error.code)) {
      const unavailable = new Error("This setting isn't available yet. It turns on after the next update.");
      unavailable.status = 409;
      throw unavailable;
    }
    throw error;
  }
  return Boolean(value);
}

module.exports = { required, setRequired };
