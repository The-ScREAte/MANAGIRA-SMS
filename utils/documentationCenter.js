const crypto = require('crypto');
const he = require('he');
const sanitizeHtml = require('sanitize-html');
const db = require('../config/db');

const DEFAULT_TOPICS = [
  'Getting Started',
  'School Setup',
  'Academic Structure',
  'Students & Admissions',
  'Attendance',
  'Assessments & Grades',
  'Reports & Transcripts',
  'Staff & Permissions',
  'Parents & Guardians',
  'PayGira & Payments',
  'Communication & Website',
  'Hub Management',
  'Analytics & Reporting',
  'Account & Login',
  'Billing & Subscriptions',
];

const QUICK_START_RESOURCES = [
  {
    key: 'full-user-documentation',
    title: 'Full User Documentation',
    subtitle: 'Complete platform guide',
    description: 'The full Google Doc guide for the entire platform.',
    type: 'link',
    url: 'https://docs.google.com/document/d/1bgFP5cCQyr-9jdaYZTsWO8ONAnAuNUKqKQ2if_4TBOM/edit?usp=drivesdk',
    external: true,
  },
  {
    key: 'walk-through-video',
    title: 'Walk Through Video',
    subtitle: 'Official walkthrough playlist',
    description: 'Watch the official Managira walkthrough directly in the page.',
    type: 'youtube',
    url: 'https://www.youtube.com/watch?v=y1J0KahfA-c&list=PLxNl6NDBQVL3A7mSgYcUKqTZ8WaB5IZOT&index=1&t=8s',
    embedUrl: 'https://www.youtube-nocookie.com/embed/y1J0KahfA-c?list=PLxNl6NDBQVL3A7mSgYcUKqTZ8WaB5IZOT',
    external: true,
  },
  {
    key: 'single-school-sign-up',
    title: 'Single School Sign Up Steps',
    subtitle: 'Step-by-step PDF',
    description: 'Download the PDF for single-school onboarding.',
    type: 'file',
    url: '/managira%20pdf/Single%20school%20Sign%20Up%20steps.pdf',
    external: true,
  },
  {
    key: 'starter-pack',
    title: 'Managira Starter Pack',
    subtitle: 'Quick-start PDF resource',
    description: 'A compact starter pack for first-time setup and orientation.',
    type: 'file',
    url: '/managira%20pdf/Managira%20Starter%20Pack.pdf',
    external: true,
  },
  {
    key: 'features-brochure',
    title: 'Features Driving Managira Brochure',
    subtitle: 'Feature overview brochure',
    description: 'Download the brochure that summarizes the platform capabilities.',
    type: 'file',
    url: '/managira%20pdf/Features%20driving%20managira%20Brochure.pdf',
    external: true,
  },
];

