"use strict";
// What a list beyond the core ones can become in Managira's own features at go-live (it's kept
// read-only as well, so nothing is lost): graduates under Graduates & Alumni with their transcripts,
// buses, drivers, routes, stops, schedules and riders in Transportation, fees and payments in
// PayGira, a parent master list filling each parent's profile. Recognised by the list's columns
// (its name only settles look-alikes) at import, so the school sees where each list goes before
// it signs.

const key = (h) => String(h || "").toLowerCase().replace(/^\[[^\]]*\]/, "").replace(/[^a-z0-9]/g, "");

const FEATURES = {
  graduates: { label: "Graduates & Alumni", into: "Students › Graduates & Alumni: each graduate as a former student, searchable by name" },
  graduate_transcripts: { label: "Graduates' transcripts", into: "Each graduate's academic record and transcript" },
  bus_routes_stops: { label: "Transportation: routes and stops", into: "Transportation › Routes, stops and buses" },
  bus_routes: { label: "Transportation: routes", into: "Transportation › Routes, with their bus and driver" },
  bus_stops: { label: "Transportation: stops", into: "Transportation › Stops, in order on each route, with their times" },
  bus_runs: { label: "Transportation: bus schedules", into: "Transportation › each bus's weekly schedule" },
  bus_riders: { label: "Transportation: riders", into: "Transportation › each rider's route, stop and times" },
  bus_alternates: { label: "Transportation: alternate addresses", into: "Transportation › riders' other stop on the days they live elsewhere" },
  bus_homes: { label: "Transportation: home addresses", into: "Transportation › each rider's home address and map point" },
  bus_drivers: { label: "Transportation: drivers", into: "Transportation › Drivers, with their licence" },
  bus_fleet: { label: "Transportation: buses", into: "Transportation › Buses (plate, VIN, capacity, fuel)" },
  fees: { label: "PayGira: fees", into: "PayGira › a bill for each fee, on each student's ledger" },
  fee_payments: { label: "PayGira: payments", into: "PayGira › payments against those bills" },
  meal_balances: { label: "Meal balances", into: "Your choice below: they stay in your meal app, or move into PayGira (amounts owed as bills, money in credit as each student's credit)" },
  parents_master: { label: "Parents' details", into: "Parents & guardians › each parent's phone, email and address" },
};

// The feature a list loads into, or null (kept read-only only).
function featureOf(fileName, header) {
  const cols = new Set((header || []).map(key));
  const has = (...names) => names.some((n) => cols.has(n));
  const name = String(fileName || "").toLowerCase().split(/[›/\\]/).pop();
  // A student's number, as each system names it (Skyward's Other ID, Blackbaud's User ID, Veracross's person_id…).
  const student = [...cols].some((c) => require("./lists").STUDENT_KEYS.includes(c));
  // How each system names a route, a bus, a stop and its place in the route.
  const route = has("routeid", "route", "routenumber", "routeno", "routename", "amroute");
  const bus = has("busnumber", "bus", "busno", "busid", "vehiclenumber", "vehicle");
  const stop = has("stopid", "stop", "stopnumber", "stopcode", "amstop");
  const seq = has("sequence", "stopsequence", "stoporder", "seq", "stopseq");
  if (/summary|totals|report_?card/.test(name)) return null; // a summary of a feature isn't its data
  // A log of what happened (scans, services, trips, arrivals) is history: kept read-only.
  const log = [...cols].some((c) => /^(date|event|eventtype|scantime|scandate|servicedate|servicetype|odometer|timestamp|recordedat|arrivaltime|logdate|tripdate|changedate)$/.test(c));
  if (log && !/graduat|alumni/.test(name)) return null;
  if (student && has("graduationyear", "graduationdate") && has("diplomatype", "finalgpaunweighted", "finalgpaweighted", "graduationdate") && has("lastname", "firstname")) return "graduates";
  if (student && /alumni|graduate/.test(name) && has("coursename") && has("lettergrade", "grade", "percent")) return "graduate_transcripts";
  if (!student && has("runid") && route) return "bus_runs";
  if (!student && route && stop && bus) return "bus_routes_stops";
  if (!student && route && stop && seq) return "bus_stops";
  if (!student && route && bus && /bus|route|transport|fleet/.test(name)) return "bus_routes";
  if (student && has("alternateaddress", "alternatestopid") && !/dismissal|emergency|closure|weather/.test(name)) return "bus_alternates";
  if (student && route && stop) return "bus_riders";
  if (student && has("homeaddress") && has("homelatitude", "homelat") && /transport|eligib|bus/.test(name)) return "bus_homes";
  if (!student && has("cdlnumber", "drivercdl", "licensenumber") && has("name", "drivername") && /driver/.test(name)) return "bus_drivers";
  if (!student && has("busnumber") && has("vin", "licenseplate")) return "bus_fleet";
  if (student && has("feeid", "feecode", "feetype") && has("amount", "feeamount") && !has("paymentid")) return "fees";
  if (has("paymentid") && has("feeid") && has("amount")) return "fee_payments";
  if (student && has("currentbalance", "balance", "accountbalance", "mealbalance") && /meal|cafeteria|lunch|food/.test(name) && !/transaction|history|notification|iou|claim|(^|_)counts?(_|\.|$)/.test(name)) return "meal_balances";
  if (!student && has("contactid") && has("firstname", "lastname") && has("primaryemail", "email", "mobilephone", "homephone")) return "parents_master";
  return null;
}

// "07:05" or "7:05 AM" → "07:05" (null when it isn't a time).
function timeOf(value) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(String(value || ""));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) { const pm = /^p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
const addMinutes = (time, minutes) => {
  const t = timeOf(time);
  const n = Number(minutes);
  if (!t || !Number.isFinite(n)) return null;
  const total = (Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + Math.round(n)) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

// "Mon-Fri", "Mon, Tue, Wed", "Thu, Fri", "M W F", "Daily" → ["monday", …].
const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
function daysOf(value) {
  const text = String(value || "").toLowerCase().trim();
  if (!text) return [];
  if (/daily|every\s*day|school\s*days|weekdays/.test(text)) return DAY_NAMES.slice(0, 5);
  const at = (word) => DAY_NAMES.findIndex((d) => d.startsWith(word.slice(0, 2)) || (word.length === 1 && d[0] === word && "mwf".includes(word)));
  const range = /^([a-z]+)\s*[-–to]+\s*([a-z]+)$/.exec(text.replace(/\s+/g, " "));
  if (range) {
    const [a, b] = [at(range[1]), at(range[2])];
    if (a >= 0 && b >= a) return DAY_NAMES.slice(a, b + 1);
  }
  const out = [];
  for (const word of text.split(/[^a-z]+/).filter(Boolean)) {
    if (/^th/.test(word)) { out.push("thursday"); continue; }
    if (/^tu/.test(word)) { out.push("tuesday"); continue; }
    if (/^sa/.test(word)) { out.push("saturday"); continue; }
    if (/^su/.test(word)) { out.push("sunday"); continue; }
    const i = at(word);
    if (i >= 0) out.push(DAY_NAMES[i]);
  }
  return [...new Set(out)];
}

const money = (value) => {
  const n = Number(String(value == null ? "" : value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
// The value of the first of these columns (in the order named) a row has.
function pick(row, ...names) {
  const byKey = new Map(Object.entries(row || {}).map(([k, v]) => [key(k), v]));
  for (const name of names) {
    const v = byKey.get(key(name));
    if (v !== "" && v != null) return String(v).trim();
  }
  return "";
}

module.exports = { FEATURES, featureOf, timeOf, addMinutes, daysOf, money, pick, key };
