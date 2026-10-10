// One-click Google Calendar / Outlook connections (OAuth).
// - Push: a "Managira" calendar is created in the person's account and kept in
//   step with their Managira events, personal events and tasks.
// - Pull: events from their main Google/Outlook calendar show inside Managira.
const crypto = require("crypto");
const axios = require("axios");
const { google } = require("googleapis");
const { createGoogleOauthClient, hasGoogleOauthConfig } = require("./googleClassroomSync");

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.events",
];
const MS_SCOPES = ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"];
const MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";

let schemaPromise = null;
function ensureConnectSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // Early version keyed connections by (user, provider) — one account each. Upgrade to one row
      // per connected account so several Google/Outlook accounts can be connected.
      const old = await db.query(
        `SELECT 1 FROM information_schema.tables t
          WHERE t.table_name = 'calendar_connections'
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = 'calendar_connections' AND c.column_name = 'connection_id')`
      );
      if (old.rowCount) {
        await db.query(`DROP TABLE IF EXISTS calendar_push_map`);
        await db.query(`DROP TABLE IF EXISTS calendar_connections`);
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS calendar_connections (
          connection_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL,
          provider VARCHAR(20) NOT NULL,
          account_email TEXT,
          access_token TEXT,
          refresh_token TEXT,
          expires_at TIMESTAMPTZ,
          time_zone VARCHAR(64),
          managira_calendar_id TEXT,
          show_in_managira BOOLEAN NOT NULL DEFAULT TRUE,
          last_synced_at TIMESTAMPTZ,
          last_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, provider, account_email)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_calendar_connections_org ON calendar_connections (organization_id, user_id)`);
      await db.query(`ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS calendar_push_map (
          connection_id INTEGER NOT NULL REFERENCES calendar_connections(connection_id) ON DELETE CASCADE,
          item_uid VARCHAR(80) NOT NULL,
          remote_id TEXT NOT NULL,
          hash VARCHAR(40) NOT NULL,
          PRIMARY KEY (connection_id, item_uid)
        )
      `);
    })().catch((err) => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

const msConfigured = () => !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
const providersConfigured = () => ({ google: hasGoogleOauthConfig(), outlook: msConfigured() });

function msRedirectUri(req) {
  return process.env.MICROSOFT_REDIRECT_URI || `${req.protocol}://${req.get("host")}/common/calendar/connect/outlook/callback`;
}

function validTimeZone(tz) {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch (_e) { return null; }
}

// ---------- start / finish OAuth ----------
function startUrl(req, provider) {
  const state = crypto.randomBytes(18).toString("hex");
  req.session.calendarOauth = {
    state,
    provider,
    timeZone: validTimeZone(String(req.query.tz || "")) || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (provider === "google") {
    return createGoogleOauthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "select_account consent",
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state,
    });
  }
  const p = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: msRedirectUri(req),
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `${MS_AUTH}/authorize?${p}`;
}

// True when this OAuth callback belongs to a calendar connection (shared Google redirect URI).
function isCalendarCallback(req) {
  const pending = req.session && req.session.calendarOauth;
  return !!(pending && req.query.state && pending.state === String(req.query.state));
}

