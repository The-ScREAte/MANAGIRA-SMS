"use strict";

// Districts & hubs: running many schools together.
module.exports = [
  {
    slug: "school-districts-education-hubs",
    title: "Districts and hubs: run many schools together",
    topic: "Districts & hubs",
    order: 1,
    summary: "A hub lets a district or network oversee its schools in one place: invite schools, see reports across them and manage billing centrally.",
    tags: ["school district", "hub", "multi-school", "network", "campuses", "district oversight", "central billing"],
    featured: true,
    who: "District and network leaders with a hub account. Each school keeps its own managers and records.",
    intro: "A hub sits above your schools. District leaders sign in to the hub to see every member school; each school still runs day to day in its own Managira, with its own staff, students and families.",
    sections: [
      {
        title: "Your hub dashboard",
        list: [
          "<strong>Schools</strong>: every member school, with a <strong>View</strong> link to its details.",
          "<strong>Needs your attention</strong>: invitations waiting, schools asking to leave, and anything else to decide.",
          "<strong>Reports</strong>: reports across your schools.",
          "<strong>Recent activity</strong> across the hub.",
        ],
      },
      {
        title: "Invite a school",
        steps: [
          "On the hub dashboard, select <strong>Invite a school</strong>.",
          "Enter the school's details and its manager's email. A school already on Managira can join with its existing account.",
          "The school's manager accepts the invitation. The school then appears under <strong>Schools</strong>.",
        ],
        note: "Invitations waiting for an answer are listed under <strong>Invitations</strong>, where you can cancel one.",
      },
      {
        title: "Plans and billing",
        text: "A hub can choose the plan each member school uses and pay for its schools centrally in <strong>Billing</strong>, so schools don't each manage a subscription.",
      },
      {
        title: "When a school wants to leave",
        text: "A school asks to leave from its own settings. The request appears under <strong>Leave requests</strong> for the hub to approve or reject. The school keeps all its records either way.",
      },
    ],
    faq: [
      ["Can district staff see student records?", "Hub leaders see what the hub is set up to oversee, such as reports across schools. Day-to-day records stay with each school and its own permissions."],
      ["How do hub users sign in?", "On the same Managira sign-in page. Once their password is confirmed, they go to the hub."],
    ],
    related: ["sign-in-to-managira", "report-builder", "roles-and-permissions"],
  },
];