const DEFAULT_ARTICLES = [
  {
    title: 'Register a school and complete first-time setup',
    topic: 'Getting Started',
    subtopic: 'First-Time Setup',
    status: 'active',
    featured: true,
    tags: ['register school', 'onboarding', 'first setup', 'new school'],
    seoDescription: 'Set up your school on Managira from registration through academic structure, staff, and students.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Use this flow when you are setting up a school on Managira for the first time.</p>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> Complete your academic structure before adding staff and students so later workflows use the right classes, subjects, and term settings.</div>
      <h2>Steps</h2>
      <ol>
        <li>Open <a href="/account/register">school registration</a> and complete the registration form.</li>
        <li>Sign in and open the <a href="/common/management">Management workspace</a>.</li>
        <li>Open <a href="/account/personalization">Personalization</a> to set your school name, logo, nickname, theme, and font.</li>
        <li>Create your school year and terms before using attendance, assessments, or reports.</li>
        <li>Create classes, subjects, and graduation-year groups.</li>
        <li>Add staff accounts and assign the correct roles.</li>
        <li>Add or approve students, then complete enrollments where needed.</li>
      </ol>
      <h3>What to do next</h3>
      <ul>
        <li>Configure the grading system before creating tests.</li>
        <li>Review guardian setup if parents will use the portal immediately.</li>
        <li>Update your public website content after the core school data is ready.</li>
      </ul>
    `,
  },
  {
    title: 'Create school years, terms, and set the current term',
    topic: 'School Setup',
    subtopic: 'Academic Calendar',
    status: 'active',
    featured: true,
    tags: ['school year', 'term', 'current term', 'semester'],
    seoDescription: 'Create academic years and terms, and make sure the correct term is active before using school workflows.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Open <a href="/common/management#school-year">Management</a> and then open the school-year records area.</p>
      <h2>Steps</h2>
      <ol>
        <li>Create a school year with the correct start and end dates.</li>
        <li>Add the terms that belong to that school year.</li>
        <li>Review each term date carefully so terms do not overlap.</li>
        <li>Set the correct term as the current term.</li>
        <li>Confirm the current term before entering attendance, assessments, enrollment changes, or reports.</li>
      </ol>
      <blockquote>Changing the current term affects what staff see across attendance, assessments, dashboards, and reporting screens.</blockquote>
      <h3>Related tasks</h3>
      <ul>
        <li><a href="/legal/user-documentation/create-classes-subjects-and-graduation-year-groups">Create classes, subjects, and graduation-year groups</a></li>
        <li><a href="/legal/user-documentation/create-a-test-or-assessment">Create a test or assessment</a></li>
      </ul>
    `,
  },
  {
    title: 'Create classes, subjects, and graduation-year groups',
    topic: 'Academic Structure',
    subtopic: 'Classes and Subjects',
    status: 'active',
    featured: true,
    tags: ['class setup', 'subjects', 'graduation year', 'academic structure'],
    seoDescription: 'Manage classes, assign subjects, and organize graduation-year groups from one academic-structure workspace.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Open <a href="/common/manageClassSubjectAndGradYr">Manage Class, Subject &amp; Graduation Year</a>.</p>
      <h2>Steps</h2>
      <ol>
        <li>Add the class first.</li>
        <li>Create new subjects or assign existing subjects to the class.</li>
        <li>Create graduation-year groups if your school tracks cohorts that way.</li>
        <li>Return to the same page when you need to rename or delete classes or subjects.</li>
      </ol>
      <div class="doc-callout doc-callout--info"><strong>Info:</strong> Classes and subjects created here are reused by attendance, assessments, reports, and promotion workflows.</div>
    `,
  },
  {
    title: 'Add, edit, and correct student information',
    topic: 'Students & Admissions',
    subtopic: 'Student Records',
    status: 'active',
    featured: true,
    tags: ['edit student', 'student details', 'student profile', 'change student info'],
    seoDescription: 'Update student details such as name, date of birth, class, guardian links, contact details, and image.',
    contentHtml: `
      <h2>Where to start</h2>
      <p>Start from the student records area rather than looking for a global settings page.</p>
      <h2>Steps</h2>
      <ol>
        <li>Open the school-year records area or the student details view.</li>
        <li>Search for the student record.</li>
        <li>Open the student details page, then choose <strong>Edit Student</strong>.</li>
        <li>Update grouped fields such as full name, date of birth, class, guardian links, contact details, and image.</li>
        <li>Save the changes.</li>
        <li>Reopen the student details page to confirm the update.</li>
      </ol>
      <h3>Good practice</h3>
      <p>If reports were already generated, review those reports after correcting core student details.</p>
    `,
  },
  {
    title: 'Review and approve pending admissions',
    topic: 'Students & Admissions',
    subtopic: 'Admissions Review',
    status: 'active',
    featured: false,
    tags: ['pending admissions', 'approve admission', 'reject admission', 'edit pending student'],
    seoDescription: 'Review public applications, edit pending student data, and approve or reject admissions inside Managira.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Open the admissions review area from the school-side admissions workflow.</p>
      <h2>Steps</h2>
      <ol>
        <li>Open the pending admissions list.</li>
        <li>Review the student and guardian details submitted from the public application flow.</li>
        <li>Edit the pending record if anything needs correction before approval.</li>
        <li>Approve the application to create the student record, or reject it if it should not move forward.</li>
        <li>Use this review workflow instead of manually re-entering information for approved applicants.</li>
      </ol>
    `,
  },
  {
    title: 'Enroll a student into a class or term',
    topic: 'Students & Admissions',
    subtopic: 'Enrollment',
    status: 'active',
    featured: false,
    tags: ['enrollment', 'class placement', 'term enrollment'],
    seoDescription: 'Create or update a student enrollment record so the student is placed into the correct class and term.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Open <a href="/enrollment/manageEnrollment">Manage Enrollment</a>.</p>
      <h2>Steps</h2>
      <ol>
        <li>Create or open the enrollment record.</li>
        <li>Select the student.</li>
        <li>Choose the class and the term for the enrollment.</li>
        <li>Save the enrollment.</li>
        <li>Return to the list to confirm the placement.</li>
      </ol>
    `,
  },
  {
    title: 'Mark attendance for a class',
    topic: 'Attendance',
    subtopic: 'Daily Attendance',
    status: 'active',
    featured: false,
    tags: ['attendance', 'mark class attendance', 'present absent'],
    seoDescription: 'Mark attendance for a class and confirm the saved record for the correct date and term.',
    contentHtml: `
      <h2>Before you start</h2>
      <p>Make sure the correct school term is active and the account has permission to mark attendance.</p>
      <h2>Steps</h2>
      <ol>
        <li>Open the attendance page from Management.</li>
        <li>Select the class and date.</li>
        <li>Mark each student with the correct attendance status.</li>
        <li>Save the attendance for that date.</li>
        <li>Reopen the class attendance view to confirm it was stored.</li>
      </ol>
      <div class="doc-callout doc-callout--warning"><strong>Warning:</strong> If you cannot mark attendance, first verify the active term, class assignment, and your permissions.</div>
    `,
  },
  {
    title: 'Create a test or assessment',
    topic: 'Assessments & Grades',
    subtopic: 'Assessment Setup',
    status: 'active',
    featured: true,
    tags: ['create test', 'assessment', 'grading'],
    seoDescription: 'Create a test or assessment, assign it to classes and subjects, and manage it from the assessment workspace.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Open <a href="/common/manageAssessment">Manage Assessments</a>, then choose <strong>Create New Test</strong>.</p>
      <h2>Steps</h2>
      <ol>
        <li>Open the assessment manager for the active term.</li>
        <li>Click <strong>Create New Test</strong>.</li>
        <li>Enter the title, category, maximum score, and weight.</li>
        <li>Assign the test to the relevant class and subject combinations.</li>
        <li>Save the assessment and return to the manager to confirm it appears in the list.</li>
      </ol>
      <h3>Related tasks</h3>
      <ul>
        <li><a href="/legal/user-documentation/enter-or-edit-assessment-scores">Enter or edit assessment scores</a></li>
        <li><a href="/legal/user-documentation/configure-the-grading-system">Configure the grading system</a></li>
      </ul>
    `,
  },
  {
    title: 'Enter or edit assessment scores',
    topic: 'Assessments & Grades',
    subtopic: 'Score Entry',
    status: 'active',
    featured: true,
    tags: ['enter scores', 'assessment marks', 'edit scores'],
    seoDescription: 'Enter student assessment scores and understand when a test must be unlocked before changes can be made.',
    contentHtml: `
      <h2>Steps</h2>
      <ol>
        <li>Create the assessment first.</li>
        <li>Open the score-entry page for that assessment.</li>
        <li>Enter the marks for each student.</li>
        <li>Save all scores.</li>
        <li>If later edits are blocked, reopen the assessment manager and check whether the assessment is locked.</li>
      </ol>
      <h3>Lock, unlock, and modify</h3>
      <p>The assessment manager also lets you lock or unlock score editing and modify the assessment configuration.</p>
    `,
  },
  {
    title: 'Configure the grading system',
    topic: 'Assessments & Grades',
    subtopic: 'Grading Rules',
    status: 'active',
    featured: false,
    tags: ['grading system', 'grade boundaries', 'grade scale'],
    seoDescription: 'Set the grading scale and grade boundaries your school uses before working with tests and report calculations.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Open <a href="/common/gradingSystem">Grading System</a>.</p>
      <h2>Steps</h2>
      <ol>
        <li>Define the grading scale your school uses.</li>
        <li>Set the grade boundaries or pass-fail cutoffs.</li>
        <li>Save the grading configuration.</li>
        <li>Only after saving should you proceed with assessment setup and reporting.</li>
      </ol>
    `,
  },
  {
    title: 'Generate report cards, merit sheets, and transcripts',
    topic: 'Reports & Transcripts',
    subtopic: 'Academic Reports',
    status: 'active',
    featured: true,
    tags: ['report cards', 'merit sheet', 'transcript', 'reports'],
    seoDescription: 'Generate report cards, merit sheets, and transcripts after confirming the active term and academic data completeness.',
    contentHtml: `
      <h2>Before you generate reports</h2>
      <ul>
        <li>Confirm the current term is correct.</li>
        <li>Make sure assessments and attendance are complete.</li>
        <li>Review grading settings if totals or grades look wrong.</li>
      </ul>
      <h2>Report cards and merit sheets</h2>
      <ol>
        <li>Open the reports area.</li>
        <li>Choose the report type you need.</li>
        <li>Select the class or student.</li>
        <li>Generate the report and review it before printing or sharing.</li>
      </ol>
      <h2>Transcripts</h2>
      <ol>
        <li>Open the transcript action for the student.</li>
        <li>Review the generated transcript.</li>
        <li>Upload or save the appropriate signature if required.</li>
        <li>Print, download, or email the transcript.</li>
      </ol>
    `,
  },
  {
    title: 'Create and manage employee accounts and permissions',
    topic: 'Staff & Permissions',
    subtopic: 'Employee Access',
    status: 'active',
    featured: false,
    tags: ['employees', 'permissions', 'roles', 'staff access'],
    seoDescription: 'Create employee accounts, assign roles, and review staff access from the employee management workspace.',
    contentHtml: `
      <h2>Where to manage it</h2>
      <p>Use the employee management area in Management.</p>
      <h2>Steps</h2>
      <ol>
        <li>Open the employee manager.</li>
        <li>Create a new employee or open an existing one.</li>
        <li>Assign the correct role and any required responsibilities.</li>
        <li>Save the record.</li>
        <li>Return to the employee list when you need to modify, hold, or remove access later.</li>
      </ol>
      <blockquote>Give only the permissions needed for the staff member's actual job.</blockquote>
    `,
  },
  {
    title: 'Create or link guardian accounts and use the Guardian Portal',
    topic: 'Parents & Guardians',
    subtopic: 'Guardian Access',
    status: 'active',
    featured: false,
    tags: ['guardian portal', 'parents', 'link guardian', 'guardian login'],
    seoDescription: 'Create and link guardian accounts from the school side, and understand how guardians sign in and submit reports.',
    contentHtml: `
      <h2>School-side guardian management</h2>
      <ol>
        <li>Open the guardian management area from Management.</li>
        <li>Search for an existing guardian record or create one if needed.</li>
        <li>Link the guardian to the correct student records.</li>
        <li>Use the password-reset action if the guardian needs new access credentials.</li>
      </ol>
      <h2>Guardian sign-in</h2>
      <ol>
        <li>Guardians sign in at <a href="/account/guardian-login">Guardian Login</a>.</li>
        <li>After signing in, they can use the dashboard, student, and academic details pages.</li>
        <li>They can also open the reports area to submit or reply to a concern.</li>
      </ol>
    `,
  },
  {
    title: 'Create announcements, events, and update the school website',
    topic: 'Communication & Website',
    subtopic: 'Content Management',
    status: 'active',
    featured: false,
    tags: ['announcements', 'events', 'school website', 'public content'],
    seoDescription: 'Create announcements and events from the management workspace and update public website content from the website settings area.',
    contentHtml: `
      <h2>Announcements and events</h2>
      <ol>
        <li>Open the combined announcements and events page from Management.</li>
        <li>Create the announcement or event.</li>
        <li>Enter the timing, audience, and content.</li>
        <li>Save and return later to edit or remove it.</li>
      </ol>
      <h2>Public website content</h2>
      <ol>
        <li>Open <a href="/account/managePublicContent">Website Settings</a>.</li>
        <li>Update slides, text sections, about-us content, images, theme, or layout as needed.</li>
        <li>Save each change and review the public result.</li>
      </ol>
    `,
  },
  {
    title: 'Set up PayGira bills, collections, and guardian payments',
    topic: 'PayGira & Payments',
    subtopic: 'Finance Workflow',
    status: 'active',
    featured: true,
    tags: ['paygira', 'finance', 'bills', 'guardian payments', 'my paygira'],
    seoDescription: 'Configure PayGira, create bills, record collections, sign off completed collections, and manage guardian payments.',
    contentHtml: `
      <h2>Finance setup</h2>
      <ol>
        <li>Open the finance workspace.</li>
        <li>Configure payment settings and payout destination.</li>
        <li>Create templates if needed, then create the actual bills.</li>
        <li>Assign the bills to the correct students or groups.</li>
      </ol>
      <h2>Staff collections</h2>
      <ol>
        <li>Staff collectors use <strong>My PayGira</strong> to record one-off or bulk collections.</li>
        <li>Once the relevant bill scope is fully settled, use sign-off to finalize the collection.</li>
      </ol>
      <h2>Guardian payments</h2>
      <ol>
        <li>Guardians sign in and open PayGira in the Guardian Portal.</li>
        <li>They choose a bill and pay using the options enabled by the school.</li>
        <li>Invoices and receipts remain available in the portal after payment.</li>
      </ol>
    `,
  },
  {
    title: 'Invite schools into a hub and manage multi-school oversight',
    topic: 'Hub Management',
    subtopic: 'School Membership',
    status: 'active',
    featured: false,
    tags: ['hub', 'invite school', 'multi-school', 'oversight'],
    seoDescription: 'Use the hub dashboard to invite schools and manage hub-level oversight.',
    contentHtml: `
      <h2>Steps</h2>
      <ol>
        <li>Sign in to the hub dashboard.</li>
        <li>Open the organization or invitation area.</li>
        <li>Send the invitation to the target school.</li>
        <li>Track the membership result and confirm how billing and oversight should work after the school joins.</li>
      </ol>
    `,
  },
  {
    title: 'Use the dashboard, reports, and activity logs',
    topic: 'Analytics & Reporting',
    subtopic: 'Operational Visibility',
    status: 'active',
    featured: false,
    tags: ['analytics', 'org dashboard', 'reports', 'activity logs'],
    seoDescription: 'Use the organization dashboard for high-level metrics and the reports and activity log areas for deeper operational review.',
    contentHtml: `
      <h2>Where to look</h2>
      <ul>
        <li>Use the organization dashboard for high-level metrics.</li>
        <li>Use the reports hub for report-driven workflows.</li>
        <li>Use activity logs when you need a detailed history of actions or changes.</li>
      </ul>
    `,
  },
  {
    title: 'Reset a password or recover account access',
    topic: 'Account & Login',
    subtopic: 'Password Recovery',
    status: 'active',
    featured: false,
    tags: ['forgot password', 'reset password', 'login help'],
    seoDescription: 'Use the password reset flow on the login page and know when school-side help is needed for guardian accounts.',
    contentHtml: `
      <h2>Steps</h2>
      <ol>
        <li>Open the login page and choose <strong>Forgot Password</strong>.</li>
        <li>Enter the email address linked to the account.</li>
        <li>Open the reset link sent by email.</li>
        <li>Set the new password.</li>
      </ol>
      <h3>If the email does not arrive</h3>
      <ul>
        <li>Check spam or junk folders.</li>
        <li>Confirm the correct account email was entered.</li>
        <li>If the account is a guardian account, the school can also trigger a guardian reset from the guardian management area.</li>
      </ul>
    `,
  },
  {
    title: 'Change a plan or cancel a subscription',
    topic: 'Billing & Subscriptions',
    subtopic: 'Subscription Management',
    status: 'active',
    featured: false,
    tags: ['billing', 'subscription', 'upgrade plan', 'cancel subscription'],
    seoDescription: 'Review available plans and manage subscription changes from the account-side billing flow.',
    contentHtml: `
      <h2>Steps</h2>
      <ol>
        <li>Open the service-plan page to review the available plans.</li>
        <li>Choose the new plan if you are upgrading or downgrading.</li>
        <li>Use the cancel-subscription page only when you intend to stop renewal.</li>
        <li>Review the current billing-cycle effect before confirming the change.</li>
      </ol>
    `,
  },
];

const CANONICAL_ARTICLE_SYNC = [
  {
    slug: 'create-school-years-classes-terms-and-set-the-current-term',
    title: 'Create school years, terms, and set the current term',
    topic: 'School Setup',
    subtopic: 'Academic Calendar',
    status: 'active',
    featured: true,
    tags: ['school year', 'term', 'current term', 'semester', 'overlap validation'],
    seoDescription: 'Create academic years and terms, validate term ranges, and make sure the correct term is active before using school workflows.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Every attendance record, assessment, report card, and promotion is tied to a specific school year and term. Before using those workflows, create your academic calendar and set the correct current term.</p>
      <h2>Creating a school year</h2>
      <ol>
        <li>Open <strong>Management Tools → School Year</strong>.</li>
        <li>Click <strong>Add School Year</strong> and enter the label, start date, and end date.</li>
        <li>Save the new school year.</li>
      </ol>
      <h2>Adding terms</h2>
      <ol>
        <li>Open the school year and click <strong>Add Term</strong>.</li>
        <li>Enter the term name with its start and end dates.</li>
        <li>Repeat for each term in that year.</li>
      </ol>
      <div class="doc-callout doc-callout--warning"><strong>Warning — overlap validation:</strong> Managira blocks any term whose date range overlaps another term in the same school year. If the save fails, review all existing term dates and correct the conflict before trying again.</div>
      <h2>Setting the current term</h2>
      <p>Only one term can be active at a time. The current term controls which term is pre-selected when staff mark attendance, enter grades, and generate reports.</p>
      <ol>
        <li>Locate the target term in the list.</li>
        <li>Click <strong>Set as Current Term</strong>.</li>
        <li>Confirm the switch.</li>
      </ol>
      <div class="doc-callout doc-callout--warning"><strong>Wrong-term warning:</strong> If a staff member starts working while the wrong term is active, Managira shows a warning prompt naming the current term before continuing. Treat that prompt as a signal to return to school-year settings and correct the active term.</div>
      <h2>Switching to a new term</h2>
      <ol>
        <li>Close the previous term if your workflow requires term closure.</li>
        <li>Open the new term and choose <strong>Set as Current Term</strong>.</li>
        <li>Confirm the change and recheck attendance, assessments, and reports.</li>
      </ol>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> Verify the active term before bulk attendance, report generation, or promotion work. Those workflows are much harder to clean up after data is saved under the wrong term.</div>
    `,
  },
  {
    slug: 'create-and-manage-employee-accounts-and-permissions',
    title: 'Create and manage employee accounts and permissions',
    topic: 'Staff & Permissions',
    subtopic: 'Employee Access',
    status: 'active',
    featured: false,
    tags: ['employees', 'permissions', 'roles', 'staff access', 'granular permissions'],
    seoDescription: 'Create employee accounts, understand role defaults, review granular permissions, and manage staff access safely.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Managira uses role-based access control. Each staff member has a base role, and administrators can add or remove granular permissions based on job responsibility.</p>
      <h2>Base roles and default access</h2>
      <table>
        <thead><tr><th>Role</th><th>Typical default access</th></tr></thead>
        <tbody>
          <tr><td><strong>Teacher</strong></td><td>Mark attendance, enter scores for assigned classes, and view student details relevant to their teaching work.</td></tr>
          <tr><td><strong>Supervisor</strong></td><td>All Teacher actions plus broader oversight such as class management and report visibility where assigned.</td></tr>
          <tr><td><strong>Manager</strong></td><td>School-wide operational access including broader student, staff, and reporting workflows.</td></tr>
          <tr><td><strong>Admin</strong></td><td>Full organisation access including billing, settings, and permission administration.</td></tr>
        </tbody>
      </table>
      <h2>Granting extra permissions</h2>
      <ol>
        <li>Go to <strong>Management → Manage Employees</strong>.</li>
        <li>Open the employee record.</li>
        <li>Use the <strong>Permissions</strong> section to enable or disable additional access.</li>
        <li>Save the employee record.</li>
      </ol>
      <div class="doc-callout doc-callout--warning"><strong>High-risk permissions:</strong> Only Admin-level users should grant access for employee management, organisation settings, billing control, reversal workflows, or other sensitive actions. Non-manager staff must not be allowed to escalate permissions for other users.</div>
      <h2>Where permissions are stored</h2>
      <p>Permissions are stored per employee in the organisation-scoped staff access records. This means permissions persist between sessions and remain enforceable even if a user tries to reach a route directly.</p>
      <h2>Reviewing permissions</h2>
      <ol>
        <li>Open <strong>Manage Employees</strong>.</li>
        <li>Review the role and permissions shown for each staff member.</li>
        <li>Open individual records when you need a detailed access audit.</li>
      </ol>
      <h2>Granular permissions commonly reviewed</h2>
      <ul>
        <li>Attendance marking and attendance editing</li>
        <li>Assessment creation and grade entry</li>
        <li>Student record editing and archiving</li>
        <li>Class and subject management</li>
        <li>Admissions approval</li>
        <li>Report and transcript generation</li>
        <li>Announcements and events publishing</li>
        <li>Promotion approval and reversal</li>
        <li>PayGira collection handling and sign-off</li>
        <li>Billing and organisation settings</li>
      </ul>
      <h2>Actions protected by permission checks</h2>
      <p>Protected organisation actions include employee management, admissions approval, event publishing, term management, class and subject setup, transcript generation, promotion workflows, billing operations, and other sensitive record changes.</p>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> Review staff permissions at the start of every term. Role drift is common when responsibilities change during the year.</div>
    `,
  },
  {
    slug: 'set-up-paygira-bills-collections-and-guardian-payments',
    title: 'Set up PayGira bills, collections, and guardian payments',
    topic: 'PayGira & Payments',
    subtopic: 'Finance Workflow',
    status: 'active',
    featured: true,
    tags: ['paygira', 'finance', 'bills', 'guardian payments', 'my paygira', 'sign-off'],
    seoDescription: 'Configure PayGira, create bills, record collections, handle sign-off, and manage guardian payments securely.',
    contentHtml: `
      <h2>Overview</h2>
      <p>PayGira is Managira's school payments workflow. Schools use it to create bills, accept guardian payments, record manual collections, manage partial payments and credit, and keep a full audit trail.</p>
      <h2>1 — Initial setup</h2>
      <ol>
        <li>Open the <strong>Finance</strong> workspace.</li>
        <li>Configure payment settings, payout destination, and supported payment options.</li>
        <li>Verify the payout route before accepting online payments.</li>
      </ol>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> Guardian online payments stay unavailable until payout setup is completed successfully.</div>
      <h2>2 — Creating bills</h2>
      <ol>
        <li>Create the bill or bill template.</li>
        <li>Choose the affected students, classes, or groups.</li>
        <li>Set due dates and whether partial payments are allowed.</li>
        <li>Publish the bill.</li>
      </ol>
      <h2>3 — Collector roles and My PayGira</h2>
      <p>Staff assigned collection responsibilities can use <strong>My PayGira</strong> to record in-person collections, including one-by-one and bulk collection workflows.</p>
      <h2>4 — Guardian payments</h2>
      <ol>
        <li>Guardians open PayGira in the Guardian Portal.</li>
        <li>They review outstanding bills and choose a supported payment method.</li>
        <li>Successful payments immediately update balances and generate invoice/receipt records.</li>
      </ol>
      <h2>5 — Sign-off process</h2>
      <p>Once a bill scope is fully settled, authorised staff can sign it off. Sign-off locks the collection batch and records who finalised it, when, and for what total amount.</p>
      <div class="doc-callout doc-callout--warning"><strong>Permission required:</strong> Sign-off should be restricted to trusted finance users because it finalises the collection batch and reduces the chance of silent edits later.</div>
      <h2>6 — Recurring bills, partial payments, and credit</h2>
      <ul>
        <li><strong>Recurring bills:</strong> Use recurring schedules for repeating charges.</li>
        <li><strong>Partial payments:</strong> Allow instalments while preserving the student's running balance.</li>
        <li><strong>Student credit:</strong> Overpayments or adjustments can remain as credit and reduce future bills.</li>
      </ul>
      <h2>7 — Records kept after payment</h2>
      <ul>
        <li>Payment amount, date, and method</li>
        <li>Collection staff member for manual collections</li>
        <li>Gateway reference or payment identifier for online payments</li>
        <li>Invoice and receipt history</li>
        <li>Balance and sign-off history</li>
      </ul>
      <h2>8 — Security</h2>
      <p>PayGira relies on authenticated sessions, role-based permissions, audited finance records, and secure external payment flows where online payments are enabled. Sensitive actions such as sign-off should always remain permission-protected.</p>
    `,
  },
  {
    slug: 'promote-students-and-manage-graduation',
    title: 'Promote students, reverse promotions, and manage graduation',
    topic: 'Students & Admissions',
    subtopic: 'Promotions',
    status: 'active',
    featured: false,
    tags: ['promotions', 'graduation', 'cut-off', 'archive'],
    seoDescription: 'Set promotion cut-offs, apply promotions, reverse mistakes, and manage graduation or archiving at year end.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Use the promotion workflow when moving students into the next class, keeping students back, or graduating final-year students out of active class lists.</p>
      <h2>Setting promotion cut-offs</h2>
      <ol>
        <li>Open <strong>Management → Promotions</strong>.</li>
        <li>Set the minimum score or promotion threshold for the relevant class.</li>
        <li>Save before applying any promotion batch.</li>
      </ol>
      <h2>Using Apply Now</h2>
      <ol>
        <li>Review the eligible students list.</li>
        <li>Click <strong>Apply Now</strong> to process the visible promotion batch.</li>
        <li>Confirm the move after checking the target class mapping.</li>
      </ol>
      <h2>Graduation and archiving</h2>
      <p>Final-year students should be marked as graduated rather than promoted. Students leaving without graduation should be archived so their academic history remains available while they disappear from active lists.</p>
      <h2>Reversing or deleting promotions</h2>
      <p>If a promotion was applied incorrectly, use the promotion history view to reverse it. This restores the previous class placement, but any later edits made in the destination class may still need manual review.</p>
      <div class="doc-callout doc-callout--warning"><strong>Warning:</strong> Reversing promotions should be limited to trusted users because it changes live student placement and can affect reports, attendance, and class membership.</div>
    `,
  },
  {
    slug: 'email-notifications-reference',
    title: 'Email notifications reference — all emails Managira sends',
    topic: 'Communication & Website',
    subtopic: 'Email Notifications',
    status: 'active',
    featured: false,
    tags: ['email', 'notifications', 'digest', 'transactional'],
    seoDescription: 'Reference for transactional emails, toggleable notifications, weekly digests, and role-based email delivery.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Managira sends both transactional emails and optional notification emails. This reference explains what each category includes and who receives it.</p>
      <h2>Transactional emails (always sent)</h2>
      <ul>
        <li>Password reset and account-access emails</li>
        <li>Payment confirmations and invoice-related emails</li>
        <li>Support ticket responses</li>
        <li>Invitation and onboarding emails</li>
        <li>Hub invitation and membership decision emails</li>
      </ul>
      <h2>Toggleable notification emails</h2>
      <ul>
        <li>Announcements and event notifications</li>
        <li>Attendance and grade alerts</li>
        <li>Bill-created and reminder notifications</li>
        <li>Routine guardian or staff update notifications</li>
      </ul>
      <h2>Weekly digests</h2>
      <p>Weekly digests vary by role:</p>
      <ul>
        <li><strong>Guardians:</strong> attendance, grades, and outstanding balances</li>
        <li><strong>Teachers:</strong> assigned class and grading summary</li>
        <li><strong>Managers / Supervisors:</strong> school-wide operational summary</li>
        <li><strong>Admins / Hubs:</strong> broader oversight metrics and exceptions</li>
      </ul>
      <h2>Emails by role</h2>
      <p>Guardians mainly receive student- and payment-related emails. Teachers, supervisors, and managers receive work-related notifications. Admins receive those plus operational and billing summaries where relevant.</p>
      <h2>Managing preferences</h2>
      <p>Optional notification categories can be toggled from account settings. Transactional emails cannot be turned off because they are required for security, billing, or workflow completion.</p>
    `,
  },
  {
    slug: 'configure-custom-student-ids',
    title: 'Configure custom student IDs and auto-generation',
    topic: 'Students & Admissions',
    subtopic: 'Student ID Configuration',
    status: 'active',
    featured: false,
    tags: ['student ID', 'custom ID', 'prefix', 'auto-generation'],
    seoDescription: 'Configure custom student ID format, prefixes, numbering, and how Managira generates the next student ID.',
    contentHtml: `
      <h2>Overview</h2>
      <p>You can allow Managira to generate student IDs automatically or define your own format with a prefix, starting number, and padded sequence.</p>
      <h2>Setting up the format</h2>
      <ol>
        <li>Open <strong>School Settings → Student ID</strong>.</li>
        <li>Enable custom student IDs if your school wants its own format.</li>
        <li>Enter an optional prefix and choose the starting number.</li>
        <li>Save and review the preview format before creating the next student.</li>
      </ol>
      <h2>Auto-generation logic</h2>
      <p>When auto-generation is enabled, Managira uses the configured prefix and sequence rules to create the next student ID at the point the student record is created or approved.</p>
      <h2>Manual override</h2>
      <p>Staff can still type a manual student ID when editing or creating a student, but duplicate IDs within the same organisation are blocked.</p>
      <div class="doc-callout doc-callout--warning"><strong>Warning:</strong> Changing the format does not rename existing student IDs. Only new records use the updated format.</div>
    `,
  },
  {
    slug: 'transfer-a-student-between-classes-and-subject-matching',
    title: 'Transfer a student between classes and subject matching',
    topic: 'Students & Admissions',
    subtopic: 'Class Transfers',
    status: 'active',
    featured: false,
    tags: ['class transfer', 'subjects', 'subject matching', 'student move'],
    seoDescription: 'Understand how Managira handles subject matching, history preservation, and manual follow-up after class transfers.',
    contentHtml: `
      <h2>Overview</h2>
      <p>When you transfer a student to another class, Managira preserves the student's historical records and checks whether subjects from the old class match subjects in the new class.</p>
      <h2>Transfer steps</h2>
      <ol>
        <li>Open the student profile.</li>
        <li>Choose <strong>Transfer Class</strong>.</li>
        <li>Select the destination class and confirm the transfer date.</li>
      </ol>
      <h2>What happens to subjects</h2>
      <ul>
        <li>Matching subject names in the destination class can carry over automatically.</li>
        <li>Subjects that do not exist in the destination class are not kept as active enrollments.</li>
        <li>Subjects available only in the new class may still require manual enrollment.</li>
      </ul>
      <h2>What is preserved</h2>
      <ul>
        <li>Past grades and attendance history</li>
        <li>Guardian links and student profile details</li>
        <li>Historical transcript data</li>
      </ul>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> For mid-term transfers, review reports and subject enrollment immediately after the move so later grade entry happens in the correct class and subject combination.</div>
    `,
  },
  {
    slug: 'understand-localized-pricing-currency-and-usd-fallback',
    title: 'Understand localized pricing, currency detection, and USD fallback',
    topic: 'Billing & Subscriptions',
    subtopic: 'Localized Pricing',
    status: 'active',
    featured: false,
    tags: ['localized pricing', 'currency', 'usd fallback', 'billing currency'],
    seoDescription: 'How Managira chooses the display currency by location and when it falls back to USD.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Managira can localize subscription pricing by user location. If location signals are weak or unavailable, pricing falls back to USD.</p>
      <h2>How currency is chosen</h2>
      <ol>
        <li>Trusted country headers from your hosting/network edge.</li>
        <li>IP-based geo detection.</li>
        <li>Safe fallbacks (including language and account context when available).</li>
        <li>USD fallback when no reliable signal is available.</li>
      </ol>
      <h2>Why users can occasionally see USD</h2>
      <ul>
        <li>Geo lookup is blocked or timed out.</li>
        <li>No reliable country signal is available for the request.</li>
        <li>The user is on a network that masks location details.</li>
      </ul>
      <h2>Important note</h2>
      <p>Currency display is for clarity during checkout. The actual charged amount and gateway currency are shown in the payment summary before confirmation.</p>
    `,
  },
  {
    slug: 'how-subscription-renewal-amount-is-calculated',
    title: 'How subscription renewal amount is calculated',
    topic: 'Billing & Subscriptions',
    subtopic: 'Renewal Pricing',
    status: 'active',
    featured: false,
    tags: ['renewal', 'student count', 'billing cycles', 'subscription amount'],
    seoDescription: 'Understand why renewal can change based on student count and billing cycle choices.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Renewal is not always a permanently fixed number. It can change as your active student count changes.</p>
      <h2>Main factors that affect renewal</h2>
      <ul>
        <li><strong>Student count:</strong> Higher active student counts can move the school into a different pricing tier.</li>
        <li><strong>Billing cycle:</strong> Monthly, term, yearly, or other cycle options can change total amount and discount behavior.</li>
        <li><strong>Plan and region pricing:</strong> The selected plan and location pricing rules are applied at checkout and renewal.</li>
      </ul>
      <h2>What schools should do</h2>
      <ol>
        <li>Keep student records current before renewal dates.</li>
        <li>Review billing settings and cycle choice in advance.</li>
        <li>Check renewal details in the billing area before charge date.</li>
      </ol>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> If your school expects a pricing jump, review student archive and graduation updates before renewal to avoid overcounting inactive learners.</div>
    `,
  },
  {
    slug: 'configure-dynamic-grading-and-remarks',
    title: 'Configure dynamic grading and remarks',
    topic: 'Assessments & Grades',
    subtopic: 'Grading Rules',
    status: 'active',
    featured: false,
    tags: ['dynamic grading', 'remarks', 'grade mapping', 'assessment settings'],
    seoDescription: 'Set up dynamic grade mappings and remark logic so report outputs match your school policy.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Dynamic grading lets schools define grade boundaries and remark rules that better match internal academic policy.</p>
      <h2>What you can configure</h2>
      <ul>
        <li>Grade boundaries and labels.</li>
        <li>Remark messages linked to score ranges.</li>
        <li>Default mappings used by assessment and report workflows.</li>
      </ul>
      <h2>Recommended setup order</h2>
      <ol>
        <li>Open grading settings before entering large batches of new assessments.</li>
        <li>Set boundary ranges and remarks.</li>
        <li>Save and test with sample scores.</li>
        <li>Generate a sample report to verify expected output.</li>
      </ol>
      <div class="doc-callout doc-callout--warning"><strong>Warning:</strong> Changing boundaries after scores are already entered can change grade labels and remarks in generated reports.</div>
    `,
  },
  {
    slug: 'troubleshooting-common-issues',
    title: 'Troubleshooting common issues in Managira',
    topic: 'Getting Started',
    subtopic: 'Troubleshooting',
    status: 'active',
    featured: false,
    tags: ['troubleshooting', 'attendance', 'reports', 'login', 'plan features'],
    seoDescription: 'Troubleshoot attendance issues, missing classes, report problems, login trouble, and plan-gated features in Managira.',
    contentHtml: `
      <h2>Overview</h2>
      <p>This guide covers the most common issues schools can resolve without waiting for support.</p>
      <h2>Attendance problems</h2>
      <ul>
        <li>If attendance is saving under the wrong period, verify the current term.</li>
        <li>If a class does not appear, check class assignment, enrollment, and permissions.</li>
      </ul>
      <h2>Class or subject visibility problems</h2>
      <ul>
        <li>Confirm the class belongs to the active school year.</li>
        <li>Check that the subject is assigned to the class and the student is enrolled correctly.</li>
      </ul>
      <h2>Report generation problems</h2>
      <ul>
        <li>Check that grades are entered and the grading system is configured.</li>
        <li>Confirm the selected term is correct before generating the report.</li>
      </ul>
      <h2>Login issues</h2>
      <ul>
        <li>Use the forgot-password flow first.</li>
        <li>Verify that the user is logging in on the correct school or guardian URL.</li>
      </ul>
      <h2>Plan-gated feature issues</h2>
      <ul>
        <li>If a feature is hidden or locked, confirm the current subscription plan and billing status.</li>
        <li>If the plan should include the feature, contact support for review.</li>
      </ul>
      <h2>When to contact support</h2>
      <p>If the issue still persists after the checks above, contact <strong>info@managira.com</strong> or use the <a href="/legal/help">Help Center</a>.</p>
    `,
  },
  {
    slug: 'mailroom-send-sms-whatsapp-and-email-to-guardians',
    title: 'Mailroom — send SMS, WhatsApp, and Email to guardians',
    topic: 'Communication & Website',
    subtopic: 'Mailroom',
    status: 'active',
    featured: true,
    tags: ['mailroom', 'sms', 'whatsapp', 'email', 'guardian messaging', 'permissions', 'integrations'],
    seoDescription: 'Set up Mailroom access, send SMS/WhatsApp/Email to guardians, restrict which contacts an employee can message, and activate the SMS/WhatsApp integrations Mailroom needs.',
    contentHtml: `
      <h2>Overview</h2>
      <p>Mailroom is a single page for messaging guardians directly — outside of a specific report or transcript send. Open it from the hamburger menu (it only appears for accounts with Mailroom access) or go straight to <strong>Mailroom</strong> under the main navigation. It shows every guardian contact you're allowed to see on the left, and a compose panel with delivery history on the right.</p>

      <h2>Turning on Mailroom access</h2>
      <p>Mailroom is off by default for everyone except the organisation owner. To let a staff member use it:</p>
      <ol>
        <li>Go to <strong>Management → Manage Employees</strong>.</li>
        <li>Open the employee's record (Add Employee for a new hire, or the pencil/modify action for an existing one).</li>
        <li>In the permissions list, check <strong>Mailroom (Send SMS/WhatsApp/Email)</strong>.</li>
        <li>A <strong>Mailroom contact access</strong> panel appears — choose a scope (see below), then save.</li>
      </ol>
      <p>Only accounts with this permission see the Mailroom link in the hamburger menu at all. Everyone else — including staff who can see other Management Tools — won't know it exists.</p>

      <h2>Choosing who an employee can message (contact scope)</h2>
      <p>When Mailroom is checked, you must choose one of two access levels:</p>
      <ul>
        <li><strong>All contacts (every class)</strong> — the employee can see and message every guardian in the school, exactly like the organisation owner.</li>
        <li><strong>Only guardians of students in selected classes</strong> — pick the specific classes. The employee's Mailroom contact list, and anything they send, is limited to guardians of students in those classes only.</li>
      </ul>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> Use the restricted scope for homeroom teachers or class-level staff who should only reach their own students' guardians. Reserve "All contacts" for front-office/admin staff who need school-wide reach.</div>
      <div class="doc-callout doc-callout--warning"><strong>This is enforced, not just hidden:</strong> the restriction is checked again on the server every time a message is sent — a restricted employee cannot message a guardian outside their assigned classes even by any indirect means. If a class assignment changes later, edit the employee's record again to update Mailroom's class list; it does not automatically follow their teaching assignment.</div>
      <p>If no classes are selected for a "restricted" employee, they will see an empty contact list until at least one class is chosen.</p>

      <h2>Sending a message</h2>
      <ol>
        <li>Open <strong>Mailroom</strong>.</li>
        <li>On the left, search and select one or more guardian contacts (use <strong>Select all</strong> to select everyone currently visible in the list — click again to deselect all).</li>
        <li>Type the message in the compose box on the right.</li>
        <li>Check one or more channels — <strong>Text (SMS)</strong>, <strong>WhatsApp</strong>, and/or <strong>Email</strong> — the checkboxes only appear once a message is started or a recipient is selected.</li>
        <li>Click <strong>Send</strong>, confirm the recipient/channel summary, then enter your password to confirm. Nothing is sent until the password is confirmed.</li>
      </ol>
      <p>Sending to multiple channels at once sends the same message through each — a guardian with both a phone number and email selected under "Text" and "Email" receives it both ways.</p>

      <h2>When a channel can't reach a recipient</h2>
      <p>A channel checkbox is greyed out and disabled if none of your currently selected recipients have the contact info it needs (e.g. SMS/WhatsApp need a phone number, Email needs an email address). A note explains why, and if none of the selected recipients can be reached on any active channel, a banner explains that too — add the missing contact info to the guardian's record first (via the report/transcript "Edit contacts" drawers, or the guardian's profile) and try again.</p>

      <h2>Activating SMS and WhatsApp</h2>
      <p>Email always works — Managira sends it directly. SMS and WhatsApp both require the school to activate a provider first. If either isn't set up yet, Mailroom shows a banner at the top of the page explaining which one is missing, with a direct link to Integrations.</p>
      <ol>
        <li>Click the banner's <strong>Activate in Integrations</strong> link, or go to <strong>Account Settings → Integrations</strong> directly.</li>
        <li>Follow the setup steps for your SMS provider (e.g. Arkesel, Africa's Talking) and/or WhatsApp Business.</li>
        <li>Return to Mailroom — the banner disappears once a channel is active, and its checkbox becomes available.</li>
      </ol>

      <h2>Delivery history</h2>
      <p>Every message sent through Mailroom appears as its own card below the compose panel, showing the channel, recipient, delivery status, who sent it, and when. An employee with restricted (class-scoped) access only sees the history of messages <em>they personally sent</em> — not messages sent by other staff — since those could involve contacts outside their assigned classes. Accounts with "All contacts" access see the school's full Mailroom history.</p>
    `,
  },
];

