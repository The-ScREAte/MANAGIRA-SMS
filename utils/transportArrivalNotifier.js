const db = require("../config/db");
const { ensureTransportationSchema, calculateDistanceKm } = require("./transportation");
const { sendEmailInBackground, renderCleanEmail } = require("./emailHelper");
const {
  getWhatsappMessagingCredentials,
  sendWhatsappTextMessage,
} = require("./whatsappIntegration");

const APPROACHING_ETA_MINUTES = 5;
const ARRIVED_DISTANCE_KM = 0.15; // ~150 meters

const COUNTRY_DIALING_CODES = {
  US: "1", CA: "1", GB: "44", GH: "233", NG: "234", KE: "254", ZA: "27",
  RW: "250", UG: "256", TZ: "255", IN: "91", AU: "61", NZ: "64", AE: "971",
};

function normalizeWhatsappPhoneNumber(value, countryCode = "") {
  const raw = String(value || "").trim();
  if (!raw) return { normalized: "", valid: false };

  let hadInternationalPrefix = false;
  let candidate = raw;
  if (candidate.startsWith("+")) {
    hadInternationalPrefix = true;
    candidate = candidate.slice(1);
  } else if (candidate.startsWith("00")) {
    hadInternationalPrefix = true;
    candidate = candidate.slice(2);
  }

  let digits = candidate.replace(/\D+/g, "");
  if (!digits) return { normalized: "", valid: false };

  if (!hadInternationalPrefix) {
    const dialCode = COUNTRY_DIALING_CODES[String(countryCode || "").trim().toUpperCase()] || "";
    if (dialCode && !digits.startsWith(dialCode)) {
      digits = digits.startsWith("0") ? `${dialCode}${digits.slice(1)}` : `${dialCode}${digits}`;
    }
  }

  return { normalized: digits, valid: /^\d{8,15}$/.test(digits) };
}

async function reserveNotificationEvent(database, { organizationId, tripId, studentId, eventType }) {
  const result = await database.query(
    `INSERT INTO transport_notification_events (organization_id, trip_id, student_id, event_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trip_id, student_id, event_type) DO NOTHING
     RETURNING id`,
    [organizationId, tripId, studentId, eventType]
  );
  return result.rows.length > 0;
}

