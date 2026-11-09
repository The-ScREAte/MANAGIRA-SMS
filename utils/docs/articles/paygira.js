"use strict";

// PayGira & payments: bills, online payments, collections, arrears and payouts.
module.exports = [
  {
    slug: "set-up-paygira-bills-collections-and-guardian-payments",
    title: "PayGira: bills, online payments and collections",
    topic: "PayGira & payments",
    order: 1,
    summary: "Set up payouts, create bills for classes or students, let parents pay online by card, record payments taken at school, and send receipts automatically.",
    tags: ["paygira", "school fees", "tuition", "bills", "online payments", "receipts", "collect payments"],
    featured: true,
    who: "Managers, and staff given <strong>PayGira</strong> with the pages they need: bills, payments, arrears, payouts or settings.",
    intro: "PayGira is how your school bills families and gets paid. Parents pay online by card in the parent portal, staff can record payments taken at school, and every payment updates balances and sends a receipt.",
    sections: [
      {
        title: "1. Set up payouts",
        steps: [
          ["Open <strong>PayGira</strong> from the menu, then its <strong>Settings</strong>.", "paygira-overview.webp", "PayGira: what's billed, paid and outstanding at a glance."],
          "Connect your school's payout account, where online payments are paid out to.",
          "Check your payment options and save. Online payments open once payouts are set up.",
        ],
      },
      {
        title: "2. Create a bill",
        steps: [
          "In <strong>Bills</strong>, create a bill: what it's for, the amount and the due date.",
          "Choose who it's for: classes, chosen students, or a group.",
          "Choose whether part payments are allowed, and whether it repeats (for example, monthly lunch fees).",
          "Assign a <strong>collector</strong> if staff will take payments at school, then publish. Families see it in the parent portal.",
        ],
        example: "<em>Spring field trip, $35, due March 6, for 5th Grade, part payments allowed.</em> Parents see it straight away, pay online, and get a receipt.",
      },
      {
        title: "3. How parents pay",
        text: "Parents open the bill in the parent portal and pay by card. The payment updates their balance and they get a receipt by email, at once.",
      },
      {
        title: "4. Record payments taken at school",
        steps: [
          "A collector opens their class and chooses <strong>My PayGira</strong>. Bills assigned to them are listed; use <strong>Past</strong>, <strong>All</strong> or <strong>Future</strong> to find one.",
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
      ["Which cards can parents use?", "Visa, Mastercard, American Express and Discover, plus Apple Pay and Google Pay where the browser supports them, processed securely by Stripe."],
      ["Can a parent pay part of a bill?", "Yes, if the bill allows part payments. The rest stays as their balance."],
      ["Does Managira store card numbers?", "No. Cards are handled by Stripe; Managira keeps only the card brand and last four digits."],
    ],
    related: ["paygira-payments-arrears-and-payouts", "parent-portal", "report-builder"],
  },
  {
    slug: "paygira-payments-arrears-and-payouts",
    title: "Track payments, arrears and payouts",
    topic: "PayGira & payments",
    order: 2,
    summary: "See every payment, correct one if needed, follow up on overdue balances, and check what has been paid out to your school.",
    tags: ["payments", "arrears", "overdue fees", "payouts", "balances", "finance"],
    who: "Staff given the matching PayGira pages: Payments, Arrears, Payouts.",
    sections: [
      {
        title: "The PayGira pages",
        image: "paygira-overview.webp",
        caption: "PayGira: billed, paid and outstanding.",
        table: [
          ["Page", "What it's for"],
          ["<strong>Overview</strong>", "Totals billed, paid and outstanding."],
          ["<strong>Bills</strong>", "Create and manage bills."],
          ["<strong>Student bills</strong>", "Each student's bills and balance."],
          ["<strong>Subscriptions</strong>", "Repeating bills."],
          ["<strong>Payments</strong>", "Every payment, online or recorded at school. Staff with the right permission can record or correct payments."],
          ["<strong>Arrears</strong>", "Overdue balances, to follow up with families."],
          ["<strong>Payouts</strong>", "Money paid out to your school's account."],
          ["<strong>Settings</strong>", "Your payout account and payment options."],
        ],
      },
      {
        title: "Follow up on overdue balances",
        steps: [
          "Open <strong>Arrears</strong> to see families with overdue balances.",
          "Send reminders from the Mail Room, or filter Report Builder's <strong>Fee balances</strong> report and email it to the office.",
        ],
        tip: "Report Builder's <strong>Fee balances</strong> and <strong>Payments</strong> reports export to Excel for your bookkeeping.",
      },
    ],
    related: ["set-up-paygira-bills-collections-and-guardian-payments", "report-builder", "mailroom-send-sms-whatsapp-and-email-to-guardians"],
  },
];
