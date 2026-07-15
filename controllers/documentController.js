const bcrypt = require("bcryptjs");
const { sendEmailInBackground } = require("../utils/emailHelper");
const { isEmailEnabledForRecipient } = require("../utils/emailPreferences");
const { PERMISSIONS, userHasPermission } = require("../middleware/permissionMiddleware");
const notifSvc = require("../utils/notificationService");

let documentsSchemaReadyPromise = null;

const ensureDocumentsSchema = async (db) => {
  if (!documentsSchemaReadyPromise) {
    documentsSchemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL DEFAULT 'Untitled Document',
          doc_type VARCHAR(20) NOT NULL DEFAULT 'document' CHECK (doc_type IN ('document', 'spreadsheet')),
          content TEXT DEFAULT '',
          created_by INTEGER NOT NULL REFERENCES users(user_id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_deleted BOOLEAN DEFAULT FALSE
        );
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS document_permissions (
          id SERIAL PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
          permission_level VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission_level IN ('view', 'edit', 'comment')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(document_id, user_id)
        );
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS document_class_assignments (
          id SERIAL PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          class_id INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
          include_students BOOLEAN DEFAULT FALSE,
          include_subjects BOOLEAN DEFAULT FALSE,
          permission_level VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission_level IN ('view', 'edit', 'comment')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(document_id, class_id)
        );
      `);

      await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_org_id ON documents(organization_id);`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(is_deleted);`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_doc_permissions_doc_id ON document_permissions(document_id);`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_doc_permissions_user_id ON document_permissions(user_id);`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_doc_class_assignments_doc_id ON document_class_assignments(document_id);`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_doc_class_assignments_class_id ON document_class_assignments(class_id);`);
    })().catch((error) => {
      documentsSchemaReadyPromise = null;
      throw error;
    });
  }

  await documentsSchemaReadyPromise;
};

const resolveCreatorUserId = async (
  db,
  { orgId, sessionUserId, sessionAccountType }
) => {
  if (!orgId) return null;

  const numericSessionUserId = Number(sessionUserId);
  if (Number.isInteger(numericSessionUserId) && numericSessionUserId > 0) {
    const directUser = await db.query(
      `
      SELECT user_id
      FROM users
      WHERE user_id = $1
        AND organization_id = $2
      LIMIT 1
    `,
      [numericSessionUserId, orgId]
    );

    if (directUser.rows.length > 0) {
      return directUser.rows[0].user_id;
    }
  }

  const isOrganizationLogin =
    String(sessionAccountType || "").trim() === "Organization";

  if (isOrganizationLogin) {
    const orgIdentityResult = await db.query(
      `
      SELECT email, first_name, last_name, password
      FROM organizations
      WHERE organization_id = $1
      LIMIT 1
    `,
      [orgId]
    );

    const orgIdentity = orgIdentityResult.rows[0] || null;

    if (orgIdentity?.email) {
      const managerByEmail = await db.query(
        `
        SELECT user_id
        FROM users
        WHERE organization_id = $1
          AND account_type = 'Manager'
          AND email::text ILIKE $2
        ORDER BY user_id ASC
        LIMIT 1
      `,
        [orgId, orgIdentity.email]
      );

      if (managerByEmail.rows.length > 0) {
        return managerByEmail.rows[0].user_id;
      }

      const userByEmailAnyRole = await db.query(
        `
        SELECT user_id
        FROM users
        WHERE organization_id = $1
          AND email::text ILIKE $2
        ORDER BY CASE WHEN account_type = 'Manager' THEN 0 ELSE 1 END, user_id ASC
        LIMIT 1
      `,
        [orgId, orgIdentity.email]
      );

      if (userByEmailAnyRole.rows.length > 0) {
        return userByEmailAnyRole.rows[0].user_id;
      }
    }

    if (orgIdentity?.first_name && orgIdentity?.last_name) {
      const managerByName = await db.query(
        `
        SELECT user_id
        FROM users
        WHERE organization_id = $1
          AND account_type = 'Manager'
          AND LOWER(first_name) = LOWER($2)
          AND LOWER(last_name) = LOWER($3)
        ORDER BY user_id ASC
        LIMIT 1
      `,
        [orgId, orgIdentity.first_name, orgIdentity.last_name]
      );

      if (managerByName.rows.length > 0) {
        return managerByName.rows[0].user_id;
      }
    }

    const managerCount = await db.query(
      `
      SELECT COUNT(*)::int AS total
      FROM users
      WHERE organization_id = $1
        AND account_type = 'Manager'
    `,
      [orgId]
    );

    const totalManagers = managerCount.rows[0]?.total || 0;

    if (totalManagers === 1) {
      const singleManager = await db.query(
        `
        SELECT user_id
        FROM users
        WHERE organization_id = $1
          AND account_type = 'Manager'
        LIMIT 1
      `,
        [orgId]
      );

      return singleManager.rows[0]?.user_id || null;
    }

    if (totalManagers > 1) {
      return null;
    }

    if (totalManagers === 0) {
      // No managers found — cannot auto-create users as a side effect
      return null;
    }

    const organizationOwnerUser = await db.query(
      `
      SELECT user_id
      FROM users
      WHERE organization_id = $1
        AND account_type = 'Manager'
      ORDER BY user_id ASC
      LIMIT 1
    `,
      [orgId]
    );

    if (organizationOwnerUser.rows.length > 0) {
      return organizationOwnerUser.rows[0].user_id;
    }

    return null;
  }

  const fallbackByRole = await db.query(
    `
    SELECT user_id
    FROM users
    WHERE organization_id = $1
      AND account_type IN ('Manager', 'Supervisor')
    ORDER BY
      CASE
        WHEN account_type = 'Manager' THEN 0
        WHEN account_type = 'Supervisor' THEN 1
        ELSE 2
      END,
      user_id ASC
    LIMIT 1
  `,
    [orgId]
  );

  if (fallbackByRole.rows.length > 0) {
    return fallbackByRole.rows[0].user_id;
  }

  return null;
};

const classBelongsToOrg = async (db, classId, orgId) => {
  if (!classId || !orgId) return false;
  const result = await db.query(`
    SELECT 1
    FROM classes
    WHERE class_id = $1 AND organization_id = $2
    LIMIT 1
  `, [classId, orgId]);
  return result.rows.length > 0;
};

const notifyTeachersOnNewClassAssignments = async ({ db, req, orgId, docId, docTitle, classIds }) => {
  if (!Array.isArray(classIds) || classIds.length === 0) return;

  try {
    const recipientsResult = await db.query(`
      SELECT DISTINCT
        u.email,
        u.first_name,
        c.class_name,
        c.class_id
      FROM class_employees ce
      JOIN users u ON u.user_id = ce.user_id
      JOIN classes c ON c.class_id = ce.class_id
      WHERE ce.class_id = ANY($1::int[])
        AND c.organization_id = $2
        AND u.organization_id = $2
        AND u.account_type = 'Teacher'
        AND COALESCE(u.email, '') <> ''
    `, [classIds, orgId]);

    if (!recipientsResult.rows.length) return;

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    await Promise.all(recipientsResult.rows.map(async (row) => {
      // Honor each teacher's per-recipient files_assigned_to_class preference.
      if (!(await isEmailEnabledForRecipient(db, row.email, 'files_assigned_to_class'))) return;
      const openUrl = `${baseUrl}/documents?classId=${row.class_id}`;
      const safeTeacherName = row.first_name || 'Teacher';
      const safeClassName = row.class_name || 'your class';
      const safeDocTitle = docTitle || `File #${docId}`;

      const html = `
        <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:640px;margin:0 auto;">
          <h2 style="color:#0f766e;">New file assigned</h2>
          <p>Hello ${safeTeacherName},</p>
          <p>A new file has been assigned to <strong>${safeClassName}</strong>.</p>
          <p><strong>File:</strong> ${safeDocTitle}</p>
          <p>
            <a href="${openUrl}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">
              Open Files
            </a>
          </p>
          <p style="font-size:12px;color:#64748b;">This is an automated Managira notification.</p>
        </div>
      `;

      sendEmailInBackground({
        to: row.email,
        subject: `New file assigned: ${safeDocTitle}`,
        html,
      }, 'Files Assignment Email');
    }));
  } catch (error) {
    console.error('Files assignment email failed:', error.message);
  }
};

