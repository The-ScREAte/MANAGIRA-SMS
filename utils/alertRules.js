"use strict";

// Alerts people set for themselves (feature alert_rules). A parent, student, teacher or driver
// chooses what they're told about and how:
//   - a score below or above a percentage on a posted grade ("needs improvement" / "happy news"),
//   - a child marked absent (parents),
//   - a rider's parent saying they aren't coming today (drivers).
// How: in Managira (the bell), by email, by text message (only where the school has set text
// messages up and the person has a number), or in the weekly briefing (only where it's on).
//
// A person's saved rows are authoritative; someone who never saved has the DEFAULTS below, so
// unticking something really turns it off. Each alert is announced once per person and thing
// (alert_events), so a grade approved twice isn't announced twice. Nothing here ever throws into the
// page that called it: every entry point is for fire-and-forget use.

const features = require("./shards/features");

const CHANNELS = ["bell", "email", "sms", "digest"];

// audience: guardian (a parent), student, teacher (any non-driver member of staff), driver.
const KINDS = {
  score_below: {
    group: "Academics",
    audiences: ["guardian", "student", "teacher"],
    tone: "improve",
    unit: "%",
    min: 1, max: 100, fallback: 50,
    name: { guardian: "Needs improvement", student: "Needs improvement", teacher: "Student needs improvement" },
    hint: {
      guardian: "When a posted score for your child is below this percentage.",
      student: "When a posted score of yours is below this percentage.",
      teacher: "When a posted score for a student in your classes is below this percentage.",
    },
  },
  score_above: {
    group: "Academics",
    audiences: ["guardian", "student", "teacher"],
    tone: "happy",
    unit: "%",
    min: 1, max: 100, fallback: 90,
    name: { guardian: "Happy news", student: "Happy news", teacher: "Student doing well" },
    hint: {
      guardian: "When a posted score for your child is at or above this percentage.",
      student: "When a posted score of yours is at or above this percentage.",
      teacher: "When a posted score for a student in your classes is at or above this percentage.",
    },
  },
  report_card: {
    group: "Academics",
    audiences: ["guardian"],
    channels: ["bell", "email"],
    name: { guardian: "Report card ready" },
    hint: { guardian: "When the school posts your child's report card." },
  },
  absent: {
    group: "Attendance",
    audiences: ["guardian"],
    name: { guardian: "Absent from school" },
    hint: { guardian: "When your child is marked absent." },
  },
  bus_near: {
    group: "Bus",
    needs: "transportation",
    audiences: ["guardian", "student"],
    channels: ["bell", "email", "sms"],
    name: { guardian: "Bus is about to arrive", student: "Bus is about to arrive" },
    hint: { guardian: "When the bus is a few minutes from your child's stop.", student: "When the bus is a few minutes from your stop." },
  },
  bus_arrived: {
    group: "Bus",
    needs: "transportation",
    audiences: ["guardian", "student"],
    channels: ["bell", "email", "sms"],
    name: { guardian: "Bus has arrived", student: "Bus has arrived" },
    hint: { guardian: "When the bus reaches your child's stop.", student: "When the bus reaches your stop." },
  },
  rider_not_coming: {
    group: "Bus",
    needs: "transportation",
    audiences: ["driver"],
    name: { driver: "A rider isn't coming" },
    hint: { driver: "When a parent says a student on your bus isn't riding today." },
  },
};

// What someone who never saved has. Bell and weekly briefing only: nothing is emailed or texted
// until the person asks for it.
const DEFAULTS = {
  guardian: [
    { kind: "score_below", threshold: 50, channels: ["bell", "digest"] },
    { kind: "score_above", threshold: 90, channels: ["digest"] },
    { kind: "absent", channels: ["bell"] },
    // As the school has always done: a report card notice and the bus's arrival emails.
    { kind: "report_card", channels: ["bell", "email"] },
    { kind: "bus_near", channels: ["email"] },
    { kind: "bus_arrived", channels: ["email"] },
  ],
  student: [
    { kind: "score_below", threshold: 50, channels: ["digest"] },
    { kind: "score_above", threshold: 90, channels: ["digest"] },
  ],
  teacher: [],
  driver: [{ kind: "rider_not_coming", channels: ["bell"] }],
};

