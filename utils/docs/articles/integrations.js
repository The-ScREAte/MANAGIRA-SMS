"use strict";

// Integrations & API: connecting other tools, text messages, service accounts, tokens and the API.
module.exports = [
  {
    slug: "integrations",
    title: "Integrations: connect the tools your school uses",
    topic: "Integrations & API",
    order: 1,
    summary: "Turn on the Student Portal, Transportation, Mira, maps and Google Classroom, and connect text messages and WhatsApp, from one Integrations page.",
    tags: ["integrations", "google classroom", "student portal", "transportation", "maps", "twilio", "whatsapp"],
    featured: true,
    who: "Managers, and staff given the <strong>Integrations</strong> permission.",
    intro: "Integrations is the one place where your school switches on optional parts of Managira and connects the outside services it already uses. Each one is a card with its status, so you can see at a glance what is on.",
    sections: [
      {
        title: "Open Integrations",
        steps: [
          ["Open the menu and choose <strong>Management</strong>, then <strong>Integrations</strong> in the Workspace list.", "integrations-overview.webp", "Management, Integrations: each card shows whether it is Active and available for your school."],
          "Find the integration you want. The badge beside its name says <strong>Active</strong> or <strong>Inactive</strong>, and whether it is available where your school is.",
          "Select <strong>Expand</strong> to see its settings. Turn it on, enter any account details it asks for, and save.",
        ],
      },
      {
        title: "What you can connect",
        table: [
          ["Integration", "What it does", "Where people see it"],
          ["<strong>Student Portal</strong>", "Students sign in to see their own classes, results, calendar and activities, and to take online assessments.", "Student sign-in and the student portal"],
          ["<strong>Mira (AI Assistant)</strong>", "Turns on Mira for staff. Each person can only ask Mira to do what their own permissions allow.", "The Mira button in the header"],
          ["<strong>Transportation</strong>", "Buses, drivers, routes and stops, rider lists, the driver app and live bus tracking.", "Transportation menu, driver app, parent and student portals"],
          ["<strong>Google Maps</strong> or <strong>Maps</strong>", "The map shown for routes, stops and the live bus.", "Route editor, bus tracker"],
          ["<strong>Google Classroom</strong>", "Creates a Google Classroom course for each class in the current term, with a topic per subject, invites the teachers, adds the students and invites their guardians, and posts assessments as classwork.", "Google Classroom"],
          ["<strong>Twilio SMS</strong>", "Text messages to parents and staff from your school's own Twilio number.", "Mail Room and notifications"],
          ["<strong>WhatsApp Business</strong>", "WhatsApp messages to parents from your school's own WhatsApp Business number.", "Mail Room"],
        ],
        note: "Calendar sync with Google Calendar, Outlook and Apple Calendar is set up from the Calendar itself. See <a href=\"/legal/user-documentation/calendar-sync-google-outlook-apple\">Sync your calendar</a>.",
      },
      {
        title: "Connect Google Classroom",
        steps: [
          "In <strong>Integrations</strong>, expand <strong>Google Classroom</strong> and select <strong>Connect</strong>.",
          "Sign in with the Google Workspace for Education account that should own the courses, and allow access.",
          "Back in Managira, the card shows the <strong>Connected account</strong>, the <strong>Last sync status</strong> and the <strong>Last sync run</strong>. Run a sync whenever classes, teachers or students change.",
        ],
        tip: "Use a school administrator's Google account, not a teacher's personal one, so the courses stay with the school when staff change.",
      },
      {
        title: "Give other systems read access",
        text: "To let another system read your school's data (for example a district data warehouse, a library system or a state reporting tool), create a service account and an access token. Everything is read-only and limited to your school.",
        list: [
          "<a href=\"/legal/user-documentation/service-accounts-and-access-tokens\">Service accounts and access tokens</a>",
          "<a href=\"/legal/user-documentation/managira-api\">Use the Managira API</a>",
        ],
      },
    ],
    faq: [
      ["Why can't I see Integrations in Management?", "It is only listed for managers and staff given the Integrations permission. Ask a manager to add the permission to your account in Users / Employees."],
      ["Does turning an integration off delete anything?", "No. Turning an integration off hides it from people and stops it working, but the school's records stay as they are. Turn it back on to carry on. While it is off, nobody is offered its pages, the permissions that belong to it are set aside, and drivers see that transportation is turned off; turning it back on gives everyone the access they had."],
      ["Who pays for text messages and WhatsApp?", "Your school's own Twilio and WhatsApp Business accounts pay their providers directly. Managira adds no charge per message."],
    ],
    related: ["sms-integrations", "connect-whatsapp-business-to-message-parents", "service-accounts-and-access-tokens", "set-up-transportation"],
  },
  {
    slug: "sms-integrations",
    title: "Text messages (SMS) with Twilio",
    topic: "Integrations & API",
    order: 2,
    summary: "Connect your school's own Twilio account so staff can text parents and staff from Managira. Your Twilio account pays for each message, with no markup.",
    tags: ["sms", "text messages", "twilio", "a2p 10dlc", "mail room", "parent texting"],
    who: "Managers, and staff given the <strong>Integrations</strong> permission.",
    intro: "Managira sends text messages through your school's own Twilio account and phone number. Parents see your school's number, replies go to your number, and Twilio bills your school directly for each message.",
    sections: [
      {
        title: "Before you start",
        list: [
          "A Twilio account (sign up at <a href=\"https://www.twilio.com\" target=\"_blank\">twilio.com</a>).",
          "A Twilio phone number that can send SMS. In the United States, register it for business texting first: <strong>A2P 10DLC</strong> for a local number, or <strong>toll-free verification</strong> for a toll-free number. Twilio walks you through it, and carriers may block unregistered texts.",
        ],
      },
      {
        title: "Get your Twilio details",
        steps: [
          "Sign in at <a href=\"https://console.twilio.com\" target=\"_blank\">console.twilio.com</a>.",
          "Copy the <strong>Account SID</strong> and <strong>Auth Token</strong> from the <strong>Account Info</strong> box.",
          "Note your SMS number (in Twilio: <strong>Phone Numbers</strong>, <strong>Manage</strong>, <strong>Active numbers</strong>), with the country code, for example <code>+1 555 010 2030</code>.",
        ],
      },
      {
        title: "Connect Twilio in Managira",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Integrations</strong>, and expand <strong>Twilio SMS</strong>.", "integrations-sms-twilio.webp", "The Twilio SMS card: paste your Account SID, Auth Token and number."],
          "Paste the <strong>Account SID</strong>, the <strong>Auth Token</strong> and the <strong>Twilio phone number</strong>.",
          "Select <strong>Check connection</strong>. It only checks the details: no text is sent and no credit is used.",
          "Select <strong>Save and test</strong>, then <strong>Send a test text</strong> to your own phone to confirm messages arrive.",
        ],
        warning: "Your Auth Token works like a password. Paste it only into Managira's Integrations page, and never send it by email or chat. Managira stores it encrypted and never shows it again.",
      },
      {
        title: "Send texts",
        text: "Once Twilio is connected, staff who may message families choose <strong>Text</strong> in the Mail Room. Messages go to the mobile numbers saved on each parent's record. See <a href=\"/legal/user-documentation/mailroom-send-sms-whatsapp-and-email-to-guardians\">Mail Room</a>.",
        example: "A principal sends \"School closes at noon on Friday for teacher training\" to all 9th grade families by text. Each parent receives it from the school's number, and their replies go to the school's Twilio number.",
      },
    ],
    faq: [
      ["How much does each text cost?", "Twilio charges your school directly at its own rates. Managira adds no fee or markup per message."],
      ["Why do some texts fail?", "The most common causes are a number that isn't registered for business texting (A2P 10DLC or toll-free verification), a parent number saved without a country code, or a Twilio balance that has run out. The Twilio console shows the reason for each message."],
      ["Can parents reply?", "Yes. Replies go to your school's Twilio number. Read them in the Twilio console, or set Twilio to forward them to a school phone or email."],
      ["Is a test text charged?", "Check connection never sends anything. Send a test text sends one real message, which Twilio charges like any other."],
    ],
    related: ["mailroom-send-sms-whatsapp-and-email-to-guardians", "connect-whatsapp-business-to-message-parents", "integrations"],
  },
  {
    slug: "service-accounts-and-access-tokens",
    title: "Service accounts and access tokens",
    topic: "Integrations & API",
    order: 3,
    summary: "Create a service account for each integration, choose exactly what it may read, and give it a personal access token and client secret to call the Managira API.",
    tags: ["api", "service account", "access token", "personal access token", "client secret", "integration", "data sharing agreement"],
    featured: true,
    who: "Managers, and staff given the <strong>Service accounts</strong> permission (for service accounts) and <strong>Access tokens</strong> in Settings.",
    intro: "Other systems, such as a district data warehouse, a library system or a reporting tool, read your school's data through the Managira API. Each signs in as a <strong>service account</strong> with three credentials: a <strong>personal access token</strong>, a <strong>client secret</strong> and your <strong>client ID</strong>. Access is read-only and limited to what you allow, and revoking any credential stops it at once.",
    sections: [
      {
        title: "1. Create a service account",
        steps: [
          ["Open <strong>Management</strong>, then <strong>Service accounts</strong>, and select <strong>New</strong>.", "service-accounts-list.webp", "Management, Service accounts: one service account for each integration."],
          ["Give it a clear <strong>Name</strong> (for example <em>District data warehouse</em>) and a <strong>Description</strong> of what it is for.", "service-accounts-new.webp", "New Service Account: tick only the data the integration needs, then accept the data-sharing agreement."],
          "Under <strong>Data it may read</strong>, tick only what the integration needs. Its tokens can never read more than this.",
          "Read the <strong>data-sharing agreement</strong> and tick <strong>I accept the agreement</strong> to confirm your school has an agreement with this integration and that you may accept on the school's behalf.",
          "Select <strong>Create</strong>.",
        ],
      },
      {
        title: "2. Create a personal access token",
        steps: [
          ["Open <strong>Settings</strong>, then <strong>Access Tokens</strong>. On the <strong>Personal Access Tokens</strong> tab, select <strong>New</strong>.", "access-tokens-list.webp", "Settings, Access Tokens: personal access tokens, client secrets, and usage."],
          ["Enter a unique <strong>Name</strong>, choose the <strong>Service account</strong>, and pick when it <strong>Expires</strong> (30 days, 90 days, 180 days or 1 year).", "access-tokens-new.webp", "New Token: choose the service account, the expiry and the scopes."],
          "Tick the <strong>Scopes</strong> it needs. You can only choose from what its service account allows.",
          "Select <strong>Create</strong> and copy the token straight away. It starts with <code>mgr_pat_</code> and is shown only once.",
        ],
      },
      {
        title: "3. Create a client secret",
        steps: [
          ["On the <strong>Client Secrets</strong> tab, select <strong>New</strong> and choose when it expires (90 days, 180 days, 1 year or 2 years).", "access-tokens-secrets.webp", "Client Secrets: one secret can serve every integration."],
          "Copy the <strong>Client ID</strong> and the secret (it starts with <code>mgr_cs_</code>). The secret is shown only once.",
        ],
        note: "One client secret serves all your integrations. Give each integration its own service account and token, so you can switch one off without touching the others.",
      },
      {
        title: "4. Give the integration its credentials",
        text: "Send the integration's administrator the <strong>API address</strong>, your <strong>Client ID</strong>, the <strong>client secret</strong> and the <strong>personal access token</strong>, privately: by a password manager or encrypted email, never by text message or chat. The <strong>How to connect</strong> button on the Access Tokens page shows the API address and a short guide.",
        image: "access-tokens-guide.webp",
        caption: "How to connect: the API address and the three calls an integration makes.",
      },
      {
        title: "What each area allows",
        table: [
          ["Area", "Scope", "What it can read"],
          ["Students", "<code>students.read</code>", "Names, student numbers, gender, class and status."],
          ["Classes & subjects", "<code>classes.read</code>", "Classes, subjects, school years and terms."],
          ["Parents & guardians", "<code>guardians.read</code>", "Parent names, phone numbers, emails and their children."],
          ["Attendance", "<code>attendance.read</code>", "Daily attendance marks by class."],
          ["Grades", "<code>grades.read</code>", "Assessment scores, percentages, grades and positions."],
          ["Staff", "<code>staff.read</code>", "Staff names, roles and email addresses."],
          ["Events & announcements", "<code>calendar.read</code>", "School events and announcements."],
          ["PayGira", "<code>paygira.read</code>", "Bills, balances owed and payments received (schools that use PayGira)."],
          ["Transportation", "<code>transport.read</code>", "Buses, routes, stops and which stop each student uses (schools that use Transportation)."],
        ],
      },
      {
        title: "Keep access under control",
        list: [
          "<strong>Revoke</strong> or <strong>Regenerate</strong> a token from its menu on the Personal Access Tokens tab. Regenerating gives a new value and stops the old one.",
          "<strong>Put on hold</strong> a service account to pause every token it has. Turn it back on to resume. Holding, turning back on and revoking each ask for your password.",
          "The <strong>Usage &amp; allowance</strong> tab shows calls by token for the last 7 days. Each school may make 120 calls a minute and 10,000 a day; select <strong>Request more</strong> if you need a bigger allowance.",
          "Expired tokens and secrets stop working on their own. Create new ones before they expire.",
        ],
        warning: "Treat tokens and secrets like passwords. Managira stores only a fingerprint of each, so nobody, including Managira, can show it again. If one may have leaked, revoke it straight away.",
      },
    ],
    faq: [
      ["Can an integration change data in Managira?", "No. The API is read-only. Integrations can read the areas you allow and nothing else."],
      ["What happens when a token expires?", "Calls with it are refused with a 401 error. Create a new token, give it to the integration, and revoke the old one if it is still listed."],
      ["Can one integration read another school's data?", "No. Every credential belongs to one school, and every call is limited to that school."],
      ["We lost the token. Can you show it again?", "No. Tokens and secrets are shown once. Regenerate the token, or create a new one, and update the integration."],
    ],
    related: ["managira-api", "integrations", "roles-and-permissions"],
  },
  {
    slug: "managira-api",
    title: "Use the Managira API",
    topic: "Integrations & API",
    order: 4,
    summary: "Exchange your credentials for an access token, read students, classes, attendance, grades and more, page through lists and keep in sync with updated_since.",
    tags: ["api", "rest api", "developers", "access token", "updated_since", "integration", "sync"],
    who: "Developers connecting another system, using credentials from <a href=\"/legal/user-documentation/service-accounts-and-access-tokens\">Service accounts and access tokens</a>.",
    intro: "The Managira API is a read-only REST API that returns JSON. An integration exchanges its credentials for a one-hour access token, then reads the areas its service account allows. Every call stays inside one school.",
    sections: [
      {
        title: "1. Get an access token",
        text: "Send your client ID, client secret and personal access token to <code>/auth/token</code> on your school's API address (shown under <strong>How to connect</strong> on the Access Tokens page, ending in <code>/api/v1</code>).",
        image: "access-tokens-guide.webp",
        caption: "How to connect: your API address and the calls to make.",
        code: "POST /api/v1/auth/token\nContent-Type: application/json\n\n{\n  \"client_id\": \"YOUR_CLIENT_ID\",\n  \"client_secret\": \"mgr_cs_...\",\n  \"personal_access_token\": \"mgr_pat_...\"\n}\n\n200 OK\n{\n  \"access_token\": \"...\",\n  \"token_type\": \"Bearer\",\n  \"expires_in\": 3600,\n  \"scope\": \"managira.api.access tenant.read students.read\"\n}",
        tip: "Keep the access token until it expires (one hour) and reuse it for every call, then ask for a new one. Asking for a token before every call is slower and counts against the token limit (20 requests a minute from one address).",
      },
      {
        title: "2. Read data",
        text: "Send the access token in the <code>Authorization</code> header.",
        code: "GET /api/v1/students?limit=100&offset=0\nAuthorization: Bearer YOUR_ACCESS_TOKEN\n\n200 OK\n{\n  \"data\": [ { \"id\": 1042, \"first_name\": \"Emma\", \"last_name\": \"Johnson\", \"status\": \"active\", ... } ],\n  \"limit\": 100,\n  \"offset\": 0,\n  \"has_more\": true,\n  \"next_updated_since\": \"2026-11-09T07:55:00.000Z\"\n}",
      },
      {
        title: "Endpoints",
        table: [
          ["Endpoint", "Returns", "Needs"],
          ["<code>GET /me</code>", "The school and the service account the token acts as", "<code>tenant.read</code>"],
          ["<code>GET /students</code>, <code>/students/{id}</code>", "Students", "<code>students.read</code>"],
          ["<code>GET /classes</code>, <code>/subjects</code>, <code>/school-years</code>, <code>/terms</code>", "School structure", "<code>classes.read</code>"],
          ["<code>GET /guardians</code>", "Parents and guardians with their children", "<code>guardians.read</code>"],
          ["<code>GET /attendance</code>", "Attendance marks", "<code>attendance.read</code>"],
          ["<code>GET /grades</code>", "Assessment results", "<code>grades.read</code>"],
          ["<code>GET /employees</code>", "Staff", "<code>staff.read</code>"],
          ["<code>GET /events</code>, <code>/announcements</code>", "School events and announcements", "<code>calendar.read</code>"],
          ["<code>GET /paygira/bills</code>, <code>/paygira/balances</code>, <code>/paygira/payments</code>", "Billing", "<code>paygira.read</code>"],
          ["<code>GET /transportation/routes</code>, <code>/stops</code>, <code>/buses</code>, <code>/assignments</code>", "Transportation", "<code>transport.read</code>"],
          ["<code>GET /deleted?updated_since=</code>", "Records deleted since a time", "Any area"],
        ],
      },
      {
        title: "Page through lists",
        text: "Lists return up to 50 rows. Add <code>limit</code> (up to 200) and <code>offset</code> to page. Keep reading while <code>has_more</code> is <code>true</code>.",
      },
      {
        title: "Keep in sync without downloading everything",
        steps: [
          "The first time, read each list in full and keep the <code>next_updated_since</code> value from the answer.",
          "After that (once a day is plenty; hourly at most), add <code>?updated_since=</code> with that value to <code>/students</code>, <code>/guardians</code>, <code>/employees</code>, <code>/attendance</code> and the PayGira lists. You get only what is new or changed. Keep the new <code>next_updated_since</code> each time.",
          "People who leave come back with a status (students: <em>graduated</em> or <em>left</em>; staff: <em>on_hold</em> or <em>removed</em>). Read <code>/deleted?updated_since=</code> for records that were deleted.",
        ],
        code: "GET /api/v1/students?updated_since=2026-11-01T08:00:00Z\nAuthorization: Bearer YOUR_ACCESS_TOKEN",
      },
      {
        title: "Errors and limits",
        table: [
          ["Status", "Meaning", "What to do"],
          ["400 <code>invalid_request</code>", "A parameter is wrong, for example a malformed <code>updated_since</code>", "Fix the request; times look like <code>2026-11-01T08:00:00Z</code>"],
          ["401", "The access token is missing, expired or revoked", "Get a new access token"],
          ["403", "The token doesn't have that area", "Add the scope to the token, if its service account allows it"],
          ["429 <code>rate_limited</code> / <code>daily_limit_reached</code>", "Too many calls (120 a minute, 10,000 a day per school by default)", "Wait for the <code>Retry-After</code> seconds; request a bigger allowance if needed"],
        ],
        note: "Errors come back as <code>{ \"error\": \"...\", \"message\": \"...\" }</code> with a sentence you can show in logs.",
      },
    ],
    faq: [
      ["Is there a sandbox?", "Use a service account that can read only what you are testing, on your own school. The API never changes data, so reading is always safe."],
      ["Which time zone are dates in?", "Times are in UTC (ending in Z). Dates without a time, such as attendance days, are the school's calendar dates."],
      ["Can I get webhooks?", "Not yet. Use updated_since to pick up changes; once a day suits most integrations."],
    ],
    related: ["service-accounts-and-access-tokens", "integrations"],
  },
];
