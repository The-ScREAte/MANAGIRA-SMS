const test = require("node:test");
const assert = require("node:assert/strict");
const { REPORT_TYPES, normalizeReport, expandReport, normalizeArrivals, reviewReport, answerArrival, ReportError } = require("../utils/transportReports");
const liveBus = require("../utils/liveBus");
const transportReports = require("../utils/transportReports");
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
  const lead = effectivePermissionsForRole("Driver", ["driver_lead", "manage_transportation", "transport_drivers", "transport_reports", "manage_students"]);
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

test("saving arrivals takes the same few queries however many students are on the bus", async () => {
  const run = async (count) => {
    let queries = 0;
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const db = {
      connect: () => { throw new Error("no held connection, no transaction round trips"); },
      query: async (sql) => {
        queries += 1;
        if (/FROM students/.test(sql)) return { rows: ids.map((student_id) => ({ student_id })) };
        if (/transportation_parent_confirm_arrival/.test(sql)) return { rows: [{ ask: true }] };
        return { rows: [{ not_arrived: 1 }] };
      },
    };
    const list = ids.map((studentId, i) => (i === 0 ? { studentId, arrived: false, reason: "absent" } : { studentId, arrived: true }));
    const result = await transportReports.saveArrivals(db, 63, { userId: 5, name: "John" }, { trip_id: 1, bus_id: 2, route_id: 3 }, list);
    assert.equal(result.saved, count);
    assert.equal(result.notArrived, 1);
    return queries;
  };
  assert.equal(await run(3), 3);
  assert.equal(await run(300), 3);
});

test("an estimate stays honest: it pauses at stops, and a bus off its route stays where it was seen", async () => {
  const stops = [[0, 0.005], [0, 0.01]];
  const line = liveBus.buildLine([[0, 0], [0, 0.01], [0, 0.02]], 300, stops);
  assert.equal(line.stopsAlong.length, 2);
  const speed = line.metresPerSecond;
  const firstStop = line.stopsAlong[0];
  assert.ok(Math.abs(liveBus.alongAfter(line, firstStop - 100, 100 / speed + 10) - firstStop) < 1, "still at the stop 10 s after reaching it");
  assert.ok(liveBus.alongAfter(line, firstStop - 100, 100 / speed + 40) > firstStop, "moves on after its pause");
  const plain = liveBus.buildLine([[0, 0], [0, 0.01], [0, 0.02]], 300);
  assert.ok(liveBus.alongAfter(line, 0, 200) < liveBus.alongAfter(plain, 0, 200), "stops slow it down");

  const away = { trip_id: 9101, route_id: 1, bus_id: 17, latitude: 0.05, longitude: 0.0001, recorded_at: new Date(Date.now() - 120000) };
  const onIt = { trip_id: 9102, route_id: 1, bus_id: 18, latitude: 0, longitude: 0.0001, recorded_at: new Date(Date.now() - 120000) };
  const brief = { trip_id: 9103, route_id: 1, bus_id: 19, latitude: 0, longitude: 0.0001, recorded_at: new Date(Date.now() - 30000) };
  [away, onIt, brief].forEach((trip) => liveBus._setRouteLine(trip.trip_id, line));
  const db = { query: async () => ({ rows: [away, onIt, brief] }) };
  const org = 777778;
  const lost = await liveBus.liveForStudent(db, org, 17, 1);
  assert.equal(lost.estimated, undefined, "off its route: no guessing");
  assert.equal(lost.latitude, 0.05);
  const moving = await liveBus.liveForStudent(db, org, 18, 1);
  assert.equal(moving.estimated, true);
  assert.ok(moving.last_gps_at, "viewers can see how old the real position is");
  const shortGap = await liveBus.liveForStudent(db, org, 19, 1);
  assert.equal(shortGap.estimated, undefined, "a short gap in signal isn't a reason to guess");
});

