"use strict";

// Promotion settings (Report Settings: cut-off, basis, promoted and repeated class, reopen date,
// "Activate promotion") belong to a class and a term, but once a school has set them up they stay
// as they are: a term with no settings of its own for a class starts from that class's settings in
// the term before it (the latest earlier term by start date) and keeps them until someone changes
// them there. Adding only: a row that exists is never overwritten, so a manual change always wins.
// `db` is a pool or a client.
async function carryForward(db, organizationId, termId) {
  if (!organizationId || !termId) return 0;
  const result = await db.query(
    `INSERT INTO status_settings
       (organization_id, class_id, term_id, cut_off_point, promoted_class, repeated_class,
        school_reopen_date, activate_promotion, promotion_basis)
     SELECT DISTINCT ON (c.class_id)
            $1, c.class_id, $2, prev.cut_off_point, prev.promoted_class, prev.repeated_class,
            NULL, COALESCE(prev.activate_promotion, FALSE), COALESCE(prev.promotion_basis, 'percentage')
       FROM terms cur
       JOIN classes c ON c.organization_id = $1
       JOIN status_settings prev ON prev.organization_id = $1 AND prev.class_id = c.class_id AND prev.term_id <> $2
       JOIN terms pt ON pt.term_id = prev.term_id AND pt.organization_id = $1 AND pt.start_date < cur.start_date
      WHERE cur.term_id = $2 AND cur.organization_id = $1
        AND NOT EXISTS (SELECT 1 FROM status_settings own
                         WHERE own.organization_id = $1 AND own.class_id = c.class_id AND own.term_id = $2)
      ORDER BY c.class_id, pt.start_date DESC, prev.id DESC
     ON CONFLICT (organization_id, class_id, term_id) DO NOTHING`,
    [organizationId, termId]
  );
  return result.rowCount || 0;
}

// Never lets a failed carry-forward stop the page it was called from.
function carryForwardQuietly(db, organizationId, termId) {
  return carryForward(db, organizationId, termId).catch((error) => {
    console.error("[promotionSettings] carry forward:", error.message);
    return 0;
  });
}

module.exports = { carryForward, carryForwardQuietly };
