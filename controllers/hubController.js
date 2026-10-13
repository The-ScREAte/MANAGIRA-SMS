const { activeStudentSql } = require("../utils/activeStudents");
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { uploadToS3, deleteFromS3 } = require("../config/s3");
const { sendEmailSafely, sendEmailInBackground, renderCleanEmail } = require("../utils/emailHelper");
const {
  getHubPreferenceMap,
  setHubPreferences,
} = require("../utils/emailPreferences");
const {
  HUB_ROLES,
  HUB_PERMISSION_GROUPS,
  ALL_HUB_PERMISSIONS,
  ensureHubAccessSchema,
  actorCan,
  notificationsFor,
  getContacts,
  notifyHub,
} = require("../utils/hubAccess");
const { buildOrganizationStats, loadTermsWithData, PASS_MARK, LOW_ATTENDANCE_RATE } = require("./statsController");

// Staff = everyone on the school's team except Managira's own accounts.
const STAFF_FILTER_SQL = (alias = "u") =>
  `LOWER(COALESCE(${alias}.account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')`;
// Subjects are stored once per class; a school's subjects are the distinct names.
const DISTINCT_SUBJECTS_SQL = (orgExpr) =>
  `(SELECT COUNT(DISTINCT LOWER(TRIM(sub.subject_name)))::int FROM subjects sub WHERE sub.organization_id = ${orgExpr} AND TRIM(COALESCE(sub.subject_name, '')) <> '')`;

// Who did it, for the activity log and emails.
const hubActorLabel = (req) => {
  const a = req.hubActor;
  if (a && a.user) return `${a.user.first_name || ''} ${a.user.last_name || ''}`.trim() || a.user.email;
  return [req.session.firstName, req.session.lastName].filter(Boolean).join(' ') || (req.hubInfo && req.hubInfo.hub_name) || 'Hub';
};
const hubActorEmail = (req) => (req.hubActor && req.hubActor.user ? req.hubActor.user.email : (req.hubInfo && req.hubInfo.hub_email)) || '';

// Tell the rest of the hub (not the person who did it) about a school change.
function notifySchoolStatus(req, schoolName, what) {
  const hubName = (req.hubInfo && req.hubInfo.hub_name) || 'your hub';
  const who = hubActorLabel(req);
  notifyHub(db, req.session.hubId, 'hub_school_status', (r) => ({
    subject: `${schoolName} ${what}`,
    html: renderCleanEmail({
      title: `${schoolName} ${what}`,
      greeting: `Hello ${r.firstName || ''}`.trim() + ',',
      paragraphs: [`${schoolName} ${what} (${hubName}).`, `Done by ${who}.`],
      cta: { text: 'Open your hub', url: `${process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || 'https://managira.com'}/hub/dashboard#schools` },
    }),
  }), { excludeEmail: hubActorEmail(req) });
}

// Helper function to send emails (fire-and-forget). Returns true once the
// email is queued, so callers that check the result don't report a failure.
function sendEmail({ to, subject, html }) {
  if (!to) return false;
  sendEmailInBackground({
    to,
    subject,
    html,
  }, "Hub email");
  return true;
}

// Log hub activity
async function logHubActivity(hubId, actionType, description, targetOrgId = null, performedBy = '', ipAddress = null) {
  try {
    await db.query(
      `INSERT INTO hub_activity_logs (hub_id, action_type, target_organization_id, description, performed_by, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [hubId, actionType, targetOrgId, description, performedBy, ipAddress]
    );
  } catch (error) {
      }
}

// The hub contact picked for a school, if it really belongs to this hub.
async function hubContactIdFrom(hubId, value) {
  const id = parseInt(value, 10);
  if (!Number.isInteger(id)) return null;
  const r = await db.query('SELECT contact_id FROM hub_contacts WHERE contact_id = $1 AND hub_id = $2', [id, hubId]);
  return r.rows.length ? id : null;
}

// Tell the rest of the hub that someone invited a school.
function notifyInvitationSent(req, schoolName) {
  const hubName = (req.hubInfo && req.hubInfo.hub_name) || 'your hub';
  const who = hubActorLabel(req);
  notifyHub(db, req.session.hubId, 'hub_invitation_sent', (r) => ({
    subject: `${schoolName} was invited to ${hubName}`,
    html: renderCleanEmail({
      title: 'School invited',
      greeting: `Hello ${r.firstName || ''}`.trim() + ',',
      paragraphs: [`${who} invited ${schoolName} to join ${hubName}.`, 'You will hear from us again when they accept.'],
      cta: { text: 'See invitations', url: `${process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || 'https://managira.com'}/hub/dashboard#invitations` },
    }),
  }), { excludeEmail: hubActorEmail(req) });
}