let schemaReady = false;
let schemaPromise = null;

const CODE_CLASSES = [
  'language-javascript',
  'language-js',
  'language-json',
  'language-html',
  'language-css',
  'language-bash',
  'language-shell',
  'language-sql',
  'language-text',
];

const TAG_CORRECTIONS_BY_SLUG = {
  'install-managira-on-your-device': ['mobile app', 'desktop app', 'pwa install', 'iphone', 'home screen shortcut'],
  'register-a-school-and-complete-first-time-setup': ['school registration', 'first-time setup', 'new school setup', 'account setup'],
  'create-school-years-classes-terms-and-set-the-current-term': ['school year', 'term setup', 'current term', 'term dates', 'overlap validation'],
  'report-settings': ['report settings', 'report signature', 'promotion settings', 'grading remarks', 'paygira reporting'],
  'edit-student-information': ['manage students', 'edit student', 'student records', 'student profile'],
  'create-and-manage-bulk-student-records': ['bulk student import', 'student records', 'admissions', 'csv import', 'enrollment'],
  'online-admission': ['online admission', 'student application', 'admissions', 'student registration', 'enrollment'],
  'troubleshooting-common-issues': ['troubleshooting', 'attendance issues', 'report issues', 'login issues', 'plan features'],
};

const TAG_TEXT_REPLACEMENTS = [
  [/\benrollement\b/gi, 'enrollment'],
  [/\bprotal\b/gi, 'portal'],
  [/\s+/g, ' '],
];