const featureOn = (organizationId) => features.isOn("alert_rules", { organizationId: Number(organizationId) || null });

function audienceOf(accountType) {
  return String(accountType || "").toLowerCase() === "driver" ? "driver" : "teacher";
}
// The alerts of an audience; with `available`, only those the school has what they need for.
const kindsFor = (audience, available = null) => Object.entries(KINDS)
  .filter(([, def]) => def.audiences.includes(audience) && (!available || !def.needs || available[def.needs]))
  .map(([key]) => key);
// The ways one alert can reach someone (the weekly briefing only suits things that can wait).
const channelsOf = (kind) => KINDS[kind].channels || CHANNELS;
const recipientTypeOf = (audience) => (audience === "guardian" ? "guardian" : audience === "student" ? "student" : "staff");

// ── What the school offers ───────────────────────────────────────

const availabilityCache = new Map();
async function availability(db, organizationId) {
  const cached = availabilityCache.get(organizationId);
  if (cached && Date.now() - cached.at < 60000) return cached.value;
  const value = { bell: true, email: true, sms: false, digest: false, transportation: false };
  try {
    value.transportation = await require("./integrationSwitches").isOn(db, organizationId, "transportation");
  } catch (_) { /* leave off */ }
  try {
    value.digest = features.isOn("weekly_briefing", { organizationId });
  } catch (_) { /* leave off */ }
  try {
    const { getTenantSmsCredentials } = require("./smsIntegration");
    const tenant = await getTenantSmsCredentials(db, organizationId);
    value.sms = Boolean(tenant && tenant.provider);
  } catch (_) { /* no text provider set up */ }
  availabilityCache.set(organizationId, { at: Date.now(), value });
  return value;
}
// A student has no bell (their app is built when they open it), so they choose email or the briefing.
async function availableFor(db, organizationId, audience) {
  const available = { ...(await availability(db, organizationId)) };
  if (audience === "student") available.bell = false;
  if (audience === "driver") { available.digest = false; }
  return available;
}
const forgetAvailability = (organizationId) => availabilityCache.delete(organizationId);

// The alerts this person may be offered, after the school's own choices (Class settings): a class
// that doesn't share something with parents or students takes that alert away, and the bus alerts
// only exist for someone whose child (or who themselves) rides a bus. A parent is offered an alert
// when any of their children (or just this child, on a child's page) allows it.
async function allowedKinds(db, organizationId, { type, id, audience }, studentId = 0) {
  const available = await availableFor(db, organizationId, audience);
  const all = kindsFor(audience, available);
  if (audience !== "guardian" && audience !== "student") return all;
  let ids = [];
  if (audience === "student") ids = [Number(id)];
  else if (Number(studentId) > 0) ids = [Number(studentId)];
  else ids = (await db.query("SELECT gs.student_id FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id AND s.organization_id = $2 WHERE gs.guardian_id = $1", [id, organizationId])).rows.map((r) => Number(r.student_id));
  if (!ids.length) return all.filter((kind) => !KINDS[kind].needs);
  const classSettings = require("./classSettings");
  const [see, rides] = await Promise.all([
    (audience === "guardian" ? classSettings.parentsSeeFor : classSettings.studentsSeeFor)(db, organizationId, ids),
    available.transportation
      ? db.query("SELECT DISTINCT student_id FROM transport_student_assignments WHERE organization_id = $1 AND active = TRUE AND student_id = ANY($2::int[])", [organizationId, ids]).then((r) => new Set(r.rows.map((x) => Number(x.student_id)))).catch(() => new Set())
      : Promise.resolve(new Set()),
  ]);
  const ok = (kind, sid) => {
    const share = see.get(sid) || {};
    if (kind === "report_card") return share.reportCards !== false;
    if (share.alerts === false) return false;
    if (kind === "absent") return share.attendance !== false;
    if (kind === "bus_near" || kind === "bus_arrived") return share.transport !== false && rides.has(sid);
    return true;
  };
  return all.filter((kind) => ids.some((sid) => ok(kind, sid)));
}