async function getGuardianContactsForStudent(database, organizationId, studentId) {
  const result = await database.query(
    `SELECT DISTINCT email, phone FROM (
       SELECT gp.email, gp.phone
       FROM guardian_profiles gp
       JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
       WHERE gs.student_id = $1 AND gp.organization_id = $2
       UNION
       SELECT g.email, g.phone
       FROM guardians g
       WHERE g.student_id = $1 AND g.organization_id = $2
     ) guardian_contacts
     WHERE (email IS NOT NULL AND TRIM(email) <> '') OR (phone IS NOT NULL AND TRIM(phone) <> '')`,
    [studentId, organizationId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function sendArrivalNotification(database, { organizationId, student, eventType, busNumber, orgCountry, whatsappCreds, whatsappActivated }) {
  const contacts = await getGuardianContactsForStudent(database, organizationId, student.student_id);
  if (!contacts.length) return;

  const studentName = [student.first_name, student.last_name].filter(Boolean).join(" ").trim() || "your child";
  const isApproaching = eventType === "approaching";
  const title = isApproaching
    ? `Bus arriving soon for ${studentName}`
    : `Bus has arrived for ${studentName}`;
  const message = isApproaching
    ? `The school bus${busNumber ? ` (${busNumber})` : ""} is about ${APPROACHING_ETA_MINUTES} minutes away from ${studentName}'s stop.`
    : `The school bus${busNumber ? ` (${busNumber})` : ""} has arrived at ${studentName}'s stop.`;

  for (const contact of contacts) {
    // Email is the default, always-sent channel.
    if (contact.email) {
      const html = renderCleanEmail({
        title,
        greeting: "Hello,",
        paragraphs: [message],
        noReply: true,
      });
      sendEmailInBackground({ to: contact.email, subject: title, html }, "TransportArrival").catch(() => {});
    }

    // WhatsApp is sent additionally, only when the organization has it active.
    if (whatsappActivated && whatsappCreds && whatsappCreds.configured && contact.phone) {
      const { normalized, valid } = normalizeWhatsappPhoneNumber(contact.phone, orgCountry);
      if (valid) {
        sendWhatsappTextMessage(whatsappCreds.accessToken, whatsappCreds.phoneNumberId, {
          to: normalized,
          text: message,
        }).catch((err) => {
          console.error("[TransportArrival] WhatsApp send failed", {
            organizationId,
            studentId: student.student_id,
            eventType,
            error: err?.message || err,
          });
        });
      }
    }
  }
}

async function runTransportArrivalSweep(database = db) {
  await ensureTransportationSchema(database);

  const summary = { tripsChecked: 0, approachingSent: 0, arrivedSent: 0 };

  const activeTrips = await database.query(
    `SELECT trip_id, organization_id, bus_id, route_id
       FROM transport_trip_sessions
      WHERE status = 'active'`
  );

  for (const trip of activeTrips.rows) {
    summary.tripsChecked += 1;

    const [pingResult, orgResult, busResult] = await Promise.all([
      database.query(
        `SELECT latitude, longitude, speed_kmh, recorded_at
           FROM transport_live_locations
          WHERE trip_id = $1
          ORDER BY recorded_at DESC
          LIMIT 1`,
        [trip.trip_id]
      ),
      database.query(
        `SELECT whatsapp_activated, organization_country FROM organizations WHERE organization_id = $1`,
        [trip.organization_id]
      ),
      trip.bus_id
        ? database.query(`SELECT bus_number FROM transport_buses WHERE bus_id = $1`, [trip.bus_id])
        : Promise.resolve({ rows: [] }),
    ]);

    const ping = pingResult.rows[0];
    if (!ping) continue;

    const whatsappActivated = Boolean(orgResult.rows[0]?.whatsapp_activated);
    const orgCountry = orgResult.rows[0]?.organization_country || "";
    const busNumber = busResult.rows[0]?.bus_number || null;
    const whatsappCreds = whatsappActivated
      ? await getWhatsappMessagingCredentials(database, trip.organization_id).catch(() => null)
      : null;

    if (!trip.bus_id) continue;

    const assignments = await database.query(
      `SELECT tsa.student_id, s.first_name, s.last_name,
              tsa.home_latitude, tsa.home_longitude,
              st.latitude AS stop_latitude, st.longitude AS stop_longitude
         FROM transport_student_assignments tsa
         JOIN students s ON s.student_id = tsa.student_id AND s.organization_id = tsa.organization_id
         LEFT JOIN transport_stops st ON st.stop_id = tsa.stop_id AND st.organization_id = tsa.organization_id
        WHERE tsa.organization_id = $1 AND tsa.bus_id = $2 AND tsa.active = TRUE`,
      [trip.organization_id, trip.bus_id]
    );

    for (const student of assignments.rows) {
      const targetLat = student.home_latitude ?? student.stop_latitude;
      const targetLng = student.home_longitude ?? student.stop_longitude;
      if (targetLat === null || targetLat === undefined || targetLng === null || targetLng === undefined) continue;

      const distanceKm = calculateDistanceKm(ping.latitude, ping.longitude, targetLat, targetLng);
      if (distanceKm === null) continue;

      const speedKmh = ping.speed_kmh !== null ? Number(ping.speed_kmh) : null;
      const etaMinutes = speedKmh && speedKmh > 1 ? (distanceKm / speedKmh) * 60 : null;

      const isArrived = distanceKm <= ARRIVED_DISTANCE_KM;
      const isApproaching = !isArrived && etaMinutes !== null && etaMinutes <= APPROACHING_ETA_MINUTES;

      if (!isArrived && !isApproaching) continue;

      const eventType = isArrived ? "arrived" : "approaching";
      const claimed = await reserveNotificationEvent(database, {
        organizationId: trip.organization_id,
        tripId: trip.trip_id,
        studentId: student.student_id,
        eventType,
      });
      if (!claimed) continue;

      await sendArrivalNotification(database, {
        organizationId: trip.organization_id,
        student,
        eventType,
        busNumber,
        orgCountry,
        whatsappCreds,
        whatsappActivated,
      });

      if (eventType === "arrived") summary.arrivedSent += 1;
      else summary.approachingSent += 1;
    }
  }

  return summary;
}

module.exports = {
  runTransportArrivalSweep,
};