const hubController = {
  getHubOrganization: async (hubId, organizationId) => {
    const orgResult = await db.query(
      `SELECT o.organization_id, o.organization_name, o.email, o.nickname, o.first_name, o.last_name,
              o.organization_phone, o.organization_address, o.joined_hub_at, o.on_hold,
              (SELECT COUNT(*) FROM students s WHERE s.organization_id = o.organization_id AND ${activeStudentSql("s")}) AS student_count,
              (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.organization_id AND ${STAFF_FILTER_SQL("u")}) AS staff_count,
              (SELECT COUNT(*) FROM classes c WHERE c.organization_id = o.organization_id) AS class_count,
              ${DISTINCT_SUBJECTS_SQL("o.organization_id")} AS subject_count,
              (SELECT hc.full_name FROM hub_contacts hc WHERE hc.contact_id = o.hub_contact_id AND hc.hub_id = o.hub_id) AS hub_contact_name,
              (SELECT p.plan_name FROM plans p WHERE p.id = COALESCE(o.hub_assigned_plan_id, (SELECT mh.plan_id FROM managira_hubs mh WHERE mh.hub_id = o.hub_id), o.plan_id)) AS plan_name,
              (o.hub_assigned_plan_id IS NULL) AS plan_is_default
       FROM organizations o
       WHERE o.organization_id = $1
         AND o.hub_id = $2
         AND o.deleted = false
         AND o.is_hub_member = true`,
      [organizationId, hubId]
    );

    return orgResult.rows[0] || null;
  },

  // Hub Login Page
  hubLoginGet: (req, res) => {
    if (req.session.hubId) {
      return res.redirect('/hub/dashboard');
    }
    res.render('hub/login', {
      title: 'Hub Login - Managira',
      messages: req.flash(),
      showFooterTopSection: true
    });
  },

  // Hub Login Authentication
  hubLoginPost: async (req, res) => {
    const { email, password } = req.body;

    try {
      const result = await db.query(
        'SELECT * FROM managira_hubs WHERE LOWER(hub_email) = LOWER($1) ORDER BY deleted ASC LIMIT 1',
        [String(email || '').trim()]
      );

      const hub = result.rows[0];

      // Not the owner? Try the hub's users.
      if (!hub) {
        await ensureHubAccessSchema(db);
        const userResult = await db.query(
          `SELECT u.*, h.hub_name, h.deleted AS hub_deleted, h.on_hold AS hub_on_hold
             FROM hub_users u JOIN managira_hubs h ON h.hub_id = u.hub_id
            WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
          [String(email || '').trim()]
        );
        const user = userResult.rows[0];
        if (user) {
          if (user.hub_deleted || user.hub_on_hold) {
            req.flash('error', 'This hub is on hold. Please contact support.');
            return res.redirect('/hub/login');
          }
          if (user.on_hold) {
            req.flash('error', 'Your hub account is on hold. Ask your hub admin for help.');
            return res.redirect('/hub/login');
          }
          if (!user.password) {
            req.flash('error', 'Please set your password first. Check your email for the invitation link.');
            return res.redirect('/hub/login');
          }
          if (!(await bcrypt.compare(String(password || ''), user.password))) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/hub/login');
          }
          req.session.hubId = user.hub_id;
          req.session.hubUserId = user.hub_user_id;
          req.session.accountType = 'Hub';
          req.session.hubName = user.hub_name;
          req.session.hubEmail = user.email;
          req.session.firstName = user.first_name;
          req.session.lastName = user.last_name;
          await db.query('UPDATE hub_users SET last_login_at = NOW() WHERE hub_user_id = $1', [user.hub_user_id]).catch(() => {});
          await logHubActivity(user.hub_id, 'LOGIN', `${user.first_name} ${user.last_name} signed in`, null, user.email, req.ip);
          return res.redirect('/hub/dashboard');
        }
      }

      if (!hub) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/hub/login');
      }

      if (hub.deleted) {
        req.flash('error', 'This account is temporarily deleted. Contact your hub for help.');
        return res.redirect('/hub/login');
      }

      if (hub.on_hold) {
        req.flash('error', 'Your hub account is currently on hold. Please contact support.');
        return res.redirect('/hub/login');
      }

      if (!hub.hub_password) {
        req.flash('error', 'Please complete your password setup first. Check your email for the setup link.');
        return res.redirect('/hub/login');
      }

      const isMatch = await bcrypt.compare(password, hub.hub_password);

      if (!isMatch) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/hub/login');
      }

      // Set hub session
      delete req.session.hubUserId;
      req.session.hubId = hub.hub_id;
      req.session.accountType = 'Hub';
      req.session.hubName = hub.hub_name;
      req.session.hubEmail = hub.hub_email;
      req.session.firstName = hub.first_name;
      req.session.lastName = hub.last_name;

      await logHubActivity(hub.hub_id, 'LOGIN', `Hub ${hub.hub_name} logged in`, null, hub.hub_email, req.ip);

      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'An error occurred during login.');
      res.redirect('/hub/login');
    }
  },

  // Hub Logout
  hubLogoutGet: async (req, res) => {
    // An admin viewing the hub goes back to admin instead of being signed out.
    if (req.session && req.session.adminHubView) return res.redirect('/admin/exit-hub');

    const sessionId = req.sessionID || null;
    const hubId = req.session.hubId;
    const hubName = req.session.hubName;
    
    if (hubId) {
      await logHubActivity(hubId, 'LOGOUT', `Hub ${hubName} logged out`);
    }

    req.session.destroy(async (err) => {
      if (err) {
        return res.redirect('/hub/login');
      }

      if (sessionId) {
        try {
          await db.query(
            `DELETE FROM user_sessions WHERE sid = $1`,
            [sessionId]
          );
        } catch (_) {
          // Non-fatal defensive cleanup.
        }
      }

      res.clearCookie('connect.sid', { path: '/' });
      res.clearCookie('connect.sid', { path: '/', domain: '.managira.com' });
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.redirect('/hub/login');
    });
  },

  // Hub Dashboard
  hubDashboardGet: async (req, res) => {
    try {
      const hubId = req.session.hubId;

      // Get hub details
      const hubResult = await db.query(
        `SELECT * FROM managira_hubs WHERE hub_id = $1`,
        [hubId]
      );
      const hub = hubResult.rows[0];

      // Get organization count
      const orgCountResult = await db.query(
        `SELECT COUNT(*) as count FROM organizations 
         WHERE hub_id = $1 AND deleted = false AND is_hub_member = true`,
        [hubId]
      );
      const orgCount = parseInt(orgCountResult.rows[0].count);

      // Get total students across all organizations
      const studentsResult = await db.query(
        `SELECT COUNT(*) as count FROM students s
         WHERE s.organization_id IN (
           SELECT organization_id FROM organizations
           WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
         ) AND ${activeStudentSql("s")}`,
        [hubId]
      );
      const totalStudents = parseInt(studentsResult.rows[0].count);

      // Get total teachers across all organizations
      const teachersResult = await db.query(
        `SELECT COUNT(*) as count FROM users u
         WHERE ${STAFF_FILTER_SQL('u')} AND organization_id IN (
           SELECT organization_id FROM organizations 
           WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
         )`,
        [hubId]
      );
      const totalTeachers = parseInt(teachersResult.rows[0].count);

      // Get total classes
      const classesResult = await db.query(
        `SELECT COUNT(*) as count FROM classes 
         WHERE organization_id IN (
           SELECT organization_id FROM organizations 
           WHERE hub_id = $1 AND deleted = false AND is_hub_member = true
         )`,
        [hubId]
      );
      const totalClasses = parseInt(classesResult.rows[0].count);

      // Get organizations list with basic stats
      const orgsResult = await db.query(
        `SELECT o.organization_id, o.organization_name, o.email as organization_email, 
                o.first_name, o.last_name, o.created_at, o.nickname, o.joined_hub_at, o.on_hold,
                (SELECT COUNT(*) FROM students st WHERE st.organization_id = o.organization_id AND ${activeStudentSql("st")}) as student_count,
                (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.organization_id AND ${STAFF_FILTER_SQL('u')}) as teacher_count,
                (SELECT COUNT(*) FROM classes WHERE organization_id = o.organization_id) as class_count
         FROM organizations o
         WHERE o.hub_id = $1 AND o.deleted = false AND o.is_hub_member = true
         ORDER BY o.organization_name ASC`,
        [hubId]
      );

      // Get pending invitations
      const invitationsResult = await db.query(
        `SELECT * FROM hub_organization_invitations 
         WHERE hub_id = $1 AND status = 'pending' 
         ORDER BY created_at DESC`,
        [hubId]
      );

      // Get pending detachment requests
      const detachmentRequestsResult = await db.query(
        `SELECT dr.*, o.organization_name, o.nickname, o.email as org_email
         FROM hub_detachment_requests dr
         JOIN organizations o ON dr.organization_id = o.organization_id
         WHERE dr.hub_id = $1 AND dr.status = 'pending'
         ORDER BY dr.created_at DESC`,
        [hubId]
      );

      // Get recent activity
      const activityResult = await db.query(
        `SELECT * FROM hub_activity_logs 
         WHERE hub_id = $1 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [hubId]
      );

      res.render('hub/dashboard', {
        title: 'Hub Dashboard',
        hub,
        orgCount,
        totalStudents,
        totalTeachers,
        totalClasses,
        organizations: orgsResult.rows,
        pendingInvitations: invitationsResult.rows,
        detachmentRequests: detachmentRequestsResult.rows,
        recentActivity: activityResult.rows,
        messages: req.flash(),
        showFooterTopSection: false
      });
    } catch (error) {
            req.flash('error', 'Error loading dashboard.');
      res.redirect('/hub/login');
    }
  },

  // Reports for the whole hub, for a chosen period. Every school has its own
  // school years and terms, so the period is worked out per school:
  //   ?org=all  &year=current|<year label>  &term=current|<position 1,2,3…>
  //   ?org=<id> &year=<school_year_id>       &term=<term_id>
  // Each school's figures come from the same builder as its own Organization
  // Stats page, so the hub and the school always show the same numbers.
  hubOverviewStatsGet: async (req, res) => {
    const hubId = req.session.hubId;
    try {
      const orgsResult = await db.query(
        `SELECT o.organization_id, o.organization_name, o.on_hold,
                (SELECT COUNT(*)::int FROM students st WHERE st.organization_id = o.organization_id AND ${activeStudentSql("st")}) AS students,
                (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.organization_id AND ${STAFF_FILTER_SQL("u")}) AS staff,
                (SELECT COUNT(*)::int FROM classes c WHERE c.organization_id = o.organization_id) AS classes,
                ${DISTINCT_SUBJECTS_SQL("o.organization_id")} AS subjects
           FROM organizations o
          WHERE o.hub_id = $1 AND o.deleted = false AND o.is_hub_member = true
          ORDER BY o.organization_name ASC`,
        [hubId]
      );
      const orgs = orgsResult.rows;
      // Terms that have attendance, enrollment or scores (what the stats builder reads)…
      const dataTermsByOrg = new Map(await Promise.all(orgs.map(async (o) => [o.organization_id, await loadTermsWithData(o.organization_id)])));
      // …and every term, so "2nd term" means the same term at every school even before it has data.
      const allTermsResult = orgs.length ? await db.query(
        `SELECT t.organization_id, t.term_id, t.term_name, t.start_date, COALESCE(t.current, FALSE) AS current,
                sy.id AS school_year_id, sy.year_label
           FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
          WHERE t.organization_id = ANY($1::int[])
          ORDER BY t.start_date ASC NULLS LAST, t.term_id ASC`,
        [orgs.map((o) => o.organization_id)]
      ) : { rows: [] };
      const termsByOrg = new Map(orgs.map((o) => [o.organization_id, allTermsResult.rows.filter((t) => t.organization_id === o.organization_id)]));
      // Within a set of terms: the current one, else the latest with data, else the latest.
      const bestTermOf = (terms, orgId) => {
        const dataIds = new Set((dataTermsByOrg.get(orgId) || []).map((t) => t.term_id));
        return terms.find((t) => t.current) || [...terms].reverse().find((t) => dataIds.has(t.term_id)) || terms[terms.length - 1] || null;
      };
      const currentTermOf = (terms, orgId) => {
        const flagged = terms.find((t) => t.current);
        if (flagged) return flagged;
        const data = dataTermsByOrg.get(orgId) || [];
        const lastWithData = data[data.length - 1];
        return (lastWithData && terms.find((t) => t.term_id === lastWithData.term_id)) || terms[terms.length - 1] || null;
      };

      // Each school is read on its own calendar: its current term, unless a term
      // was picked for it with the filter beside the school (?terms=63:150,64:201).
      const overrides = new Map();
      String(req.query.terms || '').split(',').forEach((pair) => {
        const [orgId, termId] = pair.split(':').map((v) => parseInt(v, 10));
        if (Number.isInteger(orgId) && Number.isInteger(termId)) overrides.set(orgId, termId);
      });
      // ?org=<id>&term=<term_id>: one school only (the pop-up preview).
      const single = req.query.org && req.query.org !== 'all' ? orgs.find((o) => String(o.organization_id) === String(req.query.org)) : null;
      if (single && Number.isInteger(parseInt(req.query.term, 10))) overrides.set(single.organization_id, parseInt(req.query.term, 10));

      const pickedTermId = new Map(); // organization_id -> term_id (null = no term at all)
      const termOptions = new Map(); // organization_id -> school years and terms, for the pop-up
      orgs.forEach((o) => {
        const terms = termsByOrg.get(o.organization_id) || [];
        const dataIds = new Set((dataTermsByOrg.get(o.organization_id) || []).map((t) => t.term_id));
        const chosen = overrides.has(o.organization_id) ? terms.find((t) => t.term_id === overrides.get(o.organization_id)) : null;
        const term = chosen || currentTermOf(terms, o.organization_id);
        pickedTermId.set(o.organization_id, term ? term.term_id : null);
        const years = [];
        terms.forEach((t) => {
          let y = years.find((x) => x.id === t.school_year_id);
          if (!y) { y = { id: t.school_year_id, label: t.year_label, terms: [] }; years.push(y); }
          y.terms.push({ id: t.term_id, name: t.term_name, current: !!t.current, hasData: dataIds.has(t.term_id) });
        });
        termOptions.set(o.organization_id, { years: years.reverse(), custom: !!chosen });
      });
      const filter = { org: single ? String(single.organization_id) : 'all', custom: Array.from(termOptions.values()).filter((t) => t.custom).length };

      const scopedOrgs = single ? [single] : orgs;
      const built = await Promise.all(scopedOrgs.map(async (o) => {
        const termId = pickedTermId.get(o.organization_id);
        const term = termId ? (termsByOrg.get(o.organization_id) || []).find((t) => t.term_id === termId) : null;
        const dataTerms = dataTermsByOrg.get(o.organization_id) || [];
        // A term with no attendance, enrollment or scores yet has nothing to report.
        if (!termId || !dataTerms.some((t) => t.term_id === termId)) return { org: o, term, result: null };
        return { org: o, term, result: await buildOrganizationStats(o.organization_id, termId, dataTerms) };
      }));

      const schools = built.map(({ org, term, result }) => {
        const base = {
          organizationId: org.organization_id,
          organizationName: org.organization_name,
          onHold: !!org.on_hold,
          students: org.students,
          staff: org.staff,
          classes: org.classes,
          subjects: org.subjects,
          studentsPerClass: org.classes ? Math.round((org.students / org.classes) * 10) / 10 : 0,
          studentsPerStaff: org.staff ? Math.round((org.students / org.staff) * 10) / 10 : 0,
          hasData: false,
          termId: term ? term.term_id : null,
          termLabel: term ? `${term.term_name} · ${term.year_label}` : null,
          termOptions: termOptions.get(org.organization_id),
        };
        if (!result || !result.stats) return base;
        const k = result.stats.kpis;
        const a = result.stats.academic;
        return {
          ...base,
          hasData: true,
          termId: result.currentTerm.term_id,
          termLabel: `${result.currentTerm.term_name} · ${result.currentTerm.year_label}`,
          enrolled: k.enrolled,
          enrolledChange: k.enrolledChange,
          previousTermLabel: k.previousTermLabel,
          attendanceRate: k.attendanceRate,
          attendancePresent: k.attendancePresent || 0,
          attendanceMarked: k.attendanceMarked || 0,
          lowAttendance: k.lowAttendance,
          scoreEntryRate: k.scoreEntryRate,
          scoresEntered: k.scoresEntered,
          scoresExpected: k.scoresExpected,
          activeClasses: k.activeClasses,
          teachers: k.teachers,
          averageScore: a ? a.averageScore : null,
          passRate: a ? a.passRate : null,
          results: a ? a.results || 0 : 0,
          passed: a ? a.passed || 0 : 0,
          needsSupport: a ? a.needsSupportCount : 0,
          studentsWithScores: a ? a.studentsWithScores : 0,
          academicLabel: a && a.isFallback ? a.term.label : null,
          subjectsPerformance: a ? a.subjects : [],
          distribution: a ? a.distribution : [],
          gender: result.stats.gender,
          enrollmentTrend: single ? result.stats.enrollmentTrend : undefined,
        };
      });

      const sum = (key) => schools.reduce((acc, s) => acc + (Number(s[key]) || 0), 0);
      const rate = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
      const withScores = schools.filter((s) => s.results);
      const weightedAvg = withScores.length ? Math.round((withScores.reduce((acc, s) => acc + s.averageScore * s.results, 0) / sum('results')) * 10) / 10 : null;

      const subjectMap = new Map();
      schools.forEach((s) => (s.subjectsPerformance || []).forEach((sub) => {
        const key = String(sub.subject_name || '').trim().toLowerCase();
        if (!key) return;
        const entry = subjectMap.get(key) || { name: String(sub.subject_name).trim(), total: 0, results: 0, passed: 0, schools: 0 };
        entry.total += (Number(sub.average_score) || 0) * sub.results;
        entry.results += sub.results;
        entry.passed += Math.round(((Number(sub.pass_rate) || 0) / 100) * sub.results);
        entry.schools += 1;
        subjectMap.set(key, entry);
      }));
      const genderMap = new Map();
      schools.forEach((s) => (s.gender || []).forEach((g) => genderMap.set(g.gender, (genderMap.get(g.gender) || 0) + g.count)));
      const bands = [];
      schools.forEach((s) => (s.distribution || []).forEach((d, i) => { bands[i] = { label: d.label, students: ((bands[i] && bands[i].students) || 0) + d.students }; }));

      const students = sum('students');
      const staff = sum('staff');
      const classes = sum('classes');
      return res.json({
        filter,
        passMark: PASS_MARK,
        lowAttendanceRate: LOW_ATTENDANCE_RATE,
        totals: {
          schools: schools.length,
          schoolsWithData: schools.filter((s) => s.hasData).length,
          onHold: schools.filter((s) => s.onHold).length,
          students, staff, classes,
          subjects: sum('subjects'),
          enrolled: sum('enrolled'),
          attendancePresent: sum('attendancePresent'),
          attendanceMarked: sum('attendanceMarked'),
          attendanceRate: rate(sum('attendancePresent'), sum('attendanceMarked')),
          lowAttendance: sum('lowAttendance'),
          results: sum('results'),
          averageScore: weightedAvg,
          passRate: rate(sum('passed'), sum('results')),
          needsSupport: sum('needsSupport'),
          scoresEntered: sum('scoresEntered'),
          scoresExpected: sum('scoresExpected'),
          scoreEntryRate: rate(sum('scoresEntered'), sum('scoresExpected')),
          studentsPerClass: classes ? Math.round((students / classes) * 10) / 10 : 0,
          studentsPerStaff: staff ? Math.round((students / staff) * 10) / 10 : 0,
        },
        schools: schools.map(({ subjectsPerformance, distribution, ...rest }) => rest),
        subjects: Array.from(subjectMap.values())
          .map((e) => ({ name: e.name, averageScore: e.results ? Math.round((e.total / e.results) * 10) / 10 : null, passRate: rate(e.passed, e.results), results: e.results, schools: e.schools }))
          .sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0)),
        gender: Array.from(genderMap.entries()).map(([gender, count]) => ({ gender, count })).sort((a, b) => b.count - a.count),
        distribution: bands,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[HubOverview] Request failed', { hubId, message: error.message });
      return res.status(500).json({ success: false, message: 'Failed to load hub reports.' });
    }
  },

  organizationDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;
      const allowedTabs = ['report', 'students', 'staff', 'classes'];
      const activeTab = allowedTabs.includes(req.query.tab) ? req.query.tab : 'report';

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);

      if (!organization) {
        req.flash('error', 'Organization not found or not part of your hub.');
        return res.redirect('/hub/dashboard');
      }

      // The school's report is the same one the school sees on Organization Stats.
      const { buildOrganizationStats, PASS_MARK, LOW_ATTENDANCE_RATE } = require('./statsController');
      const [report, totalsResult] = await Promise.all([
        buildOrganizationStats(organization.organization_id, req.query.selectedTermId),
        db.query(
          `SELECT
             (SELECT COUNT(*)::int FROM students s WHERE s.organization_id = $1 AND ${activeStudentSql('s')}) AS students,
             (SELECT COUNT(*)::int FROM users WHERE organization_id = $1
                 AND LOWER(COALESCE(account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')) AS staff,
             (SELECT COUNT(*)::int FROM classes WHERE organization_id = $1) AS classes,
             ${DISTINCT_SUBJECTS_SQL('$1')} AS subjects`,
          [organization.organization_id]
        ),
      ]);

      // ?pdf=true: just the report, for the PDF download (see organizationReportPdfGet).
      if (req.query.pdf === 'true') {
        return res.render('stats/organizationStats', {
          title: `${organization.organization_name} report`,
          isEmbedded: false,
          isPdf: true,
          organizationName: organization.organization_name,
          hideGlobalHeader: true,
          hideGlobalFooter: true,
          hideGlobalChatbot: true,
          schoolYears: report.schoolYears,
          currentTerm: report.currentTerm,
          selectedSchoolYear: report.selectedSchoolYear,
          stats: report.stats,
          passMark: PASS_MARK,
          lowAttendanceRate: LOW_ATTENDANCE_RATE,
          statsHeading: 'School report',
          statsAllowPdf: false,
          statsAllowCompare: false,
          allowedFeatures: [],
        });
      }

      res.render('hub/organizationDetails', {
        title: `${organization.organization_name} | Hub`,
        hub,
        organization,
        activeTab,
        totals: totalsResult.rows[0] || { students: 0, staff: 0, classes: 0, subjects: 0 },
        schoolYears: report.schoolYears,
        currentTerm: report.currentTerm,
        selectedSchoolYear: report.selectedSchoolYear,
        stats: report.stats,
        passMark: PASS_MARK,
        lowAttendanceRate: LOW_ATTENDANCE_RATE,
        messages: req.flash(),
        showFooterTopSection: false,
      });
    } catch (error) {
      console.error('[hub/organizationDetails]', error.message);
      req.flash('error', 'Unable to load organization details.');
      res.redirect('/hub/dashboard');
    }
  },

  // GET /hub/organizations/:organizationId/report/export — the school's report as a spreadsheet.
  // The school's report as a PDF: the same page, drawn in a headless browser.
  organizationReportPdfGet: async (req, res) => {
    try {
      const organization = await hubController.getHubOrganization(req.hubInfo.hub_id, req.params.organizationId);
      if (!organization) return res.status(404).send('Organization not found.');
      const { buildOrganizationStats, statsFileName } = require('./statsController');
      const { currentTerm } = await buildOrganizationStats(organization.organization_id, req.query.selectedTermId);
      if (!currentTerm) return res.status(404).send('No report to download yet.');
      const { renderAppPagePdf, sessionCookieFromHeader } = require('../utils/pdfService');
      const pdf = await renderAppPagePdf({
        baseUrl: `${req.protocol}://${req.get('host')}`,
        sessionCookie: sessionCookieFromHeader(req.headers.cookie),
        path: `/hub/organizations/${organization.organization_id}?selectedTermId=${encodeURIComponent(currentTerm.term_id)}&pdf=true`,
        readyFlag: '__orgStatsReady',
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${statsFileName(organization.organization_name, currentTerm, 'pdf')}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(pdf);
    } catch (error) {
      console.error('[hub/organizationReportPdf]', error.message);
      return res.status(500).json({ error: error.userMessage || 'The PDF could not be made. Please try again.' });
    }
  },

  // Go into a school's own account, like a Managira admin can. The hub session
  // is kept aside and comes back with "Back to hub" (exitOrganizationGet).
  openOrganizationGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { rows } = await db.query(
        `SELECT o.organization_id, o.organization_name, o.nickname, o.nickname_display, o.logo, o.font_style, o.theme_color,
                o.first_name, o.last_name, o.email, o.on_hold, mh.hub_nickname
           FROM organizations o JOIN managira_hubs mh ON mh.hub_id = o.hub_id
          WHERE o.organization_id = $1 AND o.hub_id = $2 AND o.deleted = false AND o.is_hub_member = true`,
        [req.params.organizationId, hub.hub_id]
      );
      const org = rows[0];
      if (!org) {
        req.flash('error', 'That school is not in your hub.');
        return res.redirect('/hub/dashboard#schools');
      }
      if (org.on_hold) {
        req.flash('error', `${org.organization_name} is on hold. Resume it first to open it.`);
        return res.redirect(`/hub/organizations/${org.organization_id}`);
      }

      const keep = ['hubId', 'hubUserId', 'accountType', 'hubName', 'hubEmail', 'firstName', 'lastName', 'userId', 'userRole',
        'organizationName', 'orgNickName', 'orgNickNameDisplay', 'logo', 'adminHubView', 'adminHubSaved'];
      const saved = {};
      keep.forEach((key) => { if (req.session[key] !== undefined) saved[key] = req.session[key]; });
      const who = hubActorLabel(req);
      // A Managira admin viewing the hub keeps their own sign-in aside too.
      ['hubId', 'hubUserId', 'hubName', 'hubEmail', 'adminHubView', 'adminHubSaved', 'userId'].forEach((key) => { delete req.session[key]; });

      req.session.hubOrgSwitch = { saved, organizationId: org.organization_id, organizationName: org.organization_name, by: who };
      // Same session a school owner gets when they sign in.
      req.session.user = { user_id: org.organization_id, first_name: org.first_name, last_name: org.last_name, email: org.email, account_type: 'Manager' };
      req.session.organizationId = org.organization_id;
      req.session.organizationName = org.organization_name;
      req.session.firstName = org.first_name;
      req.session.lastName = org.last_name;
      req.session.logo = org.logo || null;
      req.session.fontStyle = org.font_style || null;
      req.session.themeColor = org.theme_color || 'teal';
      req.session.accountType = 'Organization';
      req.session.userRole = 'Manager';
      req.session.orgNickName = org.nickname || null;
      req.session.orgNickNameDisplay = (org.nickname_display && String(org.nickname_display).trim()) || org.nickname || null;
      req.session.onHoldRestricted = false;

      await logHubActivity(hub.hub_id, 'SCHOOL_OPENED', `${who} opened ${org.organization_name}`, org.organization_id, who, req.ip);

      req.session.save((err) => {
        if (err) {
          req.flash('error', 'Could not open the school. Please try again.');
          return res.redirect(`/hub/organizations/${org.organization_id}`);
        }
        if (process.env.NODE_ENV === 'production' && org.nickname) {
          const host = org.hub_nickname ? `${org.nickname}.${org.hub_nickname}.managira.com` : `${org.nickname}.managira.com`;
          return res.redirect(`https://${host}/common/orgDashboard`);
        }
        return res.redirect('/common/orgDashboard');
      });
    } catch (error) {
      console.error('[hub/openOrganization]', error.message);
      req.flash('error', 'Could not open the school.');
      res.redirect('/hub/dashboard#schools');
    }
  },

  restoreHubFromOrg: (req) => {
    const sw = req.session && req.session.hubOrgSwitch;
    if (!sw) return false;
    ['user', 'organizationId', 'organizationName', 'firstName', 'lastName', 'logo', 'fontStyle', 'themeColor',
      'accountType', 'userRole', 'orgNickName', 'orgNickNameDisplay', 'onHoldRestricted', 'hubOrgSwitch'
    ].forEach((key) => { delete req.session[key]; });
    Object.assign(req.session, sw.saved || {});
    return sw;
  },

  exitOrganizationGet: (req, res) => {
    const sw = hubController.restoreHubFromOrg(req);
    const back = sw && sw.organizationId ? `/hub/organizations/${sw.organizationId}` : '/hub/dashboard';
    req.session.save(() => {
      if (process.env.NODE_ENV === 'production' && process.env.BASE_URL_PRODUCTION) {
        return res.redirect(`${String(process.env.BASE_URL_PRODUCTION).replace(/\/$/, '')}${back}`);
      }
      return res.redirect(back);
    });
  },

  organizationReportExportGet: async (req, res) => {
    try {
      const organization = await hubController.getHubOrganization(req.hubInfo.hub_id, req.params.organizationId);
      if (!organization) return res.status(404).send('Organization not found.');
      const { buildOrganizationStats, statsToCsv, statsFileName } = require('./statsController');
      const { currentTerm, stats } = await buildOrganizationStats(organization.organization_id, req.query.selectedTermId);
      if (!stats) return res.status(404).send('No statistics to export yet.');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${statsFileName(organization.organization_name, currentTerm, 'csv')}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(`\uFEFF${statsToCsv(currentTerm, stats)}`);
    } catch (error) {
      console.error('[hub/organizationReportExport]', error.message);
      return res.status(500).send('Failed to export the report.');
    }
  },

  organizationStudentsListGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const studentsResult = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.gender,
                c.class_name,
                COALESCE((
                  SELECT gp.email
                  FROM guardian_students gs
                  JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
                  WHERE gs.student_id = s.student_id AND gp.organization_id = s.organization_id
                  LIMIT 1
                ), 'N/A') AS guardian_email
         FROM students s
         LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE s.organization_id = $1
         ORDER BY s.first_name ASC, s.last_name ASC`,
        [organizationId]
      );

      res.json({ success: true, items: studentsResult.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load students.' });
    }
  },

  organizationStudentDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId, studentId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const studentResult = await db.query(
        `SELECT s.student_id, s.first_name, s.last_name, s.gender, s.date_of_birth, s.hometown,
                c.class_name
         FROM students s
         LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE s.student_id = $1 AND s.organization_id = $2`,
        [studentId, organizationId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
      }

      const guardiansResult = await db.query(
        `SELECT gp.first_name, gp.last_name, gp.email, gp.phone, gs.relationship
         FROM guardian_students gs
         JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
         WHERE gs.student_id = $1 AND gp.organization_id = $2
         ORDER BY gp.first_name, gp.last_name`,
        [studentId, organizationId]
      );

      res.json({
        success: true,
        item: {
          ...studentResult.rows[0],
          guardians: guardiansResult.rows,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load student details.' });
    }
  },

  organizationStaffListGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const staffResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, on_hold, created_at
         FROM users
         WHERE organization_id = $1
         ORDER BY first_name ASC, last_name ASC`,
        [organizationId]
      );

      res.json({ success: true, items: staffResult.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load staff.' });
    }
  },

  organizationStaffDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId, staffId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const staffResult = await db.query(
        `SELECT user_id, first_name, last_name, email, account_type, on_hold, created_at, updated_at
         FROM users
         WHERE user_id = $1 AND organization_id = $2`,
        [staffId, organizationId]
      );

      if (staffResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Staff member not found.' });
      }

      res.json({ success: true, item: staffResult.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load staff details.' });
    }
  },

  organizationClassesListGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const classesResult = await db.query(
        `SELECT c.class_id, c.class_name,
                COUNT(DISTINCT s.student_id) AS student_count,
                COUNT(DISTINCT LOWER(TRIM(sub.subject_name))) AS subject_count
         FROM classes c
         LEFT JOIN students s ON s.class_id = c.class_id
         LEFT JOIN subjects sub ON sub.class_id = c.class_id
         WHERE c.organization_id = $1
         GROUP BY c.class_id, c.class_name
         ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC`,
        [organizationId]
      );

      res.json({ success: true, items: classesResult.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load classes.' });
    }
  },

  organizationClassDetailsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId, classId } = req.params;

      const organization = await hubController.getHubOrganization(hub.hub_id, organizationId);
      if (!organization) {
        return res.status(404).json({ success: false, message: 'Organization not found.' });
      }

      const classResult = await db.query(
        `SELECT c.class_id, c.class_name
         FROM classes c
         WHERE c.class_id = $1 AND c.organization_id = $2`,
        [classId, organizationId]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }

      const subjectsResult = await db.query(
        `SELECT DISTINCT ON (LOWER(TRIM(subject_name))) subject_id, TRIM(subject_name) AS subject_name
         FROM subjects
         WHERE class_id = $1 AND organization_id = $2 AND TRIM(COALESCE(subject_name, '')) <> ''
         ORDER BY LOWER(TRIM(subject_name)) ASC, subject_id ASC`,
        [classId, organizationId]
      );

      const studentsResult = await db.query(
        `SELECT student_id, first_name, last_name
         FROM students
         WHERE class_id = $1 AND organization_id = $2
         ORDER BY first_name ASC, last_name ASC`,
        [classId, organizationId]
      );

      res.json({
        success: true,
        item: {
          ...classResult.rows[0],
          subjects: subjectsResult.rows,
          students: studentsResult.rows,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load class details.' });
    }
  },

  // Setup Password (First Time)
  setupPasswordGet: async (req, res) => {
    const { token } = req.query;

    if (!token) {
      req.flash('error', 'Invalid or missing setup link.');
      return res.redirect('/hub/login');
    }

    try {
      // Hash the token to compare with stored hash
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      await ensureHubAccessSchema(db);
      const result = await db.query(
        `SELECT hub_id, hub_name, hub_email, first_name, last_name FROM managira_hubs
         WHERE reset_password_token = $1
         AND reset_password_expires > NOW()
         AND deleted = false
         UNION ALL
         SELECT h.hub_id, h.hub_name, u.email AS hub_email, u.first_name, u.last_name
           FROM hub_users u JOIN managira_hubs h ON h.hub_id = u.hub_id
          WHERE u.reset_password_token = $1 AND u.reset_password_expires > NOW() AND h.deleted = false`,
        [hashedToken]
      );

      if (result.rows.length === 0) {
        req.flash('error', 'Invalid or expired setup link. Please contact support.');
        return res.redirect('/hub/login');
      }

      const hub = result.rows[0];

      res.render('hub/setupPassword', {
        title: 'Setup Your Hub Password',
        token,
        hub,
        messages: req.flash(),
        showFooterTopSection: true
      });
    } catch (error) {
            req.flash('error', 'An error occurred.');
      res.redirect('/hub/login');
    }
  },

  setupPasswordPost: async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    if (!password || !confirmPassword) {
      req.flash('error', 'All fields are required.');
      return res.redirect(`/hub/setup-password?token=${token}`);
    }

    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect(`/hub/setup-password?token=${token}`);
    }

    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect(`/hub/setup-password?token=${token}`);
    }

    try {
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      await ensureHubAccessSchema(db);
      const hashedPassword = await bcrypt.hash(password, 10);

      // The link belongs to either the hub owner or one of the hub's users.
      const ownerResult = await db.query(
        `UPDATE managira_hubs
         SET hub_password = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = NOW()
         WHERE reset_password_token = $2 AND reset_password_expires > NOW()
         RETURNING hub_id`,
        [hashedPassword, hashedToken]
      );
      const userResult = ownerResult.rows.length ? { rows: [] } : await db.query(
        `UPDATE hub_users
         SET password = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = NOW()
         WHERE reset_password_token = $2 AND reset_password_expires > NOW()
         RETURNING hub_id, first_name, last_name, email`,
        [hashedPassword, hashedToken]
      );

      if (!ownerResult.rows.length && !userResult.rows.length) {
        req.flash('error', 'Invalid or expired setup link.');
        return res.redirect('/hub/login');
      }

      if (ownerResult.rows.length) {
        await logHubActivity(ownerResult.rows[0].hub_id, 'PASSWORD_SETUP', 'Hub password set up successfully');
      } else {
        const u = userResult.rows[0];
        await logHubActivity(u.hub_id, 'PASSWORD_SETUP', `${u.first_name} ${u.last_name} set up their password`, null, u.email);
      }

      req.flash('success', 'Password set up successfully! You can now login.');
      res.redirect('/hub/login');
    } catch (error) {
            req.flash('error', 'An error occurred while setting up your password.');
      res.redirect('/hub/login');
    }
  },

  // Hub Settings, in tabs: General (you + the hub), Contact people, Users & roles, Emails.
  hubSettingsGet: async (req, res) => {
    try {
      const hubId = req.session.hubId;
      const actor = req.hubActor;
      const can = (p) => actorCan(actor, p);

      const result = await db.query(
        `SELECT h.*, p.plan_name, p.total_cost
         FROM managira_hubs h
         LEFT JOIN plans p ON h.plan_id = p.id
         WHERE h.hub_id = $1`,
        [hubId]
      );
      const { hub_password, reset_password_token, ...hub } = result.rows[0] || {};
      const me = hubController._me(actor, hub);

      const notificationPrefs = notificationsFor(actor);
      let savedNotificationPrefs = {};
      if (actor.isOwner) {
        savedNotificationPrefs = await getHubPreferenceMap(db, hubId);
      } else {
        const r = await db.query('SELECT preference_key, enabled FROM hub_user_email_preferences WHERE hub_user_id = $1', [actor.hubUserId]);
        r.rows.forEach((row) => { savedNotificationPrefs[row.preference_key] = !!row.enabled; });
      }

      let users = [];
      if (can('users.manage')) {
        users = (await db.query(
          `SELECT hub_user_id, first_name, last_name, email, phone, job_title, role, permissions, on_hold,
                  (password IS NOT NULL) AS has_password, last_login_at
             FROM hub_users WHERE hub_id = $1
            ORDER BY CASE role WHEN 'hub_admin' THEN 0 ELSE 1 END, first_name, last_name`,
          [hubId]
        )).rows;
      }

      const tabs = ['general', 'contacts', ...(can('users.manage') ? ['users'] : []), 'emails'];
      const license = await require('../utils/licenses').hubLicense(db, hubId);
      const seats = await require('../utils/hubBilling').capacity(db, hubId, 'user').catch(() => null);
      res.render('hub/settings', {
        title: 'Hub Settings',
        hub,
        me,
        roleLabel: me.isOwner ? 'Hub admin · Owner' : (HUB_ROLES[me.role] || HUB_ROLES.hub_user).label,
        contacts: await getContacts(db, hubId),
        users,
        roles: HUB_ROLES,
        permissionGroups: HUB_PERMISSION_GROUPS,
        totalPermissions: ALL_HUB_PERMISSIONS.length,
        currentHubUserId: req.session.hubUserId || null,
        tabs,
        license,
        seats,
        activeTab: tabs.includes(req.query.tab) ? req.query.tab : 'general',
        notificationPrefs,
        savedNotificationPrefs,
        messages: req.flash(),
        showFooterTopSection: false
      });
    } catch (error) {
      console.error('[hubSettingsGet]', error.message);
      req.flash('error', 'Error loading settings.');
      res.redirect('/hub/dashboard');
    }
  },

  _me: (actor, hub) => (actor.isOwner
    ? { first_name: hub.first_name, last_name: hub.last_name, email: hub.hub_email, phone: null, job_title: null, role: 'hub_admin', isOwner: true }
    : { ...actor.user, isOwner: false }),

  // Side-panel forms for Settings.
  hubProfileFormGet: async (req, res) => {
    if (!res.locals.drawer) return res.redirect(`/hub/settings?drawer=${encodeURIComponent('/hub/settings/profile')}`);
    const hub = (await db.query('SELECT first_name, last_name, hub_email FROM managira_hubs WHERE hub_id = $1', [req.session.hubId])).rows[0] || {};
    res.render('hub/forms/profile', { me: hubController._me(req.hubActor, hub) });
  },

  hubDetailsFormGet: async (req, res) => {
    if (!res.locals.drawer) return res.redirect(`/hub/settings?drawer=${encodeURIComponent('/hub/settings/hub')}`);
    const hub = (await db.query('SELECT * FROM managira_hubs WHERE hub_id = $1', [req.session.hubId])).rows[0] || {};
    res.render('hub/forms/hubDetails', { hub });
  },

  hubContactFormGet: async (req, res) => {
    const self = req.params.contactId ? `/hub/settings/contacts/${req.params.contactId}/edit` : '/hub/settings/contacts/new';
    if (!res.locals.drawer) return res.redirect(`/hub/settings?tab=contacts&drawer=${encodeURIComponent(self)}`);
    let contact = null;
    if (req.params.contactId) {
      contact = (await db.query('SELECT * FROM hub_contacts WHERE contact_id = $1 AND hub_id = $2', [req.params.contactId, req.session.hubId])).rows[0];
      if (!contact) return res.status(404).send('<p class="hub-drawer__error">That contact was not found.</p>');
    }
    res.render('hub/forms/contact', { contact });
  },

  // Each person chooses their own optional emails.
  hubSettingsNotificationsPost: async (req, res) => {
    try {
      const actor = req.hubActor;
      const allowed = notificationsFor(actor).map((p) => p.key);
      const submitted = new Set([].concat(req.body.preferences || []).map(String));
      if (actor.isOwner) {
        await setHubPreferences(db, req.session.hubId, allowed, Array.from(submitted));
      } else {
        for (const key of allowed) {
          await db.query(
            `INSERT INTO hub_user_email_preferences (hub_user_id, preference_key, enabled, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (hub_user_id, preference_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
            [actor.hubUserId, key, submitted.has(key)]
          );
        }
      }
      req.flash('success', 'Email preferences saved.');
    } catch (err) {
      req.flash('error', 'Could not update email preferences.');
    }
    res.redirect('/hub/settings?tab=emails');
  },

  // Your own name, phone and job title.
  hubSettingsProfilePost: async (req, res) => {
    const actor = req.hubActor;
    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    if (!firstName || !lastName) {
      req.flash('error', 'First and last name are required.');
      return res.redirect('/hub/settings');
    }
    try {
      if (actor.isOwner) {
        await db.query(
          'UPDATE managira_hubs SET first_name = $1, last_name = $2, updated_at = NOW() WHERE hub_id = $3',
          [firstName, lastName, req.session.hubId]
        );
      } else {
        await db.query(
          `UPDATE hub_users SET first_name = $1, last_name = $2, phone = $3, job_title = $4, updated_at = NOW()
           WHERE hub_user_id = $5`,
          [firstName, lastName, String(req.body.phone || '').trim().slice(0, 40) || null, String(req.body.jobTitle || '').trim().slice(0, 120) || null, actor.hubUserId]
        );
        await db.query(
          `UPDATE hub_contacts SET full_name = $1, phone = COALESCE($2, phone), job_title = COALESCE($3, job_title), updated_at = NOW() WHERE hub_user_id = $4`,
          [`${firstName} ${lastName}`, String(req.body.phone || '').trim().slice(0, 40) || null, String(req.body.jobTitle || '').trim().slice(0, 120) || null, actor.hubUserId]
        );
      }
      req.session.firstName = firstName;
      req.session.lastName = lastName;
      await logHubActivity(req.session.hubId, 'PROFILE_UPDATE', `${firstName} ${lastName} updated their profile`, null, hubActorEmail(req));
      req.flash('success', 'Your profile is saved.');
    } catch (error) {
      req.flash('error', 'Error updating profile.');
    }
    res.redirect('/hub/settings');
  },

  // The hub's own phone and address (hub name, email and plan are set by Managira).
  hubSettingsHubPost: async (req, res) => {
    try {
      await db.query(
        'UPDATE managira_hubs SET hub_phone = $1, hub_address = $2, updated_at = NOW() WHERE hub_id = $3',
        [String(req.body.hubPhone || '').trim().slice(0, 15) || null, String(req.body.hubAddress || '').trim() || null, req.session.hubId]
      );
      await logHubActivity(req.session.hubId, 'PROFILE_UPDATE', 'Hub details updated', null, hubActorLabel(req));
      req.flash('success', 'Hub details saved.');
    } catch (error) {
      req.flash('error', 'Could not save hub details. Check the phone number is no longer than 15 characters.');
    }
    res.redirect('/hub/settings');
  },

  // Add or edit a contact person.
  hubContactSavePost: async (req, res) => {
    const hubId = req.session.hubId;
    const fullName = String(req.body.fullName || '').trim().slice(0, 150);
    const email = String(req.body.email || '').trim().slice(0, 255);
    const phone = String(req.body.phone || '').trim().slice(0, 40);
    const jobTitle = String(req.body.jobTitle || '').trim().slice(0, 120);
    const share = ['1', 'on', 'true'].includes(String(req.body.shareWithSchools || ''));
    if (!fullName || (!email && !phone)) {
      req.flash('error', 'Add a name and at least an email or a phone number.');
      return res.redirect('/hub/settings?tab=contacts');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      req.flash('error', 'That email address does not look right.');
      return res.redirect('/hub/settings?tab=contacts');
    }
    try {
      await ensureHubAccessSchema(db);
      if (req.params.contactId) {
        const r = await db.query(
          `UPDATE hub_contacts SET full_name = $1, job_title = $2, email = $3, phone = $4, share_with_schools = $5, updated_at = NOW()
           WHERE contact_id = $6 AND hub_id = $7`,
          [fullName, jobTitle || null, email || null, phone || null, share, req.params.contactId, hubId]
        );
        req.flash(r.rowCount ? 'success' : 'error', r.rowCount ? `${fullName} saved.` : 'Contact not found.');
      } else {
        const count = (await db.query('SELECT COUNT(*)::int AS n FROM hub_contacts WHERE hub_id = $1', [hubId])).rows[0].n;
        await db.query(
          `INSERT INTO hub_contacts (hub_id, full_name, job_title, email, phone, is_primary, sort_order, share_with_schools)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [hubId, fullName, jobTitle || null, email || null, phone || null, count === 0, count, share]
        );
        req.flash('success', `${fullName} added as a contact.`);
      }
      await logHubActivity(hubId, 'CONTACT_UPDATE', `Contact ${fullName} saved`, null, hubActorLabel(req));
    } catch (error) {
      req.flash('error', 'Could not save the contact.');
    }
    res.redirect('/hub/settings?tab=contacts');
  },

  hubContactDeletePost: async (req, res) => {
    const hubId = req.session.hubId;
    try {
      const r = await db.query('DELETE FROM hub_contacts WHERE contact_id = $1 AND hub_id = $2 RETURNING full_name, is_primary', [req.params.contactId, hubId]);
      if (r.rows[0] && r.rows[0].is_primary) {
        await db.query(
          `UPDATE hub_contacts SET is_primary = TRUE WHERE contact_id = (
             SELECT contact_id FROM hub_contacts WHERE hub_id = $1 ORDER BY sort_order, contact_id LIMIT 1)`,
          [hubId]
        );
      }
      req.flash('success', r.rows[0] ? `${r.rows[0].full_name} removed.` : 'Contact removed.');
    } catch (error) {
      req.flash('error', 'Could not remove the contact.');
    }
    res.redirect('/hub/settings?tab=contacts');
  },

  hubContactPrimaryPost: async (req, res) => {
    const hubId = req.session.hubId;
    try {
      await db.query('UPDATE hub_contacts SET is_primary = (contact_id = $1), updated_at = NOW() WHERE hub_id = $2', [req.params.contactId, hubId]);
      req.flash('success', 'Main contact updated.');
    } catch (error) {
      req.flash('error', 'Could not update the main contact.');
    }
    res.redirect('/hub/settings?tab=contacts');
  },

  // Update Hub Logo
  hubSettingsLogoPost: async (req, res) => {
    const hubId = req.session.hubId;

    try {
      if (!req.file) {
        req.flash('error', 'Please select a logo file.');
        return res.redirect('/hub/settings');
      }

      const { uploadToS3, deleteFromS3 } = require('../middleware/s3Upload');

      // Get current logo to delete from S3
      const currentLogoResult = await db.query(
        'SELECT logo_path FROM managira_hubs WHERE hub_id = $1',
        [hubId]
      );

      const currentLogo = currentLogoResult.rows[0]?.logo_path;

      // Upload new logo to S3 with proper path including filename
      const logoKey = `images/hub-logos/${hubId}/${Date.now()}_${req.file.originalname}`;
      const logoUrl = await uploadToS3(req.file, logoKey);

            // Update database with new logo
      await db.query(
        'UPDATE managira_hubs SET logo_path = $1, updated_at = NOW() WHERE hub_id = $2',
        [logoUrl, hubId]
      );

      // Delete old logo from S3 if it exists and is not the default
      if (currentLogo && currentLogo !== '/images/managira.png' && !currentLogo.includes('managira.png')) {
        try {
          // Extract key from URL
          const s3Prefix = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
          const oldKey = currentLogo.startsWith(s3Prefix) ? currentLogo.substring(s3Prefix.length) : currentLogo;
          await deleteFromS3(oldKey);
        } catch (deleteError) {
                  }
      }

      // Update session with new logo
      req.session.logo = logoUrl;

      await logHubActivity(hubId, 'LOGO_UPDATE', 'Hub logo updated');

      req.flash('success', 'Logo updated successfully.');
      res.redirect('/hub/settings');
    } catch (error) {
            req.flash('error', 'Error updating logo.');
      res.redirect('/hub/settings');
    }
  },

  // GET - Display organization invitation form
  organizationInviteGet: async (req, res) => {
    try {
      const hub = req.hubInfo;

      // Check if hub has reached max organizations
      const orgCountResult = await db.query(
        'SELECT COUNT(*) FROM organizations WHERE hub_id = $1 AND deleted = false',
        [hub.hub_id]
      );
      const currentOrgCount = parseInt(orgCountResult.rows[0].count);
      const places = await require('../utils/hubBilling').capacity(db, hub.hub_id, 'school');

      if (places.full && !places.canBuy) {
        req.flash('error', `You have used all ${places.limit} school places in your plan. Please contact Managira to add more.`);
        return res.redirect('/hub/dashboard');
      }

      if (!res.locals.drawer) return res.redirect(`/hub/dashboard?drawer=${encodeURIComponent('/hub/organizations/invite')}#invitations`);
      res.render('hub/forms/invite', {
        hub,
        hubPlans: await require('../utils/hubPlans').plansForHub(db, hub.hub_id),
        contacts: await getContacts(db, hub.hub_id),
        currentOrgCount,
        maxOrganizations: places.limit,
        places: { ...places, priceLabel: require('../utils/hubBilling').money(places.price, places.currency) },
      });
    } catch (error) {
            req.flash('error', 'Error loading invitation form.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Send organization invitation
  organizationInvitePost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organization_name, contact_person_name, contact_person_email, contact_person_phone, message } = req.body;

      // Validate inputs
      if (!organization_name || !contact_person_name || !contact_person_email) {
        req.flash('error', 'Please fill in all required fields.');
        return res.redirect('/hub/organizations/invite');
      }

      // Out of school places? The plan may let them approve one more.
      const extra = await require('./hubBillingController').extraGate(req, res, 'school', '/hub/dashboard');
      if (extra.blocked) return;

      // Check if organization with this email already invited or exists
      const existingCheck = await db.query(
        `SELECT * FROM hub_organization_invitations 
         WHERE hub_id = $1 AND contact_person_email = $2 AND status = 'pending'`,
        [hub.hub_id, contact_person_email]
      );

      if (existingCheck.rows.length > 0) {
        req.flash('error', 'An invitation has already been sent to this email address.');
        return res.redirect('/hub/organizations/invite');
      }

      // Check if organization already exists with this contact email
      const orgCheck = await db.query(
        'SELECT * FROM organizations WHERE email = $1 AND deleted = false',
        [contact_person_email]
      );

      if (orgCheck.rows.length > 0) {
        req.flash('error', 'An organization with this contact email already exists.');
        return res.redirect('/hub/organizations/invite');
      }

      // Generate invitation token
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Insert invitation
      // The plan the new school gets (optional; one of the hub's plans).
      const wantedPlan = parseInt(req.body.hub_plan_id, 10) || null;
      const invitePlan = wantedPlan
        ? (await require('../utils/hubPlans').plansForHub(db, hub.hub_id)).plans.find((p) => Number(p.id) === wantedPlan) || null
        : null;
      await db.query(
        `INSERT INTO hub_organization_invitations 
         (hub_id, organization_name, contact_person_name, contact_person_email, contact_person_phone, invitation_token, message, expires_at, hub_contact_id, hub_assigned_plan_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [hub.hub_id, organization_name, contact_person_name, contact_person_email, contact_person_phone, invitationToken, message, expiresAt,
         await hubContactIdFrom(hub.hub_id, req.body.hub_contact_id), invitePlan ? invitePlan.id : null]
      );
      await extra.commit();

      // Send invitation email
      const invitationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/account/accept-hub-invitation/${invitationToken}`;
      
      const emailHtml = renderCleanEmail({
        title: `Hub Invitation from ${hub.hub_name}`,
        greeting: `Dear ${contact_person_name},`,
        paragraphs: [
          `${hub.hub_name} has invited ${organization_name} to join their hub on Managira SMS.`,
          'A hub is a parent organization that manages multiple schools or educational institutions.',
          message ? `Message from ${hub.hub_name}: ${message}` : '',
        ].filter(Boolean),
        details: [
          { label: 'Hub', value: hub.hub_name },
          { label: 'Organization', value: organization_name },
          { label: 'Plan', value: (invitePlan && invitePlan.plan_name) || hub.plan_name || 'Set by your hub' },
          { label: 'Access URL', value: `${organization_name.toLowerCase().replace(/\s+/g, '')}.${hub.hub_nickname}.managira.com` },
        ],
        cta: { url: invitationUrl, text: 'Accept Invitation' },
        note: `This invitation expires on ${expiresAt.toLocaleDateString()}. If you have questions, contact ${hub.hub_name} at ${hub.hub_email}.`,
      });

      const emailSent = await sendEmail({
        to: contact_person_email,
        subject: `Action required: respond to your ${hub.hub_name} Hub invitation`,
        html: emailHtml
      });

      if (!emailSent) {
        req.flash('warning', 'Invitation created but email could not be sent. Please resend the invitation.');
      } else {
        req.flash('success', `Invitation sent successfully to ${contact_person_email}`);
      }

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_invited',
        `Invited organization: ${organization_name} (${contact_person_email})`,
        null,
        hubActorLabel(req),
        req.ip
      );
      notifyInvitationSent(req, organization_name);

      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error sending invitation.');
      res.redirect('/hub/organizations/invite');
    }
  },

  // POST - Resend organization invitation
  resendInvitePost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { invitationId } = req.body;

      // Get invitation details
      const invitationResult = await db.query(
        'SELECT * FROM hub_organization_invitations WHERE invitation_id = $1 AND hub_id = $2',
        [invitationId, hub.hub_id]
      );

      if (invitationResult.rows.length === 0) {
        req.flash('error', 'Invitation not found.');
        return res.redirect('/hub/dashboard');
      }

      const invitation = invitationResult.rows[0];

      if (invitation.status !== 'pending') {
        req.flash('error', 'This invitation has already been accepted or declined.');
        return res.redirect('/hub/dashboard');
      }

      // Update expiration date
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.query(
        'UPDATE hub_organization_invitations SET expires_at = $1, updated_at = CURRENT_TIMESTAMP WHERE invitation_id = $2',
        [newExpiresAt, invitationId]
      );

      // Resend email
      const invitationUrl = `${process.env.APP_URL || 'http://localhost:4000'}/account/accept-hub-invitation/${invitation.invitation_token}`;
      
      const emailHtml = renderCleanEmail({
        title: `Reminder: Hub Invitation from ${hub.hub_name}`,
        greeting: `Dear ${invitation.contact_person_name},`,
        paragraphs: [
          `This is a reminder that ${hub.hub_name} invited ${invitation.organization_name} to join their hub on Managira SMS.`,
          invitation.message ? `Message from ${hub.hub_name}: ${invitation.message}` : '',
        ].filter(Boolean),
        cta: { url: invitationUrl, text: 'Accept Invitation' },
        note: `This invitation expires on ${newExpiresAt.toLocaleDateString()}.`,
      });

      await sendEmail({
        to: invitation.contact_person_email,
        subject: `Reminder: respond to your ${hub.hub_name} Hub invitation`,
        html: emailHtml
      });

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'invitation_resent',
        `Resent invitation to: ${invitation.organization_name} (${invitation.contact_person_email})`,
        null,
        hub.hub_name,
        req.ip
      );

      req.flash('success', 'Invitation resent successfully.');
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error resending invitation.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Remove organization from hub
  removeOrganizationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found or not part of this hub.');
        return res.redirect('/hub/dashboard');
      }

      const organization = orgResult.rows[0];

      // Remove from hub (unlink)
      await db.query(
        `UPDATE organizations 
         SET hub_id = NULL, is_hub_member = false, joined_hub_at = NULL 
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_removed',
        `Removed organization: ${organization.organization_name}`,
        organizationId,
        hubActorLabel(req),
        req.ip
      );
      notifySchoolStatus(req, organization.organization_name, 'was removed from the hub');

      // Send notification email to organization
      if (organization.email) {
        const emailHtml = renderCleanEmail({
          title: 'Hub Membership Update',
          greeting: `Dear ${organization.organization_name} Administrator,`,
          paragraphs: [
            `Your organization has been removed from the ${hub.hub_name} hub.`,
            `If you believe this is an error, contact ${hub.hub_name} at ${hub.hub_email}.`,
            'Log in to your dashboard to set up your organization subscription.',
          ],
          details: [
            { label: 'Status', value: 'Organization is now independent' },
            { label: 'New Subdomain', value: `${organization.organization_nickname}.managira.com` },
            { label: 'Data', value: 'All existing data remains intact' },
          ],
        });

        await sendEmail({
          to: organization.email,
          subject: `Hub Membership Update - ${organization.organization_name}`,
          html: emailHtml
        });
      }

      req.flash('success', `${organization.organization_name} has been removed from your hub.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error removing organization.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Cancel pending invitation
  cancelInvitationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { invitationId } = req.body;

      // Get invitation details
      const invitationResult = await db.query(
        'SELECT * FROM hub_organization_invitations WHERE invitation_id = $1 AND hub_id = $2',
        [invitationId, hub.hub_id]
      );

      if (invitationResult.rows.length === 0) {
        req.flash('error', 'Invitation not found.');
        return res.redirect('/hub/dashboard');
      }

      const invitation = invitationResult.rows[0];

      if (invitation.status !== 'pending') {
        req.flash('error', 'This invitation cannot be cancelled.');
        return res.redirect('/hub/dashboard');
      }

      // Update status to cancelled
      await db.query(
        'UPDATE hub_organization_invitations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE invitation_id = $2',
        ['cancelled', invitationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'invitation_cancelled',
        `Cancelled invitation to: ${invitation.organization_name} (${invitation.contact_person_email})`,
        null,
        hub.hub_name,
        req.ip
      );

      req.flash('success', 'Invitation cancelled successfully.');
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error cancelling invitation.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Toggle organization hold status
  toggleOrganizationHoldPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

            // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found or not part of this hub.');
        return res.redirect('/hub/dashboard');
      }

      const organization = orgResult.rows[0];
      const newHoldStatus = !organization.on_hold;

            // Toggle hold status
      await db.query(
        'UPDATE organizations SET on_hold = $1 WHERE organization_id = $2',
        [newHoldStatus, organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        newHoldStatus ? 'organization_held' : 'organization_resumed',
        `${newHoldStatus ? 'Put on hold' : 'Resumed'}: ${organization.organization_name}`,
        organizationId,
        hubActorLabel(req),
        req.ip
      );
      notifySchoolStatus(req, organization.organization_name, newHoldStatus ? 'was put on hold' : 'was resumed');

      req.flash('success', `${organization.organization_name} has been ${newHoldStatus ? 'put on hold' : 'resumed'}.`);
      // Go back to the page the action came from (dashboard list or the school's page).
      let back = '/hub/dashboard#schools';
      try {
        const ref = new URL(req.get('referer') || '', `${req.protocol}://${req.get('host')}`);
        if (ref.host === req.get('host') && ref.pathname.startsWith('/hub/')) back = ref.pathname + ref.search + (ref.pathname === '/hub/dashboard' ? '#schools' : '');
      } catch (_e) { /* keep default */ }
      res.redirect(back);
    } catch (error) {
            req.flash('error', 'Error updating organization status.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Permanently delete organization
  deleteOrganizationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

            // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found or not part of this hub.');
        return res.redirect('/hub/dashboard');
      }

      const organization = orgResult.rows[0];

      // Mark as deleted and hold to stop any billing activity while temporarily removed.
      await db.query(
        `UPDATE organizations
         SET deleted = true,
             deleted_at = CURRENT_TIMESTAMP,
             on_hold = true,
             hold_by = 'Hub',
             scheduled_hold_date = NOW(),
             updated_at = NOW()
         WHERE organization_id = $1`,
        [organizationId]
      );

      await db.query(
        'UPDATE stored_cards SET is_active = false, updated_at = NOW() WHERE organization_id = $1',
        [organizationId]
      );

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_deleted',
        `Deleted organization: ${organization.organization_name}`,
        organizationId,
        hubActorLabel(req),
        req.ip
      );
      notifySchoolStatus(req, organization.organization_name, 'was deleted');

            req.flash('success', `${organization.organization_name} has been permanently deleted.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error deleting organization.');
      res.redirect('/hub/dashboard');
    }
  },

  // GET - Edit organization page
  editOrganizationGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/hub/dashboard');
      }

      if (!res.locals.drawer) return res.redirect(`/hub/organizations/${organizationId}?drawer=${encodeURIComponent(`/hub/organizations/edit/${organizationId}`)}`);
      res.render('hub/forms/editSchool', {
        organization: orgResult.rows[0],
        contacts: await getContacts(db, hub.hub_id),
        hubPlans: await require('../utils/hubPlans').plansForHub(db, hub.hub_id),
        hub,
      });
    } catch (error) {
            req.flash('error', 'Error loading organization.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Update organization details
  editOrganizationPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.params;
      const {
        organization_name,
        organization_address,
        organization_country,
        organization_province,
        organization_phone
      } = req.body;

                  // Validate
      if (!organization_name || !organization_address || !organization_phone) {
        req.flash('error', 'Organization name, address, and phone are required.');
        return res.redirect(`/hub/organizations/edit/${organizationId}`);
      }

      // Get organization details
      const orgResult = await db.query(
        'SELECT * FROM organizations WHERE organization_id = $1 AND hub_id = $2 AND deleted = false',
        [organizationId, hub.hub_id]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/hub/dashboard');
      }

      // Update organization
      await db.query(
        `UPDATE organizations 
         SET organization_name = $1, organization_address = $2, organization_country = $3, organization_province = $4, organization_phone = $5,
             hub_contact_id = $7
         WHERE organization_id = $6`,
        [organization_name, organization_address, organization_country || null, organization_province || null, organization_phone, organizationId,
         await hubContactIdFrom(hub.hub_id, req.body.hub_contact_id)]
      );

      // The plan the hub gives this school ('' = the hub's default plan).
      if (req.body.hub_plan_id !== undefined) {
        const wanted = parseInt(req.body.hub_plan_id, 10) || null;
        if (String(wanted || '') !== String(orgResult.rows[0].hub_assigned_plan_id || '')) {
          const set = await require('../utils/hubPlans').setSchoolPlan(db, hub.hub_id, organizationId, wanted);
          if (!set.ok) {
            req.flash('error', set.message);
            return res.redirect(`/hub/organizations/edit/${organizationId}`);
          }
          await logHubActivity(hub.hub_id, 'organization_updated', `${organization_name} is now on ${set.plan ? set.plan.plan_name : 'the hub’s default plan'}`, organizationId, hubActorLabel(req), req.ip);
        }
      }

      // Log activity
      await logHubActivity(
        hub.hub_id,
        'organization_updated',
        `Updated organization: ${organization_name}`,
        organizationId,
        hub.hub_name,
        req.ip
      );

      req.flash('success', 'School details saved.');
      res.redirect(`/hub/organizations/${organizationId}`);
    } catch (error) {
            req.flash('error', 'Error updating organization.');
      res.redirect(`/hub/organizations/edit/${req.params.organizationId}`);
    }
  },

  // POST - Approve detachment request
  approveDetachmentPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { requestId } = req.body;

                  // Get request details
      const requestResult = await db.query(
        `SELECT dr.*, o.organization_name, o.nickname, o.email as org_email
         FROM hub_detachment_requests dr
         JOIN organizations o ON dr.organization_id = o.organization_id
         WHERE dr.request_id = $1 AND dr.hub_id = $2 AND dr.status = 'pending'`,
        [requestId, hub.hub_id]
      );

      if (requestResult.rows.length === 0) {
        req.flash('error', 'Detachment request not found or already processed.');
        return res.redirect('/hub/dashboard');
      }

      const request = requestResult.rows[0];

            // Detach organization from hub
      await db.query(
        `UPDATE organizations 
         SET hub_id = NULL, is_hub_member = false, joined_hub_at = NULL 
         WHERE organization_id = $1`,
        [request.organization_id]
      );

            // Update request status
      await db.query(
        `UPDATE hub_detachment_requests 
         SET status = 'approved', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP 
         WHERE request_id = $2`,
        [req.session.email, requestId]
      );

            // Log activity
      await logHubActivity(
        hub.hub_id,
        'detachment_approved',
        `Approved detachment request from ${request.organization_name}`,
        request.organization_id,
        hubActorLabel(req),
        req.ip
      );
      notifySchoolStatus(req, request.organization_name, 'left the hub');

      // Send notification email to organization
      const emailHtml = renderCleanEmail({
        title: 'Detachment Request Approved',
        greeting: `Dear ${request.organization_name} Administrator,`,
        paragraphs: [
          `Your request to detach from <strong>${hub.hub_name}</strong> has been approved. Your organization is now independent.`,
          '<strong>What happens next:</strong>',
          '1. Your organization data remains fully intact — nothing has been deleted.',
          '2. You will need to set up your own subscription plan to continue using Managira.',
          '3. Log in to your dashboard and navigate to Billing to choose a plan.',
          '4. If you were using a custom subdomain under the hub, your new subdomain is shown below.',
          'If you need any assistance during this transition, don\'t hesitate to reach out.',
        ],
        details: [
          { label: 'Status', value: 'Approved — Now Independent' },
          { label: 'Previous Hub', value: hub.hub_name },
          { label: 'Your Subdomain', value: `${request.nickname}.managira.com` },
          { label: 'Your Data', value: 'All organization data remains intact' },
          { label: 'Next Step', value: 'Set up your own subscription plan in Billing settings' },
        ],
        note: 'Need help? Contact us at info@managira.com or visit managira.com/legal/help.',
      });

      await sendEmail({
        to: request.org_email,
        subject: 'Detachment Request Approved - Managira SMS',
        html: emailHtml
      });

                  req.flash('success', `Detachment approved. ${request.organization_name} is now independent.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error approving detachment request.');
      res.redirect('/hub/dashboard');
    }
  },

  // POST - Reject detachment request
  rejectDetachmentPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { requestId, notes } = req.body;

                        // Get request details
      const requestResult = await db.query(
        `SELECT dr.*, o.organization_name, o.email as org_email
         FROM hub_detachment_requests dr
         JOIN organizations o ON dr.organization_id = o.organization_id
         WHERE dr.request_id = $1 AND dr.hub_id = $2 AND dr.status = 'pending'`,
        [requestId, hub.hub_id]
      );

      if (requestResult.rows.length === 0) {
        req.flash('error', 'Detachment request not found or already processed.');
        return res.redirect('/hub/dashboard');
      }

      const request = requestResult.rows[0];

            // Update request status
      await db.query(
        `UPDATE hub_detachment_requests 
         SET status = 'rejected', reviewed_by = $1, reviewed_at = CURRENT_TIMESTAMP, notes = $2 
         WHERE request_id = $3`,
        [req.session.email, notes, requestId]
      );

            // Log activity
      await logHubActivity(
        hub.hub_id,
        'detachment_rejected',
        `Rejected detachment request from ${request.organization_name}`,
        request.organization_id,
        hub.hub_name,
        req.ip
      );

      // Send notification email to organization
      const emailHtml = renderCleanEmail({
        title: 'Detachment Request Update',
        greeting: `Dear ${request.organization_name} Administrator,`,
        paragraphs: [
          `Your request to detach from <strong>${hub.hub_name}</strong> has been reviewed and was not approved at this time.`,
          notes ? `<strong>Reason from ${hub.hub_name}:</strong> ${notes}` : '',
          `If you would like to discuss this decision, you can contact ${hub.hub_name} directly at <strong>${hub.hub_email}</strong>.`,
          'Your organization continues to operate as part of the hub with no changes to your data or access.',
          'You may submit a new detachment request in the future if needed.',
        ].filter(Boolean),
        details: [
          { label: 'Status', value: 'Not Approved' },
          { label: 'Hub', value: hub.hub_name },
          { label: 'Hub Contact', value: hub.hub_email },
          { label: 'Your Access', value: 'Unchanged — all services remain active' },
        ],
        note: 'Need help? Contact us at info@managira.com or visit managira.com/legal/help.',
      });

      await sendEmail({
        to: request.org_email,
        subject: 'Detachment Request Update - Managira SMS',
        html: emailHtml
      });

                  req.flash('success', `Detachment request from ${request.organization_name} has been rejected.`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error rejecting detachment request.');
      res.redirect('/hub/dashboard');
    }
  },

  // GET - Search for existing organizations
  searchOrganizationsGet: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { q } = req.query;

                  if (!q || q.length < 2) {
        return res.json({ organizations: [] });
      }

      // Search for organizations not in any hub or not in this hub
      const result = await db.query(
        `SELECT organization_id, organization_name, email, nickname, is_hub_member, hub_id
         FROM organizations
         WHERE (LOWER(organization_name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1))
         AND deleted = false
         AND organization_id NOT IN (
           SELECT organization_id FROM organizations WHERE hub_id = $2
         )
         ORDER BY organization_name
         LIMIT 10`,
        [`%${q}%`, hub.hub_id]
      );

                  res.json({ organizations: result.rows });
    } catch (error) {
            res.status(500).json({ error: 'Search failed' });
    }
  },

  // POST - Invite existing organization
  inviteExistingOrgPost: async (req, res) => {
    try {
      const hub = req.hubInfo;
      const { organizationId } = req.body;

                  // Check if organization exists and is not in a hub
      const orgResult = await db.query(
        `SELECT * FROM organizations WHERE organization_id = $1 AND deleted = false`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        req.flash('error', 'Organization not found.');
        return res.redirect('/hub/organizations/invite');
      }

      const org = orgResult.rows[0];

      if (org.is_hub_member && org.hub_id) {
        req.flash('error', `${org.organization_name} is already part of a hub.`);
        return res.redirect('/hub/organizations/invite');
      }

      // Check if invitation already exists
      const existingInvite = await db.query(
        `SELECT * FROM hub_organization_invitations 
         WHERE hub_id = $1 AND contact_person_email = $2 AND status = 'pending'`,
        [hub.hub_id, org.email]
      );

      if (existingInvite.rows.length > 0) {
        req.flash('error', 'An invitation has already been sent to this organization.');
        return res.redirect('/hub/organizations/invite');
      }

      // Out of school places? The plan may let them approve one more.
      const extra = await require('./hubBillingController').extraGate(req, res, 'school', '/hub/organizations/invite');
      if (extra.blocked) return;

            // Generate invitation token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      // Create invitation record
      await db.query(
        `INSERT INTO hub_organization_invitations 
         (hub_id, organization_name, contact_person_name, contact_person_email, contact_person_phone, 
          invitation_token, expires_at, existing_org_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [hub.hub_id, org.organization_name, org.organization_name, org.email, '', token, expiresAt, organizationId]
      );
      await extra.commit();

            // Log activity
      await logHubActivity(
        hub.hub_id,
        'invitation_sent',
        `Invited existing organization: ${org.organization_name}`,
        null,
        hubActorLabel(req),
        req.ip
      );
      notifyInvitationSent(req, org.organization_name);

      // Send email to organization
      const emailHtml = renderCleanEmail({
        title: 'Hub Invitation',
        greeting: `Dear ${org.organization_name} Team,`,
        paragraphs: [
          `${hub.hub_name} has invited your organization to join their hub on Managira SMS.`,
          'A hub allows multiple organizations to be managed under one parent organization while keeping each organization operationally independent.',
          `If you have questions, contact ${hub.hub_name} at ${hub.hub_email}.`,
        ],
        details: [
          { label: 'New Subdomain', value: `${org.nickname}.${hub.hub_nickname}.managira.com` },
          { label: 'Subscription', value: `Managed by ${hub.hub_name}` },
          { label: 'Data', value: 'All your data remains with your organization' },
          { label: 'Control', value: 'You keep full control of operations' },
        ],
        cta: {
          url: `${process.env.BASE_URL || 'https://managira.com'}/account/accept-hub-invitation-existing/${token}`,
          text: 'Accept Invitation',
        },
        note: `This invitation expires on ${expiresAt.toLocaleDateString()}.`,
      });

      await sendEmail({
        to: org.email,
        subject: `Action required: respond to your ${hub.hub_name} Hub invitation`,
        html: emailHtml
      });

                  req.flash('success', `Invitation sent to ${org.organization_name}!`);
      res.redirect('/hub/dashboard');
    } catch (error) {
            req.flash('error', 'Error sending invitation.');
      res.redirect('/hub/organizations/invite');
    }
  },
};

module.exports = hubController;
