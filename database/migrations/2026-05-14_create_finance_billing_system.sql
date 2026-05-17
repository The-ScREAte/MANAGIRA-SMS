-- Finance & Billing system for school admins
-- All tables scoped by organization_id for full multi-tenant isolation.

CREATE TABLE IF NOT EXISTS finance_fee_templates (
  template_id        SERIAL PRIMARY KEY,
  organization_id    INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  bill_type          VARCHAR(40) NOT NULL DEFAULT 'one_time',
  recurrence         VARCHAR(40),
  late_fee_amount    NUMERIC(12,2) DEFAULT 0,
  late_fee_after_days INT DEFAULT 7,
  created_by         INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fee_templates_org ON finance_fee_templates(organization_id);

CREATE TABLE IF NOT EXISTS finance_bills (
  bill_id            SERIAL PRIMARY KEY,
  organization_id    INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  title              VARCHAR(255) NOT NULL,
  description        TEXT,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  bill_type          VARCHAR(40) NOT NULL DEFAULT 'one_time', -- one_time | recurring | installment
  recurrence         VARCHAR(40),                              -- daily|weekly|monthly|term|year
  late_fee_amount    NUMERIC(12,2) DEFAULT 0,
  late_fee_after_days INT DEFAULT 7,
  applies_to         VARCHAR(20) NOT NULL DEFAULT 'school',   -- school | classes | students
  school_year_id     INT,
  term_id            INT,
  due_date           DATE,
  recurrence_end_date DATE,
  accepts_card       BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_cash       BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_transfer   BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_sms         BOOLEAN NOT NULL DEFAULT FALSE,
  status             VARCHAR(20) NOT NULL DEFAULT 'active',   -- draft|active|scheduled|cancelled
  scheduled_send_at  TIMESTAMP,
  created_by         INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_bills_org ON finance_bills(organization_id);
CREATE INDEX IF NOT EXISTS idx_finance_bills_due ON finance_bills(organization_id, due_date);

-- Per-student assignment of a bill (one row per student)
CREATE TABLE IF NOT EXISTS finance_bill_assignments (
  assignment_id      SERIAL PRIMARY KEY,
  bill_id            INT NOT NULL REFERENCES finance_bills(bill_id) ON DELETE CASCADE,
  organization_id    INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id         INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid        NUMERIC(12,2) NOT NULL DEFAULT 0,
  late_fee_applied   NUMERIC(12,2) NOT NULL DEFAULT 0,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|partial|paid|overdue|cancelled
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bill_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_bill_assignments_org ON finance_bill_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_bill_assignments_student ON finance_bill_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_bill_assignments_status ON finance_bill_assignments(organization_id, status);

CREATE TABLE IF NOT EXISTS finance_payments (
  payment_id         SERIAL PRIMARY KEY,
  organization_id    INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  assignment_id      INT REFERENCES finance_bill_assignments(assignment_id) ON DELETE SET NULL,
  bill_id            INT REFERENCES finance_bills(bill_id) ON DELETE SET NULL,
  student_id         INT REFERENCES students(student_id) ON DELETE SET NULL,
  amount             NUMERIC(12,2) NOT NULL,
  method             VARCHAR(30) NOT NULL DEFAULT 'cash',     -- cash|cheque|bank_transfer|stripe|other
  reference          VARCHAR(255),
  notes              TEXT,
  received_by        INT REFERENCES users(user_id) ON DELETE SET NULL,
  received_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_refund          BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_payment_intent_id VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_finance_payments_org ON finance_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_assignment ON finance_payments(assignment_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_received ON finance_payments(organization_id, received_at DESC);

-- Per-student credit (overpayments)
CREATE TABLE IF NOT EXISTS finance_student_credits (
  credit_id          SERIAL PRIMARY KEY,
  organization_id    INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id         INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id)
);
