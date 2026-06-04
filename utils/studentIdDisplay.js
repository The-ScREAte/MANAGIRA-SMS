function buildStudentDisplayId(student = {}, studentIdSettings = {}) {
  const systemStudentId = Number(student.student_id);
  const systemIdText = Number.isInteger(systemStudentId) && systemStudentId > 0
    ? String(systemStudentId)
    : '';

  if (!studentIdSettings || !studentIdSettings.use_custom_student_id) {
    return systemIdText;
  }

  const customStudentId = String(student.custom_student_id || '').trim();
  if (customStudentId) {
    return customStudentId;
  }

  const prefix = String(studentIdSettings.student_id_prefix || '');
  if (!systemIdText) {
    return prefix;
  }

  return prefix + systemIdText.padStart(Math.max(3, systemIdText.length), '0');
}

async function getOrganizationStudentIdSettings(dbClient, organizationId) {
  const result = await dbClient.query(
    `SELECT use_custom_student_id, student_id_prefix
       FROM organizations
      WHERE organization_id = $1`,
    [organizationId]
  );

  return result.rows[0] || {};
}

module.exports = {
  buildStudentDisplayId,
  getOrganizationStudentIdSettings,
};