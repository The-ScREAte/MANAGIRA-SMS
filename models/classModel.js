// models/classModel.js

exports.getFirstClassForOrganization = async (pool, organizationId) => {
    const query = 'SELECT * FROM classes WHERE organization_id = $1 ORDER BY class_id ASC LIMIT 1';
    const values = [organizationId];

    try {
        const result = await pool.query(query, values);
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting first class for organization:', error);
        throw error;
    }
};
