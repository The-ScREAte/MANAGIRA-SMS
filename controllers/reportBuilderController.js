const {
  REPORTS,
  PAGE_SIZE,
  MAX_EXPORT_ROWS,
  getReport,
  normalizeColumns,
  normalizeCriteria,
  buildWhere,
  buildSelect,
} = require("../utils/reportBuilder");

const elevatedRoles = new Set(["organization", "manager", "supervisor", "admin", "mini admin"]);
let reportSchemaPromise;

async function ensureReportSchema(db) {
  if (!reportSchemaPromise) {
    reportSchemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS custom_report_definitions (
        report_id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        created_by INTEGER,
        report_name VARCHAR(120) NOT NULL,
        report_type VARCHAR(40) NOT NULL,
        columns_json JSONB NOT NULL,
        criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_custom_report_definitions_org_created
        ON custom_report_definitions (organization_id, created_at DESC);
    `).catch((error) => {
      reportSchemaPromise = null;
      throw error;
    });
  }
  await reportSchemaPromise;
}

function getUserId(req) {
  const rawId = req.session?.user?.user_id || req.session?.userId;
  const userId = Number(rawId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function getOrganizationId(req) {
  const organizationId = Number(req.session?.organizationId);
  return Number.isInteger(organizationId) && organizationId > 0 ? organizationId : null;
}

async function getClassAccess(db, req, organizationId) {
  const roles = [req.session?.userRole, req.session?.accountType]
    .map((role) => String(role || "").trim().toLowerCase());
  if (roles.some((role) => elevatedRoles.has(role))) return null;

  const userId = getUserId(req);
  if (!userId) return [];
  const result = await db.query(
    `SELECT DISTINCT uc.class_id
       FROM user_classes uc
       JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2
      WHERE uc.user_id = $1`,
    [userId, organizationId]
  );
  return result.rows.map((row) => Number(row.class_id)).filter(Number.isInteger);
}

function formatFieldOptions(reportType) {
  const report = REPORTS[reportType];
  return Object.entries(report.columns).map(([key, value]) => ({
    key,
    label: value.label,
  }));
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(rows, columns, report) {
  const headers = columns.map((key) => csvCell(report.columns[key].label)).join(",");
  const lines = rows.map((row) => columns.map((key) => csvCell(row[key])).join(","));
  return `\uFEFF${[headers, ...lines].join("\r\n")}`;
}

function validateReportInput(body) {
  const reportType = String(body?.reportType || "");
  const report = getReport(reportType);
  if (!report) return { error: "Choose a report type." };
  const columns = normalizeColumns(report, body?.columns);
  const criteria = normalizeCriteria(body?.criteria);
  if (!criteria.validDates) return { error: "Enter dates in a valid YYYY-MM-DD format." };
  if (criteria.fromDate && criteria.toDate && criteria.fromDate > criteria.toDate) {
    return { error: "The start date must be before the end date." };
  }
  return { reportType, report, columns, criteria };
}

function reportBuilderController(db) {
  async function loadReportData(req, report, columns, criteria, limit, offset = 0) {
    const organizationId = getOrganizationId(req);
    const allowedClassIds = await getClassAccess(db, req, organizationId);
    const where = buildWhere(report, criteria, organizationId, allowedClassIds);
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total ${report.from} WHERE ${where.sql}`,
      where.values
    );
    const total = Number(countResult.rows[0]?.total || 0);
    if (offset >= total && offset > 0) return { rows: [], total };
    const selection = buildSelect(report, columns, where, { limit, offset });
    const dataResult = await db.query(selection.sql, selection.values);
    return { rows: dataResult.rows, total };
  }

  return {
    page: async (req, res) => {
      const organizationId = getOrganizationId(req);
      if (!organizationId) return res.status(401).send("Please sign in again.");

      try {
        await ensureReportSchema(db);
        const classIds = await getClassAccess(db, req, organizationId);
        const [classResult, termResult, savedResult] = await Promise.all([
          db.query(
            `SELECT class_id, class_name FROM classes
              WHERE organization_id = $1 AND obsolete_at IS NULL
              ${classIds ? "AND class_id = ANY($2::int[])" : ""}
              ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name, class_id`,
            classIds ? [organizationId, classIds] : [organizationId]
          ),
          db.query(
            `SELECT term_id, term_name FROM terms
              WHERE organization_id = $1
              ORDER BY start_date DESC NULLS LAST, term_id DESC`,
            [organizationId]
          ),
          db.query(
            `SELECT report_id, report_name, report_type, columns_json, criteria_json, created_at
               FROM custom_report_definitions
              WHERE organization_id = $1
              ORDER BY created_at DESC, report_id DESC`,
            [organizationId]
          ),
        ]);
        return res.render("common/reportBuilder", {
          title: "Report Builder",
          reportTypes: Object.entries(REPORTS).map(([key, value]) => ({
            key,
            title: value.title,
            description: value.description,
            searchLabel: value.searchLabel,
            columns: formatFieldOptions(key),
            defaultColumns: value.defaultColumns,
            hasClassFilter: Boolean(value.classExpression),
            hasTermFilter: Boolean(value.termExpression),
            hasDateFilter: Boolean(value.dateExpression),
          })),
          classes: classResult.rows,
          terms: termResult.rows,
          savedReports: savedResult.rows,
          isEmbeddedFrame: Boolean(res.locals.isEmbeddedFrame),
        });
      } catch (error) {
        console.error("[reportBuilder/page]", error);
        return res.status(500).send("Failed to load the report builder.");
      }
    },

    run: async (req, res) => {
      const organizationId = getOrganizationId(req);
      if (!organizationId) return res.status(401).json({ success: false, error: "Please sign in again." });
      const input = validateReportInput(req.body);
      if (input.error) return res.status(400).json({ success: false, error: input.error });

      const parsedPage = Number.parseInt(String(req.body?.page || 1), 10);
      const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
      const offset = (page - 1) * PAGE_SIZE;
      try {
        const { rows, total } = await loadReportData(
          req, input.report, input.columns, input.criteria, PAGE_SIZE, offset
        );
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          success: true,
          title: input.report.title,
          columns: input.columns.map((key) => ({ key, label: input.report.columns[key].label })),
          rows,
          total,
          page,
          pageSize: PAGE_SIZE,
          hasMore: offset + rows.length < total,
        });
      } catch (error) {
        console.error("[reportBuilder/run]", error);
        return res.status(500).json({ success: false, error: "Could not run this report." });
      }
    },

    save: async (req, res) => {
      const organizationId = getOrganizationId(req);
      if (!organizationId) return res.status(401).json({ success: false, error: "Please sign in again." });
      const input = validateReportInput(req.body);
      if (input.error) return res.status(400).json({ success: false, error: input.error });
      const reportName = String(req.body?.name || "").trim().slice(0, 120);
      if (!reportName) return res.status(400).json({ success: false, error: "Enter a name for this saved report." });

      try {
        await ensureReportSchema(db);
        const result = await db.query(
          `INSERT INTO custom_report_definitions
             (organization_id, created_by, report_name, report_type, columns_json, criteria_json)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
           RETURNING report_id, report_name, report_type, columns_json, criteria_json, created_at`,
          [
            organizationId,
            getUserId(req),
            reportName,
            input.reportType,
            JSON.stringify(input.columns),
            JSON.stringify(input.criteria),
          ]
        );
        return res.status(201).json({ success: true, report: result.rows[0] });
      } catch (error) {
        console.error("[reportBuilder/save]", error);
        return res.status(500).json({ success: false, error: "Could not save this report." });
      }
    },

    loadSaved: async (req, res) => {
      const organizationId = getOrganizationId(req);
      const reportId = Number.parseInt(req.params.reportId, 10);
      if (!organizationId) return res.status(401).json({ success: false, error: "Please sign in again." });
      if (!Number.isInteger(reportId) || reportId < 1) {
        return res.status(400).json({ success: false, error: "Invalid saved report." });
      }
      try {
        await ensureReportSchema(db);
        const result = await db.query(
          `SELECT report_id, report_name, report_type, columns_json, criteria_json
             FROM custom_report_definitions
            WHERE report_id = $1 AND organization_id = $2`,
          [reportId, organizationId]
        );
        if (!result.rows[0]) return res.status(404).json({ success: false, error: "Saved report not found." });
        return res.json({ success: true, report: result.rows[0] });
      } catch (error) {
        console.error("[reportBuilder/loadSaved]", error);
        return res.status(500).json({ success: false, error: "Could not load this saved report." });
      }
    },

    deleteSaved: async (req, res) => {
      const organizationId = getOrganizationId(req);
      const reportId = Number.parseInt(req.params.reportId, 10);
      if (!organizationId) return res.status(401).json({ success: false, error: "Please sign in again." });
      if (!Number.isInteger(reportId) || reportId < 1) {
        return res.status(400).json({ success: false, error: "Invalid saved report." });
      }
      try {
        await ensureReportSchema(db);
        const result = await db.query(
          `DELETE FROM custom_report_definitions
            WHERE report_id = $1 AND organization_id = $2
            RETURNING report_id`,
          [reportId, organizationId]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: "Saved report not found." });
        return res.json({ success: true });
      } catch (error) {
        console.error("[reportBuilder/deleteSaved]", error);
        return res.status(500).json({ success: false, error: "Could not delete this saved report." });
      }
    },

    export: async (req, res) => {
      const organizationId = getOrganizationId(req);
      if (!organizationId) return res.status(401).json({ success: false, error: "Please sign in again." });
      const input = validateReportInput(req.body);
      if (input.error) return res.status(400).json({ success: false, error: input.error });

      try {
        const { rows, total } = await loadReportData(
          req, input.report, input.columns, input.criteria, MAX_EXPORT_ROWS
        );
        if (total > MAX_EXPORT_ROWS) {
          return res.status(413).json({
            success: false,
            error: `This report has ${total.toLocaleString()} rows. Add criteria to export ${MAX_EXPORT_ROWS.toLocaleString()} rows or fewer.`,
          });
        }
        const fileName = `${input.reportType.replace(/[^a-z0-9_-]/gi, "")}-report.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Cache-Control", "no-store");
        return res.send(toCsv(rows, input.columns, input.report));
      } catch (error) {
        console.error("[reportBuilder/export]", error);
        return res.status(500).json({ success: false, error: "Could not export this report." });
      }
    },
  };
}

module.exports = reportBuilderController;
module.exports._test = { ensureReportSchema, getClassAccess, validateReportInput, csvCell, toCsv };
