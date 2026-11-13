"use strict";
// At go-live, the lists that fit one of Managira's own features are loaded into it
// (utils/migration/features.js says which): Transportation (buses, drivers, routes, stops, weekly
// schedules, riders and their homes), PayGira (a bill for each kind of fee, each student's share
// and what was paid, meal accounts in debt), the graduates' transcripts and the parents' details.
// The rules are the go-live's: nothing the school already has is replaced (only empty fields are
// filled in), every row written is in the ledger for a rollback, and the lists stay read-only too.
// Nothing is sent to families: these are records and balances, not new bills.
const { pick, timeOf, addMinutes, daysOf, money } = require("./features");

const clean = (v, max = 200) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const isoDay = (value) => {
  const text = clean(value, 40);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
const numberOr = (value) => { const n = Number(String(value == null ? "" : value).replace(/[^0-9.\-]/g, "")); return String(value || "").trim() && Number.isFinite(n) ? n : null; };
const yes = (value) => /^(1|y|yes|true|x)$/i.test(String(value || "").trim());

// Transportation. `rows`: { feature: [{ studentId, row }] }.
async function loadTransport(ctx, rows) {
  const { q, ledger, org, counts, linkOf, extraOn } = ctx;
  const list = (k) => rows[k] || [];
  const kinds = ["bus_fleet", "bus_routes", "bus_routes_stops", "bus_stops", "bus_runs", "bus_riders", "bus_homes", "bus_drivers", "bus_alternates"];
  if (!kinds.some((k) => list(k).length)) return;
  counts.transport = { buses: 0, drivers: 0, routes: 0, stops: 0, schedules: 0, riders: 0, ridersKept: 0, alternates: 0 };
  const t = counts.transport;

  // Fill only what a row of the school's is missing (a rollback puts it back).
  const fillEmpty = async (table, keyCol, id, values) => {
    const cols = Object.keys(values).filter((c) => values[c] !== null && values[c] !== undefined && values[c] !== "");
    if (!cols.length) return;
    const { rows: [live] } = await q(`SELECT ${cols.join(", ")} FROM ${table} WHERE ${keyCol} = $1`, [id]);
    const empty = cols.filter((c) => live && (live[c] === null || live[c] === ""));
    if (!empty.length) return;
    if (!ledger.mine(table, { [keyCol]: id })) await ledger.before(table, { [keyCol]: id }, empty);
    await q(`UPDATE ${table} SET ${empty.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE ${keyCol} = $1`, [id, ...empty.map((c) => values[c])]);
  };

  // Buses: the fleet list, and every bus a route names.
  const buses = new Map((await q("SELECT bus_id, LOWER(bus_number) AS n FROM transport_buses WHERE organization_id = $1", [org])).rows.map((r) => [r.n, r.bus_id]));
  const busFor = async (number, values = {}) => {
    const name = clean(number, 60);
    if (!name) return null;
    let id = buses.get(name.toLowerCase());
    if (!id) {
      ({ rows: [{ bus_id: id }] } = await q(
        "INSERT INTO transport_buses (organization_id, bus_number, status) VALUES ($1, $2, $3) RETURNING bus_id",
        [org, name, values.status || "active"]
      ));
      ledger.made("transport_buses", { bus_id: id });
      buses.set(name.toLowerCase(), id);
      t.buses += 1;
    }
    const { status, ...rest } = values;
    await fillEmpty("transport_buses", "bus_id", id, rest);
    return id;
  };
  for (const { row } of list("bus_fleet")) {
    const model = clean(pick(row, "Make_Model", "Model", "Make"), 120).split(" ");
    const status = /out|retired|inactive|spare/i.test(pick(row, "Status")) ? "out_of_service" : /repair|maint|shop/i.test(pick(row, "Status")) ? "maintenance" : "active";
    await busFor(pick(row, "Bus_Number", "Bus"), {
      license_plate: clean(pick(row, "License_Plate", "Plate"), 40) || null,
      capacity: numberOr(pick(row, "Capacity")),
      vin: clean(pick(row, "Vin"), 40) || null,
      fuel_type: clean(pick(row, "Fuel_Type", "Fuel"), 40) || null,
      vehicle_year: numberOr(pick(row, "Model_Year", "Year")),
      vehicle_make: model.length > 1 ? model.slice(0, -1).join(" ") : model[0] || null,
      vehicle_model: model.length > 1 ? model[model.length - 1] : null,
      status,
    });
  }

  // Routes, each with its bus.
  const routes = new Map();
  const routeBus = new Map();
  const routeDriver = new Map();
  for (const r of (await q("SELECT route_id, LOWER(route_name) AS n, LOWER(COALESCE(route_code, '')) AS c FROM transport_routes WHERE organization_id = $1", [org])).rows) {
    routes.set(r.n, r.route_id);
    if (r.c) routes.set(r.c, r.route_id);
  }
  const routeFor = async (code) => {
    const name = clean(code, 80);
    if (!name) return null;
    let id = routes.get(name.toLowerCase());
    if (!id) {
      ({ rows: [{ route_id: id }] } = await q(
        "INSERT INTO transport_routes (organization_id, route_name, route_code, route_status) VALUES ($1, $2, $3, 'active') RETURNING route_id",
        [org, name, name]
      ));
      ledger.made("transport_routes", { route_id: id });
      routes.set(name.toLowerCase(), id);
      t.routes += 1;
    }
    return id;
  };
  for (const { row } of [...list("bus_routes"), ...list("bus_routes_stops")]) {
    const routeId = await routeFor(pick(row, "Route_ID", "Route"));
    if (!routeId) continue;
    const bus = await busFor(pick(row, "Bus_Number", "Bus"), { capacity: numberOr(pick(row, "Capacity", "Bus_Capacity")) });
    if (bus && !routeBus.has(routeId)) routeBus.set(routeId, bus);
    const driver = clean(pick(row, "Driver_Name", "Driver"), 120);
    if (driver && !routeDriver.has(routeId)) routeDriver.set(routeId, { name: driver, license: clean(pick(row, "Driver_Cdl", "Cdl_Number"), 60) });
  }

  // Drivers: the drivers' list (aides are kept as a record), and each route's driver. One who has
  // a staff account from this migration is linked to it.
  const drivers = new Map((await q("SELECT driver_id, LOWER(driver_name) AS n FROM transport_drivers WHERE organization_id = $1", [org])).rows.map((r) => [r.n, r.driver_id]));
  const driverFor = async (name, values = {}) => {
    const label = clean(name, 120);
    if (!label) return null;
    let id = drivers.get(label.toLowerCase());
    if (!id) {
      ({ rows: [{ driver_id: id }] } = await q(
        "INSERT INTO transport_drivers (organization_id, driver_name, status) VALUES ($1, $2, 'active') RETURNING driver_id",
        [org, label]
      ));
      ledger.made("transport_drivers", { driver_id: id });
      drivers.set(label.toLowerCase(), id);
      t.drivers += 1;
    }
    await fillEmpty("transport_drivers", "driver_id", id, values);
    return id;
  };
  const staffUser = async (number) => (number ? ((await linkOf("staff", number)) || {}).managira_id || null : null);
  const routeOfDriver = new Map();
  for (const { row } of list("bus_drivers")) {
    if (!/driver/i.test(pick(row, "Role", "Position", "Job")) && pick(row, "Role", "Position", "Job")) continue; // aides stay a record
    const routeId = routes.get(clean(pick(row, "Assigned_Route", "Route_ID", "Route"), 80).toLowerCase()) || null;
    const userId = await staffUser(pick(row, "TeacherNumber", "Staff_ID", "Employee_ID"));
    const driverId = await driverFor(pick(row, "Name", "Driver_Name"), {
      license_number: clean(pick(row, "Cdl_Number", "License_Number"), 60) || null,
      assigned_route_id: routeId,
      assigned_bus_id: routeId ? routeBus.get(routeId) || null : null,
      user_id: userId,
    });
    if (routeId) routeOfDriver.set(routeId, driverId);
    if (userId && routeId && routeBus.get(routeId)) await fillEmpty("transport_buses", "bus_id", routeBus.get(routeId), { driver_user_id: userId });
  }
  for (const [routeId, d] of routeDriver) {
    if (routeOfDriver.has(routeId)) continue;
    routeOfDriver.set(routeId, await driverFor(d.name, { license_number: d.license || null, assigned_route_id: routeId, assigned_bus_id: routeBus.get(routeId) || null }));
  }

  // Stops, in order on their route, with their morning and afternoon times.
  const stops = new Map(); // old stop ID → { id, am, pm }
  const stopIds = new Map((await q("SELECT stop_id, route_id, LOWER(stop_name) AS n FROM transport_stops WHERE organization_id = $1", [org])).rows.map((r) => [`${r.route_id}|${r.n}`, r.stop_id]));
  for (const { row } of [...list("bus_stops"), ...list("bus_routes_stops")]) {
    const oldId = clean(pick(row, "Stop_ID", "Stop"), 60);
    if (!oldId || stops.has(oldId)) continue;
    const routeId = await routeFor(pick(row, "Route_ID", "Route"));
    const name = clean(pick(row, "Stop_Location", "Stop_Name", "Location"), 200) || oldId;
    const am = timeOf(pick(row, "Am_Time", "Am_Pickup_Time", "Pickup_Time"));
    const pm = timeOf(pick(row, "Pm_Time", "Pm_Dropoff_Time", "Dropoff_Time"));
    let id = stopIds.get(`${routeId}|${name.toLowerCase()}`);
    const seq = numberOr(pick(row, "Sequence", "Stop_Sequence", "Stop_Order"));
    if (!id) {
      ({ rows: [{ stop_id: id }] } = await q(
        `INSERT INTO transport_stops (organization_id, route_id, stop_name, stop_address, latitude, longitude, pickup_time, dropoff_time, stop_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING stop_id`,
        [org, routeId, name, name, numberOr(pick(row, "Latitude", "Lat")), numberOr(pick(row, "Longitude", "Lng", "Lon")), am, pm, seq || 0]
      ));
      ledger.made("transport_stops", { stop_id: id });
      stopIds.set(`${routeId}|${name.toLowerCase()}`, id);
      t.stops += 1;
    }
    stops.set(oldId, { id, routeId, am, pm, seq, made: ledger.mine("transport_stops", { stop_id: id }) });
  }
  // A stop with no place in the file's order (an alternate-address stop) takes its place on the
  // route by its morning time, when the file's order follows the clock; otherwise it goes last.
  const madeByRoute = new Map();
  for (const st of stops.values()) if (st.made && st.routeId) (madeByRoute.get(st.routeId) || madeByRoute.set(st.routeId, []).get(st.routeId)).push(st);
  for (const list of madeByRoute.values()) {
    if (!list.some((st) => !st.seq)) continue;
    const bySeq = list.filter((st) => st.seq).sort((a, b) => a.seq - b.seq);
    const timed = list.every((st) => st.am);
    const followsClock = timed && bySeq.every((st, i) => i === 0 || bySeq[i - 1].am <= st.am);
    const ordered = followsClock ? [...list].sort((a, b) => (a.am < b.am ? -1 : a.am > b.am ? 1 : (a.seq || 999) - (b.seq || 999))) : [...bySeq, ...list.filter((st) => !st.seq)];
    for (let i = 0; i < ordered.length; i += 1) await q("UPDATE transport_stops SET stop_order = $2 WHERE stop_id = $1", [ordered[i].id, i + 1]);
  }

  // Weekly schedules: each run, on each day it operates, for its bus and the route's driver.
  for (const { row } of list("bus_runs")) {
    const routeId = await routeFor(pick(row, "Route_ID", "Route"));
    const busId = (await busFor(pick(row, "Bus_Number", "Bus"))) || (routeId && routeBus.get(routeId)) || null;
    if (!busId) continue;
    const start = timeOf(pick(row, "Departure_Time", "Start_Time"));
    const end = addMinutes(start, pick(row, "Planned_Minutes", "Minutes")) || timeOf(pick(row, "End_Time", "Arrival_Time"));
    const note = [clean(pick(row, "Run_Type", "Type"), 40), clean(pick(row, "Run_ID", "Run"), 40)].filter(Boolean).join(" run · ");
    for (const day of daysOf(pick(row, "Operates_Days", "Days")) ) {
      const { rowCount } = await q(
        "SELECT 1 FROM transport_bus_schedules WHERE organization_id = $1 AND bus_id = $2 AND COALESCE(route_id, 0) = COALESCE($3::int, 0) AND day_of_week = $4 AND start_time IS NOT DISTINCT FROM $5::time",
        [org, busId, routeId, day, start]
      );
      if (rowCount) continue;
      const { rows: [s] } = await q(
        `INSERT INTO transport_bus_schedules (organization_id, bus_id, driver_id, route_id, day_of_week, start_time, end_time, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8) RETURNING schedule_id`,
        [org, busId, routeId ? routeOfDriver.get(routeId) || null : null, routeId, day, start, end, note || null]
      );
      ledger.made("transport_bus_schedules", { schedule_id: s.schedule_id });
      t.schedules += 1;
    }
  }

  // Homes (address and map point) for each rider.
  const homes = new Map();
  for (const { studentId, row } of list("bus_homes")) {
    if (!studentId) continue;
    const miles = numberOr(pick(row, "Miles_To_School", "Distance_Miles"));
    homes.set(studentId, {
      address: clean(pick(row, "Home_Address", "Address"), 300) || null,
      lat: numberOr(pick(row, "Home_Latitude", "Latitude")), lng: numberOr(pick(row, "Home_Longitude", "Longitude")),
      km: miles === null ? null : Math.round(miles * 1.609344 * 1000) / 1000,
    });
  }

  // Riders: one route and stop each, the morning run's where there are several. A student the
  // school already put on a bus keeps that.
  const riders = new Map();
  const dated = (row) => Object.keys(row).some((k) => /^(enddate|startdate)$/.test(k.toLowerCase().replace(/[^a-z]/g, "")));
  const inDatedList = new Set(list("bus_riders").filter((r) => r.studentId && dated(r.row)).map((r) => r.studentId));
  for (const { studentId, row } of list("bus_riders")) {
    if (!studentId) continue;
    if (inDatedList.has(studentId) && !dated(row)) continue;
    const ended = isoDay(pick(row, "End_Date"));
    if (ended && ended < new Date().toISOString().slice(0, 10)) continue;
    const run = clean(pick(row, "Run_ID", "Run"), 40);
    const had = riders.get(studentId);
    if (had && !(/am|morning/i.test(run) && !/am|morning/i.test(had.run))) continue;
    riders.set(studentId, { row, run });
  }
  for (const [studentId, { row }] of riders) {
    const stop = stops.get(clean(pick(row, "Stop_ID", "Stop"), 60));
    const routeId = (stop && stop.routeId) || (await routeFor(pick(row, "Route_ID", "Route")));
    const busId = (await busFor(pick(row, "Bus_Number", "Bus"))) || (routeId && routeBus.get(routeId)) || null;
    const { rowCount: has } = await q("SELECT 1 FROM transport_student_assignments WHERE organization_id = $1 AND student_id = $2", [org, studentId]);
    if (has) { t.ridersKept += 1; continue; }
    const home = homes.get(studentId) || {};
    const { rows: [a] } = await q(
      `INSERT INTO transport_student_assignments (organization_id, student_id, bus_id, route_id, stop_id, pickup_time, dropoff_time, home_address, home_latitude, home_longitude, distance_km, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE) RETURNING assignment_id`,
      [org, studentId, busId, routeId, stop ? stop.id : null,
        timeOf(pick(row, "Am_Pickup_Time", "Pickup_Time")) || (stop && stop.am) || null, timeOf(pick(row, "Pm_Dropoff_Time", "Dropoff_Time")) || (stop && stop.pm) || null,
        home.address || null, home.lat ?? null, home.lng ?? null, home.km ?? null]
    );
    ledger.made("transport_student_assignments", { assignment_id: a.assignment_id });
    t.riders += 1;
    const card = clean(pick(row, "Rider_Card", "Card"), 60);
    if (card) await extraOn("student", studentId, "Bus rider card", { value: card });
    if (yes(pick(row, "Adult_Required_At_Dropoff"))) await extraOn("student", studentId, "Bus: adult required at drop-off", { value: "Yes" });
    const seat = clean(pick(row, "Seat"), 20);
    if (seat) await extraOn("student", studentId, "Bus seat", { value: seat });
  }

  // Alternate-address days (another parent's home on some days): the other stop is on its route,
  // and the arrangement is on the student's record for staff and drivers' leads.
  for (const { studentId, row } of list("bus_alternates")) {
    if (!studentId) continue;
    const stop = stops.get(clean(pick(row, "Alternate_Stop_ID", "Stop_ID"), 60));
    const days = clean(pick(row, "Alternate_Days", "Days"), 80);
    const who = clean(pick(row, "Contact_Name", "Parent_Name"), 120);
    const where = clean(pick(row, "Alternate_Address", "Address"), 200);
    const text = [`${days || "Some days"}: ${stop ? "stop " + clean(pick(row, "Alternate_Stop_ID", "Stop_ID"), 60) : "another stop"}${where ? ` (${where})` : ""}`,
      who ? `with ${who}` : "", clean(pick(row, "Primary_Days"), 80) ? `usual stop on ${clean(pick(row, "Primary_Days"), 80)}` : "", clean(pick(row, "Basis", "Reason"), 200)].filter(Boolean).join(" · ");
    await extraOn("student", studentId, "Bus on other days", { value: text });
    t.alternates += 1;
  }
}

// PayGira: a bill for each kind of fee, each student's share with what they paid, the payments
// themselves, and meal accounts in debt. Waived fees are cancelled shares.
async function loadPayGira(ctx, rows) {
  const { q, ledger, org, counts, system } = ctx;
  const fees = (rows.fees || []).filter((f) => f.studentId);
  const meals = (rows.meal_balances || []).filter((m) => m.studentId);
  if (!fees.length && !meals.length) return;
  counts.paygira = { bills: 0, charges: 0, paid: 0, payments: 0, mealDebts: 0, mealCredits: 0, owed: 0 };
  const p = counts.paygira;
  const today = new Date().toISOString().slice(0, 10);
  const source = `From ${system === "powerschool" ? "PowerSchool" : "your old system"}`;

  const billFor = async (title, description, amount, due) => {
    const { rows: [had] } = await q("SELECT bill_id FROM finance_bills WHERE organization_id = $1 AND title = $2 AND description = $3 ORDER BY bill_id LIMIT 1", [org, title, description]);
    if (had) return had.bill_id;
    const { rows: [b] } = await q(
      `INSERT INTO finance_bills (organization_id, title, description, amount, bill_type, applies_to, due_date, accepts_card, accepts_cash, accepts_transfer, notify_email, notify_sms, status)
       VALUES ($1, $2, $3, $4, 'one_time', 'students', $5, TRUE, TRUE, TRUE, FALSE, FALSE, 'active') RETURNING bill_id`,
      [org, title.slice(0, 255), description, amount, due]
    );
    ledger.made("finance_bills", { bill_id: b.bill_id });
    p.bills += 1;
    return b.bill_id;
  };
  const shareOf = async (billId, studentId, amount, paid, due, cancelled) => {
    const status = cancelled ? "cancelled" : paid >= amount ? "paid" : paid > 0 ? "partial" : due && due < today ? "overdue" : "pending";
    const { rows: [had] } = await q("SELECT assignment_id FROM finance_bill_assignments WHERE bill_id = $1 AND student_id = $2", [billId, studentId]);
    if (had) {
      if (!ledger.mine("finance_bill_assignments", { assignment_id: had.assignment_id })) return had.assignment_id; // the school's own: kept
      await q("UPDATE finance_bill_assignments SET amount = amount + $2, amount_paid = amount_paid + $3, status = $4, updated_at = NOW() WHERE assignment_id = $1", [had.assignment_id, amount, paid, status]);
      return had.assignment_id;
    }
    const { rows: [a] } = await q(
      "INSERT INTO finance_bill_assignments (bill_id, organization_id, student_id, amount, amount_paid, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING assignment_id",
      [billId, org, studentId, amount, paid, status]
    );
    ledger.made("finance_bill_assignments", { assignment_id: a.assignment_id });
    p.charges += 1;
    if (!cancelled) p.owed += Math.max(0, amount - paid);
    return a.assignment_id;
  };

  // Fees, grouped by what they're for.
  const kinds = new Map();
  for (const f of fees) {
    const title = clean(pick(f.row, "Description", "Fee_Name", "Fee_Code"), 200) || "Fee";
    const code = clean(pick(f.row, "Fee_Code", "Code"), 40);
    const k = `${title}|${code}`;
    if (!kinds.has(k)) kinds.set(k, { title, code, list: [] });
    kinds.get(k).list.push(f);
  }
  const shareOfFee = new Map(); // old fee ID → { assignmentId, billId, studentId }
  for (const kind of kinds.values()) {
    const amounts = kind.list.map((f) => money(pick(f.row, "Amount", "Fee_Amount")) || 0);
    const usual = amounts.sort((a, b) => amounts.filter((x) => x === b).length - amounts.filter((x) => x === a).length)[0] || 0;
    const dues = kind.list.map((f) => isoDay(pick(f.row, "Due_Date"))).filter(Boolean).sort();
    const billId = await billFor(kind.title, `${source}${kind.code ? ` (fee ${kind.code})` : ""}. Each student's share and what they paid came with the migration.`, usual, dues[0] || null);
    await q("UPDATE finance_bills SET target_student_ids = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(target_student_ids, '{}'::int[]) || $2::int[]))) WHERE bill_id = $1", [billId, kind.list.map((f) => f.studentId)]);
    for (const f of kind.list) {
      const amount = money(pick(f.row, "Amount", "Fee_Amount")) || 0;
      const balance = money(pick(f.row, "Balance"));
      const paid = money(pick(f.row, "Amount_Paid", "Paid")) ?? (balance !== null ? Math.max(0, amount - balance) : 0);
      const cancelled = /waiv|void|cancel/i.test(pick(f.row, "Status")) || Boolean(pick(f.row, "Waiver_Reason"));
      const assignmentId = await shareOf(billId, f.studentId, amount, Math.min(paid, amount), isoDay(pick(f.row, "Due_Date")), cancelled);
      p.paid += Math.min(paid, amount);
      const feeId = clean(pick(f.row, "Fee_ID"), 60);
      if (feeId) shareOfFee.set(feeId, { assignmentId, billId, studentId: f.studentId });
    }
  }

  // Payments against those fees, as received (method, reference, date).
  const METHOD = (m) => (/cash/i.test(m) ? "cash" : /check|cheque/i.test(m) ? "cheque" : /ach|bank|transfer|wire|eft/i.test(m) ? "bank_transfer" : "other");
  for (const pay of rows.fee_payments || []) {
    const share = shareOfFee.get(clean(pick(pay.row, "Fee_ID"), 60));
    const amount = money(pick(pay.row, "Amount"));
    if (!share || !amount || amount <= 0) continue;
    const ref = clean(pick(pay.row, "Reference", "Payment_ID"), 255);
    const { rowCount: had } = await q("SELECT 1 FROM finance_payments WHERE organization_id = $1 AND assignment_id = $2 AND reference IS NOT DISTINCT FROM $3 AND amount = $4", [org, share.assignmentId, ref || null, amount]);
    if (had) continue;
    const method = clean(pick(pay.row, "Payment_Method", "Method"), 40);
    const { rows: [row] } = await q(
      `INSERT INTO finance_payments (organization_id, assignment_id, bill_id, student_id, amount, method, reference, notes, received_at, platform_fee_percentage, platform_fee_amount, tax_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, NOW()), 0, 0, 0) RETURNING payment_id`,
      [org, share.assignmentId, share.billId, share.studentId, amount, METHOD(method), ref || null,
        [`${source}${method ? ` (${method})` : ""}`, clean(pick(pay.row, "Received_By"), 120) ? `received by ${clean(pick(pay.row, "Received_By"), 120)}` : ""].filter(Boolean).join(", "), isoDay(pick(pay.row, "Payment_Date", "Date"))]
    );
    ledger.made("finance_payments", { payment_id: row.payment_id });
    p.payments += 1;
  }

  // Meal accounts: what's owed becomes a bill; money in credit stays with the school's meal service.
  const debts = meals.map((m) => ({ ...m, balance: money(pick(m.row, "Current_Balance", "Balance")) })).filter((m) => m.balance !== null);
  p.mealCredits = debts.filter((m) => m.balance > 0).length;
  const owed = debts.filter((m) => m.balance < 0);
  if (owed.length) {
    const billId = await billFor("Meal account balance", `${source}: what each student's meal account owed when the school moved to Managira.`, 0, null);
    await q("UPDATE finance_bills SET target_student_ids = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(target_student_ids, '{}'::int[]) || $2::int[]))) WHERE bill_id = $1", [billId, owed.map((m) => m.studentId)]);
    for (const m of owed) { await shareOf(billId, m.studentId, Math.round(-m.balance * 100) / 100, 0, null, false); p.mealDebts += 1; }
  }
  p.owed = Math.round(p.owed * 100) / 100;
  p.paid = Math.round(p.paid * 100) / 100;
}

// The graduates' transcripts, on each graduate's academic record.
function transcriptRows(rows, studentIdOf) {
  const out = [];
  for (const { studentId, row } of rows.graduate_transcripts || []) {
    if (!studentId) continue;
    const course = clean(pick(row, "Course_Name", "Course"), 200);
    if (!course) continue;
    const gpa = numberOr(pick(row, "GPA_Points"));
    const weighted = numberOr(pick(row, "Weighted_GPA_Points"));
    out.push([studentId, clean(pick(row, "School_Year", "Year"), 20), clean(pick(row, "Term"), 40), clean(pick(row, "Grade_Level"), 20) || null, clean(pick(row, "Course_Number"), 40) || null,
      course, clean(pick(row, "Letter_Grade", "Grade"), 10) || null, numberOr(pick(row, "Percent")), gpa, numberOr(pick(row, "Credits_Attempted")), numberOr(pick(row, "Credits_Earned", "Credits")),
      null, gpa !== null && weighted !== null && weighted > gpa ? Math.round((weighted - gpa) * 100) / 100 : null]);
  }
  return out;
}

module.exports = { loadTransport, loadPayGira, transcriptRows, isoDay, numberOr };