function buildCanonicalDocumentationUrl(slug = '') {
  const suffix = slug ? `/${slug}` : '';
  return `https://www.managira.com/legal/user-documentation${suffix}`;
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeTextField(value, maxLength = 255) {
  return collapseWhitespace(value).slice(0, maxLength);
}

function slugify(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized || 'article';
}

function compactAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function sanitizeArticleContent(html) {
  const cleanHtml = sanitizeHtml(String(html || ''), {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote',
      'code', 'pre', 'a', 'img', 'figure', 'figcaption', 'iframe', 'video', 'source',
      'div', 'span', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'mark'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title', 'class'],
      img: ['src', 'alt', 'title', 'class', 'data-caption'],
      figure: ['class', 'style'],
      figcaption: ['class'],
      iframe: ['src', 'allow', 'allowfullscreen', 'frameborder', 'title', 'loading', 'class'],
      video: ['src', 'controls', 'playsinline', 'preload', 'poster', 'class'],
      source: ['src', 'type'],
      div: ['class', 'data-callout'],
      span: ['class', 'style'],
      code: ['class'],
      pre: ['class'],
      table: ['class'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      hr: ['class'],
      mark: ['class'],
    },
    allowedStyles: {
      figure: {
        width: [/^\d+(?:\.\d+)?(?:px|%)$/],
        'max-width': [/^\d+(?:\.\d+)?(?:px|%)$/],
      },
      span: {
        'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
        'font-style': [/^(?:normal|italic)$/i],
        'text-decoration': [/^(?:none|underline|line-through)$/i],
      },
    },
    allowedClasses: {
      div: ['doc-callout', 'doc-callout--info', 'doc-callout--warning', 'doc-callout--tip'],
      figure: ['doc-media', 'doc-image', 'doc-video', 'doc-attachment'],
      a: ['doc-attachment-card'],
      img: ['doc-inline-image'],
      iframe: ['doc-youtube-embed'],
      video: ['doc-inline-video'],
      pre: CODE_CLASSES,
      code: CODE_CLASSES,
      hr: ['doc-divider'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
      source: ['http', 'https'],
      video: ['http', 'https'],
      iframe: ['https'],
      a: ['http', 'https', 'mailto', 'tel'],
    },
    transformTags: {
      b: 'strong',
      i: 'em',
      a: (tagName, attribs) => {
        const href = collapseWhitespace(attribs.href || '');
        if (!href) {
          return { tagName: 'span', text: '' };
        }

        const transformed = {
          tagName,
          attribs: compactAttributes({
            href,
            title: attribs.title || undefined,
            class: attribs.class || undefined,
          }),
        };

        if (attribs.target === '_blank') {
          transformed.attribs.target = '_blank';
          transformed.attribs.rel = 'noopener noreferrer';
        }

        return transformed;
      },
      iframe: (tagName, attribs) => {
        const src = collapseWhitespace(attribs.src || '');
        const isTrusted = /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i.test(src);
        if (!isTrusted) {
          return { tagName: 'div', text: '' };
        }

        return {
          tagName,
          attribs: {
            src,
            allow: attribs.allow || 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
            allowfullscreen: 'allowfullscreen',
            frameborder: '0',
            title: attribs.title || 'Embedded video',
            loading: 'lazy',
            class: 'doc-youtube-embed',
          },
        };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: compactAttributes({
          src: collapseWhitespace(attribs.src || ''),
          alt: sanitizeTextField(attribs.alt || 'Documentation image', 200),
          title: sanitizeTextField(attribs.title || '', 200) || undefined,
          class: 'doc-inline-image',
          'data-caption': sanitizeTextField(attribs['data-caption'] || '', 240) || undefined,
        }),
      }),
    },
  });

  const normalizeHeadingLikeBodyText = (fullMatch, level, innerHtml) => {
    const plain = stripHtml(innerHtml || '');
    const wordCount = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
    // Headings are usually short labels. Long sentence-like headings are most
    // often accidental formatting from contenteditable and should be paragraphs.
    if (wordCount >= 14) {
      return `<p>${innerHtml}</p>`;
    }
    return fullMatch;
  };

  return cleanHtml
    // If users accidentally wrap full blocks inside headings, flatten those wrappers
    // so paragraph/list formatting and normal-weight text survive round-trips.
    .replace(/<h([2-4])>\s*<(p|ul|ol|div|table|blockquote|pre)([^>]*)>([\s\S]*?)<\/\2>\s*<\/h\1>/gi, '<$2$3>$4</$2>')
    .replace(/<h([2-4])>([\s\S]*?)<\/h\1>/gi, normalizeHeadingLikeBodyText)
    .replace(/<h([2-4])>\s*<br\s*\/?>(?:\s|&nbsp;)*<\/h\1>/gi, '')
    .replace(/<h([2-4])>\s*<\/h\1>/gi, '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>\s*(<br\s*\/?>)\s*<\/p>/g, '')
    .trim();
}

function stripHtml(value) {
  const plain = sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {},
  });

  return collapseWhitespace(he.decode(plain));
}