// ── A person's rules ─────────────────────────────────────────────

const cleanChannels = (channels, allowed) => CHANNELS.filter((channel) => (channels || []).includes(channel) && allowed[channel]);

function defaultRule(kind, audience) {
  const found = DEFAULTS[audience].find((rule) => rule.kind === kind);
  return {
    kind,
    enabled: Boolean(found),
    threshold: KINDS[kind].unit ? (found && found.threshold) || KINDS[kind].fallback : null,
    channels: found ? found.channels : ["bell"],
    isDefault: true,
  };
}

// The rows of everyone in `people` ([{ type, id, audience }]). Each person has `base` (their
// alerts for all their children, or for themselves) and `byChild` (a parent's own choices for one
// child, which replace `base` for that child). Saved rows, else the defaults.
async function loadRules(db, organizationId, people) {
  const result = new Map();
  if (!people.length) return result;
  const { rows } = await db.query(
    `SELECT recipient_type, recipient_id, kind, student_id, threshold, enabled, channels
       FROM alert_rules
      WHERE organization_id = $1 AND recipient_type = ANY($2::text[]) AND recipient_id = ANY($3::int[])`,
    [organizationId, [...new Set(people.map((p) => p.type))], [...new Set(people.map((p) => p.id))]]
  );
  const saved = new Map();
  for (const row of rows) {
    const key = `${row.recipient_type}:${row.recipient_id}`;
    if (!saved.has(key)) saved.set(key, { base: new Map(), byChild: new Map() });
    const entry = saved.get(key);
    const rule = {
      kind: row.kind, enabled: row.enabled, threshold: row.threshold === null ? null : Number(row.threshold),
      channels: row.channels || [], isDefault: false,
    };
    if (Number(row.student_id) > 0) {
      if (!entry.byChild.has(Number(row.student_id))) entry.byChild.set(Number(row.student_id), new Map());
      entry.byChild.get(Number(row.student_id)).set(row.kind, rule);
    } else entry.base.set(row.kind, rule);
  }
  for (const person of people) {
    const key = `${person.type}:${person.id}`;
    const entry = saved.get(key) || { base: new Map(), byChild: new Map() };
    entry.audience = person.audience;
    if (!entry.base.size) for (const kind of kindsFor(person.audience)) entry.base.set(kind, defaultRule(kind, person.audience));
    result.set(key, entry);
  }
  return result;
}

// The rule that applies to `kind` for one child (their own choices, else the person's).
const ruleFor = (entry, kind, studentId) => {
  const own = entry && entry.byChild.get(Number(studentId));
  // A kind that was added after the person last saved has its default.
  return (own && own.get(kind)) || (entry && entry.base.get(kind)) || (entry && entry.audience ? defaultRule(kind, entry.audience) : undefined);
};

// What a person's settings page shows: every alert of their kind, with their choices. For a
// parent's child page pass `studentId`: `custom` says whether that child has choices of their own.
async function settingsFor(db, organizationId, { type, id, audience }, studentId = 0) {
  const available = await availableFor(db, organizationId, audience);
  const entry = (await loadRules(db, organizationId, [{ type, id, audience }])).get(`${type}:${id}`);
  const allowed = await allowedKinds(db, organizationId, { type, id, audience }, studentId);
  const custom = studentId > 0 && entry.byChild.has(Number(studentId));
  const rules = custom ? entry.byChild.get(Number(studentId)) : entry.base;
  return {
    available, studentId: studentId || 0, custom,
    alerts: allowed.map((kind) => {
      const def = KINDS[kind];
      const rule = rules.get(kind) || defaultRule(kind, audience);
      const offered = channelsOf(kind).filter((channel) => available[channel] && !(channel === "bell" && audience === "student"));
      return {
        kind, group: def.group || "Alerts", tone: def.tone || "info", name: def.name[audience], hint: def.hint[audience], unit: def.unit || null,
        min: def.min || null, max: def.max || null,
        enabled: rule.enabled, threshold: rule.threshold,
        offered, channels: rule.channels.filter((channel) => offered.includes(channel)),
      };
    }),
  };
}

