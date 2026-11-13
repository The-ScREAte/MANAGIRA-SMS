"use strict";
// Who hears about a school's data migration, and what they're told, at each stage: the school's
// managers (and the school's own account, and whoever asked) by email and in the bell; Managira's
// migration team (MIGRATION_TEAM_EMAIL, else ADMIN_EMAIL, else support@managira.com) by email
// where the stage needs them. Never stops the action it follows: sent in the background.
const { BoundedMap } = require("../boundedMap");

const SCHOOL_LINK = "/common/management?panel=migration&page=%2Fcommon%2Fmigration&label=Data%20migration";
const GUIDE = "/legal/user-documentation/moving-to-managira";
const teamAddress = () => process.env.MIGRATION_TEAM_EMAIL || process.env.ADMIN_EMAIL || "support@managira.com";
const baseUrl = () => String(process.env.NODE_ENV === "production" ? process.env.BASE_URL_PRODUCTION || "https://www.managira.com" : process.env.BASE_URL_LOCAL || "").replace(/\/$/, "");

// "Label: value" lines for the details box, leaving out what wasn't given.
const line = (pairs) => pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`);

// What each stage says. `school` goes to the school's managers, `team` to Managira.
const STAGES = {
  requested: {
    school: (d) => ({ subject: "We've received your data migration request", title: "We've received your request", bell: "Data migration requested",
      paragraphs: [`Thank you. Your request to move ${d.school}'s data to Managira has reached our migration team.`, "We'll be in touch within two business days to plan your move with you. Nothing changes in your account until we open your migration together. Here is what you sent:"],
      details: line([["Current system", d.system], ["When", d.when], ["Students", d.students], ["Staff", d.staff], ["To bring", d.bring], ["Contact", d.contactName && `${d.contactName}, ${d.contactEmail}`], ["Phone", d.phone], ["Notes", d.notes]]),
      link: GUIDE, linkText: "How a move works" }),
    team: (d) => ({ subject: `Data migration request: ${d.school}`, title: "A school asked to move its data in",
      paragraphs: [`${d.school} would like to move to Managira from ${d.system}. Get in touch, then approve the request in the Migration queue to open their migration, or decline it with a note.`],
      details: line([["School", d.school], ["Hub", d.hub], ["Address", d.address], ["School phone", d.schoolPhone], ["School email", d.schoolEmail], ["In Managira now", d.inManagira],
        ["Requested by", d.requestedBy], ["Contact", d.contactName && `${d.contactName}, ${d.contactEmail}`], ["Phone", d.phone], ["Current system", d.system], ["When", d.when],
        ["Students", d.students], ["Staff", d.staff], ["To bring", d.bring], ["Notes", d.notes]]),
      link: "/admin/migrations#requests", linkText: "Open the Migration queue" }),
  },
  withdrawn: {
    team: (d) => ({ subject: `Data migration request withdrawn: ${d.school}`, title: "A school withdrew its request", paragraphs: [`${d.school} withdrew its data migration request.`], link: "/admin/migrations", linkText: "Open the Migration queue" }),
  },
  declined: {
    school: (d) => ({ subject: "About your data migration request", title: "About your data migration request", bell: "Data migration request answered",
      paragraphs: [`Our migration team has looked at your request to move ${d.school}'s data to Managira and can't start it right now.`, d.note ? `Their note: ${d.note}` : "We'll explain why when we're in touch.", "You can send a new request from Management, Data migration, at any time."],
      link: SCHOOL_LINK, linkText: "Open Data migration" }),
  },
  approved: {
    school: (d) => ({ subject: "Your data migration is ready to start", title: "Your data migration is ready to start", bell: "Your data migration is open",
      paragraphs: [`Our migration team has opened ${d.school}'s data migration.`, "Your managers now see a Sandbox button at the top of Managira. The first time you open it, you'll set up an authenticator app on your phone for your school's safety.", "While your migration is open, your live account takes no new data, so nothing is entered twice. Everyone can still sign in and look."],
      link: SCHOOL_LINK, linkText: "Open your data migration" }),
  },
  notes: {
    team: (d) => ({ subject: `Data migration: ${d.school} sent notes`, title: "A school explained columns or roles", paragraphs: [`${d.school} sent notes about what its data holds. Give each a home in the Migration queue.`], link: `/admin/migrations/${d.organizationId}`, linkText: "Open their migration" }),
  },
  answered: {
    school: (d) => ({ subject: "Your data migration questions are answered", title: "Everything you asked about has an answer", bell: "Data migration: questions answered",
      paragraphs: ["Our migration team has answered every column and role you explained.", "Open your data migration and run the import again so the answers fill in, then continue to Review & sign."],
      link: SCHOOL_LINK, linkText: "Open your data migration" }),
  },
  signed: {
    school: (d) => ({ subject: "Your data migration summary is signed", title: "Signed: you can go live", bell: "Data migration signed",
      paragraphs: [`${d.signedBy} signed ${d.school}'s migration summary.`, "Upload your latest exports, then select Go live when you're ready."], link: SCHOOL_LINK, linkText: "Open your data migration" }),
    team: (d) => ({ subject: `Data migration signed: ${d.school}`, title: "A school signed its migration summary", paragraphs: [`${d.school} signed its migration summary (${d.signedBy}) and can go live.`], link: `/admin/migrations/${d.organizationId}`, linkText: "Open their migration" }),
  },
  live: {
    school: (d) => ({ subject: "You're live on Managira", title: "Your data is in Managira", bell: "Data migration: you're live",
      paragraphs: [`${d.school}'s records are now in your live account, and it's open for new work.`, "Next: check a few records you know well, then invite your staff from the Go live step. If anything doesn't look right, tell us within 30 days."],
      details: line([["Students", d.students], ["Parent links", d.guardians], ["Staff accounts", d.staff], ["Final grades", d.courses],
        ["Already in Managira and kept", d.kept ? `${d.kept} records (${d.filled || 0} empty fields filled in, nothing replaced)` : null]]),
      link: SCHOOL_LINK, linkText: "Open your data migration" }),
    team: (d) => ({ subject: `Data migration live: ${d.school}`, title: "A school went live", paragraphs: [`${d.school} went live: ${d.students} students, ${d.staff} staff accounts.`], link: `/admin/migrations/${d.organizationId}`, linkText: "Open their migration" }),
  },
  catch_up: {
    school: (d) => ({ subject: "Your catch-up import is done", title: "Catch-up done", bell: "Data migration: catch-up done",
      paragraphs: [`The latest records from your old system are in ${d.school}'s live account. The catch-up can only be used once.`], link: SCHOOL_LINK, linkText: "Open your data migration" }),
  },
  rolled_back: {
    school: (d) => ({ subject: "Your go-live was rolled back", title: "Your go-live was rolled back", bell: "Data migration: go-live rolled back",
      paragraphs: [`As agreed with you, our migration team rolled back ${d.school}'s go-live: what it loaded was removed, and your migration is open again.`, "Check, sign and go live again when you're ready."], link: SCHOOL_LINK, linkText: "Open your data migration" }),
  },
  closed: {
    school: (d) => ({ subject: "Your data migration is complete", title: "Your data migration is complete", bell: "Data migration complete",
      paragraphs: [`${d.school}'s data migration is complete and the Sandbox button is gone.`, "Your exports are deleted 30 days after you went live, as planned. Your records stay."] }),
  },
  cancelled: {
    school: (d) => ({ subject: "Your data migration was cancelled", title: "Your data migration was cancelled", bell: "Data migration cancelled",
      paragraphs: [`${d.school}'s data migration was cancelled and its files deleted. Your live account takes new data again.`, "If you'd like to try again, send a new request from Management, Data migration."], link: SCHOOL_LINK, linkText: "Open Data migration" }),
  },
};

