let schemaReady = false;
let schemaPromise = null;

async function ensureEmploymentSchema(db) {
  if (schemaReady) {
    return;
  }

  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS employment (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        external_link TEXT,
        application_mode TEXT NOT NULL DEFAULT 'external',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE employment
      ADD COLUMN IF NOT EXISTS application_mode TEXT NOT NULL DEFAULT 'external'
    `);

    await db.query(`
      ALTER TABLE employment
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await db.query(`
      ALTER TABLE employment
      ALTER COLUMN external_link DROP NOT NULL
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'employment_application_mode_check'
        ) THEN
          ALTER TABLE employment
            ADD CONSTRAINT employment_application_mode_check
            CHECK (application_mode IN ('external', 'in_app'));
        END IF;
      END $$
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS employment_applications (
        id SERIAL PRIMARY KEY,
        employment_id INTEGER NOT NULL REFERENCES employment(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        whatsapp_number TEXT,
        contact_via_text BOOLEAN NOT NULL DEFAULT FALSE,
        contact_via_email BOOLEAN NOT NULL DEFAULT TRUE,
        cover_letter TEXT NOT NULL,
        resume_url TEXT NOT NULL,
        resume_s3_key TEXT,
        resume_filename TEXT,
        cover_letter_url TEXT,
        cover_letter_s3_key TEXT,
        cover_letter_filename TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        rejection_reason TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT ''
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS cover_letter_url TEXT
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS cover_letter_s3_key TEXT
    `);

    await db.query(`
      ALTER TABLE employment_applications
      ADD COLUMN IF NOT EXISTS cover_letter_filename TEXT
    `);

    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'employment_applications_status_check'
        ) THEN
          ALTER TABLE employment_applications
            ADD CONSTRAINT employment_applications_status_check
            CHECK (status IN ('pending', 'approved', 'rejected'));
        END IF;
      END $$
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_employment_applications_employment_id
      ON employment_applications(employment_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_employment_applications_status
      ON employment_applications(status)
    `);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = {
  ensureEmploymentSchema,
};
