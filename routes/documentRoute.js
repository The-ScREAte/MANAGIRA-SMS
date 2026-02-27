const express = require("express");
const router = express.Router();
const { documentController } = require("../controllers/documentController");
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");

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
  router.get("/edit/:id", checkFeatureAccess, isAuthenticated, (req, res) =>
    documentController.documentEditor(req, res, db)
  );

  // Auto-save document
  router.post("/save/:id", checkFeatureAccess, isAuthenticated, express.json(), (req, res) =>
    documentController.saveDocument(req, res, db)
  );

  // Get document content (polling)
  router.get("/content/:id", checkFeatureAccess, isAuthenticated, (req, res) =>
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

  return router;
};
