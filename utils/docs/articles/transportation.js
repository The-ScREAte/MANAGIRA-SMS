"use strict";

// Transportation: setting up buses and routes, the driver app, live tracking for families, reports.
module.exports = [
  {
    slug: "set-up-transportation",
    title: "Set up transportation: buses, drivers, routes and stops",
    topic: "Transportation",
    order: 1,
    summary: "Turn on Transportation, add your buses and drivers, draw routes with their stops, set schedules, and assign each student to a route and stop.",
    tags: ["transportation", "school bus", "bus routes", "bus stops", "drivers", "rider list", "student transportation"],
    featured: true,
    who: "Managers, and staff given <strong>Transportation</strong> with the parts they manage: Buses, Manage Drivers, Routes &amp; Stops, Schedules, Rider List, Student Stops &amp; Routes.",
    intro: "Transportation covers your buses from morning pickup to afternoon drop-off: who drives which bus, the route and its stops, which students ride, and live tracking for families. Set it up once; drivers and families use it every day.",
    sections: [
      {
        title: "Turn it on",
        steps: [
          "Open <strong>Management</strong>, <strong>Integrations</strong>, and activate <strong>Transportation</strong>.",
          "Choose your map provider (<strong>Google Maps</strong> or <strong>Maps</strong>) in the same place.",
        ],
      },
      {
        title: "Add buses and drivers",
        steps: [
          ["Open <strong>Transportation</strong> from the menu. <strong>Overview</strong> shows today's runs, new reports and new requests.", "transport-overview.webp", "Transportation, Overview: today's buses, reports and requests."],
          "In <strong>Buses</strong>, select <strong>Add bus</strong>, enter its details, then <strong>Save Bus</strong>.",
          "In <strong>Drivers</strong>, select <strong>Add driver</strong> and choose the staff member (their role is <em>Driver</em>). Mark experienced drivers as <strong>Lead Driver</strong> so they can help manage the others.",
        ],
      },
      {
        title: "Draw routes and stops",
        steps: [
          ["In <strong>Routes</strong>, select <strong>Add route</strong>, name it and choose its bus.", "transport-routes.webp", "Routes: the route's road through its stops, in order."],
          "Add stops in order with <strong>Add stop</strong>, by searching an address or clicking the map. Many stops at once? Use <strong>Import Stops</strong>.",
          "Select <strong>Fit Bus Stops</strong> to see the whole route, then <strong>Save Route</strong>. The route follows the real roads through its stops.",
          "In <strong>Schedules</strong>, set the morning and afternoon times, then <strong>Save Schedule</strong>.",
        ],
      },
      {
        title: "Assign students",
        steps: [
          "Open <strong>Student Stops &amp; Routes</strong> (or the <strong>Rider List</strong>).",
          "Give each rider their route and stop. Families see them in the parent portal.",
          "Use <strong>Edit class access</strong> to choose which classes may use the bus, and whether <strong>Parents confirm arrival</strong>.",
        ],
        tip: "Use <strong>Notify guardians</strong> to tell a route's families about a change, such as a new stop time.",
      },
    ],
    faq: [
      ["Can a driver change routes?", "Drivers drive the routes assigned to them. A driver with <strong>Any Route</strong> can drive any route, for example to cover for someone."],
      ["What does a parent see?", "Their child's route and stop, the live bus on the day's run, and arrival time. See <a href=\"/legal/user-documentation/live-bus-tracking\">Live bus tracking</a>."],
    ],
    related: ["driver-app", "live-bus-tracking", "transportation-reports", "integrations"],
  },
  {
    slug: "driver-app",
    title: "The driver app",
    topic: "Transportation",
    order: 2,
    summary: "Drivers start their run, follow turn-by-turn directions, confirm boarding with one tap, mark arrivals, end the trip and report problems, all from their phone.",
    tags: ["driver app", "bus driver", "boarding", "start trip", "end trip", "turn by turn", "driver reports"],
    who: "Drivers. Their school adds them in Transportation, Drivers.",
    intro: "Drivers sign in on their phone and see today's runs. The app does the counting for them: it assumes everyone boards and arrives, and drivers only tap for exceptions, so nothing slows down the route.",
    sections: [
      {
        title: "Run a trip",
        steps: [
          ["Sign in on your phone and choose today's run.", "driver-app.webp", "The driver app: the route, directions and the next stop."],
          "Start the trip. Families can now see the bus on the map, and directions guide you to each stop.",
          "At each stop, everyone due there is counted as <strong>All boarded</strong> when you drive off. If someone didn't board, tap <strong>Except</strong> and choose who.",
          "At school (or the last stop), select <strong>End trip</strong>. Everyone on board is marked as arrived, in the same tap.",
        ],
        note: "If the signal drops, the app keeps working and sends everything when it can, so ending a trip never makes you wait.",
      },
      {
        title: "Report a problem",
        steps: [
          "Select <strong>Report</strong>, choose the type (for example, a student's behavior or a bus problem) and describe it.",
          "Send. Your lead drivers see it, and decide who else should.",
        ],
      },
      {
        title: "What drivers can see",
        list: [
          "Their own runs, routes, stops and riders.",
          "Riders' pickup and emergency details, if the school gives them <strong>Pickup &amp; Emergency</strong>.",
          "Only the map zooms, so the screen stays steady while driving.",
        ],
        warning: "Drive safely: set up the run before you move, and let the app count boarding for you.",
      },
    ],
    related: ["set-up-transportation", "live-bus-tracking", "transportation-reports", "emergency-and-pickup-details"],
  },
  {
    slug: "live-bus-tracking",
    title: "Live bus tracking for families",
    topic: "Transportation",
    order: 3,
    summary: "Parents and students watch the bus on the map along its real route, see when it will reach their stop, and mark a child as not riding today.",
    tags: ["bus tracking", "where is the bus", "school bus app", "arrival time", "not coming today", "parents"],
    who: "Parents, students and staff, once the school uses Transportation.",
    sections: [
      {
        title: "Track the bus",
        steps: [
          ["In the parent or student portal, select <strong>Track bus</strong>.", "bus-tracker.webp", "Track bus: the bus on its route, and when it will reach your stop."],
          "The map shows the bus moving along the route's real road through its stops, and an arrival time for your stop.",
          "Get a notification when your child boards.",
        ],
        note: "If the driver's phone goes quiet for a while, the map says the bus position is estimated. An estimate is only made while the bus is on its route, and it never says the bus has passed your stop.",
      },
      {
        title: "Not coming today",
        steps: [
          "On your child's card in the parent portal, choose <strong>Not coming today</strong>.",
          "The driver's list updates, so the bus doesn't wait.",
        ],
        tip: "To stop using the bus altogether, send a request from the same card. It goes to the school's transport leads.",
      },
      {
        title: "For teachers",
        text: "A class's <strong>Transportation</strong> tab shows which students ride which bus, with live tracking. Teachers can mark a student as not riding today, and see class bus reports if they have <strong>Class Bus Reports</strong>.",
      },
    ],
    related: ["driver-app", "parent-portal", "set-up-transportation"],
  },
  {
    slug: "transportation-reports",
    title: "Driver reports and transportation reports",
    topic: "Transportation",
    order: 4,
    summary: "Review what drivers report, choose who else sees each report, and build reports on riders, trips, arrivals and requests in Report Builder.",
    tags: ["driver reports", "transportation reports", "bus incidents", "trips", "riders", "arrival checks"],
    who: "Lead drivers and staff given <strong>Driver Reports</strong> or <strong>Report Builder</strong>.",
    sections: [
      {
        title: "Driver reports",
        steps: [
          ["Open <strong>Transportation</strong>. <strong>New reports</strong> shows reports drivers have sent.", "transport-overview.webp", "Transportation, Overview: new reports and requests."],
          "Open a report to read it.",
          "Choose who else sees it. A report about a student can be shared with that student's parents or teachers; teachers also need <strong>Class Bus Reports</strong>.",
        ],
        note: "Until a lead shares it, a driver's report stays between the driver and the leads.",
      },
      {
        title: "Reports in Report Builder",
        text: "In <strong>Reports</strong>, <strong>Report Builder</strong>, choose a transportation report: <strong>Riders</strong>, <strong>Bus requests</strong>, <strong>Trips</strong>, <strong>Arrival checks</strong>, <strong>Driver reports</strong>, <strong>Buses</strong>, <strong>Drivers</strong> or <strong>Routes</strong>. Filter, export or email it like any other report.",
        example: "<strong>Trips</strong> filtered to last month and one route lists every run of that route, ready to export for your transportation director.",
      },
    ],
    related: ["report-builder", "driver-app", "set-up-transportation"],
  },
];
