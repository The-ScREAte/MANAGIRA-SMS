// Birthdays as all-day calendar items on /common/calendar, using the same
// visibility rule as the Birthdays page: managers, supervisors, admins and the
// organization see every student; other staff only students in their classes.
// Staff birthdays are visible to every staff member.
const ELEVATED = ["manager", "supervisor", "admin", "mini admin", "organization"];

// Kept briefly: birthdays rarely change and every calendar view asks for them.
const TTL_MS = 2 * 60 * 1000;
const cache = new Map();

function isElevated(role) {
  return ELEVATED.includes(String(role || "").trim().toLowerCase());
}

async function loadPeople(db, organizationId, userId, elevated) {
  const params = [organizationId];
  let classFilter = "";
  if (!elevated) {
    if (!userId) classFilter = " AND 1 = 0";
    else {
      params.push(userId);
      classFilter = " AND s.class_id IN (SELECT uc.class_id FROM user_classes uc WHERE uc.user_id = $2)";
    }
  }
  const [students, staff] = await Promise.all([
    db.query(
      `SELECT s.student_id AS id, s.first_name, s.last_name, to_char(s.date_of_birth, 'YYYY-MM-DD') AS dob, c.class_name AS label
         FROM students s JOIN classes c ON c.class_id = s.class_id
        WHERE s.organization_id = $1 AND s.class_id IS NOT NULL AND s.date_of_birth IS NOT NULL
          AND COALESCE(s.graduated, FALSE) = FALSE${classFilter}`,
      params
    ),
    db.query(
      `SELECT user_id AS id, first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') AS dob, account_type AS label
         FROM users
        WHERE organization_id = $1 AND COALESCE(on_hold, FALSE) = FALSE AND date_of_birth IS NOT NULL`,
      [organizationId]
    ),
  ]);
  return [
    ...students.rows.map((r) => ({ ...r, who: "student" })),
    ...staff.rows.map((r) => ({ ...r, who: "staff" })),
  ];
}

function people(db, organizationId, userId, elevated) {
  const key = `${organizationId}|${elevated ? "all" : userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;
  const list = loadPeople(db, organizationId, userId, elevated);
  cache.set(key, { at: Date.now(), list });
  list.catch(() => cache.delete(key));
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return list;
}

// The day a birthday falls on in a given year (29 Feb → 28 Feb in other years).
function dayIn(year, month, day) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const d = month === 2 && day === 29 && !leap ? 28 : day;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// start inclusive, end exclusive (YYYY-MM-DD), like the calendar feed.
async function birthdayItems(db, { organizationId, userId, role, start, end }) {
  if (!organizationId || !start || !end) return [];
  const list = await people(db, organizationId, userId, isElevated(role));
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const items = [];
  list.forEach((p) => {
    const [by, bm, bd] = p.dob.split("-").map(Number);
    if (!bm || !bd) return;
    for (let y = firstYear; y <= lastYear; y++) {
      const day = dayIn(y, bm, bd);
      if (day < start || day >= end) continue;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Someone";
      const age = by && y - by > 0 && y - by < 120 ? y - by : null;
      items.push({
        id: `birthday-${p.who}-${p.id}-${y}`,
        title: `🎂 ${name}`,
        start: day,
        allDay: true,
        editable: false,
        classNames: ["cal-ev", "cal-ev--birthday"],
        extendedProps: {
          kind: "birthday", layer: "birthday", recordId: `${p.who}-${p.id}`,
          who: p.who, personId: p.id, name, age,
          details: [p.who === "student" ? `Student · ${p.label || ""}` : `Staff · ${p.label || "Staff"}`, age ? `Turns ${age}` : ""].filter(Boolean).join(" · "),
          date: day, endDate: day,
        },
      });
    }
  });
  return items;
}

function clearBirthdayCache(organizationId) {
  for (const k of cache.keys()) if (!organizationId || k.startsWith(`${organizationId}|`)) cache.delete(k);
}

module.exports = { birthdayItems, clearBirthdayCache, isElevated };
