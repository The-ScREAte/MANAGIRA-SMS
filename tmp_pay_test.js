require("dotenv").config();
const { sendEmailSafely, renderCleanEmail } = require("./utils/emailHelper");
(async () => {
  const html = renderCleanEmail({
    title: "Your Payment Was Successful",
    greeting: "Hi <strong>Henry</strong>,",
    paragraphs: [
      "We have received your payment and your Managira subscription is now active.",
    ],
    details: [
      { label: "Plan",        value: "School Pro" },
      { label: "Amount",      value: "GHS 250.00" },
      { label: "Date",        value: new Date().toDateString() },
      { label: "Reference",   value: "TEST-REF-20260424" },
      { label: "Next billing", value: "May 24, 2026" },
    ],
    cta: { text: "View Your Dashboard", url: "https://www.managira.com/account/login" },
    note: "If you did not make this payment or have any questions, please contact us immediately.",
    noReply: true,
  });
  const ok = await sendEmailSafely({
    to: "bondahdean@gmail.com",
    subject: "Payment Confirmed — Managira Subscription Active",
    html,
  }, "Payment Confirmation Test");
  console.log(ok ? "✅ sent" : "❌ failed");
  process.exit(ok ? 0 : 1);
})();
