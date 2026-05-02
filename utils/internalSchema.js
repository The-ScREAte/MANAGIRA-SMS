// Runtime schema helper for the Internal Worker feature.
// Adds the 'Internal Worker' value to the user_role enum and creates the
// internal_contacts table used by the admin dashboard contact form.

let schemaReady = false;
let schemaPromise = null;

async function ensureInternalWorkerSchema(db) {
  if (schemaReady) return;
  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    // Add 'Internal Worker' to the user_role enum if missing.
    // ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.
    try {
      await db.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Internal Worker'`);
    } catch (err) {
      // If the type doesn't exist yet (fresh DB without enum), ignore -
      // the rest of the schema migration will create it.
      if (err && err.code !== '42704') {
        // 42704 = undefined_object. Re-throw for anything else so we know.
        throw err;
      }
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_contacts (
        id SERIAL PRIMARY KEY,
        created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        contact_name TEXT NOT NULL,
        organization_name TEXT,
        appointment_set BOOLEAN NOT NULL DEFAULT FALSE,
        appointment_at TIMESTAMP,
        notes TEXT,
        followed_up BOOLEAN NOT NULL DEFAULT FALSE,
        followed_up_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_internal_contacts_created_by
        ON internal_contacts(created_by_user_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_internal_contacts_created_at
        ON internal_contacts(created_at DESC)
    `);

    // Ensure the users table has a phone_number column for the admin profile page.
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50)
    `);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensureInternalWorkerSchema };
