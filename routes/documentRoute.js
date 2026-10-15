const express = require("express");
const router = express.Router();
const { documentController } = require("../controllers/documentController");
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");
const multer = require("multer");
const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

module.exports = (db) => {
  // Document list page
  router.get("/", checkFeatureAccess, isAuthenticated, blockGuardians, (req, res) =>
    documentController.documentsList(req, res, db)
  );

  // Create new document
  router.post("/create", checkFeatureAccess, isAuthenticated, blockGuardians, express.json(), (req, res) =>
    documentController.createDocument(req, res, db)
  );

  // Document editor
  router.get("/edit/:id", checkFeatureAccess, isAuthenticated, blockGuardians, (req, res) =>
    documentController.documentEditor(req, res, db)
  );

  // Auto-save document
  router.post("/save/:id", checkFeatureAccess, isAuthenticated, blockGuardians, express.json(), (req, res) =>
    documentController.saveDocument(req, res, db)
  );

  // Get document content (polling)
  router.get("/content/:id", checkFeatureAccess, isAuthenticated, blockGuardians, (req, res) =>
    documentController.getDocumentContent(req, res, db)
  );

  // Delete document
  router.post("/delete/:id", checkFeatureAccess, isAuthenticated, blockGuardians, express.json(), (req, res) =>
    documentController.deleteDocument(req, res, db)
  );

  // Update permissions
  router.post("/permissions/:id", checkFeatureAccess, isAuthenticated, blockGuardians, express.json(), (req, res) =>
    documentController.updatePermissions(req, res, db)
  );

  // Get documents for a class (teacher view)
  router.get("/class", checkFeatureAccess, isAuthenticated, (req, res) =>
    documentController.classDocuments(req, res, db)
  );

  // Get class data (students/subjects) for spreadsheet
  router.get("/classData", checkFeatureAccess, isAuthenticated, (req, res) =>
    documentController.getClassData(req, res, db)
  );

  // Use a Doc / Sheet as a class's report card template
  router.post("/reportTemplate/:id", checkFeatureAccess, isAuthenticated, blockGuardians, express.json(), (req, res) =>
    documentController.saveReportTemplate(req, res, db)
  );

  // Read an Excel file (.xlsx) into a sheet: values, merges, colors, borders
  router.post("/importXlsx", checkFeatureAccess, isAuthenticated, blockGuardians, xlsxUpload.single("file"), (req, res) =>
    documentController.importXlsx(req, res, db)
  );

  return router;
};
