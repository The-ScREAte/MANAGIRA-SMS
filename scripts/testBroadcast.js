require("dotenv").config();
const db = require("../config/db");
const { broadcastEventAnnouncement } = require("../utils/notificationDigestService");

(async () => {
  try {
    // Find first org with staff
    const orgs = await db.query(
      `SELECT o.organization_id, o.organization_name, COUNT(u.user_id) AS staff_count
       FROM organizations o
       JOIN users u ON u.organization_id = o.organization_id
       WHERE u.account_type IN ('Teacher','Supervisor','Manager')
         AND COALESCE(u.on_hold, FALSE) = FALSE
         AND u.email IS NOT NULL AND TRIM(u.email) <> ''
       GROUP BY o.organization_id, o.organization_name
       ORDER BY staff_count DESC LIMIT 5`
    );
    if (!orgs.rows.length) { console.log("No orgs with staff found"); process.exit(0); }
    console.log("Top orgs with staff:", JSON.stringify(orgs.rows, null, 2));
    const orgId = orgs.rows[0].organization_id;
    const orgName = orgs.rows[0].organization_name;
    console.log("Org:", orgId, orgName);

    // Count staff
    const staff = await db.query(
      `SELECT COUNT(*) AS c FROM users
       WHERE organization_id = $1
         AND account_type IN ('Teacher','Supervisor','Manager')
         AND COALESCE(on_hold, FALSE) = FALSE
         AND email IS NOT NULL AND TRIM(email) <> ''`,
      [orgId]
    );
    console.log("Staff with emails:", staff.rows[0].c);

    // Test broadcast (dry run - just to see if it works)
    console.log("\nAttempting broadcast...");
    const result = await broadcastEventAnnouncement(db, {
      organizationId: orgId,
      contentType: "event",
      visibility: "org",
      title: "Test Event - Please Ignore",
      body: "This is a test notification to verify the broadcast system works.",
      eventDate: "2026-03-28",
      contentId: 999999,
    });
    console.log("Broadcast result:", JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
