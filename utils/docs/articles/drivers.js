"use strict";

// The driver app: what a school's bus drivers see and do on their phone.
// Pictures are taken by ~/.managira-local-copy/tools/docshots/scripts/driver-*.js (James Carter, Bus 12, Route 1).
module.exports = [
  {
    slug: "driver-app",
    title: "The driver app: your day at a glance",
    topic: "Driver app",
    order: 1,
    summary: "Sign in on your phone, see today's bus, route, stops and riders, and find where to start a trip, send a report and change your settings.",
    tags: ["driver app", "bus driver", "driver dashboard", "sign in as a driver", "today's trip", "driver menu", "phone"],
    featured: true,
    who: "Drivers. Your school adds you in <strong>Management › Transportation › Drivers</strong>, or on the staff form with the role <em>Driver</em>.",
    intro: "The driver app is your school's Managira on your phone. It shows today's trip and counts boarding for you: it assumes everyone boards and arrives, and you only tap for exceptions.",
    sections: [
      {
        title: "Sign in",
        steps: [
          "Open the invitation email your school sent and select the link to set your password. You only need to do this once.",
          "Go to your school's Managira sign-in page and type your email. If you chose <strong>Keep me logged in</strong>, you stay signed in on that phone.",
          "Enter your password. If your school asks for a code, type the code from your email.",
          "You land on <strong>Today's trip</strong>. Add the page to your phone's home screen so it opens in one tap. See <a href=\"/legal/user-documentation/install-managira-on-your-device\">Install Managira on your device</a>.",
        ],
        note: "Drivers can only sign in to the driver screen. If you can't sign in, see <a href=\"/legal/user-documentation/reset-a-password-or-recover-account-access\">Reset a password or recover account access</a>.",
      },
      {
        title: "What's on your dashboard",
        steps: [
          ["<strong>Today's trip</strong> shows your name, your bus, its license plate and seats. <strong>Report</strong> is at the top right.", "driver-dashboard.webp", "The driver dashboard before a trip."],
          ["Under the map, your <strong>Route</strong> and four facts: <strong>Stops</strong>, <strong>Students</strong>, <strong>Distance</strong> and <strong>Time</strong>. <strong>Go</strong> starts the trip."],
          ["<strong>Stops</strong> lists the route in order, with how many students board at each, and ends at the school."],
          ["<strong>Students</strong> has two tabs: <strong>Bus access</strong> (your riders, with their stop and class) and <strong>No bus access</strong>. Use <strong>Search students</strong> to find one."],
        ],
        note: "If your route has more than one run, a <strong>Route</strong> list lets you choose which one to drive. If your school hasn't given you a bus or route, the page says so, and you can't start a trip. Ask your transportation lead.",
      },
      {
        title: "The menu",
        steps: [
          ["Select <strong>≡</strong> at the top right. You'll find <strong>Dashboard</strong>, <strong>Calendar</strong>, <strong>Settings</strong> and <strong>Logout</strong>. Logout always asks first."],
        ],
        list: [
          "<strong>Calendar</strong> shows school events and activities.",
          "Lead drivers also see <strong>Management</strong>. See <a href=\"/legal/user-documentation/lead-driver\">The lead driver</a>.",
        ],
      },
      {
        title: "Where to go next",
        list: [
          "<a href=\"/legal/user-documentation/driver-run-a-trip\">Start and run a trip</a>",
          "<a href=\"/legal/user-documentation/driver-boarding-and-arrivals\">Boarding, riders who aren't coming, and ending the trip</a>",
          "<a href=\"/legal/user-documentation/driver-send-a-report\">Send a report to your lead</a>",
          "<a href=\"/legal/user-documentation/driver-settings-and-forms\">Settings, alerts and Forms</a>",
        ],
        warning: "Drive safely. Set up the run before you move, and let the app count boarding for you.",
      },
    ],
    faq: [
      ["Why does my dashboard say transportation is turned off?", "Your school turned off Transportation in Integrations. Trips come back when they turn it on again."],
      ["Why can't I see my riders' addresses?", "Home addresses and parent phones show only to drivers whose school gave them <strong>Student Details</strong>. You only ever see your own riders."],
      ["Does anyone see where I am?", "Families and school staff see the bus on the map while a trip is running. Ending the trip stops it."],
    ],
    related: ["driver-run-a-trip", "driver-boarding-and-arrivals", "driver-send-a-report", "driver-settings-and-forms", "lead-driver"],
  },
  {
    slug: "driver-run-a-trip",
    title: "Start and run a trip",
    topic: "Driver app",
    order: 2,
    summary: "Press Go, follow the route on the map, open the stops list, switch to Google or Apple Maps, and keep the trip running.",
    tags: ["start trip", "go", "navigation", "turn by turn", "stops list", "skip a stop", "add a stop", "google maps", "apple maps", "location"],
    who: "Drivers with a bus and a route assigned.",
    intro: "Starting a trip shares your bus's position with families and staff, and opens a map that guides you stop to stop.",
    sections: [
      {
        title: "Start the trip",
        steps: [
          ["On <strong>Today's trip</strong>, check the route and select <strong>Go</strong>.", "driver-dashboard.webp", "Go is under the route facts."],
          "If your phone asks to share your location, choose to allow it. Without location, families can't see the bus. The bottom of the map says <strong>Location is off</strong>, <strong>Finding GPS…</strong> or <strong>Weak GPS</strong> until it works.",
          ["The map opens under the app header. It shows the road through your stops, the next turn at the top, and the next stop, such as <strong>1/4 Highland Dr &amp; 2700 S</strong>."],
        ],
        note: "A trip can't start on a bus marked <em>Maintenance</em> or <em>Out of Service</em>, on a paused route, or if your driver profile is inactive. The app tells you which. Ask your transportation lead. Starting a new trip closes one you left running.",
      },
      {
        title: "Use the map",
        steps: [
          ["The white bar names the next stop and its distance. Select it to open the stops list."],
          ["The round buttons on the right: <strong>minimize</strong> the map, <strong>turn</strong> it (heading up or north up), and show the <strong>whole route</strong>. <strong>Re-center</strong> appears when you've moved the map away from the bus."],
          ["At the bottom: minutes left, distance and arrival time, <strong>Navigate</strong> and <strong>End</strong>.", "driver-trip-bottom-zoom.webp", "Time left, Navigate and End."],
        ],
      },
      {
        title: "Open Google Maps or Apple Maps",
        steps: [
          ["Select <strong>Navigate</strong> and choose <strong>Google Maps</strong> or <strong>Apple Maps</strong>. <strong>Waze</strong> is listed when your school turned it on."],
          "Your maps app takes over the screen. Families see an estimate of where the bus is until you return to Managira, because a web page can't send your position while another app is open.",
        ],
        tip: "Prefer to stay in Managira. Its own map gives turn-by-turn directions and keeps your position live for families.",
      },
      {
        title: "Work with the stops list",
        steps: [
          ["Select the white bar to open the list. <strong>To go</strong> shows the stops left, with arrival times and the riders at each. <strong>Covered</strong> shows the ones done.", "driver-stops-sheet.webp", "The stops list over the map."],
          ["<strong>Here</strong> tells Managira you are at the next stop, so its boarding card opens. <strong>Skip</strong> skips it."],
          "On a covered stop, <strong>Change</strong> lets you fix who boarded. <strong>Find a stop or student</strong> searches the list.",
          "<strong>Add stop</strong> adds a stop for this trip only. Type an address or choose <strong>Use my location</strong>. It becomes the next stop and the route is planned again. <strong>Report</strong> opens the report form.",
        ],
        warning: "A skipped stop's riders aren't counted as boarded, so they aren't asked about at the end.",
      },
      {
        title: "Put the map away without stopping",
        steps: [
          "Select the <strong>minimize</strong> button. The trip keeps running and families still see the bus. The dashboard shows <strong>Live</strong>, <strong>Open map</strong> and an <strong>End trip</strong> button.",
          "If you close the page or lose signal, open Managira again. Your trip is still running and the map comes back.",
        ],
      },
    ],
    faq: [
      ["The map says Location is off.", "Allow location for Managira in your phone's settings, then open the trip again."],
      ["Do I need to tap at every stop?", "No. When the bus reaches a stop, its boarding card opens. Driving away counts everyone as boarded. See <a href=\"/legal/user-documentation/driver-boarding-and-arrivals\">Boarding and arrivals</a>."],
      ["Why can't I start a trip?", "The bus is out of service, the route is paused, your profile is inactive, or the route isn't assigned to you. The message on screen says which."],
    ],
    related: ["driver-app", "driver-boarding-and-arrivals", "driver-send-a-report", "live-bus-tracking"],
  },
  {
    slug: "driver-boarding-and-arrivals",
    title: "Boarding, riders who aren't coming, and ending the trip",
    topic: "Driver app",
    order: 3,
    summary: "The app counts everyone as boarded when you drive off. Tap only for exceptions, see who isn't coming today, and end the trip with one arrival check.",
    tags: ["boarding", "all boarded", "except", "not coming today", "arrival check", "end trip", "did everyone arrive", "didn't board"],
    who: "Drivers on a trip.",
    intro: "You never stop to take attendance. The app assumes everyone boards and arrives, and you only mark the exceptions.",
    sections: [
      {
        title: "At each stop",
        steps: [
          ["When the bus reaches a stop, a card opens with the stop's name and how many students board. Press <strong>All boarded</strong>, or do nothing: when the bus drives off, everyone counts as boarded.", "driver-boarding.webp", "The boarding card at the first stop."],
          ["If someone didn't board, press <strong>Except</strong>. Everyone starts on <strong>Yes</strong>. Press <strong>No</strong> beside each student who didn't get on, then <strong>Done</strong>. <strong>Back</strong> returns to the card."],
        ],
        note: "Families get a notice that their child boarded, or didn't board, if their class shares the bus with parents. Open the stops list and press <strong>Change</strong> on a covered stop to correct a mistake.",
      },
      {
        title: "Riders who aren't coming today",
        steps: [
          ["When a parent or teacher says a student isn't riding, the stops list shows <strong>Not coming:</strong> and their name under the stop. They're left out of that stop's boarding card and the count."],
          "A family can change their mind until the bus arrives, so the list is checked again every minute and at each stop. The app shows a short message when a student is newly marked as not coming.",
        ],
      },
      {
        title: "End the trip",
        steps: [
          ["At the school, select <strong>End</strong>, then <strong>End trip</strong>. If you pressed <strong>End</strong> by mistake, press <strong>Keep driving</strong>."],
          ["The app asks <strong>Did everyone arrive?</strong> with the number of students on board. Press <strong>Yes</strong> to end the trip. Everyone on board is marked arrived in the same tap."],
          ["If someone didn't, press <strong>No</strong>. Press <strong>No</strong> beside each student, and choose a <strong>Reason</strong>: <em>Absent today</em>, <em>Picked up by parent</em>, <em>Got off elsewhere</em>, <em>Missed the bus</em> or <em>Other</em>. Then select <strong>End trip</strong>.", "driver-arrival-no-zoom.webp", "Who didn't arrive, with a reason."],
        ],
        list: [
          "Only students who boarded are listed. Riders at a stop you skipped, or never reached, aren't counted as arrived.",
          "If nobody rode, the check offers <strong>No students</strong> to end the trip without it.",
          "A student marked not arrived sends an urgent report to your leads.",
        ],
        tip: "Ending a trip never makes you wait. The screen closes in the same tap, and the last answers are sent in the background and retried until they arrive, even with a weak signal.",
      },
    ],
    faq: [
      ["I forgot to mark someone as not boarded.", "Open the stops list and press <strong>Change</strong> beside the stop. You can fix it until the trip ends."],
      ["What if the bus never reaches a stop?", "Press <strong>Skip</strong> in the stops list. Those riders aren't counted as boarded or arrived."],
      ["Does the school ask parents to confirm arrival?", "If the school turned on <strong>Parents confirm arrival</strong>, parents are asked after your arrival check, and a not-arrived goes to your leads."],
    ],
    related: ["driver-run-a-trip", "driver-send-a-report", "transportation-reports", "driver-app"],
  },
  {
    slug: "driver-send-a-report",
    title: "Send a report to your lead",
    topic: "Driver app",
    order: 4,
    summary: "Tell your lead drivers about a student, bus or road problem. Reports stay private until a lead shares them.",
    tags: ["driver report", "report a problem", "behavior", "breakdown", "road closed", "urgent", "incident"],
    who: "Drivers. Reports go to lead drivers and staff with <strong>Driver Reports</strong>.",
    intro: "Use a report for anything your lead should know: a student's behavior, a bus problem, a closed road.",
    sections: [
      {
        title: "Send a report",
        steps: [
          ["Select <strong>Report</strong> on the dashboard. During a trip, it's also in the stops list."],
          ["Under <strong>What is it about?</strong>, choose a <strong>Type</strong> and then an <strong>Issue</strong>. Select <strong>Add another issue</strong> to report more than one thing."],
          "For a <strong>Student</strong> report, choose the students it is about. Each student gets a report of their own, so a lead can share one family's report without the others.",
          ["Choose a <strong>Priority</strong> (<strong>Normal</strong> or <strong>Urgent</strong>) and write the <strong>Details</strong>. Select <strong>Send</strong>. The sheet says <em>Sent to your lead.</em>", "driver-report-send-zoom.webp", "Priority, Details and Send."],
        ],
        table: [
          ["Type", "Issues"],
          ["Student", "Fighting, Bullying, Sick or injured, Bad behavior, Not at the stop, Late to the stop, Left something on the bus, Other"],
          ["Bus", "Breakdown, Accident, Flat tire, Low fuel, Needs service, Heating or AC, Door or seat problem, Other"],
          ["Route or road", "Road closed, Heavy traffic, Unsafe stop, Wrong address, Bad weather, Other"],
          ["Complaint", "From a parent, From a student, From staff, About another driver, Other"],
          ["Other", "Other"],
        ],
        note: "<strong>Other</strong> needs details. Details can be up to 2,000 characters.",
      },
      {
        title: "What happens next",
        steps: [
          "Your lead drivers read the report in Management › Transportation › Reports. See <a href=\"/legal/user-documentation/transportation-reports\">Driver reports and transportation reports</a>.",
          "Until a lead shares it, only you and the leads see it. A lead can share a report about a student with that student's parents or teachers.",
        ],
      },
    ],
    faq: [
      ["Can I see my reports afterward?", "The driver screen only sends reports. Your lead reviews them, and a driver who holds <strong>Reports</strong> can list their own in Report Builder."],
      ["Is the report tied to my trip?", "Yes. During a trip, the report records the bus and route. Outside a trip, it records your bus."],
    ],
    related: ["driver-app", "transportation-reports", "lead-driver"],
  },
  {
    slug: "driver-settings-and-forms",
    title: "Driver settings, alerts and Forms",
    topic: "Driver app",
    order: 5,
    summary: "Change your photo and phone, choose how you hear about riders who aren't coming, and fill in the Forms your school made for drivers.",
    tags: ["driver settings", "profile photo", "phone number", "driver alerts", "rider not coming", "driver forms", "notifications"],
    who: "Drivers.",
    intro: "Your settings page is the same as a parent's or student's: appearance, your details and notifications.",
    sections: [
      {
        title: "Open your settings",
        steps: [
          ["Select <strong>≡</strong> and choose <strong>Settings</strong>.", "driver-settings.webp", "Driver settings."],
        ],
      },
      {
        title: "Your details",
        steps: [
          ["Select <strong>Change photo</strong> to add or replace your picture. Families and staff see it on the bus's card."],
          ["Your email is shown but you can't change it here. Update your <strong>Phone</strong> and select <strong>Save</strong>."],
          "<strong>Appearance</strong> at the top of the page changes the look of the app on your phone.",
        ],
      },
      {
        title: "Alerts",
        steps: [
          ["Under <strong>Notifications</strong>, <strong>Bus</strong> has <strong>A rider isn't coming</strong>. Turn on <strong>In Managira</strong> (the bell) or <strong>Email</strong>, then select <strong>Save notifications</strong>.", "driver-alerts-zoom.webp", "The rider alert."],
          "By default you're told in Managira, and nothing is emailed or texted until you ask. A text option shows only if your school has a text provider.",
        ],
      },
      {
        title: "Forms",
        steps: [
          "If your school built a form for drivers in the <a href=\"/legal/user-documentation/custom-editor\">Custom editor</a>, a <strong>Forms</strong> card appears on the dashboard, below the students. A form with its own tile gets a card of its own.",
          "Open a form, choose a student, answer, and save. You only see your own riders.",
        ],
        note: "If you don't see a Forms card, your school hasn't made a form for drivers.",
      },
    ],
    related: ["driver-app", "driver-send-a-report", "notifications-and-alerts", "custom-editor"],
  },
  {
    slug: "lead-driver",
    title: "The lead driver: reports, drivers and Management",
    topic: "Driver app",
    order: 6,
    summary: "A lead driver reads and shares driver reports, adds and manages other drivers, and sees Management in their menu.",
    tags: ["lead driver", "transportation lead", "manage drivers", "driver permissions", "share reports"],
    who: "Drivers given <strong>Lead Driver</strong> on the staff form by a manager.",
    intro: "Your school makes a driver a lead by checking <strong>Lead Driver</strong>. It turns on <strong>Transportation</strong> with <strong>Manage Drivers</strong> and <strong>Driver Reports</strong>, and adds Management to the menu.",
    sections: [
      {
        title: "What changes in the menu",
        steps: [
          ["Your menu now has <strong>Management</strong> between <strong>Calendar</strong> and <strong>Settings</strong>."],
          ["Management has <strong>Users / Employees</strong> and <strong>Transportation</strong>. In Transportation, select <strong>≡</strong> to see <strong>Overview</strong>, <strong>Reports</strong> (with a badge for new ones), <strong>Drivers</strong> and <strong>Settings</strong>.", "driver-lead-transport.webp", "Transportation as a lead driver sees it."],
        ],
        list: [
          "<strong>Reports</strong>: read reports from drivers and share them. See <a href=\"/legal/user-documentation/transportation-reports\">Driver reports and transportation reports</a>.",
          "<strong>Drivers</strong>: add drivers and change their bus, route and days. See <a href=\"/legal/user-documentation/transportation-drivers-and-schedules\">Drivers and schedules</a>.",
          "<strong>Overview</strong>: the live map of every bus.",
        ],
      },
      {
        title: "Add and manage other drivers",
        steps: [
          "In <strong>Users / Employees</strong>, add a driver with the role <em>Driver</em>, or edit one. You can only work on drivers.",
          "You can give a driver only permissions you hold yourself. What you can't give stays as it was.",
          "Only a manager can change a manager, and you change your own account only through your own settings.",
        ],
        warning: "A lead sees reports about students. Share a report with a family only when the family should know.",
      },
      {
        title: "Still a driver",
        steps: [
          "Your <strong>Today's trip</strong> dashboard works as before. You can drive, board and end trips like any driver. See <a href=\"/legal/user-documentation/driver-app\">The driver app</a>.",
        ],
      },
    ],
    faq: [
      ["Why don't I see Management?", "A manager needs to check <strong>Lead Driver</strong> for you. The change shows after you reload."],
      ["Can I make another lead driver?", "Only if you hold the permission yourself. Ask a manager to promote drivers."],
    ],
    related: ["driver-app", "transportation-reports", "transportation-drivers-and-schedules", "roles-and-permissions"],
  },
];
