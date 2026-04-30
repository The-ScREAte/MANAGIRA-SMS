const db = require('../config/db');

let helpThreadSchemaReady = false;

async function ensureHelpThreadSchema(database = db) {
  if (helpThreadSchemaReady) {
    return;
  }

  await database.query(`
    ALTER TABLE help_threads
    ADD COLUMN IF NOT EXISTS request_type VARCHAR(20) NOT NULL DEFAULT 'help'
  `);

  await database.query(`
    UPDATE help_threads
    SET request_type = CASE
      WHEN EXISTS (
        SELECT 1
        FROM help_messages hm
        WHERE hm.thread_id = help_threads.id
          AND hm.message ILIKE 'Demo Request from%'
      ) THEN 'demo'
      ELSE 'help'
    END
    WHERE request_type IS NULL
       OR request_type NOT IN ('help', 'demo')
  `);

  helpThreadSchemaReady = true;
}

module.exports = {
  ensureHelpThreadSchema,
};