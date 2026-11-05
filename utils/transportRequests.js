const { z } = require('zod');
const { calculateDistanceKm } = require('./transportation');

const id = z.coerce.number().int().positive();
const addressSchema = z.string().trim().min(5, 'Enter a full pickup address.').max(500);
const requestSchema = z.object({ studentId: id, address: addressSchema, stopId: id });
const pickupSchema = z.object({
  studentId: id, address: z.string().trim().max(500).default(''),
  access: z.boolean(), addressAsStop: z.boolean().default(false),
  busId: id.nullable().default(null), stopId: id.nullable().default(null),
});

function rankStops(stops, lat, lng) {
  return stops.filter(s => s.latitude != null && s.longitude != null)
    .map(s => ({ ...s, distanceKm: calculateDistanceKm(lat, lng, s.latitude, s.longitude) }))
    .filter(s => Number.isFinite(s.distanceKm))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.stop_id - b.stop_id).slice(0, 8);
}

// Classroom requests are restricted to assigned teachers; management grants
// do not override a teacher's student-level boundary.
async function canAccessStudent(db, session, studentId) {
  const role = String(session.userRole || session.user?.account_type || '').toLowerCase();
  const userId = session.user?.user_id || session.userId;
  if (['guardian', 'student', 'driver'].includes(role)) return false;
  const result = await db.query(
    `SELECT s.student_id FROM students s WHERE s.organization_id = $1 AND s.student_id = $2
       AND COALESCE(s.graduated, FALSE) = FALSE
       AND ($3::boolean OR EXISTS (SELECT 1 FROM user_classes uc WHERE uc.class_id = s.class_id AND uc.user_id = $4))`,
    [session.organizationId, studentId, role !== 'teacher', userId || null]);
  return result.rows.length > 0;
}

module.exports = { addressSchema, requestSchema, pickupSchema, rankStops, canAccessStudent };