// Save everything on the page at once (so what isn't ticked is off, authoritatively). With
// `studentId` the choices are for that child alone; `body.same` puts the child back on the
// parent's own settings.
async function saveRules(db, organizationId, { type, id, audience }, body, studentId = 0) {
  const scope = Number(studentId) > 0 ? Number(studentId) : 0;
  if (scope && body && (body.same === true || body.same === "true" || body.same === "on")) {
    await db.query("DELETE FROM alert_rules WHERE organization_id = $1 AND recipient_type = $2 AND recipient_id = $3 AND student_id = $4", [organizationId, type, id, scope]);
    return [];
  }
  const available = await availableFor(db, organizationId, audience);
  const input = (body && body.alerts) || {};
  const kinds = await allowedKinds(db, organizationId, { type, id, audience }, scope);
  const rows = kinds.map((kind) => {
    const def = KINDS[kind];
    const mine = input[kind] || {};
    let threshold = null;
    if (def.unit) {
      const n = Number(mine.threshold);
      threshold = Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, Math.round(n * 100) / 100)) : def.fallback;
    }
    const channels = cleanChannels([].concat(mine.channels || []), available).filter((channel) => channelsOf(kind).includes(channel));
    const enabled = mine.enabled === true || mine.enabled === "true" || mine.enabled === "on";
    // An alert switched on with nothing chosen still tells them (in Managira; students by email).
    return { kind, threshold, enabled, channels: channels.length ? channels : [audience === "student" ? "email" : "bell"] };
  });
  await db.query(
    `INSERT INTO alert_rules (organization_id, recipient_type, recipient_id, kind, student_id, threshold, enabled, channels, updated_at)
     SELECT $1, $2, $3, t.kind, $8, t.threshold, t.enabled, string_to_array(t.channels, ','), NOW()
       FROM unnest($4::text[], $5::numeric[], $6::boolean[], $7::text[]) AS t(kind, threshold, enabled, channels)
     ON CONFLICT (organization_id, recipient_type, recipient_id, kind, student_id)
     DO UPDATE SET threshold = EXCLUDED.threshold, enabled = EXCLUDED.enabled, channels = EXCLUDED.channels, updated_at = NOW()`,
    [organizationId, type, id, rows.map((r) => r.kind), rows.map((r) => r.threshold), rows.map((r) => r.enabled), rows.map((r) => r.channels.join(",")), scope]
  );
  return rows;
}

// For the notices the school already sends on its own (report cards posted, the bus arriving):
// what each parent chose, or what the school has always done for someone who never chose.
// `parents` is [{ id (guardian_profiles), studentId }]; the answer is Map("id:studentId" -> rule).
async function choicesFor(db, organizationId, kind, parents) {
  const out = new Map();
  try {
    if (!featureOn(organizationId) || !parents.length) return out;
    const people = [...new Map(parents.map((p) => [`guardian:${p.id}`, { type: "guardian", id: Number(p.id), audience: "guardian" }])).values()];
    const rules = await loadRules(db, organizationId, people);
    for (const p of parents) out.set(`${p.id}:${p.studentId}`, ruleFor(rules.get(`guardian:${p.id}`), kind, p.studentId));
  } catch (error) {
    console.error("[Alerts] choices:", error.message);
  }
  return out;
}

// ── Telling people ───────────────────────────────────────────────

const pct = (n) => `${Math.round(n * 10) / 10}%`.replace(/\.0%$/, "%");

