// Tool registry. Every tool handler receives (args, tenant) - tenant comes
// from the validated session (middleware/tenantScope.js), never from
// client/model input, so a tool can never be tricked into acting outside
// the caller's own organization. A third, optional `context` argument
// (currently just `{ images }`) carries turn-scoped data too large/unsafe
// to route through the model's own token stream - e.g. an image the user
// attached in this message, which Mira can already see natively via
// vision, but which a tool (like upload_website_image) needs the actual
// bytes for, not a model-retyped description of them. Existing tools that
// don't declare a third parameter are unaffected; JS simply ignores it.
const { runAsCaller } = require("../internalApiClient");
const { checkTool } = require("../services/access");
const { scrub } = require("../services/secrets");
const findStudent = require("./findStudent");
const workOutDate = require("./workOutDate");
const getFormRequests = require("./getFormRequests");
const remindFormOutstanding = require("./remindFormOutstanding");
const getMyCalendar = require("./getMyCalendar");
const getCalendarSyncStatus = require("./getCalendarSyncStatus");
const addToMyCalendar = require("./addToMyCalendar");
const findFreeTime = require("./findFreeTime");
const whatsNew = require("./whatsNew");
const listActivities = require("./listActivities");
const createActivity = require("./createActivity");
const getBusRidingToday = require("./getBusRidingToday");
const showWorkToParents = require("./showWorkToParents");
const getSsoStatus = require("./getSsoStatus");
const findContact = require("./findContact");
const getFees = require("./getFees");
const getAttendance = require("./getAttendance");
const getClass = require("./getClass");
const getTerm = require("./getTerm");
const listProjects = require("./listProjects");
const draftMessage = require("./draftMessage");
const draftFamilyMessages = require("./draftFamilyMessages");
const findLowAttendance = require("./findLowAttendance");
const createAnnouncement = require("./createAnnouncement");
const generateReportCardSummary = require("./generateReportCardSummary");
const listSchoolYears = require("./listSchoolYears");
const createSchoolYear = require("./createSchoolYear");
const renameSchoolYear = require("./renameSchoolYear");
const deleteSchoolYear = require("./deleteSchoolYear");
const addTermToSchoolYear = require("./addTermToSchoolYear");
const deleteTerm = require("./deleteTerm");
const createClasses = require("./createClasses");
const renameClass = require("./renameClass");
const deleteClass = require("./deleteClass");
const reorderClasses = require("./reorderClasses");
const listSubjects = require("./listSubjects");
const createSubject = require("./createSubject");
const assignSubjectToClasses = require("./assignSubjectToClasses");
const renameSubject = require("./renameSubject");
const deleteSubject = require("./deleteSubject");
const listGraduationYearGroups = require("./listGraduationYearGroups");
const createGraduationYearGroup = require("./createGraduationYearGroup");
const renameGraduationYearGroup = require("./renameGraduationYearGroup");
const deleteGraduationYearGroup = require("./deleteGraduationYearGroup");
const listEnrollments = require("./listEnrollments");
const getEnrollmentRoster = require("./getEnrollmentRoster");
const setEnrollmentRoster = require("./setEnrollmentRoster");
const deleteEnrollment = require("./deleteEnrollment");
const listPromotionSchedules = require("./listPromotionSchedules");
const getPromotionPreview = require("./getPromotionPreview");
const schedulePromotion = require("./schedulePromotion");
const applyScheduledPromotion = require("./applyScheduledPromotion");
const cancelScheduledPromotion = require("./cancelScheduledPromotion");
const reversePromotion = require("./reversePromotion");
const deleteReversedPromotion = require("./deleteReversedPromotion");
const listEmployees = require("./listEmployees");
const createEmployee = require("./createEmployee");
const setEmployeeHold = require("./setEmployeeHold");
const getGuardianDetails = require("./getGuardianDetails");
const listTransportBuses = require("./listTransportBuses");
const listTransportDrivers = require("./listTransportDrivers");
const listTransportRoutes = require("./listTransportRoutes");
const listTransportStops = require("./listTransportStops");
const listTransportSchedules = require("./listTransportSchedules");
const getStudentTransportation = require("./getStudentTransportation");
const getTransportationLiveStatus = require("./getTransportationLiveStatus");
const createTransportBus = require("./createTransportBus");
const setTransportBusStatus = require("./setTransportBusStatus");
const deleteTransportBus = require("./deleteTransportBus");
const createTransportRoute = require("./createTransportRoute");
const setTransportRouteStatus = require("./setTransportRouteStatus");
const deleteTransportRoute = require("./deleteTransportRoute");
const createTransportStop = require("./createTransportStop");
const deleteTransportStop = require("./deleteTransportStop");
const createTransportDriver = require("./createTransportDriver");
const setTransportDriverStatus = require("./setTransportDriverStatus");
const deleteTransportDriver = require("./deleteTransportDriver");
const createTransportSchedule = require("./createTransportSchedule");
const setTransportScheduleStatus = require("./setTransportScheduleStatus");
const deleteTransportSchedule = require("./deleteTransportSchedule");
const assignStudentTransportation = require("./assignStudentTransportation");
const removeStudentTransportation = require("./removeStudentTransportation");
const listEvents = require("./listEvents");
const listSchoolAnnouncements = require("./listSchoolAnnouncements");
const createEvent = require("./createEvent");
const updateEvent = require("./updateEvent");
const deleteEvent = require("./deleteEvent");
const createSchoolAnnouncement = require("./createSchoolAnnouncement");
const updateSchoolAnnouncement = require("./updateSchoolAnnouncement");
const deleteSchoolAnnouncement = require("./deleteSchoolAnnouncement");
const listWebsiteImages = require("./listWebsiteImages");
const listWebsiteArticles = require("./listWebsiteArticles");
const getWebsiteAboutUs = require("./getWebsiteAboutUs");
const getWebsiteSettings = require("./getWebsiteSettings");
const uploadWebsiteImage = require("./uploadWebsiteImage");
const updateWebsiteSection = require("./updateWebsiteSection");
const listWebsiteMessages = require("./listWebsiteMessages");
const updateWebsiteImage = require("./updateWebsiteImage");
const deleteWebsiteImage = require("./deleteWebsiteImage");
const createWebsiteArticle = require("./createWebsiteArticle");
const updateWebsiteArticle = require("./updateWebsiteArticle");
const deleteWebsiteArticle = require("./deleteWebsiteArticle");
const updateWebsiteAboutUs = require("./updateWebsiteAboutUs");
const setWebsiteLayout = require("./setWebsiteLayout");
const setWebsiteTheme = require("./setWebsiteTheme");
const setWebsiteSelfEnrollment = require("./setWebsiteSelfEnrollment");
const listAssessments = require("./listAssessments");
const createTest = require("./createTest");
const modifyTest = require("./modifyTest");
const deleteTest = require("./deleteTest");
const setTestStatus = require("./setTestStatus");
const setTestDateWindow = require("./setTestDateWindow");
const listQuestionSets = require("./listQuestionSets");
const setTestQuestions = require("./setTestQuestions");
const deleteQuestionSet = require("./deleteQuestionSet");
const reviewQuestionSet = require("./reviewQuestionSet");
const reuseQuestionSet = require("./reuseQuestionSet");
const listQuestionSetStudents = require("./listQuestionSetStudents");
const postQuestionSetScores = require("./postQuestionSetScores");
const unpostQuestionSetScores = require("./unpostQuestionSetScores");
const setStudentAssessmentStatus = require("./setStudentAssessmentStatus");
const getAttemptForGrading = require("./getAttemptForGrading");
const saveAttemptGrade = require("./saveAttemptGrade");
const listDocuments = require("./listDocuments");
const getDocument = require("./getDocument");
const createDocument = require("./createDocument");
const setDocumentTitle = require("./setDocumentTitle");
const setDocumentText = require("./setDocumentText");
const setSheetCells = require("./setSheetCells");
const resizeSheet = require("./resizeSheet");
const insertClassDataIntoSheet = require("./insertClassDataIntoSheet");
const shareDocumentWithUser = require("./shareDocumentWithUser");
const removeDocumentShare = require("./removeDocumentShare");
const assignDocumentToClass = require("./assignDocumentToClass");
const unassignDocumentFromClass = require("./unassignDocumentFromClass");
const deleteDocument = require("./deleteDocument");
const getIntegrationsStatus = require("./getIntegrationsStatus");
const listFailedEmails = require("./listFailedEmails");
const checkEmailAvailability = require("./checkEmailAvailability");
const fixFailedEmail = require("./fixFailedEmail");
const getUpcomingBirthdays = require("./getUpcomingBirthdays");
const listStudents = require("./listStudents");
const checkStudentDuplicates = require("./checkStudentDuplicates");
const createStudents = require("./createStudents");
const listPendingAdmissions = require("./listPendingAdmissions");
const getPendingAdmissionDetails = require("./getPendingAdmissionDetails");
const updatePendingAdmission = require("./updatePendingAdmission");
const approvePendingAdmission = require("./approvePendingAdmission");
const rejectPendingAdmission = require("./rejectPendingAdmission");
const getOrganizationStatistics = require("./getOrganizationStatistics");
const compareClasses = require("./compareClasses");
const getReportSettings = require("./getReportSettings");
const setReportCardDisplayOptions = require("./setReportCardDisplayOptions");
const setGradingScaleBand = require("./setGradingScaleBand");
const deleteGradingScaleBand = require("./deleteGradingScaleBand");
const setPromotionSettings = require("./setPromotionSettings");
const listRemarks = require("./listRemarks");
const addRemark = require("./addRemark");
const deleteRemark = require("./deleteRemark");
const getCloseGroupCandidates = require("./getCloseGroupCandidates");
const closeGraduationYearGroup = require("./closeGraduationYearGroup");
const listArchivedStudents = require("./listArchivedStudents");
const unarchiveStudents = require("./unarchiveStudents");
const generateReportPdf = require("./generateReportPdf");
const postOrSendReportCards = require("./postOrSendReportCards");
const sendMessage = require("./sendMessage");
const listSentMessages = require("./listSentMessages");
const getMeritSheet = require("./getMeritSheet");
const generateMeritSheetPdf = require("./generateMeritSheetPdf");
const getNotificationPreferences = require("./getNotificationPreferences");
const setNotificationPreferences = require("./setNotificationPreferences");
const setOrgNotificationPreferences = require("./setOrgNotificationPreferences");
const submitFeedback = require("./submitFeedback");
const getSchoolCustomization = require("./getSchoolCustomization");
const updateSchoolProfile = require("./updateSchoolProfile");
const setSchoolFont = require("./setSchoolFont");
const setDisplayPreferences = require("./setDisplayPreferences");
const setSchoolNickname = require("./setSchoolNickname");
const setStudentIdSettings = require("./setStudentIdSettings");

