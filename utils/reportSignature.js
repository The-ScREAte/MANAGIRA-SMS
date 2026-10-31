const REPORT_SIGNATURE_TERM_ID = -2;

async function ensurePersistentReportSignatures(db, organizationId) {
  await db.query(
    `INSERT INTO report_settings (
       organization_id,
       class_id,
       term_id,
       signature_image_path,
       signature_name,
       signature_title
     )
     SELECT organization_id, class_id, $2, signature_image_path, signature_name, signature_title
     FROM (
       SELECT DISTINCT ON (rs.class_id)
         rs.organization_id,
         rs.class_id,
         rs.signature_image_path,
         rs.signature_name,
         rs.signature_title
       FROM report_settings rs
       JOIN terms t ON t.term_id = rs.term_id
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE rs.organization_id = $1
         AND rs.term_id NOT IN (-2, -1)
         AND rs.signature_image_path IS NOT NULL
       ORDER BY
         rs.class_id,
         sy.current DESC,
         t.start_date DESC NULLS LAST,
         t.end_date DESC NULLS LAST,
         rs.term_id DESC
     ) latest
     ON CONFLICT (organization_id, class_id, term_id) DO NOTHING`,
    [organizationId, REPORT_SIGNATURE_TERM_ID]
  );
}

module.exports = {
  REPORT_SIGNATURE_TERM_ID,
  ensurePersistentReportSignatures,
};
