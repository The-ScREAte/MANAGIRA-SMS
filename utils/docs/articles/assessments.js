"use strict";

// Assessments & grades: creating assessments, online tests, entering scores, grading scales.
// Pictures are made by ~/.managira-local-copy/tools/docshots/scripts/assess-*.js (sample school,
// 6th Grade, Social Studies).
const link = (slug, text) => `<a href="/legal/user-documentation/${slug}">${text}</a>`;

module.exports = [
  // ------------------------------------------------------------------ Create an assessment
  {
    slug: "create-a-test-or-assessment",
    title: "Create an assessment",
    topic: "Assessments & grades",
    order: 1,
    summary: "Add a quiz, test, project or exam from Management or the gradebook, then find it again, edit it, lock it, make it obsolete or delete it.",
    tags: ["assessments", "tests", "exams", "quiz", "weight", "gradebook", "create assessment", "new test", "lock scores", "obsolete", "delete assessment", "due date", "late until", "marked out of", "category"],
    featured: true,
    who: "Managers, and staff given <strong>Manage Assessments &amp; Scores</strong>. A teacher adds assessments from their gradebook, only for the classes and subjects they teach.",
    intro: "An assessment is anything you grade: a quiz, a unit test, a project, a final exam. It becomes a column on the class gradebook and counts toward the term grade by its weight. Questions are optional; add them only if students will take it online.",
    sections: [
      {
        title: "Find your assessments",
        image: "assess-list.webp",
        caption: "Management › Assessments. Every assessment of the term, with its class, subject, category, weight and status.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>Assessments</strong>."],
          ["The list shows one term at a time. To look at another term, choose it in the box beside <strong>New test</strong>. The number is how many assessments that term has."],
          "When one assessment goes to several classes or subjects, the row shows the first one and a small <strong>+</strong> count for the rest. Select a column heading to sort by it.",
        ],
        note: "Teachers don't have Management. They add and work on assessments from the gradebook inside their class. See below.",
      },
      {
        title: "Search and filter the list",
        steps: [
          ["Use the box on the left. Type part of a name in <strong>Name</strong>, or choose a <strong>Status</strong>, <strong>Category</strong>, <strong>Class</strong> or <strong>Subject</strong>. You can combine them. The line at the bottom says how many match, for example <em>Showing 162 of 484</em>. Select <strong>Clear</strong> to start over."],
          ["Use the page bar under the list to show 10, 20, 50, 100 or 200 rows at a time and to move between pages."],
        ],
        tip: "On a phone, the filters open from a <strong>Filters</strong> button above the list.",
      },
      {
        title: "Create an assessment in Management",
        steps: [
          ["Select <strong>New test</strong>. A form opens on the right.", "assess-new.webp", "The New test form, over the list."],
          ["Type the <strong>Name</strong>. As you type, earlier names are suggested, so one assessment keeps the same spelling in every class."],
          "Choose <strong>Results</strong>: <strong>Score</strong> (a number) or <strong>Choice</strong> (your own words, such as Yes / No or Pass / Fail).",
          "Fill in <strong>Weight</strong> (required), <strong>Out of</strong> (the highest score) and <strong>Category</strong>. Add a <strong>Due date</strong> and <strong>Late until</strong> if you want them.",
          ["Open <strong>More options</strong> only when you need them. They are explained in the table below.", "assess-more-zoom.webp", "More options: time limit, attempts, book, scaling and more."],
          ["Under <strong>Classes</strong>, search for a class, check it, then check its subjects. One assessment can go to many classes and subjects at once."],
          "Select <strong>Create</strong>. To make another one without closing the form, select <strong>Add another</strong> first. To drop a form you don't need, use the <strong>⋮</strong> at its top right and choose <strong>Remove</strong>.",
        ],
        warning: "An assessment goes only to classes that are enrolled in the term. If a term has no enrolled classes yet, the form says so and links to " + link("enrolling-classes-and-student-in-aterm-semester", "Enrollment") + ".",
      },
      {
        title: "Create an assessment from the gradebook",
        text: "This is the quickest way for a teacher, and it is the same form. The class and subject you are in are already checked.",
        steps: [
          ["Open your class, choose <strong>Gradebook</strong>, then the subject. Select <strong>+ Assessment</strong>."],
          ["Fill in the name, weight and what it is marked out of, then select <strong>Create</strong>.", "assess-gb-form.webp", "The new assessment form over the gradebook."],
          ["If you can set questions, a window asks <strong>Add questions now?</strong> Choose <strong>Add questions</strong> to build the online test straight away, or <strong>Not now</strong>. You can add questions any time later. See " + link("assessment-questions-and-online-tests", "Set questions and online tests") + ".", "assess-add-questions.webp", "After saving: Add questions, or Not now."],
        ],
        note: "If you don't hold <strong>Set Assessment Questions</strong>, the window doesn't appear and the new column shows on the gradebook.",
      },
      {
        title: "What each field means",
        table: [
          ["Field", "What it does"],
          ["<strong>Name</strong>", "Shown on the gradebook, report cards and to families."],
          ["<strong>Results</strong>", "<strong>Score</strong>: a number out of the total. <strong>Choice</strong>: your own words. Choices can carry points that count in the total, or none, and then they never change a total."],
          ["<strong>Weight</strong>", "How much it counts toward the subject total on a report card that scales subjects. Weights are relative: weight 2 counts twice as much as weight 1."],
          ["<strong>Out of</strong>", "The highest score a student can earn."],
          ["<strong>Category</strong>", "Class Assessment, Exams Assessment or Other."],
          ["<strong>Due date</strong>", "The last moment scores can be entered, and the last moment students can take the online test. Leave it empty for no end date."],
          ["<strong>Late until</strong>", "Optional. After the due date, a test handed in is still accepted and marked late until this time."],
          ["<strong>Time limit (min)</strong> (More options)", "For an online test. Empty means no time limit."],
          ["<strong>Attempts</strong> (More options)", "How many times a student may take the online test. The default is 1."],
          ["<strong>Book</strong> (More options)", "<strong>Closed book</strong> or <strong>Open book</strong>, for an online test."],
          ["<strong>Scaled out of</strong> (More options)", "What scores are scaled to on reports. The default is 100."],
          ["<strong>Entry from</strong> (More options)", "The first moment scores can be entered. Empty means any time."],
          ["<strong>Lock scores</strong> (More options)", "Stops changes to scores. See the last section."],
          ["<strong>Open now</strong> (More options)", "Checked at first. Uncheck it to create the assessment turned off."],
          ["<strong>Email teachers</strong> (More options)", "Tells the teachers of the classes you picked."],
          ["<strong>Show on dashboard</strong> (More options)", "Shows the online test on the student's dashboard. It appears only when your school uses the student portal or Google Classroom."],
        ],
        tip: "Time limit, attempts and book are also on the question set, so you can set them here or when you add questions.",
      },
      {
        title: "Open, edit, lock, make obsolete or delete",
        text: "Select any row in <strong>Management › Assessments</strong> to open its panel. It shows the settings, whether scores can be entered (<strong>Status</strong>, <strong>Opens</strong>, <strong>Closes</strong>, how many <strong>Scores saved</strong>) and the classes it was given to.",
        image: "assess-panel.webp",
        caption: "An assessment's panel, with its three buttons.",
        steps: [
          ["Use the buttons at the bottom of the panel: <strong>Make obsolete</strong> (or <strong>Restore</strong>), <strong>Lock</strong> (or <strong>Unlock</strong>) and <strong>Edit</strong>."],
          ["<strong>Edit</strong> opens the same form as New test: name, weight, out of, scaled to, category, results, <strong>Lock scores</strong>, <strong>Opens</strong>, <strong>Closes</strong>, <strong>Late until</strong>, <strong>Email teachers</strong> and the classes. Change what you need and select <strong>Save</strong>."],
          ["The red bin beside <strong>Save</strong> deletes the assessment."],
        ],
        list: [
          "<strong>One assessment, many classes.</strong> An assessment given to several classes is one group. Edit, Lock and Delete work on the whole group, so a change reaches every class at once.",
          "<strong>Lock</strong> stops anyone changing its scores, in every class. On the gradebook the column shows <strong>Closed · Locked</strong>. A teacher who can unlock it sees a small pencil there that opens the assessment in Management.",
          "<strong>Make obsolete</strong> keeps the saved scores on report cards but closes the assessment to new scores. It shows struck through in the list. <strong>Restore</strong> brings it back.",
          "<strong>Delete</strong> removes the assessment for good. It is refused once scores have been entered. Make it obsolete instead.",
        ],
      },
    ],
    faq: [
      ["Do I have to add questions?", "No. Questions are only for online tests. Without them you type scores on the gradebook."],
      ["Can I reuse an assessment next term?", "Create it again for the new term. The old term keeps its assessments and scores. Questions can be copied with <strong>Reuse</strong>, see " + link("assessment-questions-and-online-tests", "Set questions and online tests") + "."],
      ["Why does it say nothing new was added?", "An assessment with that name may already be in that class and subject. Pick another name, or open the one that exists."],
      ["Why can't I delete an assessment?", "Scores were already entered for it. Choose <strong>Make obsolete</strong>: it stops taking scores, and the saved ones stay on report cards."],
      ["What if the weights don't add up to 100?", "They don't have to. Weights are relative, and report cards use them as you set them."],
    ],
    related: ["assessment-questions-and-online-tests", "grading-or-marking-assessment", "configure-dynamic-grading-and-remarks", "report-card"],
  },

  // ------------------------------------------------------------------ Questions and online tests
  {
    slug: "assessment-questions-and-online-tests",
    title: "Set questions and online tests",
    topic: "Assessments & grades",
    order: 2,
    summary: "Write, reuse or import questions, add pictures and hints, choose open or closed book, and decide what families see of a test.",
    tags: ["online test", "testing room", "assessment questions", "question set", "set questions", "label a picture", "open book", "closed book", "time limit", "auto marking", "essay rubric", "hint", "share with family", "shuffle", "attempts", "import exam", "upload test"],
    who: "Managers, and staff given <strong>Manage Assessments &amp; Scores</strong> and <strong>Set Assessment Questions</strong> (both are needed). A teacher works only on the online tests of the subjects they teach.",
    intro: "Questions turn an assessment into an online test. Students take it in the <strong>Testing Room</strong>. Managira marks what it can, and the result lands on your gradebook for you to approve.",
    sections: [
      {
        title: "Open the question sets",
        image: "questions-list.webp",
        caption: "Management › Assessment questions. Sets are grouped by class, then by subject.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>Assessment questions</strong>."],
          ["A teacher opens their class and chooses <strong>Assessment Questions</strong> in the Class Tools menu. If it is grayed out and says <em>Ask your admin for access</em>, you haven't been given <strong>Set Assessment Questions</strong>. Ask a manager to add it on your staff form."],
          ["Each set is one line. From left to right: number of questions, total points, closed or open book, time limit, attempts allowed, review status, <strong>to review</strong> (written answers waiting for you), whether its results are posted, and when it changed."],
        ],
      },
      {
        title: "Find a set",
        steps: [
          ["The page opens on the 6 sets you changed most recently, so the one you were just working on is at the top. Select <strong>Show the … older sets</strong> to add 12 more, or <strong>Show all</strong>."],
          ["Select <strong>Filters</strong> to narrow the list by <strong>School Year</strong>, <strong>Term</strong>, <strong>Class</strong>, <strong>Subject</strong>, <strong>Assessment</strong>, <strong>Review Status</strong>, points, percentage or a word, and to change <strong>Sort By</strong>. Select <strong>Apply</strong>, or <strong>Clear</strong> to start over. Filtering looks through every set, not just the ones shown.", "questions-filters-zoom.webp", "The filter panel."],
          ["The <strong>⋮</strong> at the end of a line opens that set's actions: <strong>Preview</strong>, <strong>Review</strong>, <strong>Edit</strong>, <strong>Rubric</strong>, <strong>Reuse</strong> and <strong>Delete</strong>. <strong>Approve</strong> and <strong>Reject</strong> join them for a set waiting for review.", "questions-actions-zoom.webp", "A set's ⋮ menu."],
        ],
        note: "<strong>Review</strong> in this menu opens the list of students who took the test. See " + link("review-and-mark-online-tests", "Review and mark online tests") + ".",
      },
      {
        title: "Start a new set",
        steps: [
          ["Select <strong>New questions</strong>."],
          ["The panel opens on <strong>Settings</strong> (closed, with a one-line summary) and below it <strong>Start</strong>. Choose <strong>Write</strong> to type the questions, <strong>Reuse</strong> to copy an earlier set, or <strong>Upload</strong> to turn a file into questions."],
          "<strong>Import Exam File</strong>, at the top right of the panel, turns a PDF, Word file or photo of a paper test into questions you can change. Check every question and answer before you save.",
          "No assessment yet? In <strong>Settings</strong>, select the <strong>+</strong> beside <strong>Assessment</strong> to create one without leaving.",
        ],
        image: "questions-start.webp",
        caption: "The new question set panel.",
      },
      {
        title: "Settings of a set",
        text: "Open <strong>Settings</strong> at the top of the panel. The first row (school year, term, class, subject, assessment) says which assessment these questions belong to.",
        image: "questions-edit.webp",
        caption: "Settings open on an existing set, with the questions below.",
        table: [
          ["Setting", "Choose"],
          ["<strong>Book</strong>", "<strong>Closed book</strong>: the student works on one secure page, and leaving it locks the test until you unlock it. <strong>Open book</strong>: students may use notes, and see the resources you attach."],
          ["<strong>Share with family</strong>", "What families see of the test itself once you post the grade: <strong>Nothing</strong>, the <strong>Grade</strong>, or <strong>Grade and answers</strong> (the questions, the student's answers and the right ones)."],
          ["<strong>Shuffle questions</strong>", "Each student gets the questions in their own order. It stays the same if they reload."],
          ["<strong>Time limit</strong>", "<strong>Minutes</strong>, then how many, or <strong>No limit</strong>. The test submits itself when time runs out."],
          ["<strong>Attempts</strong>", "How many times a student may take it."],
          ["<strong>Title</strong> and <strong>Description</strong>", "Optional. The title names the set in the list."],
        ],
        steps: [
          ["These choices sit together in the middle of Settings."],
          ["<strong>Resources</strong> are notes, files (<strong>Upload</strong>) and links (<strong>Link</strong>) for the test. Under <strong>Visible to</strong>, check <strong>Students</strong> to show them with the test (open-book tests always show them) and <strong>Parents</strong> to show them on the parent portal so families can help at home. They stay saved either way, whoever can see them."],
        ],
        note: "A secure (closed-book) test blocks only Ctrl and Cmd shortcuts. Leaving the page locks it. Nothing saves once a test is locked or out of time, and answers sent more than 2 minutes after the time limit don't count. The ones already saved do.",
      },
      {
        title: "Add questions",
        steps: [
          ["Each question is a card. Choose its <strong>Type</strong> and its <strong>Marks</strong>, then type the question. <strong>B</strong> and <strong>I</strong> make text bold or italic. The bin removes the question."],
          ["<strong>Details</strong> opens the answer choices and the <strong>Correct answer</strong> for the question. Select <strong>Hide</strong> to close it.", "questions-details-zoom.webp", "Options and the correct answer of a Choose one question."],
          "Select <strong>+ Add Question</strong> at the bottom to add another. The two small buttons at the top of the list show the questions stacked or side by side. The counter says how many questions and how many marks you have, for example <em>5 questions · 20 / 20 marks</em>.",
          "Select <strong>Preview</strong> to see the test as a student sees it, then <strong>Save Questions</strong> (<strong>Save Changes</strong> on an existing set).",
        ],
      },
      {
        title: "Question types",
        table: [
          ["Type", "Students", "Marked"],
          ["<strong>Choose one</strong>", "Pick one answer.", "Automatically"],
          ["<strong>Choose several</strong>", "Pick every right answer.", "Automatically, all or nothing"],
          ["<strong>True / False</strong>", "Pick True or False.", "Automatically"],
          ["<strong>Short answer</strong>", "Type a word or phrase. Capitals and extra spaces don't matter.", "Automatically"],
          ["<strong>Label a picture</strong>", "Type what each numbered spot on a picture shows.", "Automatically, a share of the marks per spot"],
          ["<strong>Essay</strong>", "Write freely.", "By you"],
        ],
      },
      {
        title: "Pictures, hints and rubrics",
        steps: [
          "Any question can show a picture. Select <strong>Picture</strong> under the question, or drop a file on it. Use a PNG, JPG, WEBP or GIF.",
          ["For <strong>Label a picture</strong>, add the picture, then click it once for each part to label. Type the right answer beside each number. Use <strong>/</strong> for other right answers, like <em>leaf / leaves</em>. A student never sees the answers.", "questions-picture-zoom.webp", "A label-a-picture question: numbered spots and their answers."],
          ["<strong>Hint</strong> opens a box for one optional line under the question, such as where to look. The student sees it with the question."],
          ["On an <strong>Essay</strong>, <strong>Rubric</strong> lets you mark by criteria (Content 2, Examples 1, Writing 1). Pick a <strong>Template</strong> or select <strong>+ Criterion</strong>. The criteria add up to the question's marks. A <strong>Marking Guide</strong> note for yourself sits beside it.", "questions-rubric-zoom.webp", "The rubric on an essay question."],
        ],
        note: "Files and links for the whole test go in <strong>Resources</strong>. A hint is text. A hint added earlier with files keeps them until you remove them.",
      },
      {
        title: "Save, edit, reuse and delete",
        steps: [
          "Select <strong>Save Questions</strong>. If the marks don't add up to what the assessment is marked out of, Managira says so before it saves, for example <em>Questions add up to 14, but the test is out of 20</em>. You can change the assessment's <strong>Out of</strong> to match (only while no scores are recorded) or, when the questions add up to less, save them as they are. Nothing changes behind your back.",
          "If your school reviews tests before students see them, a saved set waits as <strong>Pending</strong>. A manager or supervisor approves it from its <strong>⋮</strong> menu with <strong>Approve</strong> (or <strong>Reject</strong>). Students see only approved sets.",
          ["<strong>Edit</strong> changes a set. Open <strong>Rubric</strong> in the same menu to go straight to the essay rubric. You can edit until a student starts. After that, fix a wrong answer with <strong>Fix an answer</strong>. See " + link("review-and-mark-online-tests", "Review and mark online tests") + "."],
          ["<strong>Reuse</strong> copies a set to another school year, term, class and subject. It makes a new assessment (the name is filled in, change it if you like), and you choose whether to keep the order and whether to shuffle the options.", "questions-reuse.webp", "Reuse: where the copy goes."],
          "<strong>Delete</strong> permanently removes every question in the set. Managira asks you to confirm first.",
        ],
      },
      {
        title: "After students take it",
        text: "Students open the <strong>Testing Room</strong> in the student portal, start the test, answer and submit. See " + link("student-testing-room", "Take a test") + ". Managira marks it at once, and essays wait for you. The result goes on your gradebook as a <strong>new</strong> grade (a blue dot) waiting for your ✓. Families see the grade only after you post it, and only as much of the test as <strong>Share with family</strong> allows. See " + link("grading-or-marking-assessment", "Enter scores and post grades") + ", " + link("parent-tests-and-results", "Tests and results") + " for parents and " + link("student-results", "Results") + " for students.",
      },
    ],
    faq: [
      ["Students can't see my test.", "If your school reviews tests first, check that the set is approved. Also check the assessment is turned on and open (not past its due date), and that the student is enrolled in the class and subject."],
      ["Why can't I change the questions?", "A student has already started. Use <strong>Fix an answer</strong> in the set's <strong>Review</strong> panel to correct a wrong answer key. See " + link("review-and-mark-online-tests", "Review and mark online tests") + "."],
      ["Do parents see the questions before the test?", "Only if you check <strong>Parents</strong> under Resources, and then they see your notes and files, not the test. After the test, <strong>Share with family</strong> decides what they see. For a closed-book test, leave resources for parents off until it is over."],
      ["I don't see Assessment Questions.", "It needs both <strong>Manage Assessments &amp; Scores</strong> and <strong>Set Assessment Questions</strong>, and online tests must be part of your school's plan. A teacher also sees only the subjects they teach."],
    ],
    related: ["create-a-test-or-assessment", "review-and-mark-online-tests", "grading-or-marking-assessment", "student-testing-room", "parent-tests-and-results"],
  },

  // ------------------------------------------------------------------ Review and mark online tests
  {
    slug: "review-and-mark-online-tests",
    title: "Review and mark online tests",
    topic: "Assessments & grades",
    order: 2.5,
    summary: "See who took an online test, mark written answers one question at a time, fix a wrong answer key, and let a student try again.",
    tags: ["review test", "mark essay", "written answers", "mark by question", "fix an answer", "unlock student", "retake", "preview test", "answer key", "grade attempt", "to review"],
    who: "Managers, and staff given <strong>Manage Assessments &amp; Scores</strong> and <strong>Set Assessment Questions</strong>. A teacher reviews only the tests of the subjects they teach.",
    intro: "After students take an online test, you can check each attempt, mark essays and other written answers, and correct a question if the answer key was wrong. Everything marked here goes to the gradebook, where you approve it.",
    sections: [
      {
        title: "Preview a test",
        steps: [
          ["Open <strong>Management › Assessment questions</strong>, select the <strong>⋮</strong> on the set and choose <strong>Preview</strong>.", "questions-preview.webp", "Preview shows the test as a student sees it."],
        ],
        text: "Nothing is saved when you preview.",
      },
      {
        title: "See who took it",
        steps: [
          ["In the set's <strong>⋮</strong> menu, choose <strong>Review</strong>. The line under the title counts the class, for example <em>30 students · 1 finished or locked · 29 open</em>. Each student shows <strong>Not started</strong>, in progress, or <strong>Completed</strong>, and their score.", "questions-review.webp", "Review: every student, their status and score."],
          ["Select the <strong>⋮</strong> at the end of a student's row. <strong>Review answers</strong> opens their test. <strong>Unlock</strong> lets them take the test again."],
          ["<strong>Mark by question</strong> and <strong>Fix an answer</strong> are the two buttons under the count."],
        ],
        list: [
          "<strong>Unlock</strong> deletes that student's answers and their mark for this test, including a grade already posted, and gives them a new try. Managira asks you to confirm and asks whether to shuffle the questions for the new try.",
          "A student who left a closed-book test shows as locked. They stay locked out until you unlock them.",
          "The <strong>⋮</strong> at the top right of the panel has <strong>Unlock all</strong>, which gives every student who has finished a new try. Use it with care. It deletes all their answers and marks for this test.",
        ],
      },
      {
        title: "Review one student's answers",
        steps: [
          ["From a student's <strong>⋮</strong>, choose <strong>Review answers</strong>. The student's choices are marked <strong>Student</strong> and the right ones <strong>Correct</strong>. Under each question, <strong>Award marks</strong> shows what they earned. Change it where you disagree.", "questions-grade.webp", "One student's test: their answers, the right ones and the marks."],
          "The total at the bottom updates as you change marks. Select <strong>Save</strong>. The new score goes to the gradebook.",
        ],
        tip: "<strong>By student</strong> and <strong>By question</strong>, at the top, switch between this view and the one below.",
      },
      {
        title: "Mark written answers, one question at a time",
        steps: [
          ["Select <strong>Mark by question</strong>. You see one question and every student's answer to it, one student at a time. Type the mark, then select <strong>Save &amp; next</strong>. <strong>Back</strong> and <strong>Next</strong> move between answers, and the small chip at the top (<em>Question 1 · 1 to review</em>) shows how many are left."],
          ["The class gradebook has the same list. In the subject's gradebook, <strong>Review</strong> shows the tests with written answers waiting and a count of how many."],
        ],
        note: "<strong>Review</strong> on the gradebook appears only for people who hold <strong>Set Assessment Questions</strong>.",
      },
      {
        title: "Fix a wrong answer key",
        text: "You found out after students started that an answer key was wrong. You can't edit the questions now, but you can mark that one question again.",
        steps: [
          ["In <strong>Review</strong>, select <strong>Fix an answer</strong>. Choose the question, type the right answer, and select <strong>Mark again for everyone</strong>."],
          "Only that question is marked again. A mark you changed yourself on a student's test stays. Grades that change go back to waiting, so you approve them again.",
        ],
      },
      {
        title: "Then post the grade",
        text: "A marked online test lands on the gradebook as a <strong>new</strong> grade (a blue dot). It waits for your ✓. See " + link("grading-or-marking-assessment", "Enter scores and post grades") + ". The set's line in <strong>Assessment questions</strong> can also say <strong>Posted</strong> or <strong>Not posted</strong>, with <strong>Post grades</strong> or <strong>Take back</strong> beside it. A test taken online counts as posted there because its result went straight to the gradebook, and families still see nothing until the grade is approved.",
      },
    ],
    faq: [
      ["A student left the test by accident.", "In a closed-book test, leaving the page locks it. Open <strong>Review</strong>, select the student's <strong>⋮</strong> and choose <strong>Unlock</strong>. They start again, and their old answers are deleted."],
      ["Can I change a mark after I saved it?", "Yes. Open the student's answers again and change the marks. If the grade was already posted, it waits for your ✓ again, and families keep seeing the last posted grade."],
      ["Where do essay marks go?", "Into the same score as the rest of the test, then on to the gradebook. Until you've marked every written answer the total is not complete."],
    ],
    related: ["assessment-questions-and-online-tests", "grading-or-marking-assessment", "student-testing-room"],
  },

  // ------------------------------------------------------------------ Gradebook
  {
    slug: "grading-or-marking-assessment",
    title: "Enter scores and post grades",
    topic: "Assessments & grades",
    order: 3,
    summary: "Type scores on the class gradebook, post them to families with the ✓, and choose the columns and totals you see.",
    tags: ["enter scores", "gradebook", "post grades", "approve grades", "marks", "grades", "filter", "totals", "position", "percentage", "waiting", "new online result", "teachers", "google classroom grades"],
    who: "Teachers for their own classes and subjects, and staff given <strong>Manage Assessments &amp; Scores</strong>. A teacher sees only the subjects they teach.",
    intro: "The gradebook is a table for one subject: a row for each student, a column for each assessment, and totals on the right. Scores you type wait for your approval before parents and students see them.",
    sections: [
      {
        title: "Open the gradebook",
        steps: [
          ["Open the class, choose <strong>Gradebook</strong> in the Class Tools menu, then the subject. The number beside Gradebook is how many subjects you can open."],
          ["The newest assessments are on the right, and the table opens scrolled to them.", "gradebook-main.webp", "The Social Studies gradebook."],
        ],
        list: [
          "<strong>+ Assessment</strong> adds a column. See " + link("create-a-test-or-assessment", "Create an assessment") + ".",
          "<strong>Review</strong> (only with <strong>Set Assessment Questions</strong>) lists online tests with written answers to mark.",
          "<strong>Teachers</strong> shows who teaches this subject, and who is the main teacher.",
          "<strong>Save</strong> saves the scores you typed. <strong>Filters</strong> chooses what you see.",
        ],
        images: [],
      },
      {
        title: "Read a column",
        steps: [
          ["Each column heading shows the name, the category, its weight, whether scores can be entered, and the highest score (<strong>Score out of</strong>).", "gradebook-columns-zoom.webp", "Three assessments side by side."],
        ],
        list: [
          "<strong>Open</strong>: scores can be entered and changed.",
          "<strong>Closed</strong>, with a reason: <strong>Locked</strong>, <strong>Turned off</strong>, <strong>Opens</strong> a date, or <strong>Ended</strong> a date. Scores can't change right now. A manager changes this in <strong>Management › Assessments</strong>.",
          "A column with an assessment that is obsolete shows struck through. Its saved scores still count on report cards.",
        ],
      },
      {
        title: "Enter scores",
        steps: [
          ["Click a cell and type the score."],
          "Select <strong>Save</strong>. A message says how many scores were saved.",
          "The total, scaled score, percentage, grade and position work themselves out. A score outside 0 to the highest score isn't accepted, and nothing is saved until you fix it.",
        ],
        tip: "A <strong>Choice</strong> assessment (Yes / No, Pass / Fail) shows a choice in each cell instead of a number.",
      },
      {
        title: "What families see, and the dots",
        text: "A score you type or change waits for you before families see it. The small dot in the corner of each score says where it is.",
        table: [
          ["Dot", "Means", "Parents and student see"],
          ["Gray", "Posted.", "The score."],
          ["Yellow", "Ready to post: you typed or changed it.", "The last posted score, or nothing if it is new."],
          ["Blue", "New online result: a student took the test.", "Nothing yet."],
        ],
        note: "While any grade in a subject waits, families don't see the subject's totals (total, percentage and grade) either, so a total never includes a grade they can't see.",
      },
      {
        title: "Post grades with the ✓",
        steps: [
          ["When a column has grades waiting, an orange ✓ with their count shows in its heading."],
          ["Select the ✓. Managira asks <strong>Post 30 grades for “Unit 3 Test”?</strong> Select <strong>Post</strong>. Parents and the student can see the grades, and each family gets a notice.", "gradebook-post-zoom.webp", "The confirm window."],
        ],
        note: "You can still change a posted grade. It then waits again, and families keep seeing the last posted grade until you post the new one. You post one column at a time. If scores on the page aren't saved yet, Managira asks you to save them first.",
      },
      {
        title: "Choose what you see",
        steps: [
          ["<strong>Filters</strong> has two choices. <strong>Students</strong>: all, or only male or female students. <strong>Show</strong>: all assessments, the last 1, 2, 3 and so on (as many as there are), or one assessment. The range is remembered on any device. One assessment is for this visit only. <strong>Reset</strong> puts it back.", "gradebook-filter-zoom.webp", "Students, and how much to show."],
          ["The <strong>≡</strong> in the top right of the last total opens <strong>Totals to show</strong>: total subject score, scaled score, total percentage, grade and position. Uncheck what you don't need. It is just for you, saved to your account, and at least one total always shows."],
          ["<strong>Teachers</strong> lists the people assigned to the subject. <strong>Main</strong> marks the main teacher."],
        ],
      },
      {
        title: "Online tests and Google Classroom",
        list: [
          "A finished online test arrives as a <strong>new</strong> grade (blue dot). Mark any written answers, then post it with the ✓. See " + link("review-and-mark-online-tests", "Review and mark online tests") + ".",
          "If your school connected Google Classroom, grades travel both ways. A grade changed only in Google comes in waiting for your ✓. A change made in Managira goes to Google once families can see it. If both changed, Managira's is kept and sent. A locked assessment takes nothing from Google. See " + link("integrations", "Integrations") + ".",
        ],
      },
      {
        title: "How grades are worked out",
        text: "Each score is scaled by the assessment's <strong>Scaled out of</strong> and counted by its <strong>Weight</strong>. The total gets a letter grade and remark from the grading scale. See " + link("configure-dynamic-grading-and-remarks", "Grading scales and remarks") + ".",
        example: "A student scores 42 out of 50 on a Unit Test: 42 / 50 = 84%, a B on the usual scale.",
      },
      {
        title: "What families see",
        text: "Parents see posted grades on their child's page, and students see them in their own portal. See " + link("parent-grades-and-report-cards", "Grades and report cards") + " for parents, " + link("parent-tests-and-results", "Tests and results") + " for online tests and " + link("student-results", "Results") + " for students.",
      },
    ],
    faq: [
      ["I can't edit a score.", "The column says <strong>Closed</strong> and why: locked, turned off, not open yet, or past its due date. A manager can unlock or reopen it in Management › Assessments."],
      ["When do parents see scores?", "When you post them with the ✓. Until then they see the last posted grade, or nothing for a new one."],
      ["Where's + Assessment?", "At the top of the gradebook, for staff who hold <strong>Manage Assessments &amp; Scores</strong>."],
      ["Why is a subject missing from my Gradebook list?", "A teacher sees only the subjects they teach. Ask a manager to add you to the subject on your staff form."],
      ["What does the number on ✓ mean?", "How many grades in that column are waiting to be posted."],
    ],
    related: ["create-a-test-or-assessment", "assessment-questions-and-online-tests", "review-and-mark-online-tests", "configure-dynamic-grading-and-remarks", "report-card"],
  },

  // ------------------------------------------------------------------ Grading scales and remarks
  {
    slug: "configure-dynamic-grading-and-remarks",
    title: "Grading scales and remarks",
    topic: "Assessments & grades",
    order: 4,
    summary: "Set the letter grades and the percentage range for each, the remark printed with each range, and how grades show on report cards.",
    tags: ["grading scale", "grade scale", "letter grades", "grade boundaries", "remarks", "score remark", "report settings", "grade label", "percentage", "gpa", "grade bands"],
    who: "Managers, and staff given <strong>Report Settings</strong>.",
    intro: "A grading scale turns a percentage into a letter grade and a remark. Each class has its own scale, so you can set one and apply it to as many classes as you like.",
    sections: [
      {
        title: "Open the grading scale",
        image: "grading-settings.webp",
        caption: "Reports › Report settings.",
        steps: [
          ["Go to <strong>Reports</strong> and select <strong>Report settings</strong>."],
          ["Open <strong>Promotion &amp; grading by class</strong>, then choose a class in the list on the left. Under <strong>Grades</strong> you see its <strong>Grade scale</strong>: each grade, its percentage range and its remark."],
        ],
      },
      {
        title: "Add or change grades",
        steps: [
          "Select <strong>+ Add grades</strong>. A form opens with one rule row.",
          ["Fill in <strong>Grade Label</strong> (for example <em>A</em>), <strong>Score Remark</strong> (<em>Excellent</em>), <strong>From %</strong> and <strong>To %</strong>. Select the <strong>+</strong> to add another rule row, and the <strong>×</strong> to drop one."],
          ["Under <strong>Apply To Classes</strong>, check every class that should use these rules, or check <strong>Select all classes</strong>.", "grading-apply-zoom.webp", "Choose the classes."],
          "Select <strong>Save Rules</strong>. To change or remove a grade later, use the <strong>⋮</strong> at the end of its row and choose <strong>Edit</strong> or <strong>Delete</strong>.",
        ],
        note: "A row with a small padlock is locked and can't be changed here.",
        warning: "Changing the scale mid-term changes the grades and remarks on report cards made afterwards. Set it before the term's first scores, and change it between terms.",
      },
      {
        title: "A typical scale",
        text: "Many schools in the United States use this one. Enter a row for every grade you give, with no gap between one range and the next.",
        table: [
          ["From %", "To %", "Grade", "Remark"],
          ["90", "100", "A", "Excellent"],
          ["80", "89", "B", "Very good"],
          ["70", "79", "C", "Good"],
          ["60", "69", "D", "Needs improvement"],
          ["0", "59", "F", "Failing"],
        ],
      },
      {
        title: "Choose how grades show",
        steps: [
          ["<strong>Format</strong>, under the scale, chooses <strong>Letters</strong>, <strong>Numbers</strong> or <strong>Letters + Numbers</strong>. With numbers, <strong>Configure Numbers</strong> opens the rules for the total shown."],
          "<strong>What prints on report cards</strong>, below, chooses the sections a report card shows. See " + link("report-settings", "Report settings") + ".",
        ],
      },
      {
        title: "When a class has no scale",
        text: "A class with no scale of its own uses the United States scale: <strong>A</strong> 90 and above, <strong>B</strong> 80 and above, <strong>C</strong> 70 and above, <strong>D</strong> 60 to 69, and <strong>F</strong> below 60.",
      },
      {
        title: "Where the grade shows",
        list: [
          "On the gradebook's <strong>Grade</strong> column and on report cards. See " + link("grading-or-marking-assessment", "Enter scores and post grades") + " and " + link("report-card", "Report cards") + ".",
          "To families, once the grades are posted. See " + link("parent-grades-and-report-cards", "Grades and report cards") + ".",
        ],
      },
    ],
    faq: [
      ["Can each class have a different scale?", "Yes. Choose the class on the left, or check only the classes you want under <strong>Apply To Classes</strong>."],
      ["Why does my scale stop at D?", "Only the rows you add are used. Add a row for every grade you give, with no gaps between the ranges."],
      ["Where do the remarks teachers write on report cards live?", "In <strong>Report remarks</strong>, on the same Report settings page. See " + link("report-settings", "Report settings") + "."],
    ],
    related: ["report-settings", "grading-or-marking-assessment", "report-card"],
  },
];