async function finishOauth(db, req, provider) {
  const pending = req.session.calendarOauth;
  req.session.calendarOauth = null;
  if (!pending || pending.state !== String(req.query.state || "") || pending.provider !== provider) throw new Error("The sign-in expired. Please try again.");
  if (req.query.error) throw new Error(provider === "google" ? "Google sign-in was cancelled." : "Microsoft sign-in was cancelled.");
  const code = String(req.query.code || "");
  if (!code) throw new Error("No authorization code was returned.");
  let tokens;
  let email = "";
  if (provider === "google") {
    const client = createGoogleOauthClient();
    const r = await client.getToken(code);
    tokens = { access: r.tokens.access_token, refresh: r.tokens.refresh_token, expires: r.tokens.expiry_date ? new Date(r.tokens.expiry_date) : null };
    const granted = String(r.tokens.scope || "");
    if (!granted.includes("calendar")) throw new Error("Calendar access wasn't granted. Please allow access to your calendar.");
    client.setCredentials(r.tokens);
    try { email = (await google.oauth2({ version: "v2", auth: client }).userinfo.get()).data.email || ""; } catch (_e) { email = ""; }
  } else {
    const r = await axios.post(`${MS_AUTH}/token`, new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: msRedirectUri(req),
      scope: MS_SCOPES.join(" "),
    }), { timeout: 10000 });
    tokens = { access: r.data.access_token, refresh: r.data.refresh_token, expires: new Date(Date.now() + (r.data.expires_in || 3600) * 1000) };
    try {
      const me = await axios.get("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${tokens.access}` }, timeout: 8000 });
      email = me.data.mail || me.data.userPrincipalName || "";
    } catch (_e) { email = ""; }
  }
  // One account per provider: connecting a different account replaces the old one.
  const userId = Number(req.session.userId || req.session.user?.user_id);
  const normalizedEmail = (email || `${provider} account`).toLowerCase();
  const others = await db.query(
    `SELECT * FROM calendar_connections WHERE user_id = $1 AND provider = $2 AND account_email <> $3`,
    [userId, provider, normalizedEmail]
  );
  for (const old of others.rows) await disconnect(db, old);
  const saved = await db.query(
    `INSERT INTO calendar_connections (organization_id, user_id, provider, account_email, access_token, refresh_token, expires_at, time_zone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, provider, account_email) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       access_token = EXCLUDED.access_token, refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
       expires_at = EXCLUDED.expires_at, time_zone = EXCLUDED.time_zone, last_error = NULL
     RETURNING connection_id`,
    [Number(req.session.organizationId), userId, provider, normalizedEmail, tokens.access, tokens.refresh || null, tokens.expires, pending.timeZone]
  );
  return { email, connectionId: saved.rows[0].connection_id };
}

// ---------- API clients ----------
function realGoogleApi(db, conn) {
  const client = createGoogleOauthClient();
  client.setCredentials({ access_token: conn.access_token, refresh_token: conn.refresh_token, expiry_date: conn.expires_at ? new Date(conn.expires_at).getTime() : undefined });
  client.on("tokens", (t) => {
    db.query(
      `UPDATE calendar_connections SET access_token = $2, expires_at = $3, refresh_token = COALESCE($4, refresh_token) WHERE connection_id = $1`,
      [conn.connection_id, t.access_token, t.expiry_date ? new Date(t.expiry_date) : null, t.refresh_token || null]
    ).catch(() => {});
  });
  return google.calendar({ version: "v3", auth: client });
}

async function msToken(db, conn) {
  if (conn.access_token && conn.expires_at && new Date(conn.expires_at).getTime() > Date.now() + 60000) return conn.access_token;
  const r = await axios.post(`${MS_AUTH}/token`, new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
    scope: MS_SCOPES.join(" "),
  }), { timeout: 10000 });
  conn.access_token = r.data.access_token;
  conn.expires_at = new Date(Date.now() + (r.data.expires_in || 3600) * 1000);
  await db.query(
    `UPDATE calendar_connections SET access_token = $2, expires_at = $3, refresh_token = COALESCE($4, refresh_token) WHERE connection_id = $1`,
    [conn.connection_id, conn.access_token, conn.expires_at, r.data.refresh_token || null]
  );
  return conn.access_token;
}
async function realGraph(db, conn, method, path, data, headers = {}) {
  const token = await msToken(db, conn);
  const r = await axios({ method, url: `https://graph.microsoft.com/v1.0${path}`, data, timeout: 12000, headers: { Authorization: `Bearer ${token}`, ...headers } });
  return r.data;
}

// Swappable in tests (tests/calendarConnect.test.js) so sync logic can be checked without real accounts.
const deps = { googleApi: realGoogleApi, graph: realGraph };
const googleApi = (db, conn) => deps.googleApi(db, conn);
const graph = (...args) => deps.graph(...args);

// ---------- push (Managira -> Google/Outlook) ----------
const sha = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex");
const plusDays = (key, n) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const plusHour = (time) => { const [h, m] = time.split(":").map(Number); return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };

async function ensureManagiraCalendar(db, conn, orgName) {
  if (conn.managira_calendar_id) return conn.managira_calendar_id;
  const name = `Managira · ${orgName || "School"}`;
  let id;
  if (conn.provider === "google") {
    const r = await googleApi(db, conn).calendars.insert({ requestBody: { summary: name, description: "Events, personal events and tasks from Managira. Updated automatically.", timeZone: conn.time_zone || undefined } });
    id = r.data.id;
  } else {
    const r = await graph(db, conn, "post", "/me/calendars", { name, color: "lightTeal" });
    id = r.id;
  }
  await db.query(`UPDATE calendar_connections SET managira_calendar_id = $2 WHERE connection_id = $1`, [conn.connection_id, id]);
  conn.managira_calendar_id = id;
  return id;
}