// Deliver one alert to one person, once. `person`: { type, id, audience, email, phone, firstName }.
async function deliver(db, organizationId, person, rule, event, school) {
  const channels = rule.channels || ["bell"];
  const inserted = await db.query(
    `INSERT INTO alert_events (organization_id, recipient_type, recipient_id, recipient_email, kind, ref_key, student_id, title, body, link, digest_pending)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (organization_id, recipient_type, recipient_id, kind, ref_key) DO NOTHING
     RETURNING id`,
    [organizationId, person.type, person.id, (person.email || "").toLowerCase() || null, event.kind, event.refKey, event.studentId || null,
      event.title, event.body || null, event.link || null, channels.includes("digest") && Boolean(person.email)]
  );
  if (!inserted.rows.length) return false;

  if (channels.includes("bell") && person.type !== "student") {
    const { createNotifications } = require("./notificationService");
    await createNotifications(db, [{
      orgId: organizationId, recipientType: person.type, recipientId: person.id, type: "alert",
      title: event.title, body: event.body || null, link: event.link || null, refId: event.studentId || null,
    }]);
  }
  if (channels.includes("email") && person.email) {
    const { sendEmailInBackground, renderCleanEmail, escapeHtml } = require("./emailHelper");
    sendEmailInBackground({
      to: person.email,
      subject: event.title,
      html: renderCleanEmail({
        title: event.title,
        greeting: person.firstName ? `Hi ${escapeHtml(person.firstName)},` : "Hello,",
        paragraphs: [escapeHtml(event.body || event.title)],
        cta: event.link ? { text: "Open Managira", url: `${process.env.BASE_URL || "https://managira.com"}${event.link}` } : null,
        schoolName: school.name, organizationId,
      }),
      category: "alert_rules", sender: "reminders", onBehalfOf: organizationId,
    }, "Alert");
  }
  if (channels.includes("sms") && person.phone) {
    try {
      const { getTenantSmsCredentials, sendSms } = require("./smsIntegration");
      const tenant = await getTenantSmsCredentials(db, organizationId);
      await sendSms(tenant, `${school.name}: ${event.title}${event.body ? ` ${event.body}` : ""}`.slice(0, 300), [person.phone]);
    } catch (error) {
      console.warn("[Alerts] text not sent:", error.message);
    }
  }
  return true;
}

const schoolOf = async (db, organizationId) => {
  const { rows } = await db.query("SELECT COALESCE(NULLIF(nickname_display, ''), organization_name) AS name FROM organizations WHERE organization_id = $1", [organizationId]);
  return { name: (rows[0] && rows[0].name) || "Your school" };
};

// Everyone who hears about a student: their parents, the student, their teachers (and, for the
// bus, their drivers).
async function peopleAround(db, organizationId, studentIds, { classIds = new Map(), subjectIds = new Map(), drivers = false } = {}) {
  const [parents, students] = await Promise.all([
    db.query(
      `SELECT gs.student_id, gp.guardian_id, gp.first_name, gp.email, gp.phone
         FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id AND gp.organization_id = $1
        WHERE gs.student_id = ANY($2::int[])`,
      [organizationId, studentIds]
    ),
    db.query(
      `SELECT sa.student_id, LOWER(TRIM(sa.login_email)) AS email, s.first_name
         FROM student_accounts sa JOIN students s ON s.student_id = sa.student_id AND s.organization_id = $1
        WHERE sa.organization_id = $1 AND sa.student_id = ANY($2::int[])`,
      [organizationId, studentIds]
    ),
  ]);
  const byStudent = new Map(studentIds.map((id) => [id, []]));
  parents.rows.forEach((r) => byStudent.get(Number(r.student_id)).push({
    type: "guardian", audience: "guardian", id: Number(r.guardian_id), email: String(r.email || "").trim(), phone: String(r.phone || "").trim(), firstName: r.first_name,
  }));
  students.rows.forEach((r) => byStudent.get(Number(r.student_id)).push({
    type: "student", audience: "student", id: Number(r.student_id), email: r.email, phone: "", firstName: r.first_name,
  }));
  const staffIds = new Map(); // student -> user ids
  if (classIds.size) {
    const { classStaff } = require("./notificationService");
    for (const [studentId, classId] of classIds) {
      const ids = await classStaff(db, { orgId: organizationId, classId, subjectIds: subjectIds.get(studentId) || null });
      staffIds.set(studentId, ids);
    }
  }
  if (drivers) {
    const { rows } = await db.query(
      `SELECT a.student_id, d.user_id FROM transport_student_assignments a
         JOIN (SELECT bus_id, NULL::int AS route_id, driver_user_id AS user_id FROM transport_buses WHERE organization_id = $1 AND driver_user_id IS NOT NULL
               UNION SELECT assigned_bus_id, assigned_route_id, user_id FROM transport_drivers WHERE organization_id = $1 AND user_id IS NOT NULL) d
           ON (d.bus_id IS NOT NULL AND d.bus_id = a.bus_id) OR (d.route_id IS NOT NULL AND d.route_id = a.route_id)
        WHERE a.organization_id = $1 AND a.active = TRUE AND a.student_id = ANY($2::int[])`,
      [organizationId, studentIds]
    ).catch(() => ({ rows: [] }));
    rows.forEach((r) => staffIds.set(Number(r.student_id), [...new Set([...(staffIds.get(Number(r.student_id)) || []), Number(r.user_id)])]));
  }
  const allStaff = [...new Set([...staffIds.values()].flat())];
  const staff = new Map();
  if (allStaff.length) {
    const { rows } = await db.query(
      `SELECT user_id, first_name, email, phone_number, account_type::text AS role FROM users
        WHERE organization_id = $1 AND user_id = ANY($2::int[]) AND COALESCE(on_hold, FALSE) = FALSE AND removed_at IS NULL`,
      [organizationId, allStaff]
    );
    rows.forEach((r) => staff.set(Number(r.user_id), r));
  }
  for (const [studentId, ids] of staffIds) {
    for (const userId of ids) {
      const u = staff.get(Number(userId));
      if (!u) continue;
      byStudent.get(studentId).push({
        type: "staff", audience: audienceOf(u.role), id: Number(u.user_id), email: String(u.email || "").trim(), phone: String(u.phone_number || "").trim(), firstName: u.first_name,
      });
    }
  }
  return byStudent;
}

