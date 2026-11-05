const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { ensureTransportationSchema } = require('../utils/transportation');
const { geocodeAddress } = require('../utils/geocode');
const { userHasPermission, PERMISSIONS } = require('../middleware/permissionMiddleware');
const { addressSchema, requestSchema, pickupSchema, rankStops, canAccessStudent } = require('../utils/transportRequests');
const lookups = new NodeCache({ stdTTL: 600, maxKeys: 300, useClones: false });
let ready;
async function ensure(db) {
  if (!ready) ready = (async () => {
    await ensureTransportationSchema(db);
    await db.query(fs.readFileSync(path.join(__dirname, '../database/migrations/transport_requests.sql'), 'utf8'));
  })().catch(error => { ready = null; throw error; });
  return ready;
}
async function locate(db, org, address) {
  const key = `${org}:${address.toLowerCase()}`;
  const cached = lookups.get(key);
  if (cached) return cached;
  const meta = await db.query('SELECT organization_province, organization_country FROM organizations WHERE organization_id=$1', [org]);
  const point = await geocodeAddress(address, meta.rows[0]?.organization_province, meta.rows[0]?.organization_country);
  if (!point) throw Object.assign(new Error('Address not found. Include the street, city and country.'), { status: 422 });
  if (lookups.keys().length >= 300) lookups.del(lookups.keys()[0]);
  lookups.set(key, point);
  return point;
}
async function schoolStop(db, org, stopId) {
  const result = await db.query(`SELECT st.*, r.route_name FROM transport_stops st
    JOIN transport_routes r ON r.route_id=st.route_id AND r.organization_id=st.organization_id
    WHERE st.organization_id=$1 AND st.stop_id=$2 AND r.route_status='active'`, [org, stopId]);
  if (!result.rows[0]) throw Object.assign(new Error('Choose an active school route and stop.'), { status: 400 });
  return result.rows[0];
}
async function guard(db, req, studentId) {
  if (!await canAccessStudent(db, req.session, studentId)) throw Object.assign(new Error('Student unavailable.'), { status: 403 });
}
async function management(db, req) {
  const s = req.session;
  const allowed = await userHasPermission(db, {
    organizationId: s.organizationId, userId: s.user?.user_id || s.userId,
    userRole: s.userRole || s.user?.account_type, accountType: s.accountType, userEmail: s.user?.email,
  }, PERMISSIONS.MANAGE_STUDENTS);
  if (!allowed) throw Object.assign(new Error('Transportation access required.'), { status: 403 });
}
function endpoint(handler) {
  return async (req, res, db) => {
    try {
      if (!req.session?.organizationId) return res.status(401).json({ ok: false, message: 'Please sign in.' });
      await ensure(db);
      res.set('Cache-Control', 'no-store');
      return await handler(req, res, db);
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : error.status || (error.code === '23505' ? 409 : 500);
      if (status === 500) console.error('[Transportation requests]', error.message);
      return res.status(status).json({ ok: false, message: error instanceof z.ZodError ? error.issues[0].message :
        error.code === '23505' ? 'This student already has a pending request.' : status === 500 ? 'Unable to save transportation changes. Please try again.' : error.message });
    }
  };
}
async function assign(db, org, data, point) {
  let stop = data.stopId ? await schoolStop(db, org, data.stopId) : null;
  if (data.access && !stop) throw Object.assign(new Error('Choose a stop.'), { status: 400 });
  if (data.busId) {
    const bus = await db.query('SELECT bus_id FROM transport_buses WHERE organization_id=$1 AND bus_id=$2', [org, data.busId]);
    if (!bus.rows.length) throw Object.assign(new Error('Choose a school bus.'), { status: 400 });
  }
  if (data.addressAsStop && data.access) {
    if (!point) throw Object.assign(new Error('Enter a valid pickup address.'), { status: 400 });
    const homeStop = await db.query(`INSERT INTO transport_stops (organization_id, route_id, stop_name, stop_address, latitude, longitude, stop_order)
      SELECT $1,$2,'Pickup · ' || TRIM(first_name || ' ' || last_name),$4,$5,$6,
        COALESCE((SELECT MAX(stop_order)+1 FROM transport_stops WHERE organization_id=$1 AND route_id=$2),0)
      FROM students WHERE organization_id=$1 AND student_id=$3 RETURNING *`,
      [org, stop.route_id, data.studentId, data.address, point.lat, point.lng]);
    stop = homeStop.rows[0];
  }
  await db.query(`INSERT INTO transport_student_assignments
    (organization_id, student_id, bus_id, route_id, stop_id, home_address, home_latitude, home_longitude, active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (organization_id, student_id) DO UPDATE SET bus_id=EXCLUDED.bus_id, route_id=EXCLUDED.route_id,
      stop_id=EXCLUDED.stop_id, home_address=EXCLUDED.home_address, home_latitude=EXCLUDED.home_latitude,
      home_longitude=EXCLUDED.home_longitude, active=EXCLUDED.active, updated_at=NOW()`,
    [org, data.studentId, data.access ? data.busId : null, data.access ? stop?.route_id : null,
      data.access ? stop?.stop_id : null, data.address, point?.lat ?? null, point?.lng ?? null, data.access]);
}
const controller = {
  options: endpoint(async (req, res, db) => {
    const studentId = z.coerce.number().int().positive().parse(req.query.studentId);
    const address = addressSchema.parse(req.query.address);
    await guard(db, req, studentId);
    const point = await locate(db, req.session.organizationId, address);
    const stops = await db.query(`SELECT st.stop_id,st.route_id,st.stop_name,st.stop_address,st.latitude,st.longitude,r.route_name
      FROM transport_stops st JOIN transport_routes r ON r.route_id=st.route_id AND r.organization_id=st.organization_id
      WHERE st.organization_id=$1 AND r.route_status='active' AND st.latitude IS NOT NULL AND st.longitude IS NOT NULL`, [req.session.organizationId]);
    return res.json({ ok: true, point, stops: rankStops(stops.rows, point.lat, point.lng) });
  }),
  create: endpoint(async (req, res, db) => {
    const data = requestSchema.parse(req.body);
    const org = req.session.organizationId;
    await guard(db, req, data.studentId);
    const point = await locate(db, org, data.address);
    await schoolStop(db, org, data.stopId);
    const active = await db.query('SELECT 1 FROM transport_student_assignments WHERE organization_id=$1 AND student_id=$2 AND active=TRUE', [org, data.studentId]);
    if (active.rows.length) return res.status(409).json({ ok: false, message: 'This student already has bus access.' });
    await db.query(`INSERT INTO transport_requests (organization_id,student_id,requested_by,pickup_address,latitude,longitude,stop_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [org, data.studentId, req.session.user?.user_id || req.session.userId || null, data.address, point.lat, point.lng, data.stopId]);
    return res.status(201).json({ ok: true, message: 'Bus request submitted.' });
  }),
  list: endpoint(async (req, res, db) => {
    await management(db, req);
    const history = req.query.history === '1';
    const result = await db.query(`SELECT q.*,s.first_name,s.last_name,st.stop_name,r.route_name
      FROM transport_requests q JOIN students s ON s.student_id=q.student_id AND s.organization_id=q.organization_id
      LEFT JOIN transport_stops st ON st.stop_id=q.stop_id AND st.organization_id=q.organization_id
      LEFT JOIN transport_routes r ON r.route_id=st.route_id AND r.organization_id=q.organization_id
      WHERE q.organization_id=$1 AND (CASE WHEN $2 THEN q.status<>'pending' ELSE q.status='pending' END)
      ORDER BY q.created_at DESC LIMIT 200`, [req.session.organizationId, history]);
    const rows = [];
    for (const row of result.rows) if (await canAccessStudent(db, req.session, row.student_id)) rows.push(row);
    return res.json({ ok: true, requests: rows });
  }),
  review: endpoint(async (req, res, db) => {
    await management(db, req);
    const data = z.object({ requestId: z.coerce.number().int().positive(), decision: z.enum(['approved','declined']), busId: z.coerce.number().int().positive().nullable().default(null) }).parse(req.body);
    if (data.decision === 'approved' && !data.busId) return res.status(400).json({ ok: false, message: 'Choose a bus to approve.' });
    const org = req.session.organizationId;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM transport_requests WHERE organization_id=$1 AND request_id=$2 AND status=\'pending\' FOR UPDATE', [org, data.requestId]);
      const q = result.rows[0];
      if (!q) throw Object.assign(new Error('Request already reviewed or unavailable.'), { status: 409 });
      await guard(client, req, q.student_id);
      if (data.decision === 'approved') await assign(client, org, { studentId: q.student_id, address: q.pickup_address, access: true, stopId: q.stop_id, busId: data.busId }, { lat: Number(q.latitude), lng: Number(q.longitude) });
      await client.query('UPDATE transport_requests SET status=$3,reviewed_at=NOW(),reviewed_by=$4 WHERE organization_id=$1 AND request_id=$2', [org, data.requestId, data.decision, req.session.user?.user_id || req.session.userId || null]);
      await client.query('COMMIT');
      return res.json({ ok: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }),
  student: endpoint(async (req, res, db) => {
    await management(db, req);
    const studentId = z.coerce.number().int().positive().parse(req.params.studentId);
    await guard(db, req, studentId);
    const result = await db.query(`SELECT s.student_id,s.first_name,s.last_name,s.address,
      a.bus_id,a.stop_id,a.route_id,COALESCE(a.active,FALSE) AS access,COALESCE(a.home_address,s.address,'') AS pickup_address
      FROM students s LEFT JOIN transport_student_assignments a ON a.student_id=s.student_id AND a.organization_id=s.organization_id
      WHERE s.organization_id=$1 AND s.student_id=$2`, [req.session.organizationId, studentId]);
    return res.json({ ok: true, student: result.rows[0] });
  }),
  saveStudent: endpoint(async (req, res, db) => {
    await management(db, req);
    const data = pickupSchema.parse(req.body);
    await guard(db, req, data.studentId);
    const org = req.session.organizationId;
    const point = data.address ? await locate(db, org, addressSchema.parse(data.address)) : null;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await assign(client, org, data, point);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    return res.json({ ok: true, message: 'Transportation saved.' });
  }),
};
module.exports = { controller };