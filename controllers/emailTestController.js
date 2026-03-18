"use strict";

const path = require("path");
const { sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");

/**
 * Sends one sample of every email type used in the app to a given address.
 * Admin-only endpoint for verifying SMTP configuration.
 *
 * POST /admin/testAllEmails  { "testEmail": "someone@example.com" }
 */
async function testAllEmails(req, res) {
  const testEmail = req.body.testEmail || req.query.testEmail;
  if (!testEmail) {
    return res.status(400).json({ success: false, error: "testEmail is required" });
  }

  const logoAttachment = {
    filename: "managira.png",
    path: path.join(__dirname, "../public/images/managira.png"),
    cid: "managira_logo",
  };

  const results = [];

  const templates = [
    {
      name: "Registration Welcome",
      mail: {
        to: testEmail,
        subject: "[TEST] Account Registration Confirmation",
        html: renderCleanEmail({
          title: "Welcome to Managira",
          greeting: "Hi <strong>Test User</strong>,",
          paragraphs: [
            "Your organization account has been successfully registered and is now active.",
            "You can now log in and start using all the features of Managira.",
          ],
          cta: { text: "Log In to Your Account", url: "https://www.managira.com/account/login" },
          note: "This is a test email to verify SMTP delivery.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Password Reset Request",
      mail: {
        to: testEmail,
        subject: "[TEST] Password Reset Request",
        html: renderCleanEmail({
          title: "Password Reset Request",
          greeting: "Hello,",
          paragraphs: [
            "You requested to reset your password.",
            "Click the button below to continue. This link will expire in 15 minutes.",
            "If you did not request this, you can safely ignore this email.",
          ],
          cta: { text: "Reset Password", url: "https://www.managira.com/account/reset-password?token=TEST" },
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Password Reset Confirmation",
      mail: {
        to: testEmail,
        subject: "[TEST] Password Reset Successful",
        html: renderCleanEmail({
          title: "Password Reset Successful",
          greeting: "Dear User,",
          paragraphs: [
            "Your password has been successfully reset.",
            "If you did not request this change, please contact support immediately.",
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Invoice Email",
      mail: {
        to: testEmail,
        subject: "[TEST] New Invoice from Managira",
        html: renderCleanEmail({
          title: "New Invoice from Managira",
          greeting: "Hello,",
          paragraphs: ["A new invoice has been generated for your subscription."],
          details: [
            { label: "Organization Name", value: "Test Organization" },
            { label: "Amount Due", value: "$50.00" },
            { label: "Due Date", value: new Date().toLocaleDateString() },
          ],
          note: "This is a test email.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Cancellation Confirmation",
      mail: {
        to: testEmail,
        subject: "[TEST] Subscription Cancellation Confirmation",
        html: renderCleanEmail({
          title: "Subscription Cancellation Confirmation",
          greeting: "Dear <strong>Test User</strong>,",
          paragraphs: [
            "We wanted to confirm that your subscription for <strong>Test Organization</strong> has been successfully canceled.",
            "You will continue to have full access until the end of your current billing cycle.",
          ],
          note: "This is a test email.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Support Ticket Created",
      mail: {
        to: testEmail,
        subject: "[TEST] Support Ticket Created - Ticket #999",
        html: renderCleanEmail({
          title: "Support Ticket Created (#999)",
          greeting: "Dear <strong>Test User</strong>,",
          paragraphs: [
            "Thank you for reaching out. Your support ticket has been created and our team will respond shortly.",
          ],
          details: [
            { label: "Ticket Number", value: "#999" },
            { label: "Your Message", value: "This is a test support message." },
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Support Ticket Response",
      mail: {
        to: testEmail,
        subject: "[TEST] Response to Support Ticket #999",
        html: renderCleanEmail({
          title: "Support Response",
          greeting: "Dear <strong>Test User</strong>,",
          paragraphs: [
            "Our team has responded to your support ticket (#999).",
          ],
          details: [
            { label: "Ticket Number", value: "#999" },
            { label: "Response", value: "Thank you for contacting us. This is a test response." },
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Support Ticket Resolved",
      mail: {
        to: testEmail,
        subject: "[TEST] Your Support Ticket #999 Has Been Resolved",
        html: renderCleanEmail({
          title: "Support Ticket Resolved",
          greeting: "Dear <strong>Test User</strong>,",
          paragraphs: [
            "We are pleased to inform you that your support ticket (#999) has been resolved.",
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Admin Invite",
      mail: {
        to: testEmail,
        subject: "[TEST] You are invited to Managira - Set Your Password",
        html: renderCleanEmail({
          title: "You're Invited to Join as Admin",
          greeting: "Hello <strong>Test Admin</strong>,",
          paragraphs: [
            "Managira is inviting you to join as an admin. Use the button below to set your password.",
          ],
          cta: { text: "Accept Invite & Set Password", url: "https://www.managira.com/account/setPassword?token=TEST" },
          note: "This link will expire in 24 hours.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Admin Password Set Success",
      mail: {
        to: testEmail,
        subject: "[TEST] Your Password Has Been Set Successfully",
        html: renderCleanEmail({
          title: "Password Set Successfully",
          greeting: "Hello <strong>Test Admin</strong>,",
          paragraphs: [
            "Your password has been set successfully. You can now log in to Managira.",
          ],
          cta: { text: "Log in to Managira", url: "https://www.managira.com/account/login" },
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Admission Approved",
      mail: {
        to: testEmail,
        subject: "[TEST] Admission Approved: Test Student",
        html: renderCleanEmail({
          title: "Admission Approved",
          greeting: "Dear Guardian,",
          paragraphs: [
            "We are pleased to inform you that the admission application for <strong>Test Student</strong> has been approved by <strong>Test School</strong>.",
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Admission Rejected",
      mail: {
        to: testEmail,
        subject: "[TEST] Admission Rejected: Test Student",
        html: renderCleanEmail({
          title: "Admission Rejected",
          greeting: "Dear Guardian,",
          paragraphs: [
            "We regret to inform you that the admission application for <strong>Test Student</strong> has been rejected.",
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Employment Application Confirmation",
      mail: {
        to: testEmail,
        subject: "[TEST] Application Received: Content Manager",
        html: renderCleanEmail({
          title: "Employment Application Received",
          greeting: "Dear <strong>Test Applicant</strong>,",
          paragraphs: [
            "Thank you for applying for the <strong>Content Manager</strong> role at Managira.",
            "Your application has been received successfully, and our team will review it.",
          ],
          details: [
            { label: "Application ID", value: "#TEST-001" },
            { label: "Position", value: "Content Manager" },
            { label: "Location", value: "Remote" },
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Employment Approved",
      mail: {
        to: testEmail,
        subject: "[TEST] Your Content Manager application has been approved",
        html: renderCleanEmail({
          title: "Employment Application Approved",
          greeting: "Dear <strong>Test Applicant</strong>,",
          paragraphs: [
            "We are pleased to inform you that your application has been approved for the next stage.",
          ],
          details: [
            { label: "Position", value: "Content Manager" },
            { label: "Application Status", value: "Approved for Next Stage" },
          ],
          noReply: false,
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Employment Rejected",
      mail: {
        to: testEmail,
        subject: "[TEST] Update on your Content Manager application",
        html: renderCleanEmail({
          title: "Employment Application Update",
          greeting: "Dear <strong>Test Applicant</strong>,",
          paragraphs: [
            "After careful consideration, we regret to inform you that we will not be progressing with your application at this stage.",
          ],
          details: [
            { label: "Position", value: "Content Manager" },
            { label: "Application Status", value: "Rejected" },
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Hub Welcome",
      mail: {
        to: testEmail,
        subject: "[TEST] Welcome to Test Hub - Managira SMS",
        html: renderCleanEmail({
          title: "Welcome to Your Hub",
          greeting: "Hello,",
          paragraphs: [
            "Your organization is now part of <strong>Test Hub</strong>.",
          ],
          details: [
            { label: "Hub", value: "Test Hub" },
            { label: "Status", value: "Active" },
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Guardian Welcome (Parent Portal)",
      mail: {
        to: testEmail,
        subject: "[TEST] Welcome to Test School Parent Portal - Set Your Password",
        html: renderCleanEmail({
          title: "Welcome to Test School Parent Portal",
          greeting: "Hello <strong>Test Guardian</strong>,",
          paragraphs: [
            "Great news! <strong>Test Student</strong> has been registered at Test School, and you've been added as their guardian.",
            "To monitor your child's academic progress, please set up your Parent Portal password.",
          ],
          cta: { text: "Set My Password", url: "https://www.managira.com/account/setPassword?token=TEST&type=guardian" },
          note: "This password setup link will expire in 24 hours.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Guardian Student Added",
      mail: {
        to: testEmail,
        subject: "[TEST] New Student Added - Test School Parent Portal",
        html: renderCleanEmail({
          title: "New Student Added to Your Account",
          greeting: "Hello <strong>Test Guardian</strong>,",
          paragraphs: [
            "<strong>Another Student</strong> has been added to your Parent Portal account at Test School.",
          ],
          cta: { text: "Login to Parent Portal", url: "https://www.managira.com/account/login" },
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Guardian Report Notification",
      mail: {
        to: testEmail,
        subject: "[TEST] [Test School] Report for Test Student",
        html: renderCleanEmail({
          title: "Student Report Filed",
          greeting: "Dear Guardian,",
          paragraphs: [
            "A report has been filed regarding your child <strong>Test Student</strong> by <strong>Mr. Teacher</strong> (Staff).",
          ],
          details: [
            { label: "Report Type", value: "Behavioral" },
            { label: "Student", value: "Test Student" },
            { label: "Message", value: "This is a test report notification." },
          ],
          note: "This report is also available in your Parent Portal.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Employee Invite (Set Password)",
      mail: {
        to: testEmail,
        subject: "[TEST] Set Your Password - Managira",
        html: renderCleanEmail({
          title: "You're Invited to Join Test School",
          greeting: "Hello <strong>Test Employee</strong>,",
          paragraphs: [
            "Test School is inviting you to join their institution. Accept this invitation to set your password.",
          ],
          cta: { text: "Accept Invite & Set Password", url: "https://www.managira.com/account/setPassword?token=TEST" },
          note: "This link will expire in 3 days.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Assessment Access Update",
      mail: {
        to: testEmail,
        subject: "[TEST] Assessment Access Update: Math Test",
        html: renderCleanEmail({
          title: "Assessment Access Update",
          greeting: "Hello <strong>Test Teacher</strong>,",
          paragraphs: [
            "Your assessment editing access for <strong>Math Test</strong> has been updated.",
          ],
          details: [
            { label: "Term", value: "Term 1" },
            { label: "Lock status", value: "Unlocked" },
            { label: "Edit window start", value: new Date().toLocaleDateString() },
          ],
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Report Card Email",
      mail: {
        to: testEmail,
        subject: "[TEST] Report Card - Test Student | Test School",
        html: renderCleanEmail({
          title: "Student Report Card",
          greeting: "Dear Parent/Guardian,",
          paragraphs: [
            "Please find attached the <strong>academic report card</strong> for <strong>Test Student</strong>.",
          ],
          details: [
            { label: "Student", value: "Test Student" },
            { label: "School", value: "Test School" },
            { label: "Date", value: new Date().toLocaleDateString() },
          ],
          note: "This report is confidential and intended only for the student's parent/guardian.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Payment Confirmation",
      mail: {
        to: testEmail,
        subject: "[TEST] Student Registration & Payment Confirmation - Test School",
        html: renderCleanEmail({
          title: "Student Registration & Payment Confirmation",
          greeting: "Hello <strong>Test Guardian</strong>,",
          paragraphs: [
            "We are pleased to confirm that the student's registration and payment have been successfully processed for <strong>Test School</strong>.",
          ],
          note: "This is a test email.",
        }),
        attachments: [logoAttachment],
      },
    },
    {
      name: "Admin Registration Notification",
      mail: {
        to: testEmail,
        subject: "[TEST] New Account Registration",
        text: "A new account has been registered:\n\nName: Test User\nOrganization: Test Org\nEmail: test@example.com\nPhone: +1234567890\n\nPlease review the registration details.",
      },
    },
  ];

  // Send all emails with small delay between to avoid SMTP rate limits
  for (const template of templates) {
    try {
      const sent = await sendEmailSafely(template.mail, `[TEST] ${template.name}`);
      results.push({ name: template.name, success: sent });
    } catch (err) {
      results.push({ name: template.name, success: false, error: err.message });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return res.json({
    success: true,
    summary: `${succeeded} sent, ${failed} failed out of ${results.length} total`,
    testEmail,
    results,
  });
}

module.exports = { testAllEmails };
