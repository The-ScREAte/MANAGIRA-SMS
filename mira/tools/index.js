// Tool registry. Every tool handler receives (args, tenant) - tenant comes
// from the validated session (middleware/tenantScope.js), never from
// client/model input, so a tool can never be tricked into acting outside
// the caller's own organization. Additional tools land in phase 5.
const findStudent = require("./findStudent");
const findContact = require("./findContact");
const getFees = require("./getFees");
const getAttendance = require("./getAttendance");
const getClass = require("./getClass");
const getTerm = require("./getTerm");
const listProjects = require("./listProjects");
const draftMessage = require("./draftMessage");
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

const ALL_TOOLS = [
  findStudent,
  findContact,
  getFees,
  getAttendance,
  getClass,
  getTerm,
  listProjects,
  draftMessage,
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
];

const REGISTRY = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t]));

function listToolSchemas() {
  return Object.values(REGISTRY).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

async function runTool(name, args, tenant) {
  const tool = REGISTRY[name];
  if (!tool) {
    return { status: "denied", result: `Unknown tool: ${name}` };
  }
  try {
    const result = await tool.handler(args, tenant);
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
