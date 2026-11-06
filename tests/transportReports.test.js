const test = require("node:test");
const assert = require("node:assert/strict");
const { REPORT_TYPES, normalizeReport, expandReport, normalizeArrivals, reviewReport, answerArrival, ReportError } = require("../utils/transportReports");
const liveBus = require("../utils/liveBus");
const { effectivePermissionsForRole, isDriverPermission, permissionOptionsFor } = require("../middleware/permissionMiddleware");
const { workspaceAccess } = require("../utils/workspaceAccess");

test("each line needs a real type and an issue of that type", () => {
  assert.throws(() => normalizeReport({ issues: [] }), /about/);
  assert.throws(() => normalizeReport({ issues: [{ category: "nonsense", issue: "Other" }] }), ReportError);
  assert.throws(() => normalizeReport({ issues: [{ category: "bus", issue: "Fighting" }] }), ReportError, "an issue from another type");
  assert.throws(() => normalizeReport({ issues: [{ category: "arrival", issue: "Other" }] }), ReportError, "arrival reports only come from the arrival check");
  assert.throws(() => normalizeReport({ issues: [{ category: "bus", issue: "Other" }] }), /describe/, "Other needs words");
  assert.throws(() => normalizeReport({ issues: [{ category: "student", issue: "Fighting" }] }), /student/, "a student issue needs a student");
  assert.equal(normalizeReport({ issues: [{ category: "bus", issue: "Flat tire" }], priority: "anything" }).priority, "normal");
});

test("several students get one report each, so sharing with a family shows only their child", () => {
  const report = normalizeReport({
    issues: [{ category: "student", issue: "Fighting" }, { category: "student", issue: "Sick or injured" }, { category: "bus", issue: "Flat tire" }, { category: "bus", issue: "Flat tire" }],
    studentIds: [5, 6, "6", "x"],
    priority: "urgent",
    details: " On the way home ",
  });
  assert.deepEqual(report.studentIds, [5, 6]);
  assert.equal(report.details, "On the way home");
  const rows = expandReport(report);
  assert.deepEqual(rows, [
    { category: "student", issue: "Fighting, Sick or injured", studentId: 5 },
    { category: "student", issue: "Fighting, Sick or injured", studentId: 6 },
    { category: "bus", issue: "Flat tire", studentId: null },
  ]);
});

test("students chosen for a bus-only report are ignored", () => {
  assert.deepEqual(normalizeReport({ issues: [{ category: "bus", issue: "Breakdown" }], studentIds: [5] }).studentIds, []);
});

test("every issue list ends with Other, and there are real choices", () => {
  Object.values(REPORT_TYPES).forEach((type) => assert.equal(type.issues[type.issues.length - 1], "Other"));
  ["Fighting", "Sick or injured", "Bullying"].forEach((issue) => assert.ok(REPORT_TYPES.student.issues.includes(issue), issue));
});

test("a parent can only answer for their own child, once", async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(answerArrival(db, 63, 9, { guardianId: 1, studentIds: [2] }, true), (error) => error.status === 409);
});

test("anyone who didn't arrive needs a reason; those who did don't", () => {
  assert.throws(() => normalizeArrivals([{ studentId: 1, arrived: false }]), /reason/);
  assert.throws(() => normalizeArrivals([{ studentId: 1, arrived: false, reason: "made-up" }]), /reason/);
  assert.throws(() => normalizeArrivals([{ studentId: 1, arrived: true }, { studentId: 1, arrived: true }]), ReportError, "one answer per student");
  assert.deepEqual(normalizeArrivals([{ studentId: 1, arrived: true, reason: "absent", note: "x" }])[0], { studentId: 1, arrived: true, reason: null, note: null });
  assert.equal(normalizeArrivals([{ studentId: 2, arrived: false, reason: "parent", note: "Mum came" }])[0].reason, "parent");
});

test("a report of another school can't be reviewed", async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(reviewReport(db, 63, 5, { userId: 1, name: "Lead" }, {}), (error) => error.status === 404);
});

test("a driver only ever holds driving and transportation permissions", () => {
  assert.deepEqual(effectivePermissionsForRole("Driver", ["manage_students", "paygira_bills"]), []);
  const lead = effectivePermissionsForRole("Driver", ["driver_lead", "manage_transportation", "transport_drivers", "transport_reports", "manage_employees"]);
  assert.deepEqual(lead.sort(), ["driver_lead", "manage_transportation", "transport_drivers", "transport_reports"].sort());
  assert.equal(isDriverPermission("students_delete"), false);
  assert.equal(isDriverPermission("transport_student_routes"), true);
  assert.deepEqual(effectivePermissionsForRole("Driver", ["transport_drivers"]), [], "a follow-up counts only with Transportation on");
});

test("Lead Driver opens Management with only Transportation, and each power is separate", () => {
  const access = workspaceAccess({ permissions: ["driver_lead", "manage_transportation", "transport_drivers"], features: [], role: "Driver" });
  assert.equal(access.management.any, true);
  assert.equal(access.management.transportation, true);
  assert.equal(access.management.employees, false);
  assert.equal(access.transport.drivers, true);
  assert.equal(access.transport.riderList, false);
  assert.equal(access.transport.reports, false);
  const plain = workspaceAccess({ permissions: [], features: [], role: "Driver" });
  assert.equal(plain.management.any, false, "an ordinary driver sees no Management");
});

test("driver permissions disappear when the school has no transportation", () => {
  const off = permissionOptionsFor({ transportActivated: false }).map((option) => option.key);
  assert.ok(!off.includes("driver_lead"));
  const on = permissionOptionsFor({ transportActivated: true }).map((option) => option.key);
  ["driver_lead", "driver_student_details", "driver_any_route", "transport_reports", "transport_student_routes"].forEach((key) => assert.ok(on.includes(key), key));
});

test("while a driver's phone is silent, the bus keeps moving along its road, marked as estimated", async () => {
  const line = liveBus.buildLine([[0, 0], [0, 0.01], [0, 0.02]], 300);
  assert.ok(line.length > 2000 && line.metresPerSecond >= 4 && line.metresPerSecond <= 17);
  const spot = liveBus.advanceAlong(line, 0, 0.0001, 500);
  assert.ok(spot.lng > 0.004 && spot.lng < 0.0055, "about 500 m along");
  assert.ok(Math.abs(spot.heading - 90) < 1, "facing along the road");
  assert.equal(liveBus.advanceAlong(line, 0, 0, 99999).atEnd, true, "stops at the end of the route");

  const silent = { trip_id: 9001, route_id: 1, bus_id: 7, latitude: 0, longitude: 0.0001, recorded_at: new Date(Date.now() - 60000) };
  const fresh = { trip_id: 9002, route_id: 1, bus_id: 8, latitude: 0, longitude: 0.0001, recorded_at: new Date() };
  liveBus._setRouteLine(9001, line);
  liveBus._setRouteLine(9002, line);
  const db = { query: async () => ({ rows: [silent, fresh] }) };
  const org = 777777;
  const estimated = await liveBus.liveForStudent(db, org, 7, 1);
  assert.equal(estimated.estimated, true);
  assert.ok(estimated.longitude > 0.0001, "moved on from the last GPS position");
  assert.ok(Date.now() - new Date(estimated.recorded_at).getTime() < 1000, "viewers don't treat it as lost");
  const real = await liveBus.liveForStudent(db, org, 8, 1);
  assert.equal(real.estimated, undefined, "a working phone is never estimated");
  assert.equal(real.longitude, 0.0001);
});
