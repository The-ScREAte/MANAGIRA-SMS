CREATE INDEX IF NOT EXISTS idx_finance_bills_org_school_term
  ON finance_bills (organization_id, school_year_id, term_id);

CREATE INDEX IF NOT EXISTS idx_finance_bill_assignments_org_student
  ON finance_bill_assignments (organization_id, student_id);

CREATE INDEX IF NOT EXISTS idx_finance_bill_assignments_bill_org
  ON finance_bill_assignments (organization_id, bill_id);

CREATE INDEX IF NOT EXISTS idx_finance_payments_org_assignment
  ON finance_payments (organization_id, assignment_id);

CREATE INDEX IF NOT EXISTS idx_finance_payments_org_bill
  ON finance_payments (organization_id, bill_id);

CREATE INDEX IF NOT EXISTS idx_finance_payments_org_received_at
  ON finance_payments (organization_id, received_at DESC);
