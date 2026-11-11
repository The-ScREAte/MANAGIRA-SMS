"use strict";

// PayGira & payments: bills, online payments, collections, arrears and payouts.
module.exports = [
  {
    slug: "set-up-paygira-bills-collections-and-guardian-payments",
    title: "PayGira: bills, online payments and collections",
    topic: "PayGira & payments",
    order: 1,
    summary: "Set up payouts, create bills for classes or students, let parents pay online by card, record payments taken at school, and send receipts automatically.",
    tags: ["paygira", "school fees", "tuition", "bills", "online payments", "receipts", "apple pay", "service fee"],
    featured: true,
    who: "Managers, and staff given <strong>PayGira</strong> with the pages they need: bills, the student ledger, payments, payouts or settings.",
    intro: "PayGira is how your school bills families and gets paid. Parents pay online by card in the parent portal, staff can record payments taken at school, and every payment updates balances and sends a receipt.",
    sections: [
      {
        title: "1. Set up payouts",
        steps: [
          ["Open <strong>PayGira</strong> from the menu, then its <strong>Settings</strong>.", "paygira-overview.webp", "PayGira: what was billed, paid and is still owed."],
          "Its Settings link to <strong>Settings, Billing &amp; Plan</strong>. There, <strong>Where parent payments go</strong> shows whether your payout account is connected: select <strong>Set up payouts</strong>, confirm your password and choose <strong>Connect with Stripe</strong>. Schools in a hub set up their own payouts the same way.",
          "Online payments open once the payout account is connected. Until then parents see the other ways your school takes payment, such as paying at the office.",
        ],
      },
      {
        title: "2. Create a bill",
        steps: [
          "In <strong>Bills</strong>, open <strong>New bill</strong> and fill in four things: what it is for, the amount for each student, who pays (every student, some classes or chosen students) and the due date.",
          "Open <strong>More options</strong> only when you need it: to make the bill repeat (for example, monthly lunch fees), add a late fee, or name the <strong>staff who collect it</strong> at school.",
          "Select <strong>Create and send</strong>. Each parent is emailed their invoice and sees the bill in the parent portal. <strong>Save as draft</strong> keeps it for later.",
          "To nudge the parents who still owe, select <strong>Send reminder</strong> beside the bill.",
        ],
        example: "<em>Spring field trip, $35, due March 6, for 5th Grade.</em> Parents see it straight away, pay online, and get a receipt.",
      },
      {
        title: "3. How parents pay",
        text: "Parents open PayGira in the parent portal, where each child's bills due are listed, and select <strong>Pay</strong>. They pay by card or any other way your school offers online, or see how to pay at the office. The payment updates their balance and they get a receipt by email, at once.",
      },
      {
        title: "Choose how parents can pay online",
        steps: [
          "Open <strong>PayGira</strong>, then <strong>Settings</strong>.",
          "Under <strong>Ways parents can pay online</strong>, tick the ones to offer. Card is always offered; the others are those Managira's payment processor has switched on, such as Apple Pay, Google Pay, Link and Cash App Pay.",
          "Select <strong>Save</strong>. Parents see the ways ticked the next time they pay. Apple Pay and Google Pay show only on devices that support them.",
        ],
      },
      {
        title: "Ask a parent to pay",
        text: "Select <strong>Request payment</strong> beside a bill, or open a student in the <strong>Student ledger</strong>, to email the student's parents a link that opens the bill ready to pay. <strong>Copy pay link</strong> gives you the same link to send another way.",
      },
      {
        title: "4. Record payments taken at school",
        steps: [
          ["A collector opens their class and chooses <strong>My PayGira</strong> in Class Tools. Bills assigned to them are listed; use <strong>Past</strong>, <strong>All</strong> or <strong>Future</strong> to find one.", "class-paygira.webp", "My PayGira on the class page: bills you collect, collected and outstanding."],
          "Select <strong>Collect</strong> beside the student, enter the amount, and select <strong>Record Payment</strong>. A receipt is created automatically.",
          "On a busy day, use bulk collection to record several students at once.",
        ],
      },
      {
        title: "5. Sign off",
        text: "When a bill is fully collected, someone trusted with finance signs it off. Signing off locks it and records who finalized it, when, and for how much.",
      },
    ],
    faq: [
      ["Which cards can parents use?", "Visa, Mastercard, American Express and Discover, processed securely by Stripe, plus the other ways your school ticked in PayGira Settings, such as Apple Pay, Google Pay, Link and Cash App Pay."],
      ["Who pays the service fee?", "A service fee applies to each payment made online. In Settings, Billing &amp; Plan, choose who covers it: the parent (it is added to the bill and shown before they pay, and the school receives the full amount) or the school (the parent pays the bill amount and the fee comes out of what the school receives). Payments recorded at school have no fee."],
      ["Can parents use Venmo or PayPal?", "Not at the moment. Parents can pay by card, Apple Pay, Google Pay, Link or Cash App Pay where your school offers them, or pay at the school office."],
      ["Can a parent pay part of a bill?", "Yes. They choose how much to pay; the rest stays as their balance."],
      ["Does Managira store card numbers?", "No. Cards are handled by Stripe; Managira keeps only the card brand and last four digits."],
    ],
    related: ["paygira-payments-arrears-and-payouts", "parent-portal", "report-builder"],
  },
  {
    slug: "paygira-payments-arrears-and-payouts",
    title: "The student ledger, payments, overdue balances and payouts",
    topic: "PayGira & payments",
    order: 2,
    summary: "See what each student owes, find any payment and its receipt, follow up on overdue balances, and pay staff or suppliers.",
    tags: ["payments", "ledger", "invoices", "arrears", "overdue fees", "payouts", "balances", "finance"],
    who: "Staff given the matching PayGira pages: Student Ledger, Overdue Balances, Payments, Payouts.",
    sections: [
      {
        title: "The PayGira pages",
        image: "paygira-overview.webp",
        caption: "PayGira: billed, paid and still owed.",
        table: [
          ["Page", "What it's for"],
          ["<strong>Overview</strong>", "What was billed, paid and is still owed, with the latest payments."],
          ["<strong>Bills</strong>", "Create a bill, send it and remind parents. Its <strong>Repeating</strong> tab lists the bills that repeat."],
          ["<strong>Student ledger</strong>", "What each student was billed, paid and owes, biggest balances first. Select a student for their bills, payments and invoices. Its <strong>Overdue</strong> tab lists overdue balances to follow up."],
          ["<strong>Payments</strong>", "Every payment, online or recorded at school, each with its receipt. Staff with the right permission can record a payment or remove one entered by mistake."],
          ["<strong>Payouts</strong>", "Pay a member of staff or a supplier, once or on a schedule."],
          ["<strong>Settings</strong>", "The note on every invoice, and a link to where parent payments go."],
        ],
      },
      {
        title: "Follow up on overdue balances",
        steps: [
          "Open <strong>Student ledger</strong>, then its <strong>Overdue</strong> tab, to see the students with overdue balances and how many days late each one is.",
          "Tick the students and select <strong>Email their parents</strong>, or select <strong>Email</strong> beside one student. <strong>Bills</strong> shows what the balance is made of, and <strong>Note</strong> keeps a record of what was agreed.",
          "<strong>Save a report</strong> keeps a PDF or spreadsheet of who owes what today.",
        ],
        tip: "Report Builder's <strong>Fee balances</strong> and <strong>Payments</strong> reports export to Excel for your bookkeeping.",
      },
    ],
    related: ["set-up-paygira-bills-collections-and-guardian-payments", "report-builder", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  },
];