test("Users / Employees can only be held by a driver who is a lead", () => {
  assert.deepEqual(effectivePermissionsForRole("Driver", ["manage_employees", "employees_edit"]), [], "not a lead");
  const lead = effectivePermissionsForRole("Driver", ["driver_lead", "manage_employees", "employees_add", "employees_edit"]);
  assert.ok(["manage_employees", "employees_add", "employees_edit"].every((key) => lead.includes(key)));
  assert.deepEqual(effectivePermissionsForRole("Driver", ["driver_lead", "employees_edit"]), ["driver_lead"], "a follow-up needs its main permission");
  const access = workspaceAccess({ permissions: lead, features: [], role: "Driver" });
  assert.equal(access.management.employees, true);
  assert.equal(access.employees.canEdit, true);
  assert.equal(access.employees.canChangeManagers, false);
});

test("teachers get Class Bus Reports by default, drivers can't hold it, and it follows Transportation", () => {
  assert.ok(effectivePermissionsForRole("Teacher", []).includes("transport_class_reports"));
  assert.deepEqual(effectivePermissionsForRole("Driver", ["transport_class_reports"]), []);
  assert.ok(!permissionOptionsFor({ transportActivated: false }).some((option) => option.key === "transport_class_reports"));
  assert.ok(permissionOptionsFor({ transportActivated: true }).some((option) => option.key === "transport_class_reports"));
  assert.equal(workspaceAccess({ permissions: ["transport_class_reports"], features: [], role: "Teacher" }).transport.classReports, true);
  assert.equal(workspaceAccess({ permissions: [], features: [], role: "Teacher" }).transport.classReports, false);
});

test("only a manager changes a manager, and nobody but a manager changes their own account", async () => {
  const { staffChangeRefusal } = require("../utils/staffChangeGuard");
  const db = (accountType) => ({
    query: async (sql) => ({ rows: /account_type/.test(sql) ? [{ account_type: accountType }] : [] }),
  });
  const lead = { session: { organizationId: 777003, userId: 5, userRole: "Driver" } };
  assert.match(await staffChangeRefusal(db("Teacher"), lead, 5), /your own account/);
  assert.match(await staffChangeRefusal(db("Manager"), lead, 6), /Only a manager/);
  assert.equal(await staffChangeRefusal(db("Teacher"), lead, 6), null);
  const manager = { session: { organizationId: 777003, userId: 5, userRole: "Manager" } };
  assert.equal(await staffChangeRefusal(db("Manager"), manager, 5), null);
  const broken = { query: async () => { throw new Error("busy"); } };
  assert.match(await staffChangeRefusal(broken, lead, 6), /try again/, "if it can't check, it refuses");
});

test("Report Builder for a driver: their own rows unless a transportation permission opens everyone's", () => {
  const { REPORTS, allowedBy, ownRowsFor, buildQueries } = require("../utils/reportBuilder");
  assert.deepEqual(effectivePermissionsForRole("Driver", ["driver_report_builder"]).sort(), ["driver_report_builder", "reports_builder"]);
  assert.deepEqual(effectivePermissionsForRole("Driver", ["reports_builder", "manage_reports"]), [], "the school-wide report permissions stay out of reach");

  const driverOnly = new Set(["driver_report_builder", "feature:transport", "feature:transportChecks"]);
  const can = allowedBy(driverOnly);
  assert.ok(can(REPORTS.transport_trips) && can(REPORTS.transport_riders) && can(REPORTS.transport_driver_reports));
  assert.ok(!can(REPORTS.transport_buses_list) && !can(REPORTS.students) && !can(REPORTS.payments));
  assert.ok(!can(REPORTS.transport_riders.columns.home_address), "home address needs its own permission");
  assert.equal(ownRowsFor(REPORTS.transport_trips, driverOnly, 243), 243);
  assert.equal(ownRowsFor(REPORTS.transport_trips, new Set(["manage_transportation"]), 243), null);
  assert.equal(ownRowsFor(REPORTS.transport_trips, driverOnly, null), 0, "no id means no rows, never everyone's");

  const { data } = buildQueries(REPORTS.transport_trips, { columns: ["route"], organizationId: 63, allowedClassIds: [], ownRowsOf: 243 });
  assert.match(data.sql, /t\.driver_user_id = \$2/);
  assert.equal(data.values[1], 243);
  assert.doesNotMatch(data.sql, /1 = 0/, "a transport report isn't limited by the classes someone teaches");
});
