// Gives the app its own database login that can't create databases or other logins.
//
//   node scripts/secureDatabaseLogin.js            shows what would change, changes nothing
//   node scripts/secureDatabaseLogin.js --apply    does it, then prints the new connection URL
//
// Render's default login stays as the admin login. It keeps full access (it is a member
// of the new login), so the running app is unaffected until you switch
// DB_CONNECTION_STRING to the new URL, and switching back undoes it.
//
// The new login owns the tables, because the app still adds columns and tables while it
// runs. Everything it does today keeps working; it just can't create a database or a login.
require("dotenv").config();
const crypto = require("crypto");
const { Client } = require("pg");

const APP_LOGIN = process.env.DB_APP_LOGIN || "managira_app";
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

function connectTo(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, application_name: "managira-secure-login" });
}

// Everything in the public schema owned by the current login, except what an extension owns.
const OWNED_OBJECTS = `
  SELECT 'TABLE' AS kind, format('%I', c.relname) AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) = current_user
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'VIEW', format('%I', c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v' AND pg_get_userbyid(c.relowner) = current_user
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'SEQUENCE', format('%I', c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) = current_user
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a', 'i'))
  UNION ALL
  SELECT 'FUNCTION', format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND pg_get_userbyid(p.proowner) = current_user
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'TYPE', format('%I', t.typname)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd') AND pg_get_userbyid(t.typowner) = current_user
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')`;

async function secureLogin(client, { password }) {
  const me = (await client.query("SELECT current_user AS name, current_database() AS db")).rows[0];
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_LOGIN]);
  const quoted = password.replace(/'/g, "''");
  if (existing.rows.length) await client.query(`ALTER ROLE ${ident(APP_LOGIN)} LOGIN PASSWORD '${quoted}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  else await client.query(`CREATE ROLE ${ident(APP_LOGIN)} LOGIN PASSWORD '${quoted}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  // Lets the admin login hand objects over, and keeps it working for the running app.
  await client.query(`GRANT ${ident(APP_LOGIN)} TO ${ident(me.name)} WITH INHERIT TRUE, SET TRUE`);
  await client.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(me.db)} TO ${ident(APP_LOGIN)}`);
  await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${ident(APP_LOGIN)}`);
  const objects = (await client.query(OWNED_OBJECTS)).rows;
  // One round trip, so tables are locked for moments. A busy table stops it cleanly: try again.
  const statements = objects.map(({ kind, name }) => `ALTER ${kind} public.${name} OWNER TO ${ident(APP_LOGIN)}`);
  await client.query(`BEGIN; SET LOCAL lock_timeout = '3s'; ${statements.join("; ")}; COMMIT;`).catch(async (error) => {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  });
  return objects.length;
}

// The new login must do everything the app does, and nothing it shouldn't.
async function verifyLogin(url) {
  const client = connectTo(url);
  await client.connect();
  const results = {};
  const attempt = async (name, sql, shouldWork) => {
    try {
      await client.query(sql);
      results[name] = shouldWork;
    } catch (_error) {
      results[name] = !shouldWork;
    }
  };
  await client.query("BEGIN");
  await attempt("reads tables", "SELECT 1 FROM organizations LIMIT 1", true);
  await attempt("writes tables", "UPDATE organizations SET organization_id = organization_id WHERE organization_id = -1", true);
  await attempt("creates tables", "CREATE TABLE IF NOT EXISTS secure_login_check (id INT)", true);
  await attempt("adds columns", "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS secure_login_check INT", true);
  await attempt("creates indexes", "CREATE INDEX IF NOT EXISTS secure_login_check_idx ON organizations (organization_id)", true);
  await client.query("ROLLBACK");
  const role = (await client.query("SELECT rolcreatedb, rolcreaterole, rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0];
  await attempt("can't create a database", "CREATE DATABASE secure_login_check", false);
  await attempt("can't create a login", "CREATE ROLE secure_login_check", false);
  results["role has no extra powers"] = !role.rolcreatedb && !role.rolcreaterole && !role.rolsuper;
  await client.end();
  return results;
}

function withLogin(url, name, password) {
  const parsed = new URL(url);
  parsed.username = name;
  parsed.password = password;
  return parsed.toString();
}

async function main() {
  const adminUrl = process.env.DB_ADMIN_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  if (!adminUrl) throw new Error("DB_CONNECTION_STRING is not set.");
  const client = connectTo(adminUrl);
  await client.connect();
  const me = (await client.query("SELECT r.rolname, r.rolcreatedb, r.rolcreaterole, r.rolsuper FROM pg_roles r WHERE r.rolname = current_user")).rows[0];
  const objects = (await client.query(OWNED_OBJECTS)).rows;
  console.log(`Connected as ${me.rolname}: can create databases ${me.rolcreatedb}, can create logins ${me.rolcreaterole}.`);
  if (me.rolname === APP_LOGIN) {
    console.log(`The app already uses ${APP_LOGIN}. To change anything, set DB_ADMIN_CONNECTION_STRING to the admin login.`);
    await client.end();
    return;
  }
  if (!process.argv.includes("--apply")) {
    console.log(`Would create the login ${APP_LOGIN} and hand it ${objects.length} objects. Nothing was changed.`);
    console.log("Run again with --apply to do it.");
    await client.end();
    return;
  }
  if (!me.rolcreaterole && !me.rolsuper) throw new Error("This login can't create logins. Use Render's default login.");
  const password = crypto.randomBytes(24).toString("base64url");
  const moved = await secureLogin(client, { password });
  await client.end();
  const url = withLogin(adminUrl, APP_LOGIN, password);
  const results = await verifyLogin(url);
  const failed = Object.entries(results).filter(([, passed]) => !passed).map(([name]) => name);
  console.log(`Handed ${moved} objects to ${APP_LOGIN}.`);
  Object.entries(results).forEach(([name, passed]) => console.log(`  ${passed ? "ok  " : "FAIL"} ${name}`));
  if (failed.length) throw new Error(`Don't switch yet: ${failed.join(", ")}.`);
  console.log("\nThe running app is unaffected. To finish, set this as DB_CONNECTION_STRING on Render and deploy:");
  console.log(url);
  console.log("\nIt is shown only here, so keep it private. To undo, put the old value back.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { secureLogin, verifyLogin, withLogin };
