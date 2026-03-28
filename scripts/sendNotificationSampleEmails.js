const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");

async function sendSample(to) {
  const samples = [
    {
      key: "parent_absence_threshold",
      subject: "Greenfield Academy: Attendance alert for Daniel Ade",
      html: renderCleanEmail({
        title: "Greenfield Academy Attendance Alert",
        greeting: "Dear Parent/Guardian,",
        paragraphs: [
          `<strong>${escapeHtml("Daniel Ade")}</strong> has been marked absent 3 times this week.`,
          "Please contact the school if there is any issue affecting your child's attendance and progress.",
        ],
        details: [
          { label: "School", value: "Greenfield Academy" },
          { label: "Student", value: "Daniel Ade" },
          { label: "Class", value: "JSS 2A" },
          { label: "Week", value: "2026-03-23 to 2026-03-29" },
          { label: "Absences", value: "3" },
          { label: "Attendance", value: "57.1%" },
        ],
        note: "This message is from Managira on behalf of your school.",
      }),
    },
    {
      key: "weekly_parent_digest",
      subject: "Greenfield Academy: Weekly progress digest for your children",
      html: renderCleanEmail({
        title: "Greenfield Academy Weekly Parent Digest",
        greeting: "Hello Dean Bondah,",
        paragraphs: [
          "Here is your weekly summary for all linked children (2026-03-23 to 2026-03-29).",
          `<table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Child</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Class</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Absences (week)</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Attendance</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Score</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Performance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Daniel Ade</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">JSS 2A</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">1</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">85.7%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">68.5%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Good</td>
              </tr>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Deborah Ade</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Pry 5B</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">0</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">100.0%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">74.2%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Good</td>
              </tr>
            </tbody>
          </table>`,
        ],
        details: [
          { label: "School", value: "Greenfield Academy" },
          { label: "Children in digest", value: "2" },
        ],
        note: "This message is sent by Managira for your school.",
      }),
    },
    {
      key: "weekly_teacher_digest",
      subject: "Greenfield Academy: Weekly teaching digest",
      html: renderCleanEmail({
        title: "Greenfield Academy Weekly Teaching Digest",
        greeting: "Hello Mrs. Okon,",
        paragraphs: [
          "Here is your weekly teaching digest (2026-03-23 to 2026-03-29) for your assigned classes and subjects.",
          `<table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Class</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Subject</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Attendance</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Score</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Rating</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">JSS 2A</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Mathematics</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">81.2%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">62.4%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Fair</td>
              </tr>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">JSS 1B</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Mathematics</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">76.0%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">57.3%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Needs Attention</td>
              </tr>
            </tbody>
          </table>`,
        ],
        details: [
          { label: "School", value: "Greenfield Academy" },
          { label: "Assignments in digest", value: "2" },
        ],
        note: "This report is generated by Managira using class and subject assignments.",
      }),
    },
    {
      key: "weekly_manager_digest",
      subject: "Greenfield Academy: Weekly leadership report",
      html: renderCleanEmail({
        title: "Greenfield Academy Weekly Leadership Report",
        greeting: "Hello Supervisor,",
        paragraphs: [
          "Weekly risk summary (2026-03-23 to 2026-03-29) for classes and students under your oversight.",
          `<table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Student</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Class</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Attendance</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Score</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Risk Trigger</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Kelechi Udo</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">SS 1C</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">61.5%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">49.2%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Attendance < 70% and score < 55%</td>
              </tr>
            </tbody>
          </table>`,
        ],
        details: [
          { label: "School", value: "Greenfield Academy" },
          { label: "Underperforming students", value: "1" },
          { label: "Attendance risk threshold", value: "70%" },
          { label: "Score risk threshold", value: "55%" },
        ],
        note: "This summary is generated by Managira to support timely intervention.",
      }),
    },
    {
      key: "guardian_report_created",
      subject: "Greenfield Academy: New parent report (#1042)",
      html: renderCleanEmail({
        title: "Greenfield Academy Parent Report Submitted",
        greeting: "Hello Team Member,",
        paragraphs: ["A parent/guardian has submitted a new report ticket that requires attention."],
        details: [
          { label: "Report ID", value: "#1042" },
          { label: "Student", value: "Daniel Ade" },
          { label: "Guardian", value: "Dean Bondah" },
          { label: "Subject", value: "Bullying concern" },
          { label: "Message", value: "Please investigate classroom bullying incident from Thursday." },
        ],
        note: "Please review and respond in the report workflow.",
      }),
    },
    {
      key: "guardian_report_reply",
      subject: "Greenfield Academy: New guardian reply on report #1042",
      html: renderCleanEmail({
        title: "Greenfield Academy Report Reply Received",
        greeting: "Hello Team Member,",
        paragraphs: ["A parent/guardian has replied to report #1042."],
        details: [
          { label: "Report ID", value: "#1042" },
          { label: "Subject", value: "Bullying concern" },
          { label: "Reply", value: "Thank you for the update. Please keep me informed after you speak with the class teacher." },
        ],
        note: "Please review the conversation and continue follow-up where needed.",
      }),
    },
    {
      key: "weekly_hub_digest",
      subject: "Bondah Education Group: Weekly hub overview",
      html: renderCleanEmail({
        title: "Bondah Education Group Weekly Hub Overview",
        greeting: "Hello Dean Bondah,",
        paragraphs: [
          "Here is your weekly overview across all member schools (2026-03-23 to 2026-03-29).",
          `<table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">School</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Students</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Staff</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Attendance</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Score</th>
                <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">At-Risk Students</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Greenfield Academy</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">312</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">24</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">87.3%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">66.8%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">5</td>
              </tr>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Sunrise Preparatory</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">198</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">16</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">91.6%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">72.1%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">2</td>
              </tr>
              <tr>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">Hope International School</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">145</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">12</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">78.9%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">58.4%</td>
                <td style="padding:8px;border-bottom:1px solid #e5e7eb;">9</td>
              </tr>
            </tbody>
          </table>`,
        ],
        details: [
          { label: "Hub", value: "Bondah Education Group" },
          { label: "Member schools", value: "3" },
          { label: "Total students", value: "655" },
          { label: "Total staff", value: "52" },
          { label: "At-risk students (across all schools)", value: "16" },
        ],
        note: "This summary is generated by Managira for hub-level oversight.",
      }),
    },
  ];

  let sent = 0;
  for (const sample of samples) {
    const ok = await sendEmailSafely(
      {
        to,
        subject: `[SAMPLE] ${sample.subject}`,
        html: sample.html,
      },
      `Sample Notification: ${sample.key}`
    );

    if (ok) {
      sent += 1;
      console.log(`Sent sample: ${sample.key}`);
    } else {
      console.log(`Failed sample: ${sample.key}`);
    }
  }

  console.log(`Done. ${sent}/${samples.length} sample emails sent.`);
}

const recipient = process.argv[2] || "bondahdean@gmail.com";
sendSample(recipient)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to send sample notifications:", error.message);
    process.exit(1);
  });