async function schoolPeople(db, organizationId, extraEmails = []) {
  const { rows } = await db.query(
    `SELECT LOWER(email) AS email, first_name FROM users
      WHERE organization_id = $1 AND account_type::text = 'Manager' AND removed_at IS NULL AND NOT COALESCE(on_hold, FALSE) AND email LIKE '%@%'
     UNION
     SELECT LOWER(email), first_name FROM organizations WHERE organization_id = $1 AND email LIKE '%@%'`,
    [organizationId]
  );
  const out = new Map(rows.map((r) => [r.email, r.first_name || ""]));
  extraEmails.filter((e) => /@/.test(String(e || ""))).forEach((e) => { if (!out.has(String(e).toLowerCase())) out.set(String(e).toLowerCase(), ""); });
  return [...out].map(([email, first]) => ({ email, first }));
}

const sentRecently = new BoundedMap(2000); // org:stage -> time, for stages that could repeat (notes)
// Tells everyone a stage concerns. `data` fills the words; `throttleMinutes` keeps a repeating stage to one email per spell.
function tell(db, organizationId, stage, data = {}, { throttleMinutes = 0, alsoEmail = [] } = {}) {
  const spec = STAGES[stage];
  if (!spec || !organizationId) return;
  const key = `${organizationId}:${stage}`;
  if (throttleMinutes && Date.now() - (sentRecently.get(key) || 0) < throttleMinutes * 60000) return;
  if (throttleMinutes) sentRecently.set(key, Date.now());
  setImmediate(async () => {
    try {
      const { sendEmailInBackground, renderCleanEmail, escapeHtml } = require("../emailHelper");
      const { rows: [org] } = await db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [organizationId]);
      // Plain words for subjects and the bell; the same words escaped once for the email's body
      // (what a school typed, its name or notes, never becomes markup).
      const plain = { school: (org && org.organization_name) || "Your school", organizationId, ...data };
      const safe = Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, typeof v === "string" ? escapeHtml(v) : v]));
      const base = baseUrl();
      const mail = (build, to, first) => {
        const m = build(safe);
        return {
          to,
          subject: build(plain).subject,
          html: renderCleanEmail({
            title: m.title,
            greeting: first ? `Hello ${escapeHtml(first)},` : "Hello,",
            paragraphs: m.paragraphs,
            details: m.details && m.details.length ? m.details.map((line) => ({ label: "", value: line })) : [],
            ...(m.link && base ? { cta: { text: m.linkText || "Open", url: base + m.link } } : {}),
            note: "Questions about your move? Reply to this email or write to support@managira.com.",
          }),
        };
      };
      if (spec.school) {
        for (const person of await schoolPeople(db, organizationId, alsoEmail)) sendEmailInBackground(mail(spec.school, person.email, person.first), `Data migration: ${stage}`);
        const m = spec.school(plain);
        await require("../notificationService").createNotification(db, {
          orgId: organizationId, recipientType: "broadcast", type: "data_migration", title: m.bell || m.title, body: m.paragraphs[0], link: m.link === GUIDE ? GUIDE : SCHOOL_LINK,
        });
      }
      if (spec.team) sendEmailInBackground(mail(spec.team, teamAddress(), ""), `Data migration (team): ${stage}`);
    } catch (error) {
      console.error(`[Migration] telling ${stage}:`, error.message);
    }
  });
}

module.exports = { tell, STAGES, schoolPeople, teamAddress };