// Posted grades → score alerts. Called wherever a grade becomes visible (the approval, `tellFamilies`).
async function onGradesPosted(db, organizationId, approved) {
  try {
    if (!featureOn(organizationId) || !approved || !approved.length) return 0;
    const { rows } = await db.query(
      `SELECT ar.student_id, ar.assessment_id, ar.score, a.max_score, a.title, a.class_id, a.subject_id, sub.subject_name,
              s.first_name AS student_first, s.last_name AS student_last
         FROM unnest($2::int[], $3::int[]) AS p(assessment_id, student_id)
         JOIN assessment_results ar ON ar.assessment_id = p.assessment_id AND ar.student_id = p.student_id
         JOIN assessments a ON a.assessment_id = ar.assessment_id AND a.organization_id = $1
         JOIN students s ON s.student_id = ar.student_id AND s.organization_id = $1
         LEFT JOIN subjects sub ON sub.subject_id = a.subject_id
        WHERE ar.score IS NOT NULL AND a.max_score > 0 AND COALESCE(a.entry_mode, 'score') = 'score'`,
      [organizationId, approved.map((r) => r.assessmentId), approved.map((r) => r.studentId)]
    );
    if (!rows.length) return 0;
    const studentIds = [...new Set(rows.map((r) => Number(r.student_id)))];
    const classIds = new Map(); const subjectIds = new Map();
    rows.forEach((r) => { classIds.set(Number(r.student_id), Number(r.class_id)); subjectIds.set(Number(r.student_id), r.subject_id ? [Number(r.subject_id)] : null); });
    const around = await peopleAround(db, organizationId, studentIds, { classIds, subjectIds });
    const all = [...new Map([...around.values()].flat().map((p) => [`${p.type}:${p.id}`, p])).values()];
    const rules = await loadRules(db, organizationId, all);
    const school = await schoolOf(db, organizationId);
    const classSettings = require("./classSettings");
    const [parentSee, studentSee] = await Promise.all([classSettings.parentsSeeFor(db, organizationId, studentIds), classSettings.studentsSeeFor(db, organizationId, studentIds)]);
    let told = 0;
    for (const row of rows) {
      const percent = (Number(row.score) / Number(row.max_score)) * 100;
      const what = [row.subject_name, row.title].filter(Boolean).join(" · ");
      const studentName = `${row.student_first || ""} ${row.student_last || ""}`.trim() || "Your child";
      for (const person of around.get(Number(row.student_id)) || []) {
        // The school decides whether this class's families and students can have alerts at all.
        if (person.audience === "guardian" && (parentSee.get(Number(row.student_id)) || {}).alerts === false) continue;
        if (person.audience === "student" && (studentSee.get(Number(row.student_id)) || {}).alerts === false) continue;
        const mine = rules.get(`${person.type}:${person.id}`);
        for (const kind of ["score_below", "score_above"]) {
          const rule = ruleFor(mine, kind, row.student_id);
          if (!rule || !rule.enabled || rule.threshold === null) continue;
          const hit = kind === "score_below" ? percent < rule.threshold : percent >= rule.threshold;
          if (!hit) continue;
          const subject = person.audience === "student" ? "You" : person.audience === "guardian" ? (row.student_first || "Your child") : studentName;
          const verb = person.audience === "student" ? "scored" : "scored";
          const title = kind === "score_below"
            ? `Needs improvement: ${subject} ${verb} ${pct(percent)}`
            : `Happy news: ${subject} ${verb} ${pct(percent)}`;
          const link = person.audience === "guardian" ? `/guardian/academic-details?studentId=${row.student_id}`
            : person.audience === "student" ? "/student/dashboard" : `/common/classDashboard/${row.class_id}`;
          if (await deliver(db, organizationId, person, rule, {
            kind, refKey: `a${row.assessment_id}:s${row.student_id}:${Math.round(percent)}`, studentId: Number(row.student_id),
            title, body: `${what}${kind === "score_below" ? ` (below your ${rule.threshold}% alert)` : ` (at or above your ${rule.threshold}% alert)`}`, link,
          }, school)) told += 1;
        }
      }
    }
    return told;
  } catch (error) {
    console.error("[Alerts] grades:", error.message);
    return 0;
  }
}