function remoteBody(provider, it, tz) {
  const timed = !it.allDay && it.startTime;
  const endTime = it.endTime || (timed ? plusHour(it.startTime) : null);
  const description = [it.details, it.url ? `Open in Managira: ${it.url}` : ""].filter(Boolean).join("\n\n");
  if (provider === "google") {
    return {
      summary: it.title,
      description,
      location: it.location || undefined,
      start: timed ? { dateTime: `${it.date}T${it.startTime}:00`, timeZone: tz } : { date: it.date },
      end: timed ? { dateTime: `${it.endDate || it.date}T${endTime}:00`, timeZone: tz } : { date: plusDays(it.endDate || it.date, 1) },
      source: it.url ? { title: "Managira", url: it.url } : undefined,
      extendedProperties: { private: { managiraUid: it.uid } },
    };
  }
  return {
    subject: it.title,
    body: { contentType: "text", content: description },
    location: it.location ? { displayName: it.location } : undefined,
    isAllDay: !timed,
    start: { dateTime: timed ? `${it.date}T${it.startTime}:00` : `${it.date}T00:00:00`, timeZone: tz },
    end: { dateTime: timed ? `${it.endDate || it.date}T${endTime}:00` : `${plusDays(it.endDate || it.date, 1)}T00:00:00`, timeZone: tz },
  };
}

const goneStatus = (err) => [404, 410].includes(Number(err?.code || err?.response?.status));

/** items: [{ uid, title, details, location, date, endDate, startTime, endTime, allDay, url }] */
async function pushItems(db, conn, items, orgName) {
  const tz = conn.time_zone || "UTC";
  const calId = await ensureManagiraCalendar(db, conn, orgName);
  const map = new Map((await db.query(`SELECT item_uid, remote_id, hash FROM calendar_push_map WHERE connection_id = $1`, [conn.connection_id])).rows.map((r) => [r.item_uid, r]));
  const g = conn.provider === "google" ? googleApi(db, conn) : null;
  const seen = new Set();
  for (const it of items) {
    seen.add(it.uid);
    const body = remoteBody(conn.provider, it, tz);
    const hash = sha(body);
    const prev = map.get(it.uid);
    if (prev && prev.hash === hash) continue;
    let remoteId = prev ? prev.remote_id : null;
    try {
      if (remoteId) {
        if (g) await g.events.patch({ calendarId: calId, eventId: remoteId, requestBody: body });
        else await graph(db, conn, "patch", `/me/events/${encodeURIComponent(remoteId)}`, body);
      }
    } catch (err) {
      if (!goneStatus(err)) throw err;
      remoteId = null;
    }
    if (!remoteId) {
      if (g) remoteId = (await g.events.insert({ calendarId: calId, requestBody: body })).data.id;
      else remoteId = (await graph(db, conn, "post", `/me/calendars/${encodeURIComponent(calId)}/events`, body)).id;
    }
    await db.query(
      `INSERT INTO calendar_push_map (connection_id, item_uid, remote_id, hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (connection_id, item_uid) DO UPDATE SET remote_id = EXCLUDED.remote_id, hash = EXCLUDED.hash`,
      [conn.connection_id, it.uid, remoteId, hash]
    );
  }
  for (const [uid, row] of map) {
    if (seen.has(uid)) continue;
    try {
      if (g) await g.events.delete({ calendarId: calId, eventId: row.remote_id });
      else await graph(db, conn, "delete", `/me/events/${encodeURIComponent(row.remote_id)}`);
    } catch (err) { if (!goneStatus(err)) throw err; }
    await db.query(`DELETE FROM calendar_push_map WHERE connection_id = $1 AND item_uid = $2`, [conn.connection_id, uid]);
  }
}

