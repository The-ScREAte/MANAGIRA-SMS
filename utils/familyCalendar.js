"use strict";

// The calendar families and students see, and the private link that puts it in their own
// Google, Outlook or Apple calendar. A link only reads: nothing to sign in to and no access
// to anyone's account. It can be replaced at any time, which stops the old one at once.
const crypto = require("crypto");
const { listActivities } = require("./classActivities");
const { classLessonItems } = require("./lessonCalendar");
const { encryptSecret, decryptSecret, isSettingsEncryptionKeyConfigured } = require("./encryption");
const { BoundedMap } = require("./boundedMap");
const { buildIcs } = require("./calendarSync");

const TABLE_MISSING = "42P01";
const FEED_CACHE_MS = 5 * 60 * 1000;
const feedCache = new BoundedMap(2000); // token hash -> { at, text }

const hashOf = (token) => crypto.createHash("sha256").update(token).digest("hex");

async function makeFeed(db, organizationId, ownerKind, ownerId) {
  const token = crypto.randomBytes(24).toString("hex");
  await db.query(
    `INSERT INTO family_calendar_feeds (organization_id, owner_kind, owner_id, token_hash, token_locked)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, owner_kind, owner_id)
     DO UPDATE SET token_hash = EXCLUDED.token_hash, token_locked = EXCLUDED.token_locked, created_at = NOW()`,
    [organizationId, ownerKind, ownerId, hashOf(token), isSettingsEncryptionKeyConfigured() ? encryptSecret(token) : null]
  );
  return token;
}

async function feedToken(db, organizationId, ownerKind, ownerId) {
  const { rows } = await db.query(
    "SELECT token_locked FROM family_calendar_feeds WHERE organization_id = $1 AND owner_kind = $2 AND owner_id = $3",
    [organizationId, ownerKind, ownerId]
  );
  const known = rows[0] && rows[0].token_locked ? decryptSecret(rows[0].token_locked) : "";
  return known || makeFeed(db, organizationId, ownerKind, ownerId);
}

async function resetFeed(db, organizationId, ownerKind, ownerId) {
  const { rows } = await db.query(
    "SELECT token_hash FROM family_calendar_feeds WHERE organization_id = $1 AND owner_kind = $2 AND owner_id = $3",
    [organizationId, ownerKind, ownerId]
  );
  if (rows[0]) feedCache.delete(rows[0].token_hash);
  return makeFeed(db, organizationId, ownerKind, ownerId);
}

async function findFeed(db, token) {
  try {
    const { rows } = await db.query(
      `SELECT f.organization_id, f.owner_kind, f.owner_id, f.token_hash, o.organization_name
         FROM family_calendar_feeds f
         JOIN organizations o ON o.organization_id = f.organization_id AND COALESCE(o.deleted, FALSE) = FALSE AND COALESCE(o.on_hold, FALSE) = FALSE
        WHERE f.token_hash = $1`,
      [hashOf(token)]
    );
    return rows[0] || null;
  } catch (error) {
    if (error.code === TABLE_MISSING) return null;
    throw error;
  }
}

// One tap for each calendar app. The link itself is in here, so only its owner is sent it.
function linksFor(baseUrl, token, name) {
  const https = `${String(baseUrl).replace(/\/$/, "")}/calendar/family/${token}.ics`;
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  const label = encodeURIComponent(name || "Managira");
  return {
    link: https,
    google: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${label}`,
    outlookPersonal: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${label}`,
    apple: webcal,
  };
}

// people: [{ id, name, classId }]. Parents and students see the school's public events, their
// own classes' activities and whole-school ones, and their own class timetable.
async function itemsFor(db, organizationId, people, { from, to, withLessons = true }) {
  const classIds = [...new Set(people.map((person) => person.classId).filter(Boolean))].map(Number);
  const everyone = people.map((person) => person.id);
  const [activities, events, lessons] = await Promise.all([
    listActivities(db, organizationId, { classIds, from, to }),
    db.query(
      `SELECT id, name, to_char(event_date, 'YYYY-MM-DD') AS day, to_char(end_date, 'YYYY-MM-DD') AS end_day, start_time, end_time, location, details
         FROM school_events
        WHERE organization_id = $1 AND visibility IN ('public', 'both') AND event_date IS NOT NULL
          AND event_date < $3::date AND COALESCE(end_date, event_date) >= $2::date
        ORDER BY event_date`,
      [organizationId, from, to]
    ),
    withLessons ? classLessonItems(db, { organizationId, classIds, start: from, end: to }).catch(() => []) : [],
  ]);
  const items = activities.map((row) => ({
    id: `activity-${row.id}`,
    kind: "activity",
    title: row.title,
    date: row.date,
    endDate: row.endDate,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    details: row.details,
    studentIds: row.classId === null ? everyone : people.filter((person) => Number(person.classId) === row.classId).map((person) => person.id),
  }));
  events.rows.forEach((row) => items.push({
    id: `event-${row.id}`,
    kind: "event",
    title: row.name,
    date: row.day,
    endDate: row.end_day,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    location: row.location || "",
    details: row.details || "",
    studentIds: everyone,
  }));
  lessons.forEach((row) => items.push({
    id: `class-${row.entryId}-${row.date}`,
    kind: "class",
    title: row.title,
    date: row.date,
    endDate: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    location: "",
    details: "",
    studentIds: people.filter((person) => Number(person.classId) === row.classId).map((person) => person.id),
  }));
  return items;
}

// The private link's contents. Timetable lessons stay out: they would bury everything else.
async function icsFor(feed, token, loadItems, host) {
  const cached = feedCache.get(feed.token_hash);
  if (cached && Date.now() - cached.at < FEED_CACHE_MS) return cached.text;
  const { items, names } = await loadItems();
  const text = buildIcs(items.filter((item) => item.kind !== "class").map((item) => {
    const who = names.size > 1 && item.studentIds && item.studentIds.length < names.size
      ? item.studentIds.map((id) => names.get(id)).filter(Boolean).join(", ")
      : "";
    return {
      uid: `family-${feed.owner_kind}-${feed.owner_id}-${item.id}`,
      title: who ? `${who}: ${item.title}` : item.title,
      details: item.details,
      location: item.location,
      date: item.date,
      endDate: item.endDate || item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      allDay: !item.startTime,
    };
  }), { name: `${feed.organization_name || "School"} calendar`, host: host || "managira" });
  feedCache.set(feed.token_hash, { at: Date.now(), text });
  return text;
}

module.exports = { feedToken, resetFeed, findFeed, linksFor, itemsFor, icsFor };