// Children marked absent on a day → their parents' "absent" alert.
async function onAbsent(db, organizationId, studentIds, date) {
  try {
    if (!featureOn(organizationId) || !studentIds || !studentIds.length) return 0;
    const absent = await db.query(
      `SELECT ar.student_id, s.first_name, s.last_name FROM attendance_records ar JOIN students s ON s.student_id = ar.student_id AND s.organization_id = $1
        WHERE ar.organization_id = $1 AND ar.student_id = ANY($2::int[]) AND ar.date = $3::date AND ar.status::text = 'Absent'`,
      [organizationId, studentIds, date]
    );
    if (!absent.rows.length) return 0;
    const ids = absent.rows.map((r) => Number(r.student_id));
    const around = await peopleAround(db, organizationId, ids);
    const parents = [...new Map([...around.values()].flat().filter((p) => p.audience === "guardian").map((p) => [`${p.type}:${p.id}`, p])).values()];
    const rules = await loadRules(db, organizationId, parents);
    const school = await schoolOf(db, organizationId);
    const parentSee = await require("./classSettings").parentsSeeFor(db, organizationId, ids);
    const day = new Date(`${String(date).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    let told = 0;
    for (const row of absent.rows) {
      for (const person of (around.get(Number(row.student_id)) || []).filter((p) => p.audience === "guardian")) {
        const rule = ruleFor(rules.get(`guardian:${person.id}`), "absent", row.student_id);
        const share = parentSee.get(Number(row.student_id)) || {};
        if (!rule || !rule.enabled || share.alerts === false || share.attendance === false) continue;
        if (await deliver(db, organizationId, person, rule, {
          kind: "absent", refKey: `d${String(date).slice(0, 10)}:s${row.student_id}`, studentId: Number(row.student_id),
          title: `${row.first_name || "Your child"} was marked absent`, body: day, link: `/guardian/academic-details?studentId=${row.student_id}`,
        }, school)) told += 1;
      }
    }
    return told;
  } catch (error) {
    console.error("[Alerts] absent:", error.message);
    return 0;
  }
}

// A parent said a student isn't riding today → the drivers of that student's bus.
async function onRiderNotComing(db, organizationId, studentId, day) {
  try {
    if (!featureOn(organizationId)) return 0;
    const student = await db.query("SELECT first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2", [studentId, organizationId]);
    if (!student.rows[0]) return 0;
    const around = await peopleAround(db, organizationId, [Number(studentId)], { drivers: true });
    const drivers = (around.get(Number(studentId)) || []).filter((p) => p.audience === "driver");
    const rules = await loadRules(db, organizationId, drivers);
    const school = await schoolOf(db, organizationId);
    const name = `${student.rows[0].first_name || ""} ${student.rows[0].last_name || ""}`.trim();
    let told = 0;
    for (const person of drivers) {
      const rule = ruleFor(rules.get(`staff:${person.id}`), "rider_not_coming", studentId);
      if (!rule || !rule.enabled) continue;
      if (await deliver(db, organizationId, person, rule, {
        kind: "rider_not_coming", refKey: `d${String(day).slice(0, 10)}:s${studentId}`, studentId: Number(studentId),
        title: `${name} isn't riding today`, body: "A parent let the school know.", link: "/driver",
      }, school)) told += 1;
    }
    return told;
  } catch (error) {
    console.error("[Alerts] rider:", error.message);
    return 0;
  }
}

