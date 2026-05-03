const SCHEMA_READY = { value: false };

/**
 * Persistent list of email addresses that we should never try to email again.
 * Populated automatically when an SMTP send returns a hard-failure code
 * (550/551/553/5xx user-unknown, EENVELOPE, no-MX, etc.) and also seeded any
 * time we detect an obviously malformed address at validation time.
 *
 * Rows are unique on lower-case email. `reason` is a short label and
 * `last_error` keeps the most recent SMTP message for diagnostics.
 */
async function ensureEmailSuppressionSchema(db) {
  if (SCHEMA_READY.value) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_suppression_list (
      email TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      last_error TEXT,
      failure_count INTEGER NOT NULL DEFAULT 1,
      first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  SCHEMA_READY.value = true;
}

function normalize(email) {
  return String(email || "").trim().toLowerCase();
}

async function isEmailSuppressed(db, email) {
  const addr = normalize(email);
  if (!addr) return false;
  try {
    await ensureEmailSuppressionSchema(db);
    const result = await db.query(
      `SELECT 1 FROM email_suppression_list WHERE email = $1 LIMIT 1`,
      [addr]
    );
    return result.rowCount > 0;
  } catch (_) {
    return false;
  }
}

async function suppressEmail(db, email, reason, lastError) {
  const addr = normalize(email);
  if (!addr) return;
  try {
    await ensureEmailSuppressionSchema(db);
    await db.query(
      `INSERT INTO email_suppression_list (email, reason, last_error, failure_count, last_seen)
       VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (email) DO UPDATE
         SET reason        = EXCLUDED.reason,
             last_error    = EXCLUDED.last_error,
             failure_count = email_suppression_list.failure_count + 1,
             last_seen     = CURRENT_TIMESTAMP`,
      [addr, String(reason || "smtp_failure").slice(0, 64), String(lastError || "").slice(0, 500)]
    );
  } catch (e) {
    // Do not let suppression-list errors break the caller
    console.warn(`[Email][Suppression] Failed to record ${addr}:`, e && e.message);
  }
}

async function unsuppressEmail(db, email) {
  const addr = normalize(email);
  if (!addr) return;
  try {
    await ensureEmailSuppressionSchema(db);
    await db.query(`DELETE FROM email_suppression_list WHERE email = $1`, [addr]);
  } catch (_) { /* ignore */ }
}

/**
 * Heuristic: does this SMTP/Nodemailer error look like a permanent address
 * problem (vs. a transient blip)? We only auto-suppress on hard failures.
 */
function isHardAddressFailure(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const respCode = Number(error.responseCode || 0);
  const msg = String(error.message || error.response || "").toLowerCase();

  if (code === "EENVELOPE") return true;
  if (code === "EMESSAGE") return true;
  // 5xx that indicate the recipient itself is bad / non-existent.
  if (respCode >= 550 && respCode < 560) return true;
  if (/no\s+such\s+user/.test(msg)) return true;
  if (/user\s+unknown/.test(msg)) return true;
  if (/recipient\s+address\s+rejected/.test(msg)) return true;
  if (/address\s+rejected/.test(msg)) return true;
  if (/mailbox\s+(unavailable|not\s+found|does\s+not\s+exist)/.test(msg)) return true;
  if (/invalid\s+recipient/.test(msg)) return true;
  if (/domain\s+not\s+found/.test(msg)) return true;
  if (/unrouteable\s+address/.test(msg)) return true;
  if (/account\s+(disabled|suspended)/.test(msg)) return true;
  return false;
}

module.exports = {
  ensureEmailSuppressionSchema,
  isEmailSuppressed,
  suppressEmail,
  unsuppressEmail,
  isHardAddressFailure,
};
