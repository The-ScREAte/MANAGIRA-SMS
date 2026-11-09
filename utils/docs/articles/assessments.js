"use strict";

// Assessments & grades: creating assessments, online tests, entering scores, grading scales.
module.exports = [
  {
    slug: "create-a-test-or-assessment",
    title: "Create a test or assessment",
    topic: "Assessments & grades",
    order: 1,
    summary: "Set up quizzes, tests, projects and exams with a weight, a maximum score and a window for entering scores; they feed report cards and transcripts.",
    tags: ["assessments", "tests", "exams", "quiz", "weight", "score entry", "gradebook"],
    featured: true,
    who: "Managers, and staff given <strong>Manage Assessments &amp; Scores</strong>.",
    intro: "An assessment is anything you grade: a quiz, a unit test, a project, a final exam. Each one has a weight in the term's final score. Once it's active, teachers enter scores in their class.",
    sections: [
      {
        title: "Create an assessment",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Assessments</strong>, and choose to create tests.", "assessments.webp", "Management, Assessments: every assessment for the term, with its weight and status."],
          "Fill in the details (see the table below).",
          "Choose <strong>Activate Now</strong> to open it for score entry straight away, or activate it later.",
          "Save.",
        ],
        table: [
          ["Field", "What it means", "Example"],
          ["<strong>Test Name</strong>", "What students and parents see on report cards.", "Unit 3 Test"],
          ["<strong>Test Weight (%)</strong>", "How much it counts toward the term's final score. A term's weights add up to 100.", "20"],
          ["<strong>Score Out Of</strong>", "The highest raw score.", "50"],
          ["<strong>Scale Base</strong>", "What scores are scaled to on reports (usually 100).", "100"],
          ["<strong>Category</strong>", "The kind of assessment, such as Class Assessment or Exam.", "Exam"],
          ["<strong>Edit window</strong>", "When scores can be entered or changed.", "Dec 1 to Dec 12"],
          ["<strong>Lock Assessment</strong>", "Stops changes once scores are final.", ""],
        ],
        example: "A 7th Grade science course uses Homework (10%), Quizzes (20%), Unit Tests (30%) and a Semester Exam (40%).",
        warning: "Classes must be enrolled in the current term before you can create assessments for them.",
      },
    ],
    faq: [
      ["What if the weights don't add up to 100?", "Report cards scale scores by the weights you set, so check each term's weights add up to 100 before you print."],
      ["Can I reuse assessments next term?", "Create them for the new term; the old term's assessments and scores stay with that term."],
    ],
    related: ["grading-or-marking-assessment", "configure-dynamic-grading-and-remarks", "assessment-questions-and-online-tests", "report-card"],
  },
  {
    slug: "assessment-questions-and-online-tests",
    title: "Assessment questions and online tests",
    topic: "Assessments & grades",
    order: 2,
    summary: "Write multiple-choice, short-answer and essay questions, open them in the Testing Room with a time limit, and share them with parents.",
    tags: ["online test", "testing room", "assessment questions", "multiple choice", "essay", "short answer", "student portal"],
    who: "Teachers and staff given <strong>Set Assessment Questions</strong>. Students take tests in the student portal.",
    intro: "Question sets turn an assessment into an online test. Students take it in the <strong>Testing Room</strong> of the student portal, and you mark it in Managira.",
    sections: [
      {
        title: "Write a question set",
        steps: [
          ["Open your class and choose <strong>Assessment Questions</strong> in Class Tools (or <strong>Management</strong>, <strong>Assessment questions</strong>), then choose the assessment.", "assessment-questions.webp", "Assessment Questions on the class page: each assessment's question set."],
          "Add questions: <strong>Multiple Choice</strong>, <strong>Short answer</strong> or <strong>Essay</strong>. Mark the right answers for multiple-choice questions.",
          "Set a <strong>Time Limit (minutes)</strong>, and choose <strong>Open Book</strong> if students may use their notes.",
          "Open the test when students should take it.",
        ],
      },
      {
        title: "Students take the test",
        text: "Students sign in to the student portal and open the <strong>Testing Room</strong>. Open tests are listed there; the timer starts when they begin. Multiple-choice answers are marked for you; you mark short answers and essays.",
        image: "student-testing-room.webp",
        caption: "The Testing Room in the student portal: open tests, ready to start.",
        note: "The Student Portal must be turned on in Management, Integrations. See <a href=\"/legal/user-documentation/student-portal\">The student portal</a>.",
      },
      {
        title: "Share with parents and Google Classroom",
        list: [
          "Turn on <strong>Show on parent portal</strong> and add notes and files so parents can help with homework. See <a href=\"/legal/user-documentation/parent-tiles-and-homework-help\">Homework help</a>.",
          "If Google Classroom is connected, assessments are posted to the class's Google Classroom course as classwork.",
        ],
      },
    ],
    related: ["create-a-test-or-assessment", "student-portal", "grading-or-marking-assessment"],
  },
  {
    slug: "grading-or-marking-assessment",
    title: "Enter and review scores",
    topic: "Assessments & grades",
    order: 3,
    summary: "Enter scores for a class's assessments in one sheet; grades and remarks are worked out for you from your grading scale and feed report cards.",
    tags: ["enter scores", "grading", "gradebook", "marks", "score sheet", "grades"],
    who: "Teachers for their own classes and subjects, and staff given <strong>Manage Assessments &amp; Scores</strong>.",
    sections: [
      {
        title: "Enter scores",
        steps: [
          "Open the class from your dashboard. In <strong>Class Tools</strong>, open <strong>Grading</strong> and choose the subject.",
          ["The subject's score sheet opens: one row per student and one column per assessment. An assessment marked <strong>Open</strong> takes scores; type each student's raw score, out of the <strong>Score out of</strong> shown.", "grading-sheet.webp", "The score sheet: totals, scaled score, percentage, grade and position update as you type."],
          "Select <strong>Save</strong>. Totals, the scaled score, percentage, grade and class position are worked out for you.",
        ],
      },
      {
        title: "How grades are worked out",
        text: "Each score is scaled by the assessment's <strong>Scale Base</strong> and weighted by its <strong>Test Weight</strong>. The total gets a letter grade and remark from your grading scale. See <a href=\"/legal/user-documentation/configure-dynamic-grading-and-remarks\">Grading scales and remarks</a>.",
        example: "A student scores 42 out of 50 on a Unit Test worth 30%: 42 / 50 = 84%, which adds 25.2 points to the term total.",
      },
    ],
    faq: [
      ["I can't edit a score.", "The assessment's edit window may have closed, or it's locked. Ask a manager to reopen it in Assessments."],
      ["When do parents see scores?", "Parents see results in the parent portal when your school publishes report cards."],
    ],
    related: ["create-a-test-or-assessment", "configure-dynamic-grading-and-remarks", "report-card"],
  },
  {
    slug: "configure-dynamic-grading-and-remarks",
    title: "Grading scales and remarks",
    topic: "Assessments & grades",
    order: 4,
    summary: "Set your letter grades and the score range for each (for example 90–100 = A), and the remark printed with each range on report cards.",
    tags: ["grading scale", "letter grades", "grade boundaries", "remarks", "report settings"],
    who: "Managers, and staff given <strong>Report Settings</strong>.",
    sections: [
      {
        title: "Set your grading scale",
        steps: [
          ["Open <strong>Reports</strong>, then <strong>Report Settings</strong>, and find the grading scale.", "report-settings.webp", "Reports, Report Settings: grading scale, remarks and what report cards show."],
          "Add a row for each grade with its lowest and highest score, its letter and its remark.",
          "Save, then preview a report card to check.",
        ],
        table: [
          ["Score", "Grade", "Remark"],
          ["90–100", "A", "Excellent"],
          ["80–89", "B", "Very good"],
          ["70–79", "C", "Good"],
          ["60–69", "D", "Needs improvement"],
          ["0–59", "F", "Failing"],
        ],
        warning: "Changing the scale mid-term changes the grades and remarks on report cards generated afterwards. Set it before the term's first scores, and change it only between terms.",
      },
    ],
    related: ["report-settings", "grading-or-marking-assessment", "report-card"],
  },
];
