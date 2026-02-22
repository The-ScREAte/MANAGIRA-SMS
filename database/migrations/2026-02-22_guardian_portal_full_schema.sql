-- =============================================================================
-- Guardian Portal – Full Schema Bootstrap
-- Safe to run multiple times on any environment (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- Covers: guardian_profiles, guardian_accounts, guardian_reports,
--         guardian_report_replies, guardian_report_recipients
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. guardian_profiles
--    One row per portal guardian (links to legacy guardians table via name/phone)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_profiles (
    guardian_id    SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    first_name     VARCHAR(100) NOT NULL,
    last_name      VARCHAR(100) NOT NULL,
    phone          VARCHAR(50),
    email          VARCHAR(255),
    address        TEXT,
    hometown       VARCHAR(150),
    image_url      TEXT,
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW()
);

ALTER TABLE guardian_profiles
    ADD COLUMN IF NOT EXISTS address   TEXT,
    ADD COLUMN IF NOT EXISTS hometown  VARCHAR(150),
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_guardian_profiles_org       ON guardian_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_guardian_profiles_name_phone ON guardian_profiles(organization_id, first_name, last_name, phone);

-- ---------------------------------------------------------------------------
-- 2. guardian_accounts
--    Login credentials for Parent Portal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_accounts (
    id                  SERIAL PRIMARY KEY,
    organization_id     INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    guardian_id         INTEGER NOT NULL REFERENCES guardian_profiles(guardian_id) ON DELETE CASCADE,
    login_email         VARCHAR(255),
    login_phone         VARCHAR(50),
    password_hash       TEXT,
    must_reset_password BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

ALTER TABLE guardian_accounts
    ADD COLUMN IF NOT EXISTS login_phone         VARCHAR(50),
    ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_accounts_guardian ON guardian_accounts(guardian_id);
CREATE INDEX        IF NOT EXISTS idx_guardian_accounts_email    ON guardian_accounts(login_email) WHERE login_email IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_guardian_accounts_phone    ON guardian_accounts(login_phone) WHERE login_phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. guardian_reports
--    Staff-filed or parent-submitted concern tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_reports (
    report_id       SERIAL PRIMARY KEY,
    guardian_id     INTEGER NOT NULL,
    student_id      INTEGER REFERENCES students(student_id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    report_type     VARCHAR(50),
    subject         VARCHAR(255),
    message         TEXT,
    status          VARCHAR(50)  DEFAULT 'open',   -- open, in_progress, resolved, closed, pending
    priority        VARCHAR(50)  DEFAULT 'normal', -- low, normal, high, urgent
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    resolved_at     TIMESTAMP,
    deleted_at      TIMESTAMP  -- soft-delete; null = active
);

ALTER TABLE guardian_reports
    ADD COLUMN IF NOT EXISTS report_type       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS priority          VARCHAR(50) DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP   DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS resolved_at       TIMESTAMP,
    ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMP,
    ADD COLUMN IF NOT EXISTS filed_by_user_id  INTEGER,
    ADD COLUMN IF NOT EXISTS filed_by_name     VARCHAR(255);

-- Normalise any null/empty status to 'open'
UPDATE guardian_reports
SET status = 'open'
WHERE status IS NULL OR TRIM(status) = '';

CREATE INDEX IF NOT EXISTS idx_guardian_reports_guardian_id     ON guardian_reports(guardian_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_student_id      ON guardian_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_organization_id ON guardian_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_status          ON guardian_reports(status);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_created_at      ON guardian_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_guardian_org    ON guardian_reports(guardian_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_guardian_reports_soft_delete     ON guardian_reports(organization_id, deleted_at);

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION fn_guardian_reports_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guardian_reports_updated_at ON guardian_reports;
CREATE TRIGGER trg_guardian_reports_updated_at
    BEFORE UPDATE ON guardian_reports
    FOR EACH ROW EXECUTE FUNCTION fn_guardian_reports_updated_at();

-- ---------------------------------------------------------------------------
-- 4. guardian_report_replies
--    Threaded replies from guardians or staff on a report ticket
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_report_replies (
    reply_id    SERIAL PRIMARY KEY,
    report_id   INTEGER NOT NULL REFERENCES guardian_reports(report_id) ON DELETE CASCADE,
    sender_type VARCHAR(50) NOT NULL,  -- 'guardian' | 'staff'
    sender_id   INTEGER NOT NULL,      -- guardian_id or user_id depending on sender_type
    sender_name VARCHAR(255) NOT NULL,
    message     TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    is_read     BOOLEAN DEFAULT FALSE
);

ALTER TABLE guardian_report_replies
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_guardian_report_replies_report_id   ON guardian_report_replies(report_id);
CREATE INDEX IF NOT EXISTS idx_guardian_report_replies_sender_type ON guardian_report_replies(sender_type);

-- ---------------------------------------------------------------------------
-- 5. guardian_report_recipients
--    CC list – which staff members can view and reply to a report
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_report_recipients (
    recipient_id SERIAL PRIMARY KEY,
    report_id    INTEGER NOT NULL REFERENCES guardian_reports(report_id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    user_name    VARCHAR(255),
    user_role    VARCHAR(100),
    added_at     TIMESTAMP DEFAULT NOW(),
    last_read_at TIMESTAMP,
    UNIQUE (report_id, user_id)
);

ALTER TABLE guardian_report_recipients
    ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_guardian_report_recipients_report  ON guardian_report_recipients(report_id);
CREATE INDEX IF NOT EXISTS idx_guardian_report_recipients_user    ON guardian_report_recipients(user_id);

-- =============================================================================
-- Done
-- =============================================================================
