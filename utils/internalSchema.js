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

    // Track whether a contact's organization has joined Managira.
    await db.query(`
      ALTER TABLE internal_contacts
        ADD COLUMN IF NOT EXISTS joined BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.query(`
      ALTER TABLE internal_contacts
        ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP
    `);

    await db.query(`
      ALTER TABLE internal_contacts
        ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL
    `);
    await db.query(`
      ALTER TABLE internal_contacts
        ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_internal_contacts_assigned_to
        ON internal_contacts(assigned_to_user_id)
    `);

    await db.query(`
      ALTER TABLE internal_contacts
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_internal_contacts_deleted_at
        ON internal_contacts(deleted_at)
    `);

    // Org chart: supervisor + custom role + profile picture for admin-side users.
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS supervisor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS org_role_title TEXT,
        ADD COLUMN IF NOT EXISTS org_role_description TEXT,
        ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
        ADD COLUMN IF NOT EXISTS profile_image_s3_key TEXT
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_supervisor ON users(supervisor_user_id)
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
