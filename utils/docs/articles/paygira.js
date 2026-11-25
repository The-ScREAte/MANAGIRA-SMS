"use strict";

// PayGira & payments: bills, the student ledger, payments, overdue balances, settings, paying staff
// and vendors, and collecting fees in a class. Pictures: public/images/docs/paygira-*.webp
// (taken by ~/.managira-local-copy/tools/docshots/scripts/paygira-*.js).
const WHO_MAIN = "Managers, and staff given <strong>PayGira</strong> › <strong>Main PayGira</strong>.";

module.exports = [
  {
    slug: "set-up-paygira-bills-collections-and-guardian-payments",
    title: "PayGira: get started, send a bill and get paid",
    topic: "PayGira & payments",
    order: 1,
    summary: "Open PayGira, connect the account that receives parent payments, send your first bill and see how families pay.",
    tags: ["paygira", "school fees", "tuition", "bills", "online payments", "guardian payments", "get paid", "stripe", "set up", "fees"],
    featured: true,
    who: WHO_MAIN + " Setting up where parent payments go needs <strong>PayGira Settings</strong> and Settings access.",
    intro: "PayGira is how your school bills families and gets paid. You send a bill, parents pay online or at the office, and every payment updates balances and gives them a receipt.",
    sections: [
      {
        title: "Where it is in the menu",
        image: "paygira-bills.webp",
        caption: "PayGira has its own menu: Overview, Bills, Student ledger, Payments, Pay staff & vendors and Settings.",
        steps: [
          ["Go to <strong>Management</strong> and select <strong>PayGira</strong> in the menu on the left."],
          "Each menu item is one page. The next sections walk through them in the order you will use them.",
        ],
        table: [
          ["Page", "What it is for", "Guide"],
          ["<strong>Overview</strong>", "What was billed, paid and still owed, and the latest payments.", "<a href=\"/legal/user-documentation/paygira-overview\">The PayGira Overview</a>"],
          ["<strong>Bills</strong>", "Create, send and edit bills. <strong>Repeating</strong> lists bills that repeat.", "<a href=\"/legal/user-documentation/paygira-bills\">Bills and repeating bills</a>"],
          ["<strong>Student ledger</strong>", "What each student was billed, paid and owes. <strong>Overdue</strong> lists late balances.", "<a href=\"/legal/user-documentation/paygira-student-ledger\">Student ledger</a>, <a href=\"/legal/user-documentation/paygira-overdue-balances\">Overdue balances</a>"],
          ["<strong>Payments</strong>", "Every payment, with receipts. Record cash and checks here.", "<a href=\"/legal/user-documentation/paygira-payments-arrears-and-payouts\">Payments</a>"],
          ["<strong>Pay staff &amp; vendors</strong>", "Money your school sends out.", "<a href=\"/legal/user-documentation/paygira-pay-staff-and-vendors\">Pay staff and vendors</a>"],
          ["<strong>Settings</strong>", "The invoice note and the ways parents can pay online.", "<a href=\"/legal/user-documentation/paygira-settings\">PayGira settings</a>"],
        ],
      },
      {
        title: "Choose where parent payments go",
        text: "Parents can pay online only after your school has an account to receive the money. Until then, bills can still be paid at the office and recorded by staff.",
        steps: [
          "Go to <strong>Settings › Billing &amp; plan</strong>.",
          ["Open <strong>Where parent payments go</strong> with <strong>Expand</strong>."],
          "Select <strong>Set up an account</strong>, confirm your password and follow the steps to connect the account. Schools that belong to a district set up their own account the same way, because each school receives its own parents' payments.",
        ],
        note: "This is the account that <em>receives</em> what parents pay. Paying your own staff and vendors is a different page: <strong>Pay staff &amp; vendors</strong>.",
      },
      {
        title: "Send your first bill",
        steps: [
          ["Open <strong>PayGira › Bills</strong> and select <strong>+ New bill</strong>."],
          ["Type the <strong>Title</strong> and the <strong>Amount each</strong>, choose <strong>Who pays?</strong> and the <strong>Due date</strong>.", "paygira-bill-new-zoom.webp", "Four answers are enough for most bills."],
          "Select <strong>Create and send</strong>. Each parent is emailed an invoice and sees the bill in the parent portal. <strong>Save as draft</strong> keeps it for later without sending.",
        ],
        example: "<em>Spring field trip, Science Museum, $35 each, due March 6, for 6th Grade.</em> Parents of 6th Grade students see it right away and can pay online.",
        tip: "<a href=\"/legal/user-documentation/paygira-bills\">Bills and repeating bills</a> explains every option, including choosing students with checkboxes, late fees and repeating bills.",
      },
      {
        title: "How families pay",
        steps: [
          "Parents open <strong>PayGira</strong> in the parent portal. Each child's bills and what is due are listed.",
          "They pay online, using the ways your school offers (card, and others you turn on in <a href=\"/legal/user-documentation/paygira-settings\">PayGira Settings</a>), or pay at the office.",
          "The payment updates the balance and they get a receipt by email. A parent can pay part of a bill; the rest stays as their balance.",
        ],
        tip: "To nudge a family, use <strong>Request payment</strong> beside a bill or in a student's ledger. See <a href=\"/legal/user-documentation/paygira-student-ledger\">Student ledger</a>.",
      },
    ],
    faq: [
      ["Why can't parents pay online?", "Online payment opens once <strong>Where parent payments go</strong> shows a connected account (Settings › Billing &amp; plan). Until then parents see the other ways your school takes payment."],
      ["Why is the menu item missing for me?", "PayGira appears for managers and for staff given <strong>PayGira</strong> in Users / Employees. A teacher or other staff member who collects fees in class gets <strong>Classroom PayGira</strong> and sees <strong>My PayGira</strong> in their class instead. See <a href=\"/legal/user-documentation/paygira-class-collection\">Collect fees in your class</a>."],
      ["Can parents use Venmo or PayPal?", "Not at the moment. Parents can pay by card and by the other ways your school checks in PayGira Settings, or pay at the school office."],
      ["Does Managira store card numbers?", "No. Cards are handled by Stripe. Managira keeps only the card brand and last four digits."],
    ],
    related: ["paygira-bills", "paygira-student-ledger", "paygira-payments-arrears-and-payouts", "paygira-settings", "parent-portal"],
  },
  {
    slug: "paygira-overview",
    title: "The PayGira Overview",
    topic: "PayGira & payments",
    order: 2,
    summary: "See at a glance what was billed, what was paid and what is still owed for a term, with the latest payments.",
    tags: ["paygira overview", "billed", "paid", "still owed", "dashboard", "latest payments", "fees summary"],
    who: "Managers, and staff given <strong>PayGira › Overview</strong>.",
    intro: "The Overview is PayGira's front page: three totals for a term, the bills behind them and the newest payments.",
    sections: [
      {
        title: "Open the Overview",
        image: "paygira-overview.webp",
        caption: "PayGira › Overview for Fall Semester, 2026-2027.",
        steps: [
          ["Go to <strong>Management › PayGira</strong> and select <strong>Overview</strong>."],
        ],
      },
      {
        title: "What each part shows",
        list: [
          "<strong>Billed</strong>: everything sent as bills in the period.",
          "<strong>Paid</strong>: what families have paid, with the share of the total billed.",
          "<strong>Still owed</strong>: what is left to collect, and how many balances are overdue.",
          "<strong>Bills</strong>: each bill with its status, amount billed and amount paid. <strong>All bills</strong> opens the Bills page.",
          "<strong>Latest payments</strong>: the newest payments with student, bill, method and date. <strong>All payments</strong> opens the Payments page.",
          "<strong>Charts and bill-by-bill breakdown</strong>: open it for charts and a closer look at each bill.",
        ],
      },
      {
        title: "Change the period",
        steps: [
          "Select <strong>Filter</strong> at the top right. It shows the school year and term now in view, for example <strong>Fall Semester · 2026-2027</strong>.",
          "Choose another school year or term. The totals, bills and payments change to match.",
        ],
        note: "Money owed carries over: a student's ledger shows what they owe across all terms, while the Overview and Bills show the period you chose.",
      },
    ],
    faq: [
      ["The totals look too low.", "The Overview covers one term at a time. Use <strong>Filter</strong> to look at another term, or open the <a href=\"/legal/user-documentation/paygira-student-ledger\">Student ledger</a> for each student's full balance."],
    ],
    related: ["paygira-bills", "paygira-payments-arrears-and-payouts", "set-up-paygira-bills-collections-and-guardian-payments"],
  },
  {
    slug: "paygira-bills",
    title: "Bills: create, choose who pays, edit and repeat",
    topic: "PayGira & payments",
    order: 3,
    summary: "Create a one-time or repeating bill for every student, some classes or chosen students, add late fees, edit it and ask families to pay.",
    tags: ["bills", "new bill", "tuition", "field trip fee", "uniform", "lunch top-up", "repeating bills", "installments", "late fee", "draft", "checkboxes"],
    who: "Managers, and staff given <strong>PayGira › Bills</strong>. Removing a bill needs <strong>Cancel &amp; Delete Bills</strong>, and <strong>Repeating</strong> needs <strong>Repeating Bills</strong>.",
    intro: "A bill is something your school charges: tuition, a field trip, a uniform. You decide who pays, how much and when.",
    sections: [
      {
        title: "The Bills page",
        image: "paygira-bills.webp",
        caption: "Bills sent this term, with students, due date, billed, paid and status.",
        steps: [
          "Go to <strong>Management › PayGira</strong> and select <strong>Bills</strong>. <strong>All bills</strong> is the first tab.",
          ["Each row shows the bill, how many students it covers, its due date, the amount <strong>Billed</strong> and <strong>Paid</strong>, and its status: <strong>Sent</strong>, <strong>Draft</strong>, <strong>Cancelled</strong> or <strong>Paid</strong>.", "paygira-bills-row-zoom.webp", "At the right of a row: Request payment, edit and delete."],
          "Use <strong>Filter</strong> to look at another school year or term.",
        ],
      },
      {
        title: "Create a bill",
        steps: [
          ["Select <strong>+ New bill</strong>."],
          ["Fill in <strong>Title</strong>, <strong>Amount each (USD)</strong>, <strong>Who pays?</strong> and <strong>Due date</strong>.", "paygira-bill-new-zoom.webp", "The amount is per student."],
          "Select <strong>Create and send</strong> to email each parent their invoice, or <strong>Save as draft</strong> to keep it for later.",
        ],
        example: "<em>Winter concert tickets, $12 each, due December 5</em> for 6th Grade and Grade 2 - Room 1, or <em>Lunch account top-up, December, $60</em> for two chosen students.",
      },
      {
        title: "Choose who pays",
        text: "<strong>Who pays?</strong> has three choices. Classes and students are chosen with checkboxes, never by holding a key.",
        list: [
          "<strong>Every student</strong>: the whole school.",
          "<strong>Some classes</strong>: check the classes. Use the search box to find one, <strong>Tick all shown</strong> to check everything the search shows, and <strong>Clear</strong> to start over.",
          "<strong>Chosen students</strong>: search by name or class and check each student. The counter beside the box says how many are chosen.",
        ],
        steps: [
          ["Choose <strong>Some classes</strong> and check <strong>6th Grade</strong>."],
          ["Or choose <strong>Chosen students</strong>, search for a name and check the student."],
        ],
      },
      {
        title: "More options",
        text: "Open <strong>More options</strong> when you need more than the basics.",
        steps: [
          ["Add a <strong>Late fee</strong> and the number of days after the due date it applies (<strong>After (days late)</strong>)."],
        ],
        list: [
          "<strong>Note</strong>: shown on the invoice.",
          "<strong>How often</strong>: <strong>Once</strong>, <strong>Repeating</strong> or <strong>In installments</strong>. A repeating bill uses <strong>Repeats</strong> (every day, week, month, term or year), a <strong>Last date</strong> and <strong>Skip weekends and holidays</strong>.",
          "<strong>School year</strong> and <strong>Term</strong>: the period the bill belongs to. They start on the current ones.",
          "<strong>Staff who collect it</strong>: teachers or staff who take the money in class. They see the bill in <strong>My PayGira</strong>. Leave empty when the office collects. See <a href=\"/legal/user-documentation/paygira-class-collection\">Collect fees in your class</a>.",
          "<strong>Where the money goes</strong> and <strong>How parents can pay</strong>: <strong>All methods</strong>, or check the ones you accept for this bill (card, cash and others your school has set up).",
          "<strong>Tell parents</strong>: <strong>Email each parent their invoice</strong>.",
        ],
      },
      {
        title: "Edit, ask for payment or delete",
        steps: [
          ["Select a bill's row, or the pencil, to open <strong>Edit bill</strong>. Change the title, amount, due date, who pays and the options, then select <strong>Save changes</strong>."],
          "In Edit bill, <strong>Cancel</strong> closes the window without changes.",
          "Select <strong>Request payment</strong> on a <strong>Sent</strong> bill to email every parent who still owes it a link to pay.",
          "The red bin deletes the bill and everything assigned under it. It shows only for staff with <strong>Cancel &amp; Delete Bills</strong>, and it asks you to confirm first.",
        ],
        warning: "Deleting a bill removes it from every student's ledger. Record corrections to payments on the <strong>Payments</strong> page instead.",
      },
      {
        title: "Repeating bills",
        image: "paygira-repeating.webp",
        caption: "Repeating lists every bill that repeats, with its price, schedule and progress.",
        steps: [
          ["Open <strong>Bills</strong> and select the <strong>Repeating</strong> tab."],
          "Each card says how much it repeats for, how often, how many students and how much was paid so far, for example <em>$55.00 every month · 30 students</em>.",
          "To change or stop a repeating bill, open it from <strong>All bills</strong>.",
        ],
      },
    ],
    faq: [
      ["Why is the student I want not in the list?", "The student list follows the school year and term you chose in <strong>More options</strong>. A student not enrolled in that term does not appear. Check <strong>School year</strong> and <strong>Term</strong>."],
      ["What does Draft mean?", "A draft is saved but not sent. Parents see nothing and nobody is emailed until you send it."],
      ["Can I bill one student only?", "Yes. Choose <strong>Chosen students</strong> and check the student."],
    ],
    related: ["paygira-student-ledger", "paygira-class-collection", "paygira-settings", "set-up-paygira-bills-collections-and-guardian-payments"],
  },
  {
    slug: "paygira-student-ledger",
    title: "Student ledger: what each student owes",
    topic: "PayGira & payments",
    order: 4,
    summary: "See every student's billed, paid and owed amounts, open one student's bills and payments, and email their parents a link to pay.",
    tags: ["student ledger", "balances", "invoice", "receipt", "request payment", "copy pay link", "what a student owes", "fees owed", "statement"],
    who: "Managers, and staff given <strong>PayGira › Student Ledger</strong>.",
    intro: "The Student ledger puts each child's bills and payments in one place. It is the quickest way to answer a parent who asks what they owe.",
    sections: [
      {
        title: "Open the ledger",
        image: "paygira-ledger.webp",
        caption: "Student ledger › Balances: biggest balances first.",
        steps: [
          ["Go to <strong>Management › PayGira</strong> and select <strong>Student ledger</strong>."],
          ["It has two tabs: <strong>Balances</strong> (this page) and <strong>Overdue</strong>."],
          "The three tiles at the top show <strong>Billed</strong>, <strong>Paid</strong> and <strong>Still owed</strong> for the period.",
        ],
      },
      {
        title: "Find a student",
        steps: [
          ["Type a name or student ID in <strong>Find a student</strong>."],
          ["Use <strong>Class</strong> and <strong>Show</strong> to narrow it further.", "paygira-ledger-filters-zoom.webp", "Class and Show sit beside the search box."],
        ],
        list: [
          "<strong>Show</strong> offers <strong>Students who owe</strong>, <strong>Everyone billed</strong>, <strong>Paid in full</strong>, <strong>With credit</strong> (when someone has credit) and <strong>All students</strong>, each with a count where it applies.",
          "The table shows each student's class, <strong>Billed</strong>, <strong>Paid</strong>, <strong>Balance</strong> and a badge: <strong>Owes</strong>, paid or credit. Select a column heading to sort.",
        ],
      },
      {
        title: "Open a student's ledger",
        steps: [
          ["Select a student's row. Their ledger opens on the right.", "paygira-ledger-student.webp", "Audrey Diaz: every bill with its balance, then every payment."],
          ["At the top are their <strong>Billed</strong>, <strong>Paid</strong> and <strong>Still owed</strong> totals."],
          ["Under <strong>Bills</strong>, each row has an <strong>Invoice</strong> link that opens the invoice."],
          "Under <strong>Payments</strong>, each row has a <strong>Receipt</strong> link.",
          "Close the window with the <strong>×</strong> at the top right.",
        ],
      },
      {
        title: "Ask the family to pay",
        steps: [
          ["In a student's ledger, select <strong>Request payment</strong>. Their parents are emailed one message that lists every bill still owed, with a link that opens the bill ready to pay."],
          "Select <strong>Copy pay link</strong> to get the same link and send it another way, such as a text or a note. A line under the buttons confirms what happened.",
        ],
        note: "The button shows only while the student owes something. There is one <strong>Request payment</strong> for everything owed. To nudge families for one bill, use <strong>Request payment</strong> on the <a href=\"/legal/user-documentation/paygira-bills\">Bills</a> page.",
      },
    ],
    faq: [
      ["Why does a student show a balance for a past term?", "Money owed carries over between terms, so the ledger counts every term. The Overview and Bills pages show one period at a time."],
      ["Who gets the email?", "The student's parents or guardians who have an email address. If none has one, nothing can be sent. Use <strong>Copy pay link</strong> instead."],
      ["How do I see only late balances?", "Open the <strong>Overdue</strong> tab. See <a href=\"/legal/user-documentation/paygira-overdue-balances\">Overdue balances</a>."],
    ],
    related: ["paygira-overdue-balances", "paygira-payments-arrears-and-payouts", "paygira-bills"],
  },
  {
    slug: "paygira-overdue-balances",
    title: "Overdue balances: find late payments and follow up",
    topic: "PayGira & payments",
    order: 5,
    summary: "See which students are late, filter the list, email parents, keep notes and save a report.",
    tags: ["overdue", "arrears", "late fees owed", "overdue balances", "reminder email", "email parents", "collections", "outstanding fees", "report", "notes"],
    who: "Managers, and staff given <strong>PayGira › Overdue Balances</strong>. It is a tab of the Student ledger.",
    intro: "Overdue lists the students whose payments are late, how late, and gives you ways to follow up with their parents.",
    sections: [
      {
        title: "Open Overdue",
        image: "paygira-overdue.webp",
        caption: "Student ledger › Overdue.",
        steps: [
          "Go to <strong>Management › PayGira › Student ledger</strong>.",
          ["Select the <strong>Overdue</strong> tab."],
          "The tiles show the total overdue, what was already paid toward it, how much has had nothing paid and how many parents have an email address.",
        ],
      },
      {
        title: "Narrow the list",
        steps: [
          "Open <strong>Filters</strong> under <strong>Narrow the list</strong>.",
          "Choose any of <strong>School Year</strong>, <strong>Term</strong>, <strong>Class</strong> and <strong>Bill</strong> (check several, or use <strong>Select all</strong> and <strong>Clear</strong>), a <strong>Due Date From</strong> and <strong>To</strong>, <strong>Owes at least</strong> an amount, a <strong>Search</strong> word, <strong>Saved card</strong> and <strong>Parent's email</strong>.",
          "Select <strong>Apply</strong>.",
          "To reuse a set of filters, type a name under <strong>Saved filters</strong> and select <strong>Save these filters</strong>. A saved filter is one tap next time.",
        ],
      },
      {
        title: "Read a row",
        steps: [
          ["Each row shows the student, their parent, what they owe, <strong>Days late</strong> and a status such as <strong>Nothing paid</strong> or <strong>30+ days late</strong>."],
        ],
        list: [
          "<strong>Bills</strong> shows what the balance is made of.",
          "<strong>Email</strong> emails that student's parents.",
          "<strong>Note</strong> keeps a record of what was agreed, for example a payment plan.",
        ],
      },
      {
        title: "Email parents",
        steps: [
          ["Check the students, then select <strong>Email their parents</strong> in the bar that appears. To email everyone on the list, select <strong>Email all parents</strong>."],
          ["Check the <strong>Subject</strong> and <strong>Message</strong>. They fill in names and amounts for each family from the fields listed on the right. Keep <strong>Include a link to pay</strong> checked so parents can pay straight away.", "paygira-overdue-email.webp", "The Email parents window lists who gets it and whether they are ready."],
          "Select <strong>Send</strong>.",
        ],
        note: "Only parents with an email address can be emailed. <strong>Who gets it</strong> shows each one as <strong>Ready</strong> or missing an address.",
      },
      {
        title: "Save a report",
        steps: [
          ["Select <strong>Save a report</strong>, above the list or in the bar for the students you checked."],
          "Give it a name and save it. The saved report keeps who owed what that day, as a file you can open or download later.",
        ],
        tip: "<a href=\"/legal/user-documentation/report-builder\">Report Builder</a> has <strong>Fee balances</strong> and <strong>Payments</strong> reports you can export to Excel for your bookkeeping.",
      },
    ],
    faq: [
      ["Why does a student show 0 days late but is on the list?", "The balance is billed but its due date has not passed. The status reads <strong>Nothing paid</strong> until it becomes late."],
      ["Will parents get a second email if I send again?", "Yes, every send is a new email. Check <strong>Who gets it</strong> before you send."],
    ],
    related: ["paygira-student-ledger", "paygira-bills", "report-builder"],
  },
  {
    slug: "paygira-payments-arrears-and-payouts",
    title: "Payments: record, find and correct a payment",
    topic: "PayGira & payments",
    order: 6,
    summary: "Record a cash or check payment, find any payment and print its receipt, and correct one entered by mistake.",
    tags: ["payments", "record a payment", "cash", "check", "cheque", "bank transfer", "receipt", "correct payment", "online payments", "payment history", "sign-off"],
    who: "Managers, and staff given <strong>PayGira › Payments</strong>. <strong>Record Payments</strong> allows entering payments, and <strong>Correct Payments &amp; Reopen Sign-Offs</strong> allows undoing them.",
    intro: "Payments lists every payment your school has received, whether a parent paid online or staff recorded it. A receipt goes with each one.",
    sections: [
      {
        title: "Open Payments",
        image: "paygira-payments.webp",
        caption: "Payments received: date, student, bill, how it was paid and amount.",
        steps: [
          "Go to <strong>Management › PayGira</strong> and select <strong>Payments</strong>.",
          "The heading shows how many payments there are and the total, for example <em>90 payments</em>. Online payments by parents appear here by themselves, with the method <strong>Card</strong>.",
        ],
      },
      {
        title: "Find a payment",
        steps: [
          ["Type a student's name, a bill or a reference in the search box and select <strong>Find</strong>."],
          ["On a row, select <strong>Receipt</strong> to open that payment's receipt."],
          "Select <strong>Show all</strong> to clear the search.",
        ],
      },
      {
        title: "Record a payment taken at school",
        text: "Use this for cash, checks and bank transfers that staff receive.",
        steps: [
          ["Select <strong>+ Record a payment</strong> at the top right."],
          ["In <strong>Paid by</strong>, choose the student and the bill. The list shows what is still due."],
          ["Enter the <strong>Amount</strong>, choose <strong>How it was paid</strong> (<strong>Cash</strong>, <strong>Check</strong>, <strong>Bank transfer</strong> or <strong>Other</strong>) and add a <strong>Reference</strong>, such as a check number, and a <strong>Note</strong> if you like.", "paygira-payment-form-zoom.webp", "The window with a check payment filled in."],
          "Select <strong>Record payment</strong>. The student's balance updates and a receipt is made.",
        ],
        tip: "A parent can pay part of a bill. Enter what you actually received. The rest stays as the balance.",
      },
      {
        title: "Correct a payment entered by mistake",
        steps: [
          "Select the red bin at the end of the payment's row. It shows only for staff with <strong>Correct Payments &amp; Reopen Sign-Offs</strong>.",
          "Confirm. The payment is removed and the student's balance goes back up.",
        ],
        warning: "Correct a payment only when it was entered wrongly. A real payment that was refunded is not the same thing.",
      },
      {
        title: "Collections signed off",
        text: "Further down the page, <strong>Collections signed off</strong> lists the times a member of staff who collects a bill handed in everything they took. Each row shows when, the bill, the class, who signed and how much, with a <strong>Report</strong> link. Search it by bill, class, signer or date. Staff with <strong>Correct Payments &amp; Reopen Sign-Offs</strong> can reopen one. See <a href=\"/legal/user-documentation/paygira-class-collection\">Collect fees in your class</a>.",
      },
    ],
    faq: [
      ["Where do online payments show?", "Here, with the method <strong>Card</strong>, as soon as the parent pays. Nothing needs to be recorded by hand."],
      ["Does a recorded payment email the parent?", "A receipt is created for it. Parents can see the payment and the new balance in the parent portal."],
      ["I can't see Record a payment.", "It shows for staff with <strong>Record Payments</strong>. Ask a manager to add it on your staff form."],
    ],
    related: ["paygira-student-ledger", "paygira-class-collection", "paygira-settings", "set-up-paygira-bills-collections-and-guardian-payments"],
  },
  {
    slug: "paygira-class-collection",
    title: "Collect fees in your class: My PayGira",
    topic: "PayGira & payments",
    order: 7,
    summary: "Teachers and staff named as collectors record cash and checks for a bill in their class and sign off when everything is handed in.",
    tags: ["my paygira", "collect fees", "class collection", "sign off", "bulk collect", "teacher collects money", "class tools", "field trip money"],
    who: "Teachers and staff given <strong>Classroom PayGira</strong> and named as a collector on a bill.",
    intro: "When the office names a teacher as a bill's collector, that teacher takes the money in class and records it here. The office sees every payment on the Payments page.",
    sections: [
      {
        title: "Open My PayGira",
        image: "paygira-class-tab.webp",
        caption: "6th Grade, Class Tools › My PayGira, for Brian Sullivan.",
        steps: [
          ["Open your class and select <strong>My PayGira</strong> in <strong>Class Tools</strong>."],
          "The tiles show <strong>Bills</strong>, <strong>Students</strong>, <strong>Collected</strong> and <strong>Outstanding</strong>. Under <strong>Assigned Bills</strong>, each card is a bill you collect, with its due date, students and amounts.",
        ],
        note: "A bill appears here only when a manager chose you under <strong>Staff who collect it</strong> in the bill's More options. See <a href=\"/legal/user-documentation/paygira-bills\">Bills</a>.",
      },
      {
        title: "Record a payment",
        steps: [
          ["Select a bill's card. Its students open on the right, each with <strong>Billed</strong>, <strong>Paid</strong> and what they owe."],
          ["Select <strong>Collect</strong> beside a student. <strong>Record Collection</strong> opens with the bill and student filled in.", "paygira-class-collect.webp", "The amount starts at what the student owes."],
          "Check the amount, choose the <strong>Method</strong>, add a <strong>Reference</strong> or <strong>Notes</strong> if you want, and select <strong>Record payment</strong>. A receipt is made.",
        ],
      },
      {
        title: "Record many at once",
        steps: [
          "Select <strong>Bulk collect</strong> at the top of the bill.",
          "Check the students whose money you took, check each amount and select the button to record them together. The review shows the total.",
        ],
      },
      {
        title: "Sign off",
        steps: [
          "When you have collected everything, select <strong>Sign off</strong>. It stays grayed out while money is still outstanding (<em>Collect the remaining balance before signing off</em>).",
          "Enter your full name and select <strong>Sign off</strong>. The sign-off records who handed in the collection, when and how much.",
        ],
        note: "Signing off locks the collection. A manager with <strong>Correct Payments &amp; Reopen Sign-Offs</strong> can reopen it from the Payments page.",
      },
    ],
    faq: [
      ["I don't see My PayGira.", "Your manager gives it with <strong>Classroom PayGira</strong> on your staff form. You also need a bill that names you as a collector."],
      ["A student paid online already.", "Their row shows what was paid and what is left. Collect only the remaining balance."],
    ],
    related: ["paygira-bills", "paygira-payments-arrears-and-payouts"],
  },
  {
    slug: "paygira-settings",
    title: "PayGira settings: invoice note, payment methods, service fee",
    topic: "PayGira & payments",
    order: 8,
    summary: "Add a note to every invoice, choose how parents can pay online and decide who covers the service fee.",
    tags: ["paygira settings", "apple pay", "google pay", "link", "cash app pay", "service fee", "invoice note", "payment methods", "who pays the fee", "stripe"],
    who: "Managers, and staff given <strong>PayGira › PayGira Settings</strong>. The service fee and the receiving account are in Settings, which needs Settings access.",
    intro: "Three things control how parents pay: the note on every invoice, the online payment methods you accept and who covers the service fee.",
    sections: [
      {
        title: "Open PayGira Settings",
        image: "paygira-settings.webp",
        caption: "PayGira › Settings. Bills are in US dollars.",
        steps: [
          "Go to <strong>Management › PayGira</strong> and select <strong>Settings</strong>.",
          "The top of the page tells you where the money goes (<strong>Settings › Billing &amp; plan › Where parent payments go</strong>) and that online payment opens once that account is connected.",
        ],
      },
      {
        title: "Write the note on every invoice",
        steps: [
          ["Type your message in <strong>Note at the bottom of every invoice</strong>, for example <em>Thank you for trusting us with your child. Questions? Call the office.</em>"],
          "Select <strong>Save</strong>. The note is optional.",
        ],
      },
      {
        title: "Choose how parents can pay online",
        steps: [
          ["Under <strong>Ways parents can pay online</strong>, check the methods to offer. <strong>Card</strong> is always on. Other methods, such as Apple Pay, Google Pay, Link and Cash App Pay, appear here when Managira's payment processor has them switched on."],
          "Select <strong>Save</strong>. Parents see the checked ways the next time they pay.",
        ],
        note: "Apple Pay and Google Pay show only on devices that support them. Until you save a choice, parents see every available method.",
      },
      {
        title: "Decide who covers the service fee",
        text: "A service fee applies to each payment parents make online. Payments you record at school have no fee.",
        steps: [
          "Go to <strong>Settings › Billing &amp; plan</strong> and open <strong>Platform Service Fee</strong>.",
          ["Choose <strong>The parent paying</strong> (the fee is added to the bill and shown before they pay, and the school receives the full amount) or <strong>The school</strong> (the parent pays the bill amount and the fee comes out of what the school receives).", "paygira-service-fee.webp", "Platform Service Fee, with the two choices and Save preference."],
          "Select <strong>Save preference</strong>.",
        ],
      },
    ],
    faq: [
      ["Why don't I see Apple Pay or Google Pay?", "They appear only when Managira's payment processor has them on for your school's account. Parents also need a device that supports them."],
      ["Can I switch off card?", "No. Card is always offered."],
    ],
    related: ["set-up-paygira-bills-collections-and-guardian-payments", "paygira-bills"],
  },
  {
    slug: "paygira-pay-staff-and-vendors",
    title: "Pay staff and vendors",
    topic: "PayGira & payments",
    order: 9,
    summary: "Send school money to a member of staff or a vendor from the school's card, once or on a schedule.",
    tags: ["pay staff", "vendors", "payouts", "salary", "pay someone", "schedule payment", "money you send out"],
    who: "Managers, and staff given <strong>PayGira › Pay Staff &amp; Vendors</strong>.",
    intro: "Pay staff &amp; vendors is for money your school sends out. It is separate from where parents' payments land.",
    sections: [
      {
        title: "Open the page",
        image: "paygira-payouts.webp",
        caption: "Pay staff & vendors. Nothing has been paid yet.",
        steps: [
          "Go to <strong>Management › PayGira</strong> and select <strong>Pay staff &amp; vendors</strong>.",
          ["Select <strong>+ Pay someone</strong>."],
        ],
      },
      {
        title: "Set up a payment",
        steps: [
          "Type a <strong>Title</strong>, for example <em>Salary, Jordan Lee</em>.",
          "Under <strong>Who gets it?</strong> choose <strong>Someone at the school</strong> and search by name or email, or <strong>Someone else</strong> and enter their full name and email address.",
          "Enter the <strong>Amount</strong>, the <strong>Currency</strong> and the card to <strong>Pay from this card</strong>.",
          "Choose <strong>How often</strong>: <strong>Once</strong>, <strong>Every week</strong>, <strong>Every 2 weeks</strong> or <strong>Every month</strong>. Set <strong>Pay on</strong> (and an end date for a schedule), then select <strong>Save</strong>.",
        ],
        note: "If there is no saved card yet, the window says so and links to <strong>Settings › Billing &amp; plan</strong> where you add one.",
      },
      {
        title: "Manage payments you set up",
        list: [
          "<strong>Pay now</strong> sends a payment immediately.",
          "<strong>Pause</strong> and <strong>Resume</strong> stop and restart a schedule.",
          "<strong>History</strong> lists what was sent.",
          "<strong>Remove</strong> deletes it.",
        ],
      },
    ],
    faq: [
      ["Is this where parent payments are received?", "No. That is <strong>Settings › Billing &amp; plan › Where parent payments go</strong>. See <a href=\"/legal/user-documentation/set-up-paygira-bills-collections-and-guardian-payments\">PayGira: get started</a>."],
    ],
    related: ["set-up-paygira-bills-collections-and-guardian-payments", "paygira-settings"],
  },
];