function summarizeText(value, query = '', maxLength = 180) {
  const text = stripHtml(value);
  if (!text) return '';

  const normalizedQuery = collapseWhitespace(query).toLowerCase();
  if (!normalizedQuery) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
  }

  const matchIndex = text.toLowerCase().indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function normalizeTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const normalized = [];
  const seen = new Set();

  rawTags.forEach((tag) => {
    let nextTag = sanitizeTextField(tag, 80);
    TAG_TEXT_REPLACEMENTS.forEach(([pattern, replacement]) => {
      nextTag = nextTag.replace(pattern, replacement);
    });
    nextTag = nextTag.toLowerCase().trim();
    if (!nextTag) return;
    const key = nextTag;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(nextTag);
  });

  return normalized.slice(0, 8);
}

async function applyProfessionalTagCorrections(database = db) {
  const result = await database.query('SELECT id, slug, tags FROM documentation_articles');

  for (const row of result.rows) {
    const slug = String(row.slug || '').trim();
    const currentTags = Array.isArray(row.tags) ? row.tags : [];
    const preferredTags = TAG_CORRECTIONS_BY_SLUG[slug];
    const nextTags = normalizeTags(preferredTags || currentTags);

    const currentSerialized = JSON.stringify(currentTags);
    const nextSerialized = JSON.stringify(nextTags);
    if (currentSerialized === nextSerialized) {
      continue;
    }

    await database.query(
      `UPDATE documentation_articles
          SET tags = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [row.id, nextTags]
    );
  }
}

function normalizeMedia(value) {
  let media = value;
  if (typeof media === 'string') {
    try {
      media = JSON.parse(media);
    } catch (_) {
      media = [];
    }
  }

  if (!Array.isArray(media)) {
    return [];
  }

  return media
    .map((item) => ({
      type: sanitizeTextField(item && item.type, 32),
      url: collapseWhitespace(item && item.url),
      s3Key: sanitizeTextField(item && item.s3Key, 255),
      title: sanitizeTextField(item && item.title, 200),
      caption: sanitizeTextField(item && item.caption, 240),
      alt: sanitizeTextField(item && item.alt, 200),
      mimeType: sanitizeTextField(item && item.mimeType, 120),
      filename: sanitizeTextField(item && item.filename, 255),
      embedUrl: collapseWhitespace(item && item.embedUrl),
    }))
    .filter((item) => item.type && (item.url || item.embedUrl));
}

function mapArticleRow(row) {
  if (!row) return null;

  const contentHtml = sanitizeArticleContent(row.content_html || '');
  const plainText = stripHtml(contentHtml);
  const topic = sanitizeTextField(row.topic, 120);
  const subtopic = sanitizeTextField(row.subtopic || '', 120);

  return {
    id: Number(row.id),
    slug: row.slug,
    title: sanitizeTextField(row.title, 200),
    topic,
    subtopic,
    status: row.status === 'draft' ? 'draft' : 'active',
    featured: Boolean(row.featured),
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    seoDescription: sanitizeTextField(row.seo_description || '', 320),
    contentHtml,
    plainText,
    excerpt: summarizeText(contentHtml),
    media: normalizeMedia(row.media),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    helpfulYes: Number(row.helpful_yes || 0),
    helpfulNo: Number(row.helpful_no || 0),
    breadcrumb: [topic, subtopic, sanitizeTextField(row.title, 200)].filter(Boolean),
  };
}

function buildTopicTree(articles) {
  const byTopic = new Map();

  for (const article of articles) {
    if (!byTopic.has(article.topic)) {
      byTopic.set(article.topic, { topic: article.topic, subtopics: new Map(), articles: [] });
    }

    const topicEntry = byTopic.get(article.topic);
    if (article.subtopic) {
      if (!topicEntry.subtopics.has(article.subtopic)) {
        topicEntry.subtopics.set(article.subtopic, []);
      }
      topicEntry.subtopics.get(article.subtopic).push(article);
    } else {
      topicEntry.articles.push(article);
    }
  }

  const tree = Array.from(byTopic.values()).map((entry) => ({
    topic: entry.topic,
    articles: entry.articles.sort((left, right) => left.title.localeCompare(right.title)),
    subtopics: Array.from(entry.subtopics.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([subtopic, articlesForSubtopic]) => ({
        subtopic,
        articles: articlesForSubtopic.sort((left, right) => left.title.localeCompare(right.title)),
      })),
  }));

  tree.sort((left, right) => {
    const leftIndex = DEFAULT_TOPICS.indexOf(left.topic);
    const rightIndex = DEFAULT_TOPICS.indexOf(right.topic);
    if (leftIndex === -1 && rightIndex === -1) return left.topic.localeCompare(right.topic);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });

  return tree;
}

function buildIndexEntry(article) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    topic: article.topic,
    subtopic: article.subtopic,
    status: article.status,
    featured: article.featured,
    tags: article.tags,
    seoDescription: article.seoDescription,
    excerpt: summarizeText(article.plainText, '', 160),
    plainText: article.plainText,
    updatedAt: article.updatedAt,
    breadcrumb: article.breadcrumb,
  };
}

function normalizeArticleInput(data) {
  const title = sanitizeTextField(data.title, 200);
  const topic = sanitizeTextField(data.topic, 120);
  const subtopic = sanitizeTextField(data.subtopic || '', 120);
  const status = String(data.status || '').trim().toLowerCase() === 'draft' ? 'draft' : 'active';
  const featured = Boolean(data.featured);
  const tags = normalizeTags(data.tags);
  const seoDescription = sanitizeTextField(data.seoDescription || data.seo_description || '', 320);
  const contentHtml = sanitizeArticleContent(data.contentHtml || data.content_html || '');
  const media = normalizeMedia(data.media);

  if (!title) {
    throw new Error('Title is required.');
  }

  if (!topic) {
    throw new Error('Topic is required.');
  }

  return {
    title,
    topic,
    subtopic: subtopic || null,
    status,
    featured,
    tags,
    seoDescription: seoDescription || null,
    contentHtml,
    media,
  };
}

async function generateUniqueSlug(title, database = db, excludeId = null) {
  const baseSlug = slugify(title);
  let candidate = baseSlug;
  let counter = 2;

  while (true) {
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const sql = excludeId
      ? 'SELECT 1 FROM documentation_articles WHERE slug = $1 AND id <> $2 LIMIT 1'
      : 'SELECT 1 FROM documentation_articles WHERE slug = $1 LIMIT 1';
    const result = await database.query(sql, params);
    if (result.rows.length === 0) {
      return candidate;
    }
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }
}

async function seedDefaultArticles(database) {
  for (const article of DEFAULT_ARTICLES) {
    const slug = await generateUniqueSlug(article.title, database);
    await database.query(
      `INSERT INTO documentation_articles (
        slug, title, topic, subtopic, status, featured, tags, seo_description, content_html, media, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        slug,
        article.title,
        article.topic,
        article.subtopic || null,
        article.status || 'active',
        Boolean(article.featured),
        article.tags || [],
        article.seoDescription || null,
        sanitizeArticleContent(article.contentHtml || ''),
        JSON.stringify(article.media || []),
        null,
      ]
    );
  }
}

