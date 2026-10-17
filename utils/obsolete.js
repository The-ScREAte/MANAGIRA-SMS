"use strict";

// Obsolete: retire something without losing what already uses it.
//
// Remarks, remark types, signatures, classes, subjects, assessments and
// graduation groups are shared: one remark is on many report cards, one class
// holds years of scores. Deleting one would take it away from every record that
// uses it. Once anything uses it, it can't be deleted; it can be made obsolete
// instead:
//   - it stays on every record that already uses it (report cards, transcripts,
//     scores, history) exactly as before;
//   - it is no longer offered for new work (pickers, new terms, new remarks);
//   - it can be restored at any time.
// Something nothing uses yet can still be deleted.

const { savedRecords, savedRecordsMessage } = require("./recordGuards");

const OBSOLETE_TABLES = [
  "classes",
  "subjects",
  "assessments",
  "remarks",
  "organization_custom_remark_types",
  "graduation_year_groups",
];

let ready = null;
function ensureObsoleteSchema(db) {
  if (!ready) {
    ready = (async () => {
      for (const table of OBSOLETE_TABLES) {
        const exists = (await db.query("SELECT to_regclass($1) AS t", [`public.${table}`])).rows[0].t;
        if (!exists) continue;
        await db.query(`
          ALTER TABLE ${table}
            ADD COLUMN IF NOT EXISTS obsolete_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS obsolete_by INTEGER
        `);
      }
      // Signatures are image paths shared by classes, kept per school.
      await db.query(`
        CREATE TABLE IF NOT EXISTS obsolete_signatures (
          organization_id INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'report',
          signature_path TEXT NOT NULL,
          obsolete_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          obsolete_by INTEGER,
          PRIMARY KEY (organization_id, kind, signature_path)
        )
      `);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;
const joinList = (parts) =>
  parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const BUILTIN_REMARK_COLUMNS = {
  teacher: "teacher_remarks",
  conduct: "conduct_remarks",
  attitude: "attitude_remarks",
  interest: "interest_remarks",
};

// Student report cards that carry this remark text.
async function remarkUseCount(db, organizationId, remarkType, remarkText) {
  const text = String(remarkText || "").trim();
  if (!text) return 0;
  const column = BUILTIN_REMARK_COLUMNS[remarkType];
  const { rows } = column
    ? await db.query(
        `SELECT COUNT(*)::int AS n FROM student_reports WHERE organization_id = $1 AND TRIM(${column}) = $2`,
        [organizationId, text]
      )
    : await db.query(
        `SELECT COUNT(*)::int AS n FROM student_reports
          WHERE organization_id = $1 AND TRIM(custom_remarks_json ->> $2) = $3`,
        [organizationId, String(remarkType || ""), text]
      );
  return Number(rows[0] && rows[0].n) || 0;
}

/**
 * Each kind: how to find its rows, what "in use" means, and what may block
 * making it obsolete. ids are the rows the action applies to.
 */
const KINDS = {
  class: {
    table: "classes",
    idColumn: "class_id",
    nameColumn: "class_name",
    noun: "class",
    async uses(db, organizationId, ids) {
      const subjectIds = (await db.query(
        "SELECT subject_id FROM subjects WHERE organization_id = $1 AND class_id = ANY($2::int[])",
        [organizationId, ids]
      )).rows.map((r) => Number(r.subject_id));
      const records = [
        ...(await savedRecords(db, "class", ids, organizationId)),
        ...(await savedRecords(db, "subject", subjectIds, organizationId)),
      ];
      // The same kind of record can be counted for the class and its subjects.
      const byLabel = new Map();
      records.forEach((r) => {
        const label = r.text.replace(/^[\d,]+ /, "");
        if (!byLabel.has(label) || byLabel.get(label).count < r.count) byLabel.set(label, r);
      });
      return Array.from(byLabel.values());
    },
    // A class that still has students would take them out of the register.
    async blocksObsolete(db, organizationId, ids) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM students
          WHERE organization_id = $1 AND class_id = ANY($2::int[]) AND NOT COALESCE(graduated, FALSE)`,
        [organizationId, ids]
      );
      const n = Number(rows[0].n) || 0;
      return n
        ? `It still has ${plural(n, "student", "students")}. Move them to another class first, then make it obsolete.`
        : null;
    },
    // Not part of the current term's class list any more (only empty entries;
    // a term that has students in the class keeps it).
    async afterObsolete(client, organizationId, ids) {
      await client.query("SAVEPOINT obsolete_class_lists");
      try {
        await client.query(
          `DELETE FROM enrolled_classes ec USING enrollments e
            WHERE ec.enrollment_id = e.enrollment_id AND e.organization_id = $1 AND ec.class_id = ANY($2::int[])
              AND NOT EXISTS (SELECT 1 FROM enrolled_students es
                               WHERE es.enrollment_id = ec.enrollment_id AND es.class_id = ec.class_id)
              AND e.term_id IN (SELECT term_id FROM terms WHERE organization_id = $1 AND current = TRUE)`,
          [organizationId, ids]
        );
        await client.query("RELEASE SAVEPOINT obsolete_class_lists");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT obsolete_class_lists");
      }
    },
  },
  subject: {
    table: "subjects",
    idColumn: "subject_id",
    nameColumn: "subject_name",
    noun: "subject",
    async uses(db, organizationId, ids) {
      return savedRecords(db, "subject", ids, organizationId);
    },
  },
  gradGroup: {
    table: "graduation_year_groups",
    idColumn: "id",
    nameColumn: "name",
    noun: "graduation year group",
    async uses(db, organizationId, ids) {
      const { rows } = await db.query(
        "SELECT COUNT(*)::int AS n FROM classes WHERE organization_id = $1 AND graduation_year_group_id = ANY($2::int[])",
        [organizationId, ids]
      );
      const n = Number(rows[0].n) || 0;
      return n ? [{ count: n, text: plural(n, "class", "classes") }] : [];
    },
  },
  assessment: {
    table: "assessments",
    idColumn: "assessment_id",
    nameColumn: "title",
    noun: "assessment",
    async uses(db, organizationId, ids) {
      const { rows } = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM assessment_results WHERE assessment_id = ANY($2::int[]) AND organization_id = $1) AS scores,
           (SELECT COUNT(*)::int FROM student_assessment_attempts WHERE assessment_id = ANY($2::int[])) AS attempts`,
        [organizationId, ids]
      ).catch(() => ({ rows: [{ scores: 0, attempts: 0 }] }));
      const found = [];
      if (rows[0].scores) found.push({ count: rows[0].scores, text: plural(rows[0].scores, "score", "scores") });
      if (rows[0].attempts) found.push({ count: rows[0].attempts, text: plural(rows[0].attempts, "online test attempt", "online test attempts") });
      return found;
    },
  },
  remark: {
    table: "remarks",
    idColumn: "id",
    nameColumn: "remark",
    noun: "remark",
    async uses(db, organizationId, ids) {
      const { rows } = await db.query(
        "SELECT remark, remark_type FROM remarks WHERE organization_id = $1 AND id = ANY($2::int[])",
        [organizationId, ids]
      );
      let n = 0;
      for (const row of rows) n += await remarkUseCount(db, organizationId, row.remark_type, row.remark);
      return n ? [{ count: n, text: plural(n, "student report card", "student report cards") }] : [];
    },
  },
  remarkType: {
    table: "organization_custom_remark_types",
    idColumn: "type_key",
    idType: "text",
    nameColumn: "label",
    noun: "remark type",
    async uses(db, organizationId, keys) {
      const { rows } = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM remarks WHERE organization_id = $1 AND remark_type = ANY($2::text[])) AS remarks,
           (SELECT COUNT(*)::int FROM student_reports sr, unnest($2::text[]) k
             WHERE sr.organization_id = $1 AND NULLIF(TRIM(sr.custom_remarks_json ->> k), '') IS NOT NULL) AS reports`,
        [organizationId, keys]
      );
      const found = [];
      if (rows[0].reports) found.push({ count: rows[0].reports, text: plural(rows[0].reports, "student report card", "student report cards") });
      if (rows[0].remarks) found.push({ count: rows[0].remarks, text: plural(rows[0].remarks, "saved remark", "saved remarks") });
      return found;
    },
  },
};

// "“Grade 3” can't be deleted because it's already used by 72 scores and ..."
function inUseMessage(what, records) {
  return savedRecordsMessage(what, records) + " You can make it obsolete instead: it stays on those records and is no longer offered for new work.";
}

/**
 * Resolves the rows an action applies to, scoped to the school.
 * target: { id } or, for subjects, { subjectKey } (every class), for
 * assessments, { groupId } (the whole test).
 */
async function resolveRows(db, kind, organizationId, target) {
  const def = KINDS[kind];
  if (!def) return [];
  if (kind === "subject" && target.subjectKey) {
    return (await db.query(
      `SELECT subject_id AS id, subject_name AS name, obsolete_at FROM subjects
        WHERE organization_id = $1 AND LOWER(TRIM(subject_name)) = $2`,
      [organizationId, String(target.subjectKey).trim().toLowerCase()]
    )).rows;
  }
  if (kind === "assessment" && target.groupId) {
    return (await db.query(
      `SELECT assessment_id AS id, title AS name, obsolete_at FROM assessments
        WHERE organization_id = $1 AND group_id = $2`,
      [organizationId, String(target.groupId)]
    )).rows;
  }
  const rawId = String(target.id == null ? "" : target.id).trim();
  if (!rawId) return [];
  if (def.idType !== "text" && !/^\d+$/.test(rawId)) return [];
  return (await db.query(
    `SELECT ${def.idColumn} AS id, ${def.nameColumn} AS name, obsolete_at FROM ${def.table}
      WHERE organization_id = $1 AND ${def.idColumn} = $2`,
    [organizationId, def.idType === "text" ? rawId.toLowerCase() : Number(rawId)]
  )).rows;
}

function describe(kind, rows) {
  const def = KINDS[kind];
  const name = String((rows[0] && rows[0].name) || "").trim();
  const short = name.length > 60 ? `${name.slice(0, 57)}…` : name;
  return short ? `The ${def.noun} “${short}”` : `This ${def.noun}`;
}

/**
 * Makes rows obsolete (obsolete = true) or restores them (false).
 * Returns { ok, status, message }.
 */
async function setObsolete(db, kind, organizationId, target, obsolete, userId) {
  await ensureObsoleteSchema(db);
  const def = KINDS[kind];
  if (!def) return { ok: false, status: 400, message: "Unknown item." };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const rows = await resolveRows(client, kind, organizationId, target);
    if (!rows.length) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: `That ${def.noun} wasn't found.` };
    }
    const ids = rows.map((r) => (def.idType === "text" ? String(r.id) : Number(r.id)));
    const what = describe(kind, rows);
    if (obsolete && def.blocksObsolete) {
      const reason = await def.blocksObsolete(client, organizationId, ids);
      if (reason) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, message: `${what} can't be made obsolete yet. ${reason}` };
      }
    }
    const by = Number.isInteger(Number(userId)) ? Number(userId) : null;
    await client.query(
      `UPDATE ${def.table}
          SET obsolete_at = ${obsolete ? "COALESCE(obsolete_at, NOW())" : "NULL"},
              obsolete_by = ${obsolete ? "$3" : "NULL"}
        WHERE organization_id = $1 AND ${def.idColumn} = ANY($2::${def.idType === "text" ? "text" : "int"}[])`,
      obsolete ? [organizationId, ids, by] : [organizationId, ids]
    );
    if (obsolete && def.afterObsolete) await def.afterObsolete(client, organizationId, ids);
    await client.query("COMMIT");
    return {
      ok: true,
      status: 200,
      message: obsolete
        ? `${what} is now obsolete. It stays on every record that already uses it and is no longer offered for new work.`
        : `${what} is active again.`,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * What already uses these rows, e.g. [{ count: 72, text: "72 scores" }].
 * Empty means nothing uses them and they can be deleted.
 */
async function usesOf(db, kind, organizationId, ids) {
  const def = KINDS[kind];
  if (!def || !ids.length) return [];
  return def.uses(db, organizationId, ids);
}

// --- Signatures (report card and transcript) --------------------------------

async function obsoleteSignaturePaths(db, organizationId, kind = "report") {
  await ensureObsoleteSchema(db);
  const { rows } = await db.query(
    "SELECT signature_path FROM obsolete_signatures WHERE organization_id = $1 AND kind = $2",
    [organizationId, kind]
  );
  return new Set(rows.map((r) => r.signature_path));
}

async function setSignatureObsolete(db, organizationId, kind, signaturePath, obsolete, userId) {
  await ensureObsoleteSchema(db);
  const path = String(signaturePath || "").trim();
  if (!path) return { ok: false, status: 400, message: "Signature not found." };
  if (obsolete) {
    await db.query(
      `INSERT INTO obsolete_signatures (organization_id, kind, signature_path, obsolete_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, kind, signature_path) DO NOTHING`,
      [organizationId, kind, path, Number.isInteger(Number(userId)) ? Number(userId) : null]
    );
    return {
      ok: true,
      status: 200,
      message: `The signature is now obsolete. It stays on the ${kind === "transcript" ? "transcripts" : "report cards"} that already use it and can't be added to more classes.`,
    };
  }
  await db.query(
    "DELETE FROM obsolete_signatures WHERE organization_id = $1 AND kind = $2 AND signature_path = $3",
    [organizationId, kind, path]
  );
  return { ok: true, status: 200, message: "The signature is active again." };
}

// True while any term's report settings still point at this signature image,
// so the image file must stay (past report cards print it).
async function signatureStillUsed(db, organizationId, signaturePath) {
  const { rows } = await db.query(
    "SELECT 1 FROM report_settings WHERE organization_id = $1 AND signature_image_path = $2 LIMIT 1",
    [organizationId, signaturePath]
  );
  return rows.length > 0;
}

// --- Request handling -------------------------------------------------------

function wantsJson(req) {
  const accept = String((req.headers && req.headers.accept) || "").toLowerCase();
  const type = String((req.headers && req.headers["content-type"]) || "").toLowerCase();
  return Boolean(req.xhr) || accept.includes("application/json") || type.includes("application/json");
}

// Only a path on this site (never another host).
function safeReturnTo(value, fallback) {
  const v = String(value || "");
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : fallback;
}

/**
 * Express handler factory: POST { kind, id | subjectKey | groupId, action }
 * where action is "obsolete" or "restore". kinds limits what this route may
 * change (routes check the matching permission).
 */
function obsoleteHandler(db, { kinds, fallbackRedirect }) {
  return async (req, res) => {
    const body = req.body || {};
    const kind = String(body.kind || "");
    const action = String(body.action || "obsolete");
    const organizationId = req.session && req.session.organizationId;
    const reply = (status, message) => {
      if (wantsJson(req)) return res.status(status).json({ success: status < 400, message });
      if (typeof req.flash === "function") req.flash(status < 400 ? "success" : "error", message);
      return res.redirect(safeReturnTo(body.returnTo, fallbackRedirect));
    };
    if (!organizationId) return reply(401, "Please sign in again.");
    if (!kinds.includes(kind) || !["obsolete", "restore"].includes(action)) return reply(400, "That action isn't available.");
    try {
      const userId = req.session.userId || (req.session.user && req.session.user.user_id) || null;
      const result = await setObsolete(db, kind, organizationId, {
        id: body.id,
        subjectKey: body.subjectKey,
        groupId: body.groupId,
      }, action === "obsolete", userId);
      return reply(result.status, result.message);
    } catch (error) {
      console.error("[obsolete]", kind, action, error.message);
      return reply(500, "That couldn't be saved. Please try again.");
    }
  };
}

module.exports = {
  ensureObsoleteSchema,
  KINDS,
  setObsolete,
  usesOf,
  inUseMessage,
  resolveRows,
  describe,
  remarkUseCount,
  obsoleteSignaturePaths,
  setSignatureObsolete,
  signatureStillUsed,
  obsoleteHandler,
  wantsJson,
  safeReturnTo,
};
