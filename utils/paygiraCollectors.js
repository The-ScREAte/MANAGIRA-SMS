// A staff member given a bill to collect, as its assignee or one of its collectors.
async function isBillCollector(db, organizationId, userId) {
  if (!organizationId || !userId) return false;
  const result = await db.query(
    `SELECT 1 FROM finance_bills b
      WHERE b.organization_id = $1
        AND COALESCE(b.status, 'active') <> 'cancelled'
        AND (b.assignee_id = $2 OR EXISTS (
          SELECT 1 FROM finance_bill_collectors c WHERE c.bill_id = b.bill_id AND c.user_id = $2))
      LIMIT 1`,
    [organizationId, userId]
  ).catch(() => ({ rows: [] }));
  return result.rows.length > 0;
}

module.exports = { isBillCollector };