async function syncCanonicalDocumentationArticles(database) {
  for (const article of CANONICAL_ARTICLE_SYNC) {
    await database.query(
      `INSERT INTO documentation_articles (
         slug, title, topic, subtopic, status, featured, tags, seo_description, content_html, media, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         topic = EXCLUDED.topic,
         subtopic = EXCLUDED.subtopic,
         status = EXCLUDED.status,
         featured = EXCLUDED.featured,
         tags = EXCLUDED.tags,
         seo_description = EXCLUDED.seo_description,
         content_html = EXCLUDED.content_html,
         updated_at = NOW()`,
      [
        article.slug,
        article.title,
        article.topic,
        article.subtopic || null,
        article.status || 'active',
        Boolean(article.featured),
        article.tags || [],
        article.seoDescription || null,
        sanitizeArticleContent(article.contentHtml || ''),
        JSON.stringify(article.media || []),
        null,
      ]
    );
  }
}

async function ensureDocumentationSchema(database = db) {
  if (schemaReady) {
    return;
  }

  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    await database.query(`
      CREATE TABLE IF NOT EXISTS documentation_articles (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        subtopic TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        seo_description TEXT,
        content_html TEXT NOT NULL DEFAULT '',
        media JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        helpful_yes INTEGER NOT NULL DEFAULT 0,
        helpful_no INTEGER NOT NULL DEFAULT 0
      )
    `);

    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS slug TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS topic TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS subtopic TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS seo_description TEXT
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS content_html TEXT NOT NULL DEFAULT ''
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS helpful_yes INTEGER NOT NULL DEFAULT 0
    `);
    await database.query(`
      ALTER TABLE documentation_articles
      ADD COLUMN IF NOT EXISTS helpful_no INTEGER NOT NULL DEFAULT 0
    `);

    await database.query(`
      UPDATE documentation_articles
      SET slug = COALESCE(NULLIF(slug, ''), 'article-' || id)
      WHERE slug IS NULL OR slug = ''
    `);

    await database.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'documentation_articles_status_check'
        ) THEN
          ALTER TABLE documentation_articles DROP CONSTRAINT documentation_articles_status_check;
        END IF;

        ALTER TABLE documentation_articles
        ADD CONSTRAINT documentation_articles_status_check
        CHECK (status IN ('draft', 'active'));
      END $$
    `);

    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_status
      ON documentation_articles(status)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_topic
      ON documentation_articles(topic, subtopic)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_updated_at
      ON documentation_articles(updated_at DESC)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_documentation_articles_tags
      ON documentation_articles USING GIN(tags)
    `);

    await database.query(`
      CREATE TABLE IF NOT EXISTS documentation_article_feedback (
        id SERIAL PRIMARY KEY,
        article_id INTEGER NOT NULL REFERENCES documentation_articles(id) ON DELETE CASCADE,
        fingerprint_hash TEXT NOT NULL,
        vote TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(article_id, fingerprint_hash)
      )
    `);

    await database.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'documentation_article_feedback_vote_check'
        ) THEN
          ALTER TABLE documentation_article_feedback DROP CONSTRAINT documentation_article_feedback_vote_check;
        END IF;

        ALTER TABLE documentation_article_feedback
        ADD CONSTRAINT documentation_article_feedback_vote_check
        CHECK (vote IN ('yes', 'no'));
      END $$
    `);

    const countResult = await database.query('SELECT COUNT(*)::int AS total FROM documentation_articles');
    if (Number(countResult.rows[0] && countResult.rows[0].total) === 0) {
      await seedDefaultArticles(database);
    }

    await syncCanonicalDocumentationArticles(database);
    await applyProfessionalTagCorrections(database);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

