const test = require("node:test");
const assert = require("node:assert/strict");
process.env.SETTINGS_ENCRYPTION_KEY = process.env.SETTINGS_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { lockSecret, openSecret, zoned, buildIcs } = require("../utils/calendarSync");
const { linksFor } = require("../utils/familyCalendar");

test("sign-ins and secret links are stored locked, and older plain ones still open", () => {
  const locked = lockSecret("refresh-token-value");
  assert.ok(locked.startsWith("enc1:"));
  assert.ok(!locked.includes("refresh-token-value"));
  assert.equal(openSecret(locked), "refresh-token-value");
  assert.equal(openSecret("old-plain-token"), "old-plain-token");
  assert.equal(lockSecret(locked), locked, "never locked twice");
  assert.equal(lockSecret(null), null);
  assert.equal(openSecret(null), null);
});

test("a time is shown in the person's own zone, not the server's", () => {
  const moment = new Date("2026-11-09T14:00:00Z");
  assert.deepEqual(zoned(moment, "America/New_York"), { day: "2026-11-09", time: "09:00" });
  assert.deepEqual(zoned(moment, "Asia/Tokyo"), { day: "2026-11-09", time: "23:00" });
  assert.deepEqual(zoned(new Date("2026-11-09T03:30:00Z"), "America/Los_Angeles"), { day: "2026-11-08", time: "19:30" });
  assert.deepEqual(zoned(moment, "Not/AZone"), { day: "2026-11-09", time: "14:00" }, "a bad zone falls back");
});

test("a calendar file is valid, even with long lines in other alphabets", () => {
  const text = buildIcs([{ uid: "a", title: "Réunion des parents, école 日本語 ".repeat(8), date: "2026-11-09", allDay: true }], { name: "School", host: "x" });
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /END:VCALENDAR\r\n$/);
  text.split("\r\n").forEach((line) => assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${Buffer.byteLength(line)}`));
  assert.ok(!text.includes("�"));
  const joined = text.replace(/\r\n /g, "");
  assert.ok(joined.includes("日本語"), "folding never splits a character");
});

test("the add-to-calendar links carry the private link and nothing else", () => {
  const links = linksFor("https://managira.com", "a".repeat(48), "Rose's School calendar");
  assert.equal(links.link, `https://managira.com/calendar/family/${"a".repeat(48)}.ics`);
  assert.equal(links.apple, `webcal://managira.com/calendar/family/${"a".repeat(48)}.ics`);
  assert.ok(links.google.startsWith("https://calendar.google.com/"));
  assert.ok(links.outlook.startsWith("https://outlook.office.com/calendar/0/addfromweb?url="));
  assert.ok(links.outlookPersonal.startsWith("https://outlook.live.com/calendar/0/addfromweb?url="));
});
