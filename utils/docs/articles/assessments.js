"use strict";

// Assessments & grades: creating assessments, online tests, entering scores, grading scales.
module.exports = [
  {
    slug: "create-a-test-or-assessment",
    title: "Create an assessment",
    topic: "Assessments & grades",
    order: 1,
    summary: "Add a quiz, test, project or exam from the gradebook's + Assessment or from Management. Questions are optional; add them now or later.",
    tags: ["assessments", "tests", "exams", "quiz", "weight", "gradebook", "create assessment"],
    featured: true,
    who: "Managers, and staff given <strong>Manage Assessments &amp; Scores</strong>.",
    intro: "An assessment is anything you grade: a quiz, a unit test, a project, a final exam. It becomes a column on the class gradebook and counts toward the term grade by its weight.",
    sections: [
      {
        title: "From the gradebook (quickest)",
        steps: [
          ["Open the class, choose <strong>Grading</strong> and the subject, then select <strong>+ Assessment</strong>.", "gradebook.webp", "The subject's gradebook: + Assessment, Teachers, Save and Filter at the top."],
          ["A form opens on the right with this class and subject already ticked. Fill in the name, weight and score, then select <strong>Create Test</strong>.", "assessment-new-test.webp", "The new assessment form. The fields are explained below."],
          ["Choose <strong>Add questions</strong> to make it an online test now, or <strong>Not now</strong>. You can add questions any time later.", "assessment-add-questions.webp", "After saving: add questions now, or later."],
        ],
      },
      {
        title: "From Management",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Assessments</strong>, and select <strong>New test</strong>.", "assessments.webp", "Management, Assessments: the term's assessments, with weight and status."],
          "Fill in the form, open <strong>Show/Hide Classes</strong> and tick each class and subject it applies to. One test can go to many classes at once; <strong>Add Form</strong> adds another test.",
          "Select <strong>Create Test</strong>.",
        ],
      },
      {
        title: "The fields",
        table: [
          ["Field", "What it does"],
          ["<strong>Test Name</strong>", "Shown on the gradebook, report cards and to families."],
          ["<strong>Score</strong> or <strong>Choice</strong>", "Score: a number out of the total. Choice: your own words (Yes / No, Pass / Fail)."],
          ["<strong>Test Weight (%)</strong>", "How much it counts toward the term grade. A term's weights add up to 100."],
          ["<strong>Score Out Of</strong>", "The highest score."],
          ["<strong>Scale Base</strong>", "What scores are scaled to on reports, usually 100."],
          ["<strong>Category</strong>", "Class Assessment, Exams Assessment or Other."],
          ["<strong>Edit Window</strong>", "When scores can be entered. Leave empty for any time."],
          ["<strong>Lock this assessment</strong>", "Stops changes once scores are final."],
          ["<strong>Activate now</strong>", "Opens it for scores straight away."],
          ["<strong>Email affected class teachers</strong>", "Tells the teachers of those classes."],
        ],
        warning: "A test goes to classes enrolled in the term. If a term has no enrolled classes yet, the form says so and links to <a href=\"/legal/user-documentation/enrolling-classes-and-student-in-aterm-semester\">Enrollment</a>.",
      },
    ],
    faq: [
      ["Do I have to add questions?", "No. Questions are only for online tests. Without them you type scores on the gradebook."],
      ["Can I reuse an assessment next term?", "Create it again for the new term; the old term keeps its assessments and scores. Questions can be copied with <strong>Reuse</strong>."],
      ["What if the weights don't add up to 100?", "Report cards use the weights you set, so check each term's weights add up to 100 before printing."],
    ],
    related: ["assessment-questions-and-online-tests", "grading-or-marking-assessment", "configure-dynamic-grading-and-remarks", "report-card"],
  },
  {
    slug: "assessment-questions-and-online-tests",
    title: "Set questions and online tests",
    topic: "Assessments & grades",
    order: 2,
    summary: "Write, reuse or upload questions, add pictures to label, choose open or closed book, and share results with families.",
    tags: ["online test", "testing room", "assessment questions", "set questions", "label a picture", "open book", "auto marking"],
    who: "Teachers and staff given <strong>Set Assessment Questions</strong>. Students take tests in the student portal.",
    intro: "Questions turn an assessment into an online test. Students take it in the <strong>Testing Room</strong>; Managira marks what it can, and the result lands on your gradebook for you to post.",
    sections: [
      {
        title: "Start a question set",
        steps: [
          ["Open the class and choose <strong>Assessment Questions</strong> (or <strong>Management</strong>, <strong>Assessment questions</strong>), then <strong>Set Questions</strong>. Each set shows on one line: questions, points, book, time, attempts and status.", "questions-list.webp", "Assessment questions: every set, one per line."],
          ["Pick the class, subject and assessment. No assessment yet? Select <strong>+</strong> beside it to create one without leaving.", "questions-start.webp", "A new set: choose how to start."],
          "Choose how to start: <strong>Write</strong> (a blank question), <strong>Reuse</strong> (copy an earlier set, then change it) or <strong>Upload</strong> (a PDF, Word file or photo of a paper test, turned into questions you can edit). You can always add more questions after.",
        ],
      },
      {
        title: "Question types",
        table: [
          ["Type", "Students", "Marked"],
          ["<strong>Choose one</strong>", "Pick one answer.", "Automatically"],
          ["<strong>Choose several</strong>", "Pick every right answer.", "Automatically, all or nothing"],
          ["<strong>True / False</strong>", "Pick True or False.", "Automatically"],
          ["<strong>Short answer</strong>", "Type a word or phrase.", "Automatically; capitals and extra spaces don't matter"],
          ["<strong>Label a picture</strong>", "Type what each numbered spot shows.", "Automatically; a share of the marks per spot"],
          ["<strong>Essay</strong>", "Write freely.", "By you"],
        ],
      },
      {
        title: "Pictures",
        steps: [
          "Any question can show a picture: select <strong>Add a picture</strong> under the question (or drop a file on it).",
          ["For <strong>Label a picture</strong>, add the picture, then click it once for each part to label. Type the answer beside each number. Use <strong>/</strong> for other right answers, like <em>leaf / leaves</em>.", "questions-picture.webp", "A picture question: numbered spots and their answers."],
        ],
      },
      {
        title: "Settings",
        table: [
          ["Setting", "Choose"],
          ["<strong>Assessment mode</strong>", "<strong>Closed book</strong>: one secure page; leaving it locks the test until you unlock it; resources hidden. <strong>Open book</strong>: students may use notes, and see the files you attach."],
          ["<strong>Time limit</strong>", "Minutes, or Unlimited. The test submits itself when time runs out."],
          ["<strong>Max attempts</strong>", "How many times a student may take it."],
          ["<strong>Share with family</strong>", "After you post the grade: <strong>Nothing</strong>, the <strong>Grade</strong>, or <strong>Grade and answers</strong> (the questions, their answers and the right ones)."],
          ["<strong>Show on parent portal</strong>", "Parents see the questions to help at home, with your notes and files (resources)."],
        ],
      },
      {
        title: "Save, review and edit",
        list: [
          "<strong>Save Questions</strong> sends the set for review. Students see it once a reviewer chooses <strong>Approve</strong> from the set's <strong>⋮</strong> menu.",
          "To change a set, open its <strong>⋮</strong> menu and choose <strong>Edit</strong>. You can edit until a student starts; after that, unlock a student for a retake instead.",
        ],
      },
      {
        title: "Students take the test",
        steps: [
          "Students open the <strong>Testing Room</strong> in the student portal, choose <strong>Start</strong>, answer, and submit. See <a href=\"/legal/user-documentation/student-testing-room\">Take a test</a>.",
          "Managira marks it at once (essays wait for you). The result appears on your gradebook as a <strong>new</strong> grade (a blue dot); the student and family see it after you post it.",
        ],
        note: "In a closed-book test, a student who leaves the page is locked out. Unlock them from the set's <strong>⋮</strong> menu, <strong>Students</strong>.",
      },
      {
        title: "Mark written answers",
        steps: [
          ["Open the set's <strong>⋮</strong> menu, choose <strong>Students</strong>, then <strong>Grade</strong> beside a student. Check each answer, change marks, and save.", "questions-grade-attempt.webp", "Grading one student's test: their answers, the right ones and the marks."],
          "Post the grade from the gradebook (✓). See <a href=\"/legal/user-documentation/grading-or-marking-assessment\">Enter scores and post grades</a>.",
        ],
        note: "Every student's test is kept, with their answers, for as long as the term is kept.",
      },
    ],
    faq: [
      ["Students can't see my test.", "Check that the set is approved, the assessment is active and open, and the student is enrolled in the class and subject."],
      ["Why can't I change the questions?", "A student has already started. Unlock a student for a retake from <strong>Students</strong> instead."],
      ["Do parents see the questions before the test?", "Only if you turn on <strong>Show on parent portal</strong>. For a closed-book test, leave it off until after."],
    ],
    related: ["create-a-test-or-assessment", "grading-or-marking-assessment", "student-testing-room", "parent-tests-and-results"],
  },
  {
    slug: "grading-or-marking-assessment",
    title: "Enter scores and post grades",
    topic: "Assessments & grades",
    order: 3,
    summary: "Type scores on the gradebook, then post new grades with ✓ so parents and students see them. Choose the columns and totals you see.",
    tags: ["enter scores", "gradebook", "post grades", "approve grades", "marks", "grades", "filter"],
    who: "Teachers for their own classes and subjects, and staff given <strong>Manage Assessments &amp; Scores</strong>.",
    sections: [
      {
        title: "Enter scores",
        steps: [
          ["Open the class, choose <strong>Grading</strong> and the subject. Each assessment is a column; the newest is on the right. Type each score and select <strong>Save</strong>.", "gradebook.webp", "The gradebook: dots show what families see; ✓ posts new grades."],
          "Totals, the scaled score, percentage, grade and position work themselves out.",
        ],
      },
      {
        title: "Post grades to families",
        text: "A new or changed grade waits for you before parents and the student see it. The dot in the corner of each score tells you where it is:",
        table: [
          ["Dot", "Means"],
          ["Grey", "Posted: parents and the student see it."],
          ["Yellow", "Needs approval: you typed or changed it."],
          ["Blue", "New online result: the student took the test."],
        ],
        steps: [
          "When a column has grades waiting, a ✓ with their count appears beside <strong>Open</strong>.",
          "Select ✓, then <strong>Approve and post</strong>. Parents and the student see the grades, and each family gets a notice.",
        ],
        note: "Change a posted grade and it waits again; families keep seeing the last posted grade until you approve the new one.",
      },
      {
        title: "Choose what you see",
        steps: [
          ["<strong>Filter</strong> shows all students or only male or female students, and all assessments or just the last 5, 4, 3, 2 or 1. Your choice is remembered on any device.", "gradebook-filter.webp", "Filter: students, and how many assessments show."],
          ["Select <strong>≡</strong> beside the totals to choose which ones show: total score, scaled score, percentage, grade and position. Just for you.", "gradebook-totals.webp", "Choose the totals you see."],
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
      ["When do parents see scores?", "When you post them with ✓. Until then they see the last posted grade, or nothing for a new one."],
      ["Where's + Assessment?", "At the top of the gradebook, for staff who can manage assessments. See <a href=\"/legal/user-documentation/create-a-test-or-assessment\">Create an assessment</a>."],
    ],
    related: ["create-a-test-or-assessment", "assessment-questions-and-online-tests", "configure-dynamic-grading-and-remarks", "report-card"],
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