const reportBuilderTools = require("./reportBuilder");

const ALL_TOOLS = [
  workOutDate,
  ...reportBuilderTools,
  findStudent,
  getFormRequests,
  remindFormOutstanding,
  getMyCalendar,
  getCalendarSyncStatus,
  addToMyCalendar,
  findFreeTime,
  whatsNew,
  listActivities,
  createActivity,
  getBusRidingToday,
  showWorkToParents,
  getSsoStatus,
  findContact,
  getFees,
  getAttendance,
  findLowAttendance,
  getClass,
  getTerm,
  listProjects,
  draftMessage,
  draftFamilyMessages,
  createAnnouncement,
  generateReportCardSummary,
  listSchoolYears,
  createSchoolYear,
  renameSchoolYear,
  deleteSchoolYear,
  addTermToSchoolYear,
  deleteTerm,
  createClasses,
  renameClass,
  deleteClass,
  reorderClasses,
  listSubjects,
  createSubject,
  assignSubjectToClasses,
  renameSubject,
  deleteSubject,
  listGraduationYearGroups,
  createGraduationYearGroup,
  renameGraduationYearGroup,
  deleteGraduationYearGroup,
  listEnrollments,
  getEnrollmentRoster,
  setEnrollmentRoster,
  deleteEnrollment,
  listPromotionSchedules,
  getPromotionPreview,
  schedulePromotion,
  applyScheduledPromotion,
  cancelScheduledPromotion,
  reversePromotion,
  deleteReversedPromotion,
  listEmployees,
  createEmployee,
  setEmployeeHold,
  getGuardianDetails,
  listTransportBuses,
  listTransportDrivers,
  listTransportRoutes,
  listTransportStops,
  listTransportSchedules,
  getStudentTransportation,
  getTransportationLiveStatus,
  createTransportBus,
  setTransportBusStatus,
  deleteTransportBus,
  createTransportRoute,
  setTransportRouteStatus,
  deleteTransportRoute,
  createTransportStop,
  deleteTransportStop,
  createTransportDriver,
  setTransportDriverStatus,
  deleteTransportDriver,
  createTransportSchedule,
  setTransportScheduleStatus,
  deleteTransportSchedule,
  assignStudentTransportation,
  removeStudentTransportation,
  listEvents,
  listSchoolAnnouncements,
  createEvent,
  updateEvent,
  deleteEvent,
  createSchoolAnnouncement,
  updateSchoolAnnouncement,
  deleteSchoolAnnouncement,
  listWebsiteImages,
  listWebsiteArticles,
  getWebsiteAboutUs,
  getWebsiteSettings,
  uploadWebsiteImage,
  updateWebsiteSection,
  listWebsiteMessages,
  updateWebsiteImage,
  deleteWebsiteImage,
  createWebsiteArticle,
  updateWebsiteArticle,
  deleteWebsiteArticle,
  updateWebsiteAboutUs,
  setWebsiteLayout,
  setWebsiteTheme,
  setWebsiteSelfEnrollment,
  listAssessments,
  createTest,
  modifyTest,
  deleteTest,
  setTestStatus,
  setTestDateWindow,
  listQuestionSets,
  setTestQuestions,
  deleteQuestionSet,
  reviewQuestionSet,
  reuseQuestionSet,
  listQuestionSetStudents,
  postQuestionSetScores,
  unpostQuestionSetScores,
  setStudentAssessmentStatus,
  getAttemptForGrading,
  saveAttemptGrade,
  listDocuments,
  getDocument,
  createDocument,
  setDocumentTitle,
  setDocumentText,
  setSheetCells,
  resizeSheet,
  insertClassDataIntoSheet,
  shareDocumentWithUser,
  removeDocumentShare,
  assignDocumentToClass,
  unassignDocumentFromClass,
  deleteDocument,
  getIntegrationsStatus,
  listFailedEmails,
  checkEmailAvailability,
  fixFailedEmail,
  getUpcomingBirthdays,
  listStudents,
  checkStudentDuplicates,
  createStudents,
  listPendingAdmissions,
  getPendingAdmissionDetails,
  updatePendingAdmission,
  approvePendingAdmission,
  rejectPendingAdmission,
  getOrganizationStatistics,
  compareClasses,
  getReportSettings,
  setReportCardDisplayOptions,
  setGradingScaleBand,
  deleteGradingScaleBand,
  setPromotionSettings,
  listRemarks,
  addRemark,
  deleteRemark,
  getCloseGroupCandidates,
  closeGraduationYearGroup,
  listArchivedStudents,
  unarchiveStudents,
  generateReportPdf,
  postOrSendReportCards,
  sendMessage,
  listSentMessages,
  getMeritSheet,
  generateMeritSheetPdf,
  getNotificationPreferences,
  setNotificationPreferences,
  setOrgNotificationPreferences,
  submitFeedback,
  getSchoolCustomization,
  updateSchoolProfile,
  setSchoolFont,
  setDisplayPreferences,
  setSchoolNickname,
  setStudentIdSettings,
];

