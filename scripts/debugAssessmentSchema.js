const db = require('../config/db');

// Copy the exact same functions from commonController
function parseBooleanValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalizedValue = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalizedValue);
}

function computeAssessmentEditability(control, now = new Date()) {
  const locked = Boolean(control?.is_locked);
  const active = control?.is_active === undefined || control?.is_active === null
    ? true
    : Boolean(control.is_active);
  const windowStart = control?.edit_window_start ? new Date(control.edit_window_start) : null;
  const windowEnd = control?.edit_window_end ? new Date(control.edit_window_end) : null;
  const withinStart = !windowStart || now >= windowStart;
  const withinEnd = !windowEnd || now <= windowEnd;
  const withinWindow = withinStart && withinEnd;
  if (locked) return { canEdit: false, reason: 'Locked' };
  if (!active) return { canEdit: false, reason: 'Inactive' };
  if (!withinWindow) return { canEdit: false, reason: 'Outside time window' };
  return { canEdit: true, reason: 'Editable' };
}

(async () => {
  try {
    // 1. Run DDL
    await db.query(`
      ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS edit_window_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS edit_window_end TIMESTAMPTZ
    `);
    console.log('DDL OK');

    // 2. Run the query
    const assessmentsResult = await db.query(`
      SELECT a.group_id, a.title, a.weight, a.max_score, a.category, a.term_id,
             c.class_id, c.class_name, s.subject_name,
             BOOL_OR(COALESCE(a.is_locked, FALSE)) OVER (PARTITION BY a.group_id) AS is_locked,
             BOOL_AND(COALESCE(a.is_active, TRUE)) OVER (PARTITION BY a.group_id) AS is_active,
             MIN(a.edit_window_start) OVER (PARTITION BY a.group_id) AS edit_window_start,
             MAX(a.edit_window_end) OVER (PARTITION BY a.group_id) AS edit_window_end
      FROM assessments a
      LEFT JOIN classes c ON a.class_id = c.class_id
      LEFT JOIN subjects s ON a.subject_id = s.subject_id
      WHERE a.organization_id = 63 AND a.term_id = 150
      ORDER BY a.group_id, c.class_id, s.subject_name
    `, []);
    console.log('Query rows:', assessmentsResult.rowCount);

    // 3. Process exactly as the controller does
    const assessmentsMap = {};
    for (let row of assessmentsResult.rows) {
      const groupId = row.group_id;
      if (!assessmentsMap[groupId]) {
        const editability = computeAssessmentEditability(row);
        assessmentsMap[groupId] = {
          group_id: groupId,
          title: row.title,
          weight: row.weight,
          max_score: row.max_score,
          category: row.category,
          term_id: row.term_id,
          is_locked: row.is_locked,
          is_active: row.is_active,
          edit_window_start: row.edit_window_start,
          edit_window_end: row.edit_window_end,
          can_edit_scores: editability.canEdit,
          access_reason: editability.reason,
          assigned_classes: {},
        };
      }
      if (!assessmentsMap[groupId].assigned_classes[row.class_id]) {
        assessmentsMap[groupId].assigned_classes[row.class_id] = {
          class_id: row.class_id,
          class_name: row.class_name,
          subjects: [],
        };
      }
      assessmentsMap[groupId].assigned_classes[row.class_id].subjects.push(row.subject_name);
    }

    const assessments = Object.values(assessmentsMap).map((assessment) => ({
      ...assessment,
      assigned_classes: Object.values(assessment.assigned_classes),
    }));

    console.log('JS processing OK, assessment groups:', assessments.length);
    console.log('Sample assessment:', JSON.stringify(assessments[0], null, 2).slice(0, 300));

    // 4. Check for any null group_ids
    const nullGroups = assessments.filter(a => a.group_id == null);
    if (nullGroups.length) console.log('WARNING: null group_id assessments:', nullGroups.length);

  } catch (e) {
    console.error('FULL PIPELINE ERROR:', e.message);
    console.error(e.stack);
  }
  process.exit(0);
})();

