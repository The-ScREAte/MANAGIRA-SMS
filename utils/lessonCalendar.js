// A teacher's lessons from the class timetables (class_schedules) as calendar
// items, one per lesson per day within each term's dates. Shown on
// /common/calendar and in the calendar feed. Days the school marked closed in
// the attendance calendar (manual closures, public holidays) are skipped; the
// timetable itself decides which weekdays have lessons.
const {
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  buildCalendarDayMap,
  parseBoolean,
} = require("./attendanceCalendar");

const MAX_DAYS = 400; // the longest range the calendar asks for (feed: 30 days back, a year ahead)

function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Closed days in [from, to] for a term: date key -> label. Kept for a minute:
// looking them up takes three database round trips and every calendar load
// asks for them, while closures change rarely.
const CLOSED_TTL_MS = 60 * 1000;
const closedCache = new Map();

function closedDays(db, organizationId, termId, from, to) {
  const key = `${organizationId}|${termId}|${from}|${to}`;
  const hit = closedCache.get(key);
  if (hit && Date.now() - hit.at < CLOSED_TTL_MS) return hit.days;
  const days = loadClosedDays(db, organizationId, termId, from, to);
  closedCache.set(key, { at: Date.now(), days });
  days.catch(() => closedCache.delete(key));
  if (closedCache.size > 500) closedCache.delete(closedCache.keys().next().value);
  return days;
}

async function loadClosedDays(db, organizationId, termId, from, to) {
  const profile = await getAttendanceCalendarProfile(db, organizationId, termId);
  if (!profile) return new Map();
  const dayMap = buildCalendarDayMap(await getAttendanceCalendarDays(db, profile.calendar_id, from, to));
  const closed = new Map();
  dayMap.forEach((day, key) => {
    const source = String(day.source || "").toLowerCase();
    const counts = (source === "manual" || (source === "public_holiday" && parseBoolean(profile.include_public_holidays)))
      ? Boolean(day.counts_for_attendance)
      : true;
    if (!counts) closed.set(key, day.label || "School closed");
  });
  return closed;
}

// Lessons a person teaches: subjects assigned to them, every lesson of a class
// they are main teacher of, and every lesson of a class they teach without
// specific subject assignments there.
async function lessonItems(db, { organizationId, userId, start, end }) {
  if (!organizationId || !userId || !start || !end) return [];
  const { rows } = await db.query(
    `SELECT e.entry_id, e.day_of_week, to_char(e.start_time, 'HH24:MI') AS start_time, to_char(e.end_time, 'HH24:MI') AS end_time,
            e.custom_label, s.subject_name, c.class_id, c.class_name, t.term_id, t.term_name,
            to_char(t.start_date, 'YYYY-MM-DD') AS term_start, to_char(t.end_date, 'YYYY-MM-DD') AS term_end
       FROM class_schedule_entries e
       JOIN class_schedules cs ON cs.schedule_id = e.schedule_id
       JOIN terms t ON t.term_id = cs.term_id
       JOIN classes c ON c.class_id = cs.class_id AND c.obsolete_at IS NULL
       LEFT JOIN subjects s ON s.subject_id = e.subject_id
      WHERE cs.organization_id = $1
        AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
        AND t.start_date < $3::date AND t.end_date >= $2::date
        -- Drivers are linked to classes for transport, not teaching.
        AND NOT EXISTS (SELECT 1 FROM users d WHERE d.user_id = $4 AND d.account_type = 'Driver')
        AND (
          EXISTS (SELECT 1 FROM user_subjects us WHERE us.user_id = $4 AND us.subject_id = e.subject_id)
          OR EXISTS (SELECT 1 FROM user_classes uc WHERE uc.user_id = $4 AND uc.class_id = cs.class_id AND uc.main)
          OR (EXISTS (SELECT 1 FROM user_classes uc WHERE uc.user_id = $4 AND uc.class_id = cs.class_id)
              AND NOT EXISTS (SELECT 1 FROM user_subjects us JOIN subjects x ON x.subject_id = us.subject_id
                               WHERE us.user_id = $4 AND x.class_id = cs.class_id))
        )
      ORDER BY e.start_time`,
    [organizationId, start, end, userId]
  );
  if (!rows.length) return [];

  const lastDay = addDays(end, -1);
  const terms = new Map();
  rows.forEach((r) => { if (!terms.has(r.term_id)) terms.set(r.term_id, r); });
  const closedByTerm = new Map();
  await Promise.all([...terms.values()].map(async (t) => {
    const from = t.term_start > start ? t.term_start : start;
    const to = t.term_end < lastDay ? t.term_end : lastDay;
    closedByTerm.set(t.term_id, await closedDays(db, organizationId, t.term_id, from, to).catch(() => new Map()));
  }));

  const items = [];
  rows.forEach((r) => {
    const from = r.term_start > start ? r.term_start : start;
    const to = r.term_end < lastDay ? r.term_end : lastDay;
    const closed = closedByTerm.get(r.term_id);
    for (let day = from, n = 0; day <= to && n < MAX_DAYS; day = addDays(day, 1), n++) {
      const isoDay = new Date(`${day}T00:00:00Z`).getUTCDay() || 7; // 1 = Monday … 7 = Sunday
      if (isoDay !== Number(r.day_of_week) || closed.has(day)) continue;
      const subject = r.subject_name || r.custom_label || "Lesson";
      items.push({
        id: `lesson-${r.entry_id}-${day}`,
        title: `${subject} · ${r.class_name}`,
        start: `${day}T${r.start_time}`,
        end: `${day}T${r.end_time}`,
        allDay: false,
        editable: false,
        classNames: ["cal-ev", "cal-ev--lesson"],
        extendedProps: {
          kind: "lesson", layer: "lesson", recordId: `${r.entry_id}-${day}`,
          subject, classId: r.class_id, className: r.class_name, term: r.term_name,
          details: `${r.class_name} · ${r.term_name}`, location: r.class_name,
          date: day, endDate: day, startTime: r.start_time, endTime: r.end_time,
        },
      });
    }
  });
  return items;
}

module.exports = { lessonItems };