const documentController = {
  // List all documents for the organization
  async documentsList(req, res, db) {
    const orgId = req.session.organizationId;
    const userId = req.session.userId || req.session.user?.user_id || null;
    const userRole = req.session.userRole;
    const accountType = req.session.accountType;
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const canManageRecords = await userHasPermission(
      db,
      { userId, userRole, organizationId: orgId, accountType },
      PERMISSIONS.MANAGE_RECORDS
    );
    const canCreate = canManageRecords;
    const shouldAutoCreate = canCreate && req.query.create === '1';

    // For Organisation logins the session userId is null; resolve the actual
    // manager user_id so that "created_by" queries match correctly.
    let effectiveUserId = userId;
    if (!effectiveUserId && canCreate) {
      effectiveUserId = await resolveCreatorUserId(db, {
        orgId,
        sessionUserId: userId,
        sessionAccountType: accountType,
      });
    }

    try {
      await ensureDocumentsSchema(db);

      let documentRows = [];

      if (classId) {
        const classExists = await classBelongsToOrg(db, classId, orgId);
        if (!classExists) {
          documentRows = [];
        } else if (canCreate) {
          // Admin / manager: show ALL org docs with class-context labels.
          // No userId filter — admins see everything regardless of who created it.
          const docs = await db.query(`
            SELECT DISTINCT d.id, d.title, d.doc_type, d.created_at, d.updated_at,
              u.first_name || ' ' || u.last_name AS created_by_name,
              d.created_by,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM document_class_assignments dca
                  WHERE dca.document_id = d.id AND dca.class_id = $2
                ) THEN 'class'::text
                WHEN EXISTS (
                  SELECT 1 FROM document_class_assignments dca
                  JOIN classes c ON c.class_id = dca.class_id
                  WHERE dca.document_id = d.id AND c.organization_id = $1
                ) THEN 'other_class'::text
                ELSE 'personal'::text
              END AS visibility_type,
              (
                SELECT c3.class_name
                FROM document_class_assignments dca3
                JOIN classes c3 ON c3.class_id = dca3.class_id
                WHERE dca3.document_id = d.id AND c3.organization_id = $1
                LIMIT 1
              ) AS other_class_name
            FROM documents d
            JOIN users u ON d.created_by = u.user_id
            WHERE d.organization_id = $1 AND d.is_deleted = FALSE
            ORDER BY d.updated_at DESC
          `, [orgId, classId]);
          documentRows = docs.rows;
        } else {
          // Regular user (teacher etc): show only docs they can access for this class.
          // Case 1: doc assigned to THIS class AND user is a class_employee
          // Case 2: doc created by user OR user has explicit permission, NOT assigned to this class
          const docs = await db.query(`
            SELECT id, title, doc_type, created_at, updated_at, created_by_name, created_by,
                   visibility_type, other_class_name
            FROM (
              SELECT DISTINCT d.id, d.title, d.doc_type, d.created_at, d.updated_at,
                u.first_name || ' ' || u.last_name AS created_by_name,
                d.created_by,
                'class'::text AS visibility_type,
                NULL::text AS other_class_name
              FROM documents d
              JOIN users u ON d.created_by = u.user_id
              JOIN document_class_assignments dca ON d.id = dca.document_id AND dca.class_id = $2
              WHERE d.organization_id = $1 AND d.is_deleted = FALSE
                AND EXISTS (
                  SELECT 1 FROM class_employees ce
                  WHERE ce.class_id = $2 AND ce.user_id = $3
                )

              UNION

              SELECT DISTINCT d.id, d.title, d.doc_type, d.created_at, d.updated_at,
                u.first_name || ' ' || u.last_name AS created_by_name,
                d.created_by,
                CASE
                  WHEN EXISTS (
                    SELECT 1 FROM document_class_assignments dca2
                    JOIN classes c2 ON c2.class_id = dca2.class_id
                    WHERE dca2.document_id = d.id AND c2.organization_id = $1
                  ) THEN 'other_class'::text
                  ELSE 'personal'::text
                END AS visibility_type,
                (
                  SELECT c3.class_name
                  FROM document_class_assignments dca3
                  JOIN classes c3 ON c3.class_id = dca3.class_id
                  WHERE dca3.document_id = d.id AND c3.organization_id = $1
                  LIMIT 1
                ) AS other_class_name
              FROM documents d
              JOIN users u ON d.created_by = u.user_id
              LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $3
              WHERE d.organization_id = $1 AND d.is_deleted = FALSE
                AND (d.created_by = $3 OR dp.user_id IS NOT NULL)
                AND NOT EXISTS (
                  SELECT 1 FROM document_class_assignments dca4
                  WHERE dca4.document_id = d.id AND dca4.class_id = $2
                )
            ) sub
            ORDER BY updated_at DESC
          `, [orgId, classId, effectiveUserId]);
          console.log('[DOCS][LIST][USER] query returned', docs.rows.length, 'rows for classId', classId, 'userId', userId, 'effectiveUserId', effectiveUserId);
          documentRows = docs.rows;
        }
      } else if (canCreate) {
        // No classId — admin/manager sees all org docs
        const docs = await db.query(`
          SELECT d.id, d.title, d.doc_type, d.created_at, d.updated_at,
            u.first_name || ' ' || u.last_name AS created_by_name,
            d.created_by,
            NULL::text AS visibility_type,
            NULL::text AS other_class_name
          FROM documents d
          JOIN users u ON d.created_by = u.user_id
          WHERE d.organization_id = $1 AND d.is_deleted = FALSE
          ORDER BY d.updated_at DESC
        `, [orgId]);
        documentRows = docs.rows;
      } else {
        // No classId, no manage-records — user sees only their own / permitted docs
        const docs = await db.query(`
          SELECT DISTINCT d.id, d.title, d.doc_type, d.created_at, d.updated_at,
            u.first_name || ' ' || u.last_name AS created_by_name,
            d.created_by,
            NULL::text AS visibility_type,
            NULL::text AS other_class_name
          FROM documents d
          JOIN users u ON d.created_by = u.user_id
          LEFT JOIN document_permissions dp ON d.id = dp.document_id AND dp.user_id = $1
          LEFT JOIN document_class_assignments dca ON d.id = dca.document_id
          LEFT JOIN class_employees ce ON ce.class_id = dca.class_id AND ce.user_id = $1
          WHERE d.organization_id = $2 AND d.is_deleted = FALSE
            AND (d.created_by = $1 OR dp.user_id IS NOT NULL OR ce.user_id IS NOT NULL)
          ORDER BY d.updated_at DESC
        `, [effectiveUserId, orgId]);
        documentRows = docs.rows;
      }

      // Get classes for assignment dropdowns
      const classes = await db.query(`
        SELECT c.class_id, c.class_name 
        FROM classes c 
        WHERE c.organization_id = $1 
        ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC
      `, [orgId]);

      // Get employees for permission assignment
      const employees = await db.query(`
        SELECT u.user_id, u.first_name || ' ' || u.last_name AS name, u.account_type AS role
        FROM users u
        WHERE u.organization_id = $1
        ORDER BY u.first_name
      `, [orgId]);

      res.render("common/documents", {
        title: "Docs/Sheets",
        documents: documentRows,
        classes: classes.rows,
        employees: employees.rows,
        userId,
        canCreate,
        classId,
        autoCreate: shouldAutoCreate,
        layout: "layout",
        showOrgHeader: true,
        hideGlobalHeader: true,
        hideGlobalFooter: true,
      });
    } catch (error) {
      console.error('[FILES][LIST][ERROR]', {
        path: req.originalUrl,
        orgId: req.session.organizationId,
        userId: req.session.userId,
        userRole: req.session.userRole,
        message: error.message,
        stack: error.stack,
      });

      try {
        return res.render("common/documents", {
          title: "Docs/Sheets",
          documents: [],
          classes: [],
          employees: [],
          userId,
          canCreate,
          classId,
          autoCreate: shouldAutoCreate,
          layout: "layout",
          showOrgHeader: true,
          hideGlobalHeader: true,
          hideGlobalFooter: true,
        });
      } catch (renderError) {
        console.error('[FILES][LIST][FALLBACK_RENDER_ERROR]', {
          path: req.originalUrl,
          message: renderError.message,
          stack: renderError.stack,
        });
        req.flash("error", "Failed to load files page.");
        return res.redirect("/common/management");
      }
    }
  },

  // Create a new document
  async createDocument(req, res, db) {
    try {
      await ensureDocumentsSchema(db);

      const orgId = req.session.organizationId;
      const userId = req.session.userId || req.session.user?.user_id || null;
      const userRole = req.session.userRole;
      const { title, doc_type } = req.body;

      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      if (!canManageRecords) {
        return res.status(403).json({ success: false, message: "You do not have permission to create docs or sheets." });
      }

      const creatorUserId = await resolveCreatorUserId(db, {
        orgId,
        sessionUserId: userId,
        sessionAccountType: req.session.accountType,
      });
      if (!creatorUserId) {
        console.error('[FILES][CREATE][OWNER_MAP_FAILED]', {
          orgId,
          sessionUserId: userId,
          sessionAccountType: req.session.accountType,
          sessionUserRole: userRole,
          sessionEmail: req.session?.user?.email || null,
        });
        return res.status(400).json({ success: false, message: "Unable to safely map this organization login to its manager profile. Ask admin to align manager email/name with organization account." });
      }

      const docTitle = title || (doc_type === 'spreadsheet' ? 'Untitled Spreadsheet' : 'Untitled Document');
      const defaultContent = doc_type === 'spreadsheet' 
        ? JSON.stringify({ cells: {}, colCount: 10, rowCount: 20 })
        : '';

      const result = await db.query(`
        INSERT INTO documents (organization_id, title, doc_type, content, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [orgId, docTitle, doc_type || 'document', defaultContent, creatorUserId]);

      // Auto-add creator with edit permission
      await db.query(`
        INSERT INTO document_permissions (document_id, user_id, permission_level)
        VALUES ($1, $2, 'edit')
      `, [result.rows[0].id, creatorUserId]);

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
      const userId = req.session.userId || req.session.user?.user_id || null;
      const userRole = req.session.userRole;
      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      // Get document
      const docResult = await db.query(`
        SELECT d.*, u.first_name || ' ' || u.last_name AS created_by_name
        FROM documents d
        JOIN users u ON d.created_by = u.user_id
        WHERE d.id = $1 AND d.organization_id = $2 AND d.is_deleted = FALSE
      `, [docId, orgId]);

      if (docResult.rows.length === 0) {
        req.flash("error", "Document not found.");
        return res.redirect("/documents");
      }

      const doc = docResult.rows[0];

      // Check permission - creators and managers always have edit access
      let permissionLevel = 'view';
      if (doc.created_by === userId || canManageRecords) {
        permissionLevel = 'edit';
      } else {
        // Check direct permission
        const permResult = await db.query(`
          SELECT dp.permission_level
          FROM document_permissions dp
          JOIN users u ON u.user_id = dp.user_id AND u.organization_id = $3
          WHERE document_id = $1 AND user_id = $2
        `, [docId, userId, orgId]);

        if (permResult.rows.length > 0) {
          permissionLevel = permResult.rows[0].permission_level;
        } else {
          // Check class-based permission
          const classPermResult = await db.query(`
            SELECT dca.permission_level FROM document_class_assignments dca
            JOIN class_employees ce ON dca.class_id = ce.class_id
            JOIN classes c ON c.class_id = dca.class_id AND c.organization_id = $3
            WHERE dca.document_id = $1 AND ce.user_id = $2
            LIMIT 1
          `, [docId, userId, orgId]);

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
        WHERE dp.document_id = $1 AND u.organization_id = $2
      `, [docId, orgId]);

      // Get class assignments
      const classAssignments = await db.query(`
        SELECT dca.*, c.class_name
        FROM document_class_assignments dca
        JOIN classes c ON dca.class_id = c.class_id
        WHERE dca.document_id = $1 AND c.organization_id = $2
      `, [docId, orgId]);

      // Get classes and employees for assignment
      const classes = await db.query(`
        SELECT c.class_id, c.class_name FROM classes c 
        WHERE c.organization_id = $1
        ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC
      `, [orgId]);

      const employees = await db.query(`
        SELECT u.user_id, u.first_name || ' ' || u.last_name AS name, u.account_type AS role
        FROM users u WHERE u.organization_id = $1
        ORDER BY u.first_name
      `, [orgId]);

      // Resolve safe return URL (must be relative path within the app)
      let returnUrl = '/documents';
      if (req.query.returnUrl) {
        const raw = decodeURIComponent(req.query.returnUrl);
        // Accept only relative paths or same-origin absolute URLs
        try {
          const parsed = new URL(raw, 'http://localhost');
          if (parsed.hostname === 'localhost' || parsed.hostname === '') {
            returnUrl = parsed.pathname + parsed.search + parsed.hash;
          }
        } catch (_) {
          if (raw.startsWith('/')) returnUrl = raw;
        }
      }

      res.render("common/documentEditor", {
        title: doc.title,
        document: doc,
        permissionLevel,
        permissions: permissions.rows,
        classAssignments: classAssignments.rows,
        classes: classes.rows,
        employees: employees.rows,
        userId,
        returnUrl,
        layout: false,
      });
    } catch (error) {
      console.error('[FILES][EDITOR][ERROR]', {
        path: req.originalUrl,
        docId: req.params.id,
        orgId: req.session.organizationId,
        userId: req.session.userId,
        userRole: req.session.userRole,
        message: error.message,
        stack: error.stack,
      });
      req.flash("error", "Failed to load document.");
      res.redirect("/documents");
    }
  },

  // Auto-save document content
  async saveDocument(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;
      const userId = req.session.userId || req.session.user?.user_id || null;
      const { content, title } = req.body;

      // Verify permission
      const doc = await db.query(`SELECT created_by FROM documents WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE`, [docId, orgId]);
      if (doc.rows.length === 0) return res.status(404).json({ success: false });

      const hasEdit = await documentController._hasEditPermission(
        db,
        docId,
        userId,
        req.session.userRole,
        orgId,
        doc.rows[0].created_by
      );
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
      const userId = req.session.userId || req.session.user?.user_id || null;
      const userRole = req.session.userRole;

      const result = await db.query(`
        SELECT content, title, updated_at, created_by FROM documents
        WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE
      `, [docId, orgId]);

      if (result.rows.length === 0) return res.status(404).json({ success: false });

      const doc = result.rows[0];

      // Verify user has access
      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      if (doc.created_by !== userId && !canManageRecords) {
        const directPerm = await db.query(
          `SELECT 1 FROM document_permissions WHERE document_id = $1 AND user_id = $2 LIMIT 1`,
          [docId, userId]
        );
        if (directPerm.rows.length === 0) {
          const classPerm = await db.query(`
            SELECT 1 FROM document_class_assignments dca
            JOIN class_employees ce ON dca.class_id = ce.class_id
            JOIN classes c ON c.class_id = dca.class_id AND c.organization_id = $3
            WHERE dca.document_id = $1 AND ce.user_id = $2
            LIMIT 1
          `, [docId, userId, orgId]);
          if (classPerm.rows.length === 0) {
            return res.status(403).json({ success: false });
          }
        }
      }

      res.json({ success: true, data: { content: doc.content, title: doc.title, updated_at: doc.updated_at } });
    } catch (error) {
      res.status(500).json({ success: false });
    }
  },

  // Delete document
  async deleteDocument(req, res, db) {
    try {
      const docId = req.params.id;
      const orgId = req.session.organizationId;
      const userId = req.session.userId || req.session.user?.user_id || null;
      const userRole = req.session.userRole;

      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      if (!canManageRecords) {
        return res.status(403).json({ success: false, message: "You do not have permission to delete files." });
      }

      // D4 — notify all users with explicit permissions before soft-delete
      try {
        const docInfo = await db.query(
          `SELECT title FROM documents WHERE id = $1 AND organization_id = $2`,
          [docId, orgId]
        );
        const docTitle = docInfo.rows[0]?.title || 'Document';
        const permUsers = await db.query(
          `SELECT user_id FROM document_permissions WHERE document_id = $1`,
          [docId]
        );
        const notifList = permUsers.rows.map(r => ({
          orgId: Number(orgId),
          recipientType: 'staff',
          recipientId: r.user_id,
          type: 'document_deleted',
          title: `Doc deleted`,
          body: `"${docTitle}" was removed`,
          link: null,
        }));
        if (notifList.length) {
          notifSvc.createNotifications(db, notifList)
            .catch(err => console.error('[Notif] document_deleted failed:', err.message));
        }
      } catch { /* silent */ }

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
      const userId = req.session.userId || req.session.user?.user_id || null;
      const userRole = req.session.userRole;
      const { permissions, classAssignments } = req.body;
      let addedClassIds = [];

      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      if (!canManageRecords) {
        return res.status(403).json({ success: false, message: "You do not have permission to update file permissions." });
      }

      // Verify document belongs to org
      const doc = await db.query(`SELECT id, title FROM documents WHERE id = $1 AND organization_id = $2`, [docId, orgId]);
      if (doc.rows.length === 0) return res.status(404).json({ success: false });

      // Use a dedicated client for transactional permission updates
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Update user permissions
        if (permissions) {
          const permissionUserIds = Array.from(new Set(
            permissions
              .map((perm) => Number(perm.user_id))
              .filter((id) => Number.isInteger(id) && id > 0)
          ));

          if (permissionUserIds.length > 0) {
            const validUsers = await client.query(`
              SELECT user_id FROM users
              WHERE organization_id = $1 AND user_id = ANY($2::int[])
            `, [orgId, permissionUserIds]);

            const validUserIds = new Set(validUsers.rows.map((row) => row.user_id));
            const hasInvalidUser = permissionUserIds.some((id) => !validUserIds.has(id));
            if (hasInvalidUser) {
              await client.query('ROLLBACK');
              client.release();
              return res.status(400).json({ success: false, message: 'One or more users do not belong to this organization.' });
            }
          }

          await client.query(`DELETE FROM document_permissions WHERE document_id = $1`, [docId]);
          for (const perm of permissions) {
            await client.query(`
              INSERT INTO document_permissions (document_id, user_id, permission_level)
              VALUES ($1, $2, $3)
              ON CONFLICT (document_id, user_id) DO UPDATE SET permission_level = $3
            `, [docId, perm.user_id, perm.permission_level]);
          }
        }

        // Update class assignments
        if (classAssignments) {
          const existingAssignments = await client.query(`
            SELECT dca.class_id
            FROM document_class_assignments dca
            JOIN classes c ON c.class_id = dca.class_id
            WHERE dca.document_id = $1 AND c.organization_id = $2
          `, [docId, orgId]);

          const existingClassIds = new Set(existingAssignments.rows.map((row) => Number(row.class_id)));

          const classIds = Array.from(new Set(
            classAssignments
              .map((assignment) => Number(assignment.class_id))
              .filter((id) => Number.isInteger(id) && id > 0)
          ));

          if (classIds.length > 0) {
            const validClasses = await client.query(`
              SELECT class_id FROM classes
              WHERE organization_id = $1 AND class_id = ANY($2::int[])
            `, [orgId, classIds]);

            const validClassIds = new Set(validClasses.rows.map((row) => row.class_id));
            const hasInvalidClass = classIds.some((id) => !validClassIds.has(id));
            if (hasInvalidClass) {
              await client.query('ROLLBACK');
              client.release();
              return res.status(400).json({ success: false, message: 'One or more classes do not belong to this organization.' });
            }
          }

          addedClassIds = classIds.filter((id) => !existingClassIds.has(id));

          await client.query(`DELETE FROM document_class_assignments WHERE document_id = $1`, [docId]);
          for (const assignment of classAssignments) {
            await client.query(`
              INSERT INTO document_class_assignments (document_id, class_id, include_students, include_subjects, permission_level)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (document_id, class_id) DO UPDATE SET include_students = $3, include_subjects = $4, permission_level = $5
            `, [docId, assignment.class_id, assignment.include_students || false, assignment.include_subjects || false, assignment.permission_level || 'view']);
          }
        }

        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      if (addedClassIds.length > 0) {
        await notifyTeachersOnNewClassAssignments({
          db,
          req,
          orgId,
          docId,
          docTitle: doc.rows[0].title,
          classIds: addedClassIds,
        });
      }

      // D1 — notify each user that a document was shared with them (only newly-added users)
      // We compare OLD vs NEW permissions to find genuinely new users
      // Since we do DELETE + re-INSERT, all current permission users get notified when this
      // function is called — but we only notify users who were actually granted access.
      // To keep it simple and correct: fire for all current permissions.
      if (permissions && Array.isArray(permissions)) {
        const docTitleSafe = doc.rows[0].title || 'Document';
        const notifList = permissions.map(p => ({
          orgId: Number(orgId),
          recipientType: 'staff',
          recipientId: Number(p.user_id),
          type: 'document_shared_user',
          title: `Doc shared with you`,
          body: `"${docTitleSafe}" — ${p.permission_level || 'view'} access`,
          link: `/documents/edit/${docId}`,
        }));
        notifSvc.createNotifications(db, notifList)
          .catch(err => console.error('[Notif] document_shared_user failed:', err.message));
      }

      // D2 — notify class teachers when a document is assigned to their class (new assignments only)
      if (addedClassIds.length > 0) {
        const docTitleSafe = doc.rows[0].title || 'Document';
        notifSvc.notifyPerClassTeachers(db, {
          orgId: Number(orgId),
          classIds: addedClassIds,
          type: 'document_shared_class',
          title: `Doc shared with your class`,
          body: `"${docTitleSafe}"`,
          linkTemplate: '/common/classDashboard/{classId}/docs',
        }).catch(err => console.error('[Notif] document_shared_class failed:', err.message));
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
      const userRole = req.session.userRole;
      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      const classExists = await classBelongsToOrg(db, classId, orgId);
      if (!classExists) {
        return res.json({ success: true, documents: [] });
      }

      if (!canManageRecords) {
        const classMembership = await db.query(`
          SELECT 1
          FROM class_employees ce
          JOIN classes c ON c.class_id = ce.class_id
          WHERE ce.class_id = $1 AND ce.user_id = $2 AND c.organization_id = $3
          LIMIT 1
        `, [classId, userId, orgId]);

        if (classMembership.rows.length === 0) {
          return res.json({ success: true, documents: [] });
        }
      }

      // Documents assigned to this class and accessible to the current user
      const docs = await db.query(`
        SELECT DISTINCT d.id, d.title, d.doc_type, d.updated_at,
          u.first_name || ' ' || u.last_name AS created_by_name,
          COALESCE(dca.permission_level, dp.permission_level, 'view') AS permission_level
        FROM documents d
        JOIN users u ON d.created_by = u.user_id
        JOIN document_class_assignments dca ON d.id = dca.document_id AND dca.class_id = $1
        JOIN classes c ON c.class_id = dca.class_id AND c.organization_id = $3
        LEFT JOIN document_permissions dp ON d.id = dp.document_id AND dp.user_id = $2
        WHERE d.organization_id = $3 AND d.is_deleted = FALSE
          AND (
            d.created_by = $2
            OR dp.user_id IS NOT NULL
            OR $4 = TRUE
            OR EXISTS (
              SELECT 1 FROM class_employees ce
              WHERE ce.class_id = dca.class_id AND ce.user_id = $2
            )
          )
        ORDER BY d.updated_at DESC
      `, [classId, userId, orgId, canManageRecords]);

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
      const userId = req.session.userId || req.session.user?.user_id || null;
      const userRole = req.session.userRole;

      const canManageRecords = await userHasPermission(
        db,
        { userId, userRole, organizationId: orgId },
        PERMISSIONS.MANAGE_RECORDS
      );

      if (!canManageRecords) {
        return res.status(403).json({ success: false, message: 'You do not have permission to access class file data.' });
      }

      const classExists = await classBelongsToOrg(db, classId, orgId);
      if (!classExists) {
        return res.status(403).json({ success: false, message: 'Class does not belong to this organization.' });
      }

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
        JOIN classes c ON cs.class_id = c.class_id
        WHERE cs.class_id = $1 AND c.organization_id = $2
        ORDER BY sub.subject_name
      `, [classId, orgId]);

      res.json({ success: true, students: students.rows, subjects: subjects.rows });
    } catch (error) {
      console.error("Error fetching class data:", error);
      res.status(500).json({ success: false });
    }
  },

  // Helper: check if user has edit permission
  async _hasEditPermission(db, docId, userId, userRole, orgId, createdBy) {
    const canManageRecords = await userHasPermission(
      db,
      { userId, userRole, organizationId: orgId },
      PERMISSIONS.MANAGE_RECORDS
    );

    if (createdBy === userId || canManageRecords) return true;
    
    const perm = await db.query(`
      SELECT permission_level FROM document_permissions WHERE document_id = $1 AND user_id = $2
    `, [docId, userId]);
    if (perm.rows.length > 0 && perm.rows[0].permission_level === 'edit') return true;

    const classPerm = await db.query(`
      SELECT dca.permission_level FROM document_class_assignments dca
      JOIN class_employees ce ON dca.class_id = ce.class_id
      JOIN documents d ON d.id = dca.document_id
      JOIN classes c ON c.class_id = dca.class_id AND c.organization_id = d.organization_id
      WHERE dca.document_id = $1 AND ce.user_id = $2 AND dca.permission_level = 'edit'
      LIMIT 1
    `, [docId, userId]);
    return classPerm.rows.length > 0;
  }
};

module.exports = { documentController };