async function listDocumentationArticles(options = {}) {
  const {
    includeDrafts = false,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);

  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no
       FROM documentation_articles
      WHERE ($1::boolean = TRUE OR status = 'active')
      ORDER BY
        CASE status WHEN 'active' THEN 0 ELSE 1 END,
        topic ASC,
        subtopic ASC NULLS FIRST,
        featured DESC,
        updated_at DESC,
        title ASC`,
    [includeDrafts]
  );

  return result.rows.map(mapArticleRow);
}

async function getDocumentationArticleBySlug(slug, options = {}) {
  const {
    includeDrafts = false,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no
       FROM documentation_articles
      WHERE slug = $1
        AND ($2::boolean = TRUE OR status = 'active')
      LIMIT 1`,
    [slug, includeDrafts]
  );

  return mapArticleRow(result.rows[0]);
}

async function getDocumentationArticleById(id, options = {}) {
  const {
    includeDrafts = true,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no
       FROM documentation_articles
      WHERE id = $1
        AND ($2::boolean = TRUE OR status = 'active')
      LIMIT 1`,
    [id, includeDrafts]
  );

  return mapArticleRow(result.rows[0]);
}

async function searchDocumentationArticles(query, options = {}) {
  const {
    includeDrafts = false,
    limit = 10,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalizedQuery = collapseWhitespace(query);
  if (!normalizedQuery) {
    return [];
  }

  const likeQuery = `%${normalizedQuery}%`;
  const result = await database.query(
    `SELECT id, slug, title, topic, subtopic, status, featured, tags, seo_description,
            content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no,
            ts_rank(
              to_tsvector(
                'simple',
                coalesce(title, '') || ' ' ||
                coalesce(topic, '') || ' ' ||
                coalesce(subtopic, '') || ' ' ||
                array_to_string(tags, ' ') || ' ' ||
                coalesce(seo_description, '') || ' ' ||
                regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g')
              ),
              plainto_tsquery('simple', $1)
            ) AS rank
       FROM documentation_articles
      WHERE ($2::boolean = TRUE OR status = 'active')
        AND (
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' ||
            coalesce(topic, '') || ' ' ||
            coalesce(subtopic, '') || ' ' ||
            array_to_string(tags, ' ') || ' ' ||
            coalesce(seo_description, '') || ' ' ||
            regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g')
          ) @@ plainto_tsquery('simple', $1)
          OR title ILIKE $3
          OR topic ILIKE $3
          OR coalesce(subtopic, '') ILIKE $3
          OR coalesce(seo_description, '') ILIKE $3
          OR array_to_string(tags, ' ') ILIKE $3
          OR regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g') ILIKE $3
        )
      ORDER BY rank DESC NULLS LAST, featured DESC, updated_at DESC
      LIMIT $4`,
    [normalizedQuery, includeDrafts, likeQuery, limit]
  );

  return result.rows.map((row) => {
    const article = mapArticleRow(row);
    return {
      ...article,
      excerpt: summarizeText(article.contentHtml || article.plainText, normalizedQuery, 180),
      rank: Number(row.rank || 0),
    };
  });
}

async function createDocumentationArticle(data, options = {}) {
  const {
    userId = null,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalized = normalizeArticleInput(data);
  const slug = await generateUniqueSlug(normalized.title, database);

  const result = await database.query(
    `INSERT INTO documentation_articles (
      slug, title, topic, subtopic, status, featured, tags, seo_description, content_html, media, created_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP)
    RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
              content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [
      slug,
      normalized.title,
      normalized.topic,
      normalized.subtopic,
      normalized.status,
      normalized.featured,
      normalized.tags,
      normalized.seoDescription,
      normalized.contentHtml,
      JSON.stringify(normalized.media),
      userId,
    ]
  );

  return mapArticleRow(result.rows[0]);
}

