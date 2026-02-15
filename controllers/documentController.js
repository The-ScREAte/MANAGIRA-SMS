const bcrypt = require("bcryptjs");

const documentController = {
  // List all documents for the organization
  async documentsList(req, res, db) {
    try {
      const orgId = req.session.organizationId;
      const userId = req.session.userId;

      // Get all documents created by users in this org (not deleted)
      const docs = await db.query(`
        SELECT d.id, d.title, d.doc_type, d.created_at, d.updated_at,
          u.first_name || ' ' || u.last_name AS created_by_name,
          d.created_by
        FROM documents d
        JOIN users u ON d.created_by = u.user_id
        WHERE d.organization_id = $1 AND d.is_deleted = FALSE
        ORDER BY d.updated_at DESC
      `, [orgId]);

      // Get classes for assignment dropdowns
      const classes = await db.query(`
        SELECT c.class_id, c.class_name 
        FROM classes c 
        WHERE c.organization_id = $1 
        ORDER BY c.class_name
      `, [orgId]);

      // Get employees for permission assignment
      const employees = await db.query(`
        SELECT u.user_id, u.first_name || ' ' || u.last_name AS name, u.role
        FROM users u
        WHERE u.organization_id = $1 AND u.status = 'Active'
        ORDER BY u.first_name
      `, [orgId]);

      res.render("common/documents", {
        title: "Documents",
        documents: docs.rows,
        classes: classes.rows,
        employees: employees.rows,
        userId,
        layout: "layout",
        showOrgHeader: true,
      });
    } catch (error) {
      console.error("Error loading documents:", error);
      req.flash("error", "Failed to load documents.");
      res.redirect("/common/management");
    }
  },

  // Create a new document
  async createDocument(req, res, db) {
    try {
      const orgId = req.session.organizationId;
      const userId = req.session.userId;
      const { title, doc_type } = req.body;

      const docTitle = title || (doc_type === 'spreadsheet' ? 'Untitled Spreadsheet' : 'Untitled Document');
      const defaultContent = doc_type === 'spreadsheet' 
        ? JSON.stringify({ cells: {}, colCount: 10, rowCount: 20 })
        : '';

      const result = await db.query(`
        INSERT INTO documents (organization_id, title, doc_type, content, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [orgId, docTitle, doc_type || 'document', defaultContent, userId]);

      // Auto-add creator with edit permission
      await db.query(`
        INSERT INTO document_permissions (document_id, user_id, permission_level)
        VALUES ($1, $2, 'edit')
      `, [result.rows[0].id, userId]);

      res.json({ success: true, documentId: result.rows[0].id });
    } catch (error) {
      console.error("Error creating document:", error);
      res.status(500).json({ success: false, message: "Failed to create document." });
    }
  },

  // Get document editor page
  async documentEditor(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;
      const userId = req.session.userId;
      const userRole = req.session.userRole;

      // Get document
      const docResult = await db.query(`
        SELECT d.*, u.first_name || ' ' || u.last_name AS created_by_name
        FROM documents d
        JOIN users u ON d.created_by = u.user_id
        WHERE d.id = $1 AND d.organization_id = $2 AND d.is_deleted = FALSE
      `, [docId, orgId]);

      if (docResult.rows.length === 0) {
        req.flash("error", "Document not found.");
        return res.redirect("/common/documents");
      }

      const doc = docResult.rows[0];

      // Check permission - creators and managers always have edit access
      let permissionLevel = 'view';
      if (doc.created_by === userId || userRole === 'Manager' || userRole === 'Supervisor') {
        permissionLevel = 'edit';
      } else {
        // Check direct permission
        const permResult = await db.query(`
          SELECT permission_level FROM document_permissions
          WHERE document_id = $1 AND user_id = $2
        `, [docId, userId]);

        if (permResult.rows.length > 0) {
          permissionLevel = permResult.rows[0].permission_level;
        } else {
          // Check class-based permission
          const classPermResult = await db.query(`
            SELECT dca.permission_level FROM document_class_assignments dca
            JOIN class_employees ce ON dca.class_id = ce.class_id
            WHERE dca.document_id = $1 AND ce.user_id = $2
            LIMIT 1
          `, [docId, userId]);

          if (classPermResult.rows.length > 0) {
            permissionLevel = classPermResult.rows[0].permission_level;
          }
        }
      }

      // Get permissions list
      const permissions = await db.query(`
        SELECT dp.*, u.first_name || ' ' || u.last_name AS user_name
        FROM document_permissions dp
        JOIN users u ON dp.user_id = u.user_id
        WHERE dp.document_id = $1
      `, [docId]);

      // Get class assignments
      const classAssignments = await db.query(`
        SELECT dca.*, c.class_name
        FROM document_class_assignments dca
        JOIN classes c ON dca.class_id = c.class_id
        WHERE dca.document_id = $1
      `, [docId]);

      // Get classes and employees for assignment
      const classes = await db.query(`
        SELECT c.class_id, c.class_name FROM classes c 
        WHERE c.organization_id = $1 ORDER BY c.class_name
      `, [orgId]);

      const employees = await db.query(`
        SELECT u.user_id, u.first_name || ' ' || u.last_name AS name, u.role
        FROM users u WHERE u.organization_id = $1 AND u.status = 'Active'
        ORDER BY u.first_name
      `, [orgId]);

      res.render("common/documentEditor", {
        title: doc.title,
        document: doc,
        permissionLevel,
        permissions: permissions.rows,
        classAssignments: classAssignments.rows,
        classes: classes.rows,
        employees: employees.rows,
        userId,
        layout: false,
      });
    } catch (error) {
      console.error("Error loading document editor:", error);
      req.flash("error", "Failed to load document.");
      res.redirect("/common/documents");
    }
  },

  // Auto-save document content
  async saveDocument(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;
      const userId = req.session.userId;
      const { content, title } = req.body;

      // Verify permission
      const doc = await db.query(`SELECT created_by FROM documents WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE`, [docId, orgId]);
      if (doc.rows.length === 0) return res.status(404).json({ success: false });

      const hasEdit = await documentController._hasEditPermission(db, docId, userId, req.session.userRole, doc.rows[0].created_by);
      if (!hasEdit) return res.status(403).json({ success: false, message: "No edit permission." });

      const updates = [];
      const values = [];
      let idx = 1;

      if (content !== undefined) { updates.push(`content = $${idx++}`); values.push(content); }
      if (title !== undefined) { updates.push(`title = $${idx++}`); values.push(title); }
      updates.push(`updated_at = NOW()`);
      values.push(docId);

      await db.query(`UPDATE documents SET ${updates.join(', ')} WHERE id = $${idx}`, values);

      res.json({ success: true });
    } catch (error) {
      console.error("Error saving document:", error);
      res.status(500).json({ success: false });
    }
  },

  // Get document content (for polling/refresh)
  async getDocumentContent(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;

      const result = await db.query(`
        SELECT content, title, updated_at FROM documents
        WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE
      `, [docId, orgId]);

      if (result.rows.length === 0) return res.status(404).json({ success: false });

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false });
    }
  },

  // Delete document
  async deleteDocument(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;

      await db.query(`UPDATE documents SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND organization_id = $2`, [docId, orgId]);

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ success: false });
    }
  },

  // Update permissions
  async updatePermissions(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;
      const { permissions, classAssignments } = req.body;

      // Verify document belongs to org
      const doc = await db.query(`SELECT id FROM documents WHERE id = $1 AND organization_id = $2`, [docId, orgId]);
      if (doc.rows.length === 0) return res.status(404).json({ success: false });

      // Update user permissions
      if (permissions) {
        await db.query(`DELETE FROM document_permissions WHERE document_id = $1`, [docId]);
        for (const perm of permissions) {
          await db.query(`
            INSERT INTO document_permissions (document_id, user_id, permission_level)
            VALUES ($1, $2, $3)
            ON CONFLICT (document_id, user_id) DO UPDATE SET permission_level = $3
          `, [docId, perm.user_id, perm.permission_level]);
        }
      }

      // Update class assignments
      if (classAssignments) {
        await db.query(`DELETE FROM document_class_assignments WHERE document_id = $1`, [docId]);
        for (const assignment of classAssignments) {
          await db.query(`
            INSERT INTO document_class_assignments (document_id, class_id, include_students, include_subjects, permission_level)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (document_id, class_id) DO UPDATE SET include_students = $3, include_subjects = $4, permission_level = $5
          `, [docId, assignment.class_id, assignment.include_students || false, assignment.include_subjects || false, assignment.permission_level || 'view']);
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating permissions:", error);
      res.status(500).json({ success: false });
    }
  },

  // Get documents accessible by a teacher for a specific class
  async classDocuments(req, res, db) {
    try {
      const classId = req.query.classId;
      const userId = req.session.userId;
      const orgId = req.session.organizationId;

      // Documents assigned to this class OR where user has direct permission
      const docs = await db.query(`
        SELECT DISTINCT d.id, d.title, d.doc_type, d.updated_at,
          u.first_name || ' ' || u.last_name AS created_by_name,
          COALESCE(dca.permission_level, dp.permission_level, 'view') AS permission_level
        FROM documents d
        JOIN users u ON d.created_by = u.user_id
        LEFT JOIN document_class_assignments dca ON d.id = dca.document_id AND dca.class_id = $1
        LEFT JOIN document_permissions dp ON d.id = dp.document_id AND dp.user_id = $2
        WHERE d.organization_id = $3 AND d.is_deleted = FALSE
          AND (dca.class_id IS NOT NULL OR dp.user_id IS NOT NULL OR d.created_by = $2)
        ORDER BY d.updated_at DESC
      `, [classId, userId, orgId]);

      res.json({ success: true, documents: docs.rows });
    } catch (error) {
      console.error("Error fetching class documents:", error);
      res.status(500).json({ success: false });
    }
  },

  // Get students and subjects for a class (for spreadsheet insertion)
  async getClassData(req, res, db) {
    try {
      const classId = req.query.classId;
      const orgId = req.session.organizationId;
      const termId = req.session.currentTermId;

      const students = await db.query(`
        SELECT s.student_id, s.first_name, s.last_name
        FROM students s
        JOIN enrollments e ON s.student_id = e.student_id
        WHERE e.class_id = $1 AND e.term_id = $2 AND s.organization_id = $3 AND s.status = 'Active'
        ORDER BY s.first_name, s.last_name
      `, [classId, termId, orgId]);

      const subjects = await db.query(`
        SELECT cs.subject_id, sub.subject_name
        FROM class_subjects cs
        JOIN subjects sub ON cs.subject_id = sub.subject_id
        WHERE cs.class_id = $1
        ORDER BY sub.subject_name
      `, [classId]);

      res.json({ success: true, students: students.rows, subjects: subjects.rows });
    } catch (error) {
      console.error("Error fetching class data:", error);
      res.status(500).json({ success: false });
    }
  },

  // Helper: check if user has edit permission
  async _hasEditPermission(db, docId, userId, userRole, createdBy) {
    if (createdBy === userId || userRole === 'Manager' || userRole === 'Supervisor') return true;
    
    const perm = await db.query(`
      SELECT permission_level FROM document_permissions WHERE document_id = $1 AND user_id = $2
    `, [docId, userId]);
    if (perm.rows.length > 0 && perm.rows[0].permission_level === 'edit') return true;

    const classPerm = await db.query(`
      SELECT dca.permission_level FROM document_class_assignments dca
      JOIN class_employees ce ON dca.class_id = ce.class_id
      WHERE dca.document_id = $1 AND ce.user_id = $2 AND dca.permission_level = 'edit'
      LIMIT 1
    `, [docId, userId]);
    return classPerm.rows.length > 0;
  }
};

module.exports = { documentController };