// ---------- pull (Google/Outlook -> Managira) ----------
const pullCache = new Map();
const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function pullEvents(db, conn, start, end) {
  const key = `${conn.connection_id}:${start}:${end}`;
  const hit = pullCache.get(key);
  if (hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.items;
  const label = conn.account_email || (conn.provider === "google" ? "Google Calendar" : "Outlook");
  const layer = `conn-${conn.connection_id}`;
  const out = [];
  if (conn.provider === "google") {
    const r = await googleApi(db, conn).events.list({
      calendarId: "primary", timeMin: new Date(`${start}T00:00:00`).toISOString(), timeMax: new Date(`${end}T23:59:59`).toISOString(),
      singleEvents: true, orderBy: "startTime", maxResults: 500,
    });
    (r.data.items || []).forEach((e) => {
      if (e.status === "cancelled" || (e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.managiraUid)) return;
      const allDay = !!(e.start && e.start.date);
      const s = allDay ? e.start.date : (e.start && e.start.dateTime ? new Date(e.start.dateTime) : null);
      if (!s) return;
      const en = allDay ? e.end && e.end.date : (e.end && e.end.dateTime ? new Date(e.end.dateTime) : null);
      out.push({
        id: `${layer}-${e.id}`, title: e.summary || "(No title)",
        start: allDay ? s : `${localKey(s)}T${localTime(s)}`, end: en ? (allDay ? en : `${localKey(en)}T${localTime(en)}`) : null,
        allDay, editable: false, classNames: ["cal-ev", "cal-ev--external"],
        extendedProps: { kind: "external", layer, provider: "google", source: label, details: e.description || "", location: e.location || "", link: e.htmlLink || "" },
      });
    });
  } else {
    const p = new URLSearchParams({ startDateTime: `${start}T00:00:00`, endDateTime: `${end}T23:59:59`, $top: "250", $orderby: "start/dateTime" });
    const r = await graph(db, conn, "get", `/me/calendarView?${p}`, null, { Prefer: `outlook.timezone="${conn.time_zone || "UTC"}"` });
    (r.value || []).forEach((e) => {
      if (e.isCancelled) return;
      const s = String(e.start && e.start.dateTime || "").slice(0, 16);
      const en = String(e.end && e.end.dateTime || "").slice(0, 16);
      out.push({
        id: `${layer}-${e.id}`, title: e.subject || "(No title)",
        start: e.isAllDay ? s.slice(0, 10) : s, end: e.isAllDay ? en.slice(0, 10) : en, allDay: !!e.isAllDay, editable: false,
        classNames: ["cal-ev", "cal-ev--external"],
        extendedProps: { kind: "external", layer, provider: "outlook", source: label, details: e.bodyPreview || "", location: (e.location && e.location.displayName) || "", link: e.webLink || "" },
      });
    });
  }
  pullCache.set(key, { at: Date.now(), items: out });
  return out;
}

async function disconnect(db, conn) {
  try {
    if (conn.managira_calendar_id) {
      if (conn.provider === "google") await googleApi(db, conn).calendars.delete({ calendarId: conn.managira_calendar_id });
      else await graph(db, conn, "delete", `/me/calendars/${encodeURIComponent(conn.managira_calendar_id)}`);
    }
  } catch (_e) { /* calendar may already be gone */ }
  if (conn.provider === "google" && conn.refresh_token) {
    axios.post(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(conn.refresh_token)}`).catch(() => {});
  }
  await db.query(`DELETE FROM calendar_connections WHERE connection_id = $1`, [conn.connection_id]);
  for (const k of pullCache.keys()) if (k.startsWith(`${conn.connection_id}:`)) pullCache.delete(k);
}

// Error codes stored on the connection; the UI turns them into plain words.
//   setup     – Managira's Google/Microsoft app isn't fully switched on yet (platform side; retried automatically)
//   reconnect – the person removed access or it expired; they need to connect again
//   other:…   – anything else (retried automatically)
function friendlyError(err) {
  const status = Number(err?.code || err?.response?.status || 0);
  const msg = err?.response?.data?.error?.message || err?.response?.data?.error_description || err?.message || "Unknown error";
  if (status === 401 || /invalid_grant|unauthorized_client/i.test(msg)) return "reconnect";
  if (status === 403 && /insufficient|scope/i.test(msg)) return "reconnect";
  if (status === 403 && /has not been used|disabled|accessNotConfigured/i.test(msg)) {
    console.error("[Calendar] Platform setup needed:", msg.slice(0, 300));
    return "setup";
  }
  return `other:${String(msg).slice(0, 180)}`;
}

module.exports = {
  ensureConnectSchema, providersConfigured, startUrl, isCalendarCallback, finishOauth,
  pushItems, pullEvents, disconnect, friendlyError,
  __setDeps: (next) => Object.assign(deps, next),
};
