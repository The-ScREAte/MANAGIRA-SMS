// enrollmentRoutes.js
const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollmentController');
const { isAuthenticated } = require('../middleware/middleware');
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 
const { requirePermission, PERMISSIONS } = require('../middleware/permissionMiddleware');

const canManageStudents = requirePermission(PERMISSIONS.STUDENTS_ENROLLMENT);


module.exports = (db) => {
    router.get('/enroll', checkFeatureAccess, isAuthenticated, canManageStudents, (req, res) => enrollmentController.enrollmentGet(req, res, db));
    router.post('/enroll', isAuthenticated, canManageStudents, (req, res) => enrollmentController.enrollmentPost(req, res, db));
    router.get('/manageEnrollment', checkFeatureAccess, isAuthenticated, canManageStudents, (req, res) => enrollmentController.manageEnrollmentGet(req, res, db));
    router.get('/modifyEnrollment/:enrollmentId', checkFeatureAccess, isAuthenticated, canManageStudents, (req, res) => enrollmentController.modifyEnrollmentGet(req, res, db));
    router.post('/modifyEnrollment/:enrollmentId', isAuthenticated, canManageStudents, (req, res) => enrollmentController.modifyEnrollmentPost(req, res, db));
    router.post('/deleteEnrollment/:enrollmentId', isAuthenticated, canManageStudents, (req, res) => enrollmentController.deleteEnrollment(req, res, db));
    // The header search: staff through the staff door; a signed-in student through their own (the
    // search gives a student only their teachers and subjects).
    const searchDoor = (req, res, next) => (req.session && req.session.studentId && !req.session.userId
      ? require('../middleware/studentAuthMiddleware').isStudentAuthenticated(req, res, next)
      : isAuthenticated(req, res, next));
    router.get('/searchUsers', searchDoor, (req, res) => enrollmentController.searchUsers(req, res, db));
    return router;
};