// A student's own bus alerts (the parents' notices are sent by the transport notifier itself).
async function onBus(db, organizationId, studentId, kind, title, body) {
  try {
    if (!featureOn(organizationId)) return 0;
    const share = (await require("./classSettings").studentsSeeFor(db, organizationId, [Number(studentId)])).get(Number(studentId)) || {};
    if (share.alerts === false || share.transport === false) return 0;
    const around = await peopleAround(db, organizationId, [Number(studentId)]);
    const students = (around.get(Number(studentId)) || []).filter((p) => p.audience === "student");
    if (!students.length) return 0;
    const rules = await loadRules(db, organizationId, students);
    const school = await schoolOf(db, organizationId);
    let told = 0;
    for (const person of students) {
      const rule = ruleFor(rules.get(`student:${person.id}`), kind, studentId);
      if (!rule || !rule.enabled) continue;
      if (await deliver(db, organizationId, person, rule, { kind, refKey: `t${Date.now() - (Date.now() % 600000)}:s${studentId}`, studentId: Number(studentId), title, body, link: "/student/dashboard" }, school)) told += 1;
    }
    return told;
  } catch (error) {
    console.error("[Alerts] bus:", error.message);
    return 0;
  }
}

// ── The weekly briefing ──────────────────────────────────────────

// Alerts waiting for the weekly briefing, by the address they go to.
async function digestFor(db, organizationId) {
  const out = new Map();
  try {
    const { rows } = await db.query(
      `SELECT id, recipient_email, title, body, created_at FROM alert_events
        WHERE organization_id = $1 AND digest_pending AND recipient_email IS NOT NULL ORDER BY created_at LIMIT 20000`,
      [organizationId]
    );
    rows.forEach((r) => {
      if (!out.has(r.recipient_email)) out.set(r.recipient_email, []);
      out.get(r.recipient_email).push({ id: Number(r.id), title: r.title, body: r.body, at: r.created_at });
    });
  } catch (error) {
    if (error.code !== "42P01") console.warn("[Alerts] digest:", error.message);
  }
  return out;
}

// Rows for the briefing email: what the person asked to be told, in their own words.
function digestRows(events) {
  const { escapeHtml } = require("./emailLayout");
  if (!events || !events.length) return null;
  const shown = events.slice(0, 8).map((e) => escapeHtml(e.body ? `${e.title} — ${e.body}` : e.title));
  const more = events.length - 8;
  return { label: "Alerts you asked for", value: shown.join("<br>") + (more > 0 ? `<br><span style="color:#64748b;">and ${more} more in Managira</span>` : "") };
}

async function markDigested(db, ids) {
  if (!ids || !ids.length) return;
  await db.query("UPDATE alert_events SET digest_pending = FALSE, digested_at = NOW() WHERE id = ANY($1::bigint[])", [ids]).catch((e) => console.warn("[Alerts] mark digested:", e.message));
}

module.exports = {
  KINDS, DEFAULTS, CHANNELS, featureOn, audienceOf, recipientTypeOf, kindsFor, availability, forgetAvailability,
  allowedKinds, loadRules, settingsFor, saveRules, choicesFor, ruleFor, onGradesPosted, onAbsent, onRiderNotComing, onBus, digestFor, digestRows, markDigested,
};
