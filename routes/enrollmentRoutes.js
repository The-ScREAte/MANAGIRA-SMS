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
    router.get('/getStudentsByClass', isAuthenticated, (req, res) => enrollmentController.getStudentsByClass(req, res, db));
    router.get('/manageEnrollment', checkFeatureAccess, isAuthenticated, canManageStudents, (req, res) => enrollmentController.manageEnrollmentGet(req, res, db));
    router.get('/modifyEnrollment/:enrollmentId', checkFeatureAccess, isAuthenticated, canManageStudents, (req, res) => enrollmentController.modifyEnrollmentGet(req, res, db));
    router.post('/modifyEnrollment/:enrollmentId', isAuthenticated, canManageStudents, (req, res) => enrollmentController.modifyEnrollmentPost(req, res, db));
    router.post('/deleteEnrollment/:enrollmentId', isAuthenticated, canManageStudents, (req, res) => enrollmentController.deleteEnrollment(req, res, db));
    router.get('/searchUsers', isAuthenticated, (req, res) => enrollmentController.searchUsers(req, res, db));
    return router;
};