// Read tools in one shape (tools/read/: utils/miraRead on the main app).
const READ_TOOLS = require("./read").tools;
const REGISTRY = Object.fromEntries([...ALL_TOOLS, ...READ_TOOLS].map((t) => [t.name, t]));
if (Object.keys(REGISTRY).length !== ALL_TOOLS.length + READ_TOOLS.length) throw new Error("A Mira tool name is registered twice.");

function listToolSchemas() {
  return Object.values(REGISTRY).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

// Without the person's access (context.access, see services/access.js) only
// tools that need no permission run: unknown access is no access.
const NO_ACCESS = { ok: false, held: new Set(), notInPlan: new Set(), labels: new Map(), permissions: [], classes: null, features: {} };

const MAX_RECORDS = 200;
const READ_TOOL = /^(get_|list_|find_|check_|compare_|whats_|search_)/;
// A person's own sheet may take more cells than that.
const OWN_WORK = new Set(["set_sheet_cells", "insert_class_data_into_sheet", "set_document_text"]);

async function runTool(name, args, tenant, context) {
  const tool = REGISTRY[name];
  if (!tool) {
    return { status: "denied", result: `Unknown tool: ${name}` };
  }
  // The person's own permissions decide, before anything is read or changed.
  const gate = checkTool(name, tenant, context?.access || NO_ACCESS);
  if (!gate.allowed) return { status: "denied", result: gate.reason };
  // One action changes at most MAX_RECORDS records (a list of 200 students, rows, cells ...).
  const tooMany = Object.entries(args || {}).find(([, value]) => Array.isArray(value) && value.length > MAX_RECORDS);
  if (tooMany && !READ_TOOL.test(name) && !OWN_WORK.has(name)) {
    return { status: "denied", result: `Not done: ${tooMany[1].length} ${tooMany[0]} is more than Mira changes at once (${MAX_RECORDS}). Offer to do it in parts, or point to the page in Managira.` };
  }
  try {
    // Every internal API call this tool makes carries the caller's identity
    // (see internalApiClient.js), so the main app applies its own
    // permission checks to reads as well as writes.
    const raw = await runAsCaller(tenant, () => tool.handler(args, tenant, context));
    // Nothing secret leaves a tool: tokens, signed or storage links, keys, password data.
    const found = [];
    const result = scrub(raw, found);
    if (found.length) console.warn(`[mira/tools] ${name}: hid ${found.length} secret value(s) from the result`);
    return { status: "ok", result };
  } catch (error) {
    if (error.denied) {
      return { status: "denied", result: error.message };
    }
    console.error(`[mira/tools] ${name} failed`, error);
    return { status: "error", result: error.message };
  }
}

module.exports = { REGISTRY, listToolSchemas, runTool };