async function updateDocumentationArticle(id, data, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const existing = await getDocumentationArticleById(id, { includeDrafts: true, database });
  if (!existing) {
    throw new Error('Article not found.');
  }

  const normalized = normalizeArticleInput(data);
  const slug = normalized.title === existing.title
    ? existing.slug
    : await generateUniqueSlug(normalized.title, database, id);

  const result = await database.query(
    `UPDATE documentation_articles
        SET slug = $2,
            title = $3,
            topic = $4,
            subtopic = $5,
            status = $6,
            featured = $7,
            tags = $8,
            seo_description = $9,
            content_html = $10,
            media = $11,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
                content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [
      id,
      slug,
      normalized.title,
      normalized.topic,
      normalized.subtopic,
      normalized.status,
      normalized.featured,
      normalized.tags,
      normalized.seoDescription,
      normalized.contentHtml,
      JSON.stringify(normalized.media),
    ]
  );

  return mapArticleRow(result.rows[0]);
}

async function setDocumentationArticleStatus(id, status, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'draft' ? 'draft' : 'active';
  const result = await database.query(
    `UPDATE documentation_articles
        SET status = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
                content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [id, normalizedStatus]
  );

  return mapArticleRow(result.rows[0]);
}

async function duplicateDocumentationArticle(id, options = {}) {
  const {
    userId = null,
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const existing = await getDocumentationArticleById(id, { includeDrafts: true, database });
  if (!existing) {
    throw new Error('Article not found.');
  }

  return createDocumentationArticle({
    title: `${existing.title} (Copy)`,
    topic: existing.topic,
    subtopic: existing.subtopic,
    status: 'draft',
    featured: false,
    tags: existing.tags,
    seoDescription: existing.seoDescription,
    contentHtml: existing.contentHtml,
    media: existing.media,
  }, { userId, database });
}

async function deleteDocumentationArticle(id, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const result = await database.query(
    `DELETE FROM documentation_articles
      WHERE id = $1
      RETURNING id, slug, title, topic, subtopic, status, featured, tags, seo_description,
                content_html, media, created_by, created_at, updated_at, helpful_yes, helpful_no`,
    [id]
  );

  return mapArticleRow(result.rows[0]);
}

function createFeedbackFingerprint(req) {
  const fingerprintSource = [
    req.ip || req.headers['x-forwarded-for'] || '',
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
  ].join('::');

  return crypto.createHash('sha256').update(fingerprintSource).digest('hex');
}

async function recordHelpfulVote(articleId, vote, fingerprintHash, options = {}) {
  const {
    database = db,
  } = options;

  await ensureDocumentationSchema(database);
  const normalizedVote = String(vote || '').trim().toLowerCase() === 'no' ? 'no' : 'yes';

  const feedbackColumnsResult = await database.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'documentation_article_feedback'`
  );
  const feedbackColumns = new Set((feedbackColumnsResult.rows || []).map((row) => row.column_name));
  const hashColumn = feedbackColumns.has('fingerprint_hash') ? 'fingerprint_hash' : 'request_hash';

  // Compatibility path for older DB schemas where feedback table used request_hash
  // and did not have a unique constraint for ON CONFLICT.
  const existing = await database.query(
    `SELECT id
       FROM documentation_article_feedback
      WHERE article_id = $1 AND ${hashColumn} = $2
      LIMIT 1`,
    [articleId, fingerprintHash]
  );

  if (existing.rows[0]) {
    if (feedbackColumns.has('updated_at')) {
      await database.query(
        `UPDATE documentation_article_feedback
            SET vote = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [normalizedVote, existing.rows[0].id]
      );
    } else {
      await database.query(
        `UPDATE documentation_article_feedback
            SET vote = $1
          WHERE id = $2`,
        [normalizedVote, existing.rows[0].id]
      );
    }
  } else {
    if (feedbackColumns.has('user_agent')) {
      await database.query(
        `INSERT INTO documentation_article_feedback (article_id, ${hashColumn}, vote, user_agent)
         VALUES ($1, $2, $3, $4)`,
        [articleId, fingerprintHash, normalizedVote, 'docs-widget']
      );
    } else {
      await database.query(
        `INSERT INTO documentation_article_feedback (article_id, ${hashColumn}, vote)
         VALUES ($1, $2, $3)`,
        [articleId, fingerprintHash, normalizedVote]
      );
    }
  }

  await database.query(
    `UPDATE documentation_articles
        SET helpful_yes = COALESCE(counts.helpful_yes, 0),
            helpful_no = COALESCE(counts.helpful_no, 0)
       FROM (
         SELECT article_id,
                COUNT(*) FILTER (WHERE vote = 'yes')::int AS helpful_yes,
                COUNT(*) FILTER (WHERE vote = 'no')::int AS helpful_no
           FROM documentation_article_feedback
          WHERE article_id = $1
          GROUP BY article_id
       ) AS counts
      WHERE documentation_articles.id = $1`,
    [articleId]
  );

  const updated = await database.query(
    'SELECT helpful_yes, helpful_no FROM documentation_articles WHERE id = $1 LIMIT 1',
    [articleId]
  );

  return {
    helpfulYes: Number(updated.rows[0] && updated.rows[0].helpful_yes || 0),
    helpfulNo: Number(updated.rows[0] && updated.rows[0].helpful_no || 0),
  };
}

async function buildDocumentationPageData(options = {}) {
  const {
    includeDrafts = false,
    selectedSlug = null,
    database = db,
  } = options;

  const articles = await listDocumentationArticles({ includeDrafts, database });
  const selectedArticle = selectedSlug
    ? articles.find((article) => article.slug === selectedSlug) || null
    : null;
  const tree = buildTopicTree(articles);
  const featuredArticles = articles
    .filter((article) => article.featured && article.status === 'active')
    .slice(0, 6);
  const index = articles.map(buildIndexEntry);
  const availableTopics = Array.from(new Set([...DEFAULT_TOPICS, ...articles.map((article) => article.topic)])).filter(Boolean);

  return {
    selectedArticle,
    articles,
    featuredArticles,
    tree,
    index,
    availableTopics,
    quickStartResources: QUICK_START_RESOURCES,
  };
}

module.exports = {
  DEFAULT_TOPICS,
  QUICK_START_RESOURCES,
  buildCanonicalDocumentationUrl,
  buildDocumentationPageData,
  buildIndexEntry,
  buildTopicTree,
  createDocumentationArticle,
  createFeedbackFingerprint,
  deleteDocumentationArticle,
  duplicateDocumentationArticle,
  ensureDocumentationSchema,
  getDocumentationArticleById,
  getDocumentationArticleBySlug,
  listDocumentationArticles,
  mapArticleRow,
  normalizeMedia,
  recordHelpfulVote,
  sanitizeArticleContent,
  searchDocumentationArticles,
  setDocumentationArticleStatus,
  slugify,
  stripHtml,
  summarizeText,
  updateDocumentationArticle,
};