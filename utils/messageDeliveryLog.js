// Tracks which guardian contacts have already been messaged for a given
// report send, so the "Edit contacts" drawer can flag "Already sent" and
// avoid double-texting/emailing the same guardian when a report is sent
// again (e.g. after fixing one student's number).
let schemaReady = false;

async function ensureMessageDeliveryLogSchema(dbClient) {
  if (schemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS guardian_message_log (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      context TEXT NOT NULL,
      context_key TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS idx_guardian_message_log_lookup
    ON guardian_message_log (organization_id, context, context_key, channel)
  `);
  schemaReady = true;
}

function normalizeRecipient(value) {
  return String(value || "").trim().toLowerCase();
}

async function recordMessageSent(dbClient, { organizationId, context, contextKey, channel, recipient }) {
  await ensureMessageDeliveryLogSchema(dbClient);
  await dbClient.query(
    `INSERT INTO guardian_message_log (organization_id, context, context_key, channel, recipient) VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, context, String(contextKey || ""), channel, normalizeRecipient(recipient)]
  );
}

// Returns a Set of "contextKey|recipient" strings already sent for this
// organization/context/channel — cheap enough to load in one query and
// check in-memory for a whole batch of students.
async function getSentRecipientSet(dbClient, { organizationId, context, contextKeys, channel }) {
  await ensureMessageDeliveryLogSchema(dbClient);
  const keys = Array.isArray(contextKeys) ? contextKeys.map(String) : [];
  if (!keys.length) return new Set();
  const result = await dbClient.query(
    `SELECT context_key, recipient FROM guardian_message_log
     WHERE organization_id = $1 AND context = $2 AND channel = $3 AND context_key = ANY($4::text[])`,
    [organizationId, context, channel, keys]
  );
  return new Set((result.rows || []).map((r) => `${r.context_key}|${normalizeRecipient(r.recipient)}`));
}

let auditSchemaReady = false;

// Mirrors printController.js's ensureDeliveryAuditTable — same table, so a
// "Send Report" SMS/WhatsApp/email send shows up on the existing Report
// History page (/print/emailHistoryPage) instead of needing a second
// history UI. Idempotent alongside printController's own ensure call.
async function ensureDeliveryAuditTable(dbClient) {
  if (auditSchemaReady) return;
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS delivery_audit_history (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      event_domain VARCHAR(32) NOT NULL,
      event_name VARCHAR(64) NOT NULL,
      class_id INTEGER,
      term_id INTEGER,
      student_id INTEGER,
      student_name VARCHAR(255),
      actor_user_id INTEGER,
      actor_name VARCHAR(255),
      recipient_emails TEXT[],
      status VARCHAR(50),
      batch_id VARCHAR(120),
      pdf_url TEXT,
      notes TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbClient.query(`
    ALTER TABLE delivery_audit_history
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
  auditSchemaReady = true;
}

async function recordDeliveryAuditRow(dbClient, {
  organizationId,
  eventDomain,
  eventName,
  classId,
  termId,
  studentId,
  studentName,
  actorUserId,
  actorName,
  recipient,
  status,
  batchId,
  metadata,
}) {
  await ensureDeliveryAuditTable(dbClient);
  const result = await dbClient.query(
    `INSERT INTO delivery_audit_history (
       organization_id, event_domain, event_name, class_id, term_id, student_id,
       student_name, actor_user_id, actor_name, recipient_emails, status, batch_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      organizationId,
      eventDomain,
      eventName,
      classId || null,
      termId || null,
      studentId || null,
      studentName || null,
      actorUserId || null,
      actorName || null,
      recipient ? [String(recipient)] : [],
      status || "sent",
      batchId || null,
      JSON.stringify(metadata || {}),
    ]
  );
  return { id: result.rows[0]?.id || null };
}

// Flips a row from "pending" to its final "sent"/"failed" state once the
// actual provider send (fired in the background, after the HTTP response
// already went out) resolves — also used by the resend button to retry a
// single failed row in place instead of creating a duplicate history entry.
async function updateDeliveryAuditRowStatus(dbClient, { id, status, metadata }) {
  await ensureDeliveryAuditTable(dbClient);
  await dbClient.query(
    `UPDATE delivery_audit_history
     SET status = $1, metadata = $2::jsonb, updated_at = NOW()
     WHERE id = $3`,
    [status, JSON.stringify(metadata || {}), id]
  );
}

module.exports = {
  ensureMessageDeliveryLogSchema,
  recordMessageSent,
  getSentRecipientSet,
  normalizeRecipient,
  recordDeliveryAuditRow,
  updateDeliveryAuditRowStatus,
};
