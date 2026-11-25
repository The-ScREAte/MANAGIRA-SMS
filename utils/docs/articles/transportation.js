"use strict";

// Transportation: setting up buses, routes, drivers and riders, bus requests, live tracking, reports.
// Pictures are taken by ~/.managira-local-copy/tools/docshots/scripts/transport-*.js (school 63).
module.exports = [
  {
    slug: "set-up-transportation",
    title: "Set up transportation: turn it on and add buses",
    topic: "Transportation",
    order: 1,
    summary: "Turn on Transportation, find your way around its page, and add your buses. Routes, drivers and riders each have their own guide.",
    tags: ["transportation", "school bus", "buses", "add a bus", "bus out of service", "maintenance", "fleet", "student transportation"],
    featured: true,
    who: "Managers, and staff given <strong>Transportation</strong> in the staff form. Each part has its own permission: <strong>Buses</strong>, <strong>Manage Drivers</strong>, <strong>Routes &amp; Stops</strong>, <strong>Schedules</strong>, <strong>Rider List</strong>, <strong>Student Stops &amp; Routes</strong>, <strong>Driver Reports</strong> and <strong>Transportation Settings</strong>.",
    intro: "Transportation covers your buses from the morning pickup to the afternoon drop-off: who drives which bus, the route and its stops, which students ride, and live tracking for families. Set it up in this order: buses, routes and stops, drivers and schedules, riders.",
    sections: [
      {
        title: "Turn Transportation on",
        steps: [
          "Go to <strong>Management › Integrations</strong> and turn on <strong>Transportation</strong>. See <a href=\"/legal/user-documentation/integrations\">Integrations</a>.",
          "Until it is on, Transportation has no page, and drivers see a note on their dashboard that transportation is turned off. Everything you saved stays, and comes back when you switch it on again.",
        ],
      },
      {
        title: "Find Transportation",
        steps: [
          ["Go to <strong>Management › Transportation</strong>.", "transport-overview.webp", "Management, Transportation: the overview with the school's buses on the map."],
          ["The row of tiles counts your <strong>Buses</strong>, <strong>Drivers</strong>, <strong>Routes</strong>, <strong>Stops</strong>, <strong>Students riding</strong>, <strong>New requests</strong>, <strong>New reports</strong> and <strong>Trips today</strong>. Select a tile to open its tab."],
          ["Select <strong>≡</strong> at the top right of the panel to switch tabs: <strong>Overview</strong>, <strong>Requests</strong>, <strong>Reports</strong>, <strong>Buses</strong>, <strong>Drivers</strong>, <strong>Schedule</strong>, <strong>Students</strong> and <strong>Settings</strong>. You only see the tabs your permissions allow."],
          ["The buttons <strong>Add driver</strong>, <strong>Add bus</strong>, <strong>Add route</strong> and <strong>Add stop</strong> are on every visit to the overview."],
        ],
        list: [
          "<strong>Overview</strong>: the live map of every route, with a route filter, and a green chip when a bus is on the road.",
          "<strong>Requests</strong> and <strong>Reports</strong>: what families and drivers sent you. See <a href=\"/legal/user-documentation/transportation-bus-requests\">Bus requests</a> and <a href=\"/legal/user-documentation/transportation-reports\">Driver reports and transportation reports</a>.",
          "<strong>Buses</strong>: buses, routes and stops.",
          "<strong>Drivers</strong> and <strong>Schedule</strong>: <a href=\"/legal/user-documentation/transportation-drivers-and-schedules\">Drivers and schedules</a>.",
          "<strong>Students</strong>: <a href=\"/legal/user-documentation/transportation-riders\">Riders</a>.",
          "<strong>Settings</strong>: <a href=\"/legal/user-documentation/transportation-settings\">Transportation settings</a>.",
        ],
      },
      {
        title: "Add a bus",
        steps: [
          ["Open the <strong>Buses</strong> tab. <strong>Buses</strong> lists each bus with its status, driver, license plate and seats.", "transport-buses.webp", "The Buses tab with the school's three buses."],
          ["Select <strong>+ Add Bus</strong>."],
          ["Type the <strong>Bus Number</strong> (required), and if you like a <strong>Bus Name</strong>, <strong>Vehicle Registration / License Plate</strong> and <strong>Capacity</strong>.", "transport-add-bus-zoom.webp", "The Add Bus window."],
          "Under <strong>Vehicle Details</strong> you can add the make, model, year, color, VIN, fuel type and odometer.",
          "Select <strong>Save Bus</strong>. To change a bus later, select <strong>Edit</strong> beside it. <strong>Delete bus</strong> is at the bottom of the Edit window.",
        ],
        tip: "You don't choose a bus's driver here. A bus gets its driver from the <strong>Drivers</strong> tab.",
      },
      {
        title: "Take a bus out of service",
        steps: [
          ["Select <strong>Edit</strong> beside the bus and change <strong>Status</strong>."],
          "<strong>Active</strong> and <strong>In Service</strong> are normal. <strong>Maintenance</strong> and <strong>Out of Service</strong> stop its driver from starting a trip: the driver's app says the bus is not in service and to ask the transportation lead.",
          "Select <strong>Save Changes</strong>. Change the status back to <strong>Active</strong> when the bus returns. While a trip is running the bus shows as <em>on trip</em>, and goes back to what it was when the trip ends.",
        ],
      },
    ],
    faq: [
      ["Why can't I see Transportation in Management?", "Either the school hasn't turned on <strong>Transportation</strong> in Integrations, or you don't hold the <strong>Transportation</strong> permission. Ask a manager."],
      ["Can a driver start a trip on a bus that isn't theirs?", "No. Only the bus's assigned driver can start a trip on it."],
    ],
    related: ["transportation-routes-and-stops", "transportation-drivers-and-schedules", "transportation-riders", "driver-app", "integrations"],
  },
  {
    slug: "transportation-routes-and-stops",
    title: "Add routes and stops, and pause a route",
    topic: "Transportation",
    order: 2,
    summary: "Create a route, add its stops in order, show it on the map, and pause it when it isn't running.",
    tags: ["routes", "bus stops", "stop order", "import stops", "pause a route", "route map", "school destination"],
    who: "Managers, and staff with <strong>Transportation</strong> and <strong>Routes &amp; Stops</strong>.",
    intro: "A route is a list of stops in order that ends at the school. Families and drivers follow the real roads between the stops.",
    sections: [
      {
        title: "Add a stop",
        steps: [
          ["Open <strong>Management › Transportation</strong>, then the <strong>Buses</strong> tab. Select <strong>+ Add Stop</strong> (or <strong>Add stop</strong> on the overview).", "transport-buses.webp", "The Buses tab, where routes and stops live."],
          ["Type the <strong>Stop Name</strong> and <strong>Stop Address</strong>. Choose a <strong>Route</strong> now, or leave <strong>No route yet — attach later</strong>.", "transport-add-stop-zoom.webp", "The Add Stop window."],
          "Set the stop's place on the map: type the <strong>Latitude</strong> and <strong>Longitude</strong>, or click the map to drop the pin.",
          "Add the <strong>Pickup Time</strong>, <strong>Dropoff Time</strong> and <strong>Stop Order</strong> (1 is the first stop), then select <strong>Save Stop</strong>.",
        ],
        note: "A stop without a place on the map still saves, but families can't see it on a map, and the overview says how many stops are not on the map.",
      },
      {
        title: "Import many stops at once",
        steps: [
          ["Open the <strong>Stops</strong> card on the Buses tab and select <strong>+ Import City Stops</strong>."],
          "Choose the <strong>Route</strong>, type the <strong>City</strong> and the <strong>Max Stops</strong>, then select <strong>Import Stops</strong>. Managira pulls bus stop candidates from map data. Check them and edit or delete the ones you don't need.",
        ],
      },
      {
        title: "Add a route",
        steps: [
          "On the Buses tab, select <strong>+ Add Route</strong>.",
          "Type the <strong>Route Name</strong> (for example <em>Route 1 - Sugar House</em>) and a short <strong>Route Code</strong>.",
          "Leave <strong>Use School Destination</strong> checked so the route ends at your school. Uncheck it to type a different <strong>Destination Address</strong>.",
          "Under <strong>Stops on this Route</strong>, check the stops that belong to it. Then select <strong>Save Route</strong>.",
        ],
        tip: "Changing the school's address in <strong>Settings › School location</strong> moves every school-linked route's destination. See <a href=\"/legal/user-documentation/transportation-settings\">Transportation settings</a>.",
      },
      {
        title: "Check a route",
        steps: [
          ["Open the <strong>Routes</strong> card and select a route's name. It opens to its destination, its stops in order, and its bus, driver and weekly days.", "transport-routes.webp", "A route opened on the Buses tab."],
          ["Select <strong>Show on map</strong> to see the route's road through its stops."],
          ["Select <strong>Edit</strong> to change the name, code, stops or destination."],
        ],
      },
      {
        title: "Pause a route",
        steps: [
          ["Select <strong>Edit</strong> on the route and set <strong>Status</strong> to <strong>inactive</strong>."],
          "Select <strong>Save Changes</strong>. A driver can't start a trip on a paused route: the app says the route is paused. Set it back to <strong>active</strong> to run it again.",
        ],
        note: "<strong>Delete route</strong> removes only the route. Its stops stay in the stop list, so you can attach them to another route.",
      },
    ],
    faq: [
      ["How do I change the order of the stops?", "Edit each stop and change its <strong>Stop Order</strong>. Stops are served in that order, and families' arrival times follow it."],
      ["Why are my stops missing from the map?", "They have no latitude and longitude. Edit the stop and click the map to pin it."],
    ],
    related: ["set-up-transportation", "transportation-drivers-and-schedules", "transportation-riders", "live-bus-tracking"],
  },
  {
    slug: "transportation-drivers-and-schedules",
    title: "Add drivers, make a lead driver and set weekly schedules",
    topic: "Transportation",
    order: 3,
    summary: "Add a driver with a bus, a route and weekly days in one form, change single days on the schedule, and give a driver lead permissions.",
    tags: ["drivers", "lead driver", "weekly schedule", "any route", "inactive driver", "bus driver account", "schedule"],
    who: "Managers, and staff with <strong>Transportation</strong> and <strong>Manage Drivers</strong> (drivers) or <strong>Schedules</strong> (the Schedule tab).",
    intro: "Each driver is a staff member with the role <em>Driver</em>. One form gives them a bus, a route and the days they run it.",
    sections: [
      {
        title: "Add a driver",
        steps: [
          ["Open <strong>Management › Transportation</strong>, then the <strong>Drivers</strong> tab. Select <strong>Add driver</strong>.", "transport-drivers.webp", "The Drivers tab."],
          ["Type the driver's <strong>First name</strong>, <strong>Last name</strong> and <strong>Email</strong>. Add a <strong>Phone</strong>, <strong>License number</strong> and photo if you have them."],
          ["Under <strong>Bus, route and weekly days</strong>, choose the <strong>Bus</strong> and <strong>Route</strong>, check the days they run it, and set the <strong>Start time</strong> and <strong>End time</strong>."],
          "Select <strong>Save driver</strong>. A new driver gets an email invitation to set a password. They can only sign in to the driver screen.",
        ],
        note: "If you pick weekly days, you must also pick a bus and a route. If the email already belongs to a driver, that driver is updated. If it belongs to someone with another role, change their role in Users / Employees first.",
      },
      {
        title: "Read the Drivers list",
        steps: [
          ["Each row shows the bus, route, days and times, email and phone, and a badge."],
        ],
        list: [
          "<strong>Ready</strong>: the driver has a bus and a route.",
          "<strong>Needs bus and route</strong>: give them both before they can start a trip.",
          "<strong>Inactive</strong>: the driver can't start trips. Set <strong>Status</strong> back to <strong>Active</strong> in <strong>Edit</strong> to bring them back.",
        ],
      },
      {
        title: "Set or change a schedule",
        steps: [
          ["Open the <strong>Schedule</strong> tab. Schedules are grouped by start time. Select a time to see each bus running then, its driver, route and days.", "transport-schedule.webp", "The Schedule tab, grouped by time."],
          ["Select a day (<strong>Mon</strong>, <strong>Tue</strong> and so on) to change only that day: its bus, driver, route, times, <strong>Status</strong> or notes."],
          "Select <strong>Save Changes</strong>. A day set to <em>inactive</em> shows <em>(off)</em> on the schedule. <strong>Delete All</strong> removes every day for that bus.",
        ],
        tip: "To change all of a driver's days at once, edit the driver on the <strong>Drivers</strong> tab.",
      },
      {
        title: "Give a driver more access",
        steps: [
          "Go to <strong>Management › Users / Employees</strong> and edit the driver. A driver can only hold driver and transportation permissions. See <a href=\"/legal/user-documentation/create-and-manage-employee-accounts-and-permissions\">Create and manage employee accounts and permissions</a>.",
          "Check <strong>Lead Driver</strong> to make them a lead. See <a href=\"/legal/user-documentation/lead-driver\">The lead driver</a>.",
          "Other driver permissions: <strong>Student Details</strong> (riders' home address and parent phone), <strong>Pickup &amp; Emergency</strong> (the details the school shares with drivers), <strong>Reports</strong> (Report Builder for their own trips and riders), <strong>School website</strong> and <strong>Any Route</strong> (drive any route, for example to cover for someone).",
        ],
        warning: "Take care with <strong>Student Details</strong>. It shows riders' home addresses and parents' phone numbers on the driver's phone.",
      },
    ],
    faq: [
      ["A driver can't start a trip. Why?", "Check four things: the bus is <strong>Active</strong> (not Maintenance or Out of Service), the route is <strong>active</strong>, the driver is <strong>Active</strong>, and the route is the driver's own (or they hold <strong>Any Route</strong>)."],
      ["Can one bus have two drivers?", "A bus has one assigned driver at a time. Use the Schedule tab to give different days to different drivers."],
    ],
    related: ["set-up-transportation", "transportation-routes-and-stops", "lead-driver", "driver-app"],
  },
  {
    slug: "transportation-riders",
    title: "Put students on a bus: riders, stops and class access",
    topic: "Transportation",
    order: 4,
    summary: "Give a student a bus, route and stop, check a whole class at once, and see riders on the class page and the student's Transport tab.",
    tags: ["riders", "rider list", "student bus", "bus access", "pickup address", "assign stop", "class transportation", "student transport tab"],
    who: "Managers, and staff with <strong>Rider List</strong> (who rides) or <strong>Student Stops &amp; Routes</strong> (bus, route, stop and pickup details). Teachers see their own class's riders.",
    intro: "A student rides a bus once they have <strong>Bus access</strong>, a bus, a route and a stop. Families then see their child's bus on the live map.",
    sections: [
      {
        title: "Put one student on a bus",
        steps: [
          ["Open <strong>Management › Transportation</strong>, then the <strong>Students</strong> tab. Use <strong>Filters</strong> (<strong>Name</strong>, <strong>Class</strong> and <strong>Bus access</strong>) to find the student.", "transport-students.webp", "The Students tab, filtered to 6th Grade riders."],
          ["Select the student. A panel opens on the right. Turn on <strong>Bus access</strong>, then choose the <strong>Bus</strong>, <strong>Route</strong> and <strong>Stop</strong>.", "transport-student-panel-zoom.webp", "A student's bus details."],
          "Set the <strong>Pickup time</strong> and <strong>Drop-off time</strong> if they differ from the stop's.",
          "Type a <strong>Pickup address</strong> if you want it kept with the student. Check <strong>Address as stop</strong> to add the address as a stop on the route.",
          "Select <strong>Save</strong>. Turning <strong>Bus access</strong> off and saving takes the student off the bus.",
        ],
        note: "Staff with only <strong>Rider List</strong> can add and remove riders. Staff with only <strong>Student Stops &amp; Routes</strong> can change the bus, route and stop of students who already ride.",
      },
      {
        title: "Change a whole class at once",
        steps: [
          ["On the <strong>Students</strong> tab, choose a <strong>Class</strong> in Filters. Select <strong>Edit class access</strong>."],
          ["Check the students who should have bus access, then select <strong>Save</strong>. <strong>Cancel</strong> puts everything back."],
          "Select <strong>Notify guardians</strong> to tell the class's families about a change. This needs permission to message guardians.",
        ],
        note: "This only gives or removes bus access. Choose each student's bus and stop one at a time as above.",
      },
      {
        title: "See riders from the class page",
        steps: [
          ["Teachers and staff open the class and choose <strong>Transportation</strong> in <strong>Class Tools</strong>.", "transport-class-tab.webp", "A class's Transportation tab."],
          ["Riders are grouped by route, in pickup order, under a map of the routes. The top says how many of the class ride (<em>17 of 30 ride</em>). A route shows <strong>Live</strong> while its bus is on the road."],
          "Select a route to see each rider, their stop and pickup time. A teacher can mark a student as not riding today, and sees bus reports a lead has shared with teachers (these need <strong>Class Bus Reports</strong>).",
        ],
        tip: "Students in the class who don't ride are listed under <em>Not on a bus</em>, so you can spot who is missing.",
      },
      {
        title: "See a student's bus on their page",
        steps: [
          ["Open the student's page and choose the <strong>Transport</strong> tab. It shows their <strong>Bus</strong>, <strong>Route</strong>, <strong>Stop</strong> and <strong>Pickup · Drop-off</strong> times. <strong>More details</strong> adds the stop address, distance to the stop and live status."],
          "Select <strong>Track bus</strong> to watch their bus while a trip is running. See <a href=\"/legal/user-documentation/student-page\">The student page</a>.",
        ],
      },
    ],
    faq: [
      ["Why don't I see the Transport tab on a student?", "The student has no bus yet, or you don't hold Transportation permissions or the right to open the student."],
      ["A family can't see the bus for their child.", "The child needs bus access, a route and a stop, and the class must share the bus with parents in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>."],
    ],
    related: ["transportation-bus-requests", "live-bus-tracking", "class-settings", "student-page"],
  },
  {
    slug: "transportation-bus-requests",
    title: "Answer bus requests from families",
    topic: "Transportation",
    order: 5,
    summary: "Parents and school staff ask for a bus for a student. Approve the request to put the student on a route and stop, or decline with a note.",
    tags: ["bus request", "request a bus", "approve", "decline", "new rider", "waiting list"],
    who: "Managers, and staff with <strong>Transportation</strong> and <strong>Rider List</strong>.",
    intro: "A parent asks from the parent portal, and staff of the school can ask for a student too. Each request waits on the <strong>Requests</strong> tab until you answer it.",
    sections: [
      {
        title: "See new requests",
        steps: [
          ["Open <strong>Management › Transportation</strong>, then the <strong>Requests</strong> tab. The badge counts new requests.", "transport-requests.webp", "The Requests tab."],
          ["<strong>New</strong> lists requests waiting for you. <strong>Old</strong> lists the answered ones, with their status: <em>Approved</em>, <em>Declined</em> or <em>Canceled</em> (the family took it back)."],
          "Use the search box to find a request by student, class or route.",
        ],
      },
      {
        title: "Approve a request",
        steps: [
          ["Select a request. The panel shows the class, who asked and when, the address (with <strong>View on map</strong>) and the <strong>Distance to stop</strong>."],
          "Under <strong>Put on a bus</strong>, check the <strong>Route</strong> and <strong>Stop</strong> the family asked for, or choose others. Leave <strong>Bus</strong> on <em>The route's scheduled bus</em>, or pick one.",
          "Add a <strong>Note to the family (optional)</strong>, then select <strong>Approve</strong>. The student now has bus access, on that route and stop.",
        ],
      },
      {
        title: "Decline a request",
        steps: [
          "Open the request, type the reason in <strong>Note to the family (optional)</strong> (for example, that the route is full this term) and select <strong>Decline</strong>.",
        ],
        note: "Only the first person to answer a request counts. If a colleague answered first, you'll see that the request was already answered.",
      },
    ],
    faq: [
      ["Can a family ask twice for the same student?", "No. A student can have only one waiting request, and a student who already has bus access can't ask."],
      ["Where do parents make the request?", "In the parent portal, on their child's page. See <a href=\"/legal/user-documentation/parent-portal\">The parent portal</a>."],
    ],
    related: ["transportation-riders", "parent-portal", "set-up-transportation"],
  },
  {
    slug: "transportation-settings",
    title: "Transportation settings: location, units, arrival checks",
    topic: "Transportation",
    order: 6,
    summary: "Set the school's address for every route, choose miles or kilometers, and decide whether parents confirm their child arrived.",
    tags: ["school location", "units", "miles", "kilometers", "parents confirm arrival", "map settings", "destination"],
    who: "<strong>Transportation Settings</strong> for the cards. <strong>Parents confirm arrival</strong> also needs <strong>Driver Reports</strong>.",
    intro: "These settings apply to every route and bus map.",
    sections: [
      {
        title: "Parents confirm arrival",
        steps: [
          ["Open <strong>Management › Transportation</strong>, then the <strong>Settings</strong> tab. Turn on <strong>Parents confirm arrival</strong>."],
          "After the driver's arrival check, parents confirm in their portal that their child arrived. A <em>not arrived</em> goes straight to <strong>Reports</strong>.",
        ],
      },
      {
        title: "Set the school's location",
        steps: [
          ["Open the <strong>School location</strong> card, type the <strong>School Address</strong> and select <strong>Save School Destination</strong>."],
          "Leave <strong>Apply to all routes now</strong> checked to move every route's destination. Uncheck it to change only routes that already use the school destination.",
        ],
        note: "Managira finds the map location from the address, so you don't type coordinates.",
      },
      {
        title: "Choose units and the map view",
        steps: [
          ["Open <strong>Units</strong> and choose <strong>Kilometers (km, km/h)</strong> or <strong>Miles (mi, mph)</strong>, then select <strong>Save Units</strong>. This changes distances and speeds on drivers' phones and the live maps.", "transport-settings.webp", "The Settings tab with School location and Units open."],
          "Open <strong>Map</strong> to type a city and select <strong>Center City</strong>, or select <strong>Fit Bus Stops</strong> to frame all your stops.",
        ],
      },
    ],
    related: ["set-up-transportation", "transportation-routes-and-stops", "transportation-reports"],
  },
  {
    slug: "live-bus-tracking",
    title: "Live bus tracking for staff, teachers, families and drivers",
    topic: "Transportation",
    order: 7,
    summary: "While a driver is on a trip, staff watch every bus on the Transportation map, teachers see their class's route live, and families follow their own bus.",
    tags: ["bus tracking", "where is the bus", "live bus", "arrival time", "not coming today", "estimated position", "bus map"],
    featured: true,
    who: "Staff with Transportation, teachers, parents, students and drivers. This guide covers the staff view.",
    intro: "A bus appears on the maps when its driver starts a trip, and leaves them when the trip ends. Nobody has to do anything extra.",
    sections: [
      {
        title: "Watch buses on the overview",
        steps: [
          ["Open <strong>Management › Transportation</strong>. When a trip is running, a green chip shows <strong>1 bus live</strong>."],
          ["The bus appears on the map with its number and moves along its route. Select it to see the driver's card."],
          ["Choose a route in the filter to zoom to it.", "transport-live-route-zoom.webp", "Route 1 with its bus."],
        ],
        note: "Staff see buses in real time. The map updates every few seconds, and a bus with no signal for two minutes leaves the map.",
      },
      {
        title: "When the driver's phone goes quiet",
        steps: [
          "If the driver switches to another app (for example, a maps app for directions), the phone can't send its position. After about 45 seconds the map moves the bus along its route at its usual pace, pausing at stops, and marks it as <strong>estimated</strong>.",
          "An estimate is only made for a bus that was on its route. A bus that was off the route stays where it was last seen. An estimate never says the bus passed anyone's stop.",
        ],
      },
      {
        title: "What others see",
        list: [
          "<strong>Teachers</strong>: the class's <strong>Transportation</strong> tab shows <strong>Live</strong> on a route while its bus is running. See <a href=\"/legal/user-documentation/transportation-riders\">Riders</a>.",
          "<strong>Parents</strong>: <strong>Track bus</strong> on their child's page shows the bus along the real road through its stops, in order, and when it will reach their stop. <strong>Not coming today</strong> tells the driver. See <a href=\"/legal/user-documentation/parent-portal\">The parent portal</a>.",
          "<strong>Students</strong>: <strong>Track bus</strong> in the student portal. See <a href=\"/legal/user-documentation/student-portal\">The student portal</a>.",
          "<strong>Drivers</strong>: starting a trip in the driver app shares the bus's position, and ending it stops. See <a href=\"/legal/user-documentation/driver-app\">The driver app</a>.",
        ],
        tip: "A school can switch bus information off for a class's parents or students in <a href=\"/legal/user-documentation/class-settings\">Class settings</a>. Then those families don't see the bus.",
      },
    ],
    faq: [
      ["Why is there no bus on the map?", "No trip is running. The driver starts one from the driver app, and it appears within a few seconds."],
      ["Why do families see an estimate?", "The driver's phone was quiet, usually because the driver switched to a maps app. It goes back to the real position as soon as the phone reports again."],
      ["Why doesn't a parent see Track bus?", "Their child needs a route and stop, and the class must share the bus with parents."],
    ],
    related: ["driver-app", "transportation-riders", "parent-portal", "transportation-reports"],
  },
  {
    slug: "transportation-reports",
    title: "Driver reports, arrival checks and transportation reports",
    topic: "Transportation",
    order: 8,
    summary: "Read what drivers send, choose who else sees it, check each trip's arrivals, and build transportation reports in Report Builder.",
    tags: ["driver reports", "arrival checks", "trips report", "bus incidents", "share with parents", "share with teachers", "transportation reports"],
    who: "Staff with <strong>Transportation</strong> and <strong>Driver Reports</strong> (lead drivers have these), and <strong>Report Builder</strong> for the reports.",
    intro: "A driver's report stays between the driver and the leads until a lead shares it. Only reports about a student can be shared, with that student's parents or teachers.",
    sections: [
      {
        title: "Read driver reports",
        steps: [
          ["Open <strong>Management › Transportation</strong>, then the <strong>Reports</strong> tab. <strong>New</strong> lists reports nobody has reviewed yet, with their type, who it is about, the driver, date and priority (<em>Urgent</em> or <em>Normal</em>).", "transport-reports.webp", "The Reports tab."],
          ["Select a report to read it: its type, issue, driver, student, bus, route and date, and what the driver wrote."],
          "Use the search box to find a report by student, driver or issue.",
        ],
      },
      {
        title: "Share a report",
        steps: [
          "Under <strong>Who else sees this</strong>, check <strong>Parents</strong>, <strong>Teachers</strong> or both. Teachers of the student's class see it only if they hold <strong>Class Bus Reports</strong>.",
          "Add a <strong>Note (shown to whoever you share with)</strong>. Parents and teachers see what happened and your note, never who else was told.",
          "Select <strong>Mark reviewed</strong>. The report moves to <strong>Old</strong>. Parents see shared reports in the parent portal.",
        ],
        note: "Reports not about a student (a bus problem, a closed road) can be reviewed but not shared.",
      },
      {
        title: "Check arrivals",
        steps: [
          ["Open the <strong>Arrivals</strong> tab. Each row is a finished trip with the date, route, driver and how many students <em>arrived</em> out of those on board."],
          "Select a row to see who didn't arrive and why the driver said (for example <em>Picked up by parent</em>). A student who didn't arrive also creates an urgent report.",
        ],
        tip: "Turn on <strong>Parents confirm arrival</strong> in Settings to have parents answer too. See <a href=\"/legal/user-documentation/transportation-settings\">Transportation settings</a>.",
      },
      {
        title: "Transportation reports in Report Builder",
        steps: [
          ["Go to <strong>Reports › Report builder</strong>. Under <strong>Transportation</strong> choose <strong>Riders &amp; requests</strong>, <strong>Trips &amp; reports</strong> or <strong>Buses, drivers &amp; routes</strong>.", "transport-report-builder.webp", "The Transportation group in Report Builder."],
          "Pick the view you want: <strong>Riders</strong>, <strong>Bus requests</strong>, <strong>Trips</strong>, <strong>Arrival checks</strong>, <strong>Driver reports</strong>, <strong>Buses</strong>, <strong>Drivers</strong> or <strong>Routes</strong>. Then choose columns, criteria, run, save and export like any report. See <a href=\"/legal/user-documentation/report-builder\">Report Builder</a>.",
        ],
        example: "<strong>Trips</strong> filtered to last month and one route lists every run of that route, ready to export for your transportation director.",
        note: "A driver who holds <strong>Reports</strong> sees only their own trips and riders. Staff with a transportation permission see everyone's.",
      },
    ],
    faq: [
      ["Can a parent see a report about their child?", "Only after a lead checks <strong>Parents</strong> and marks it reviewed."],
      ["Who sees a driver's report before it's reviewed?", "The driver who wrote it and the leads, nobody else."],
    ],
    related: ["transportation-bus-requests", "lead-driver", "report-builder", "set-up-transportation"],
  },
];
