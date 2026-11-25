"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const phoneCss = read("public", "css", "classroomPhone.css");
const workspaceCss = read("public", "css", "classWorkspace.css");
const dashboard = read("views", "common", "classDashboard.ejs");

// The part of a stylesheet inside its phone media block (the rules this test pins down).
const phoneBlock = phoneCss.slice(phoneCss.indexOf("@media (max-width: 640px)"));

test("the classroom toolbar is one pattern: 40px buttons, 8px gap, wrapping, 13.5px / 600", () => {
  assert.match(phoneBlock, /\.cw-toolbar[^{]*\{[^}]*flex-wrap: wrap;[^}]*gap: 8px;/);
  assert.match(phoneBlock, /height: 40px; min-height: 40px;/);
  assert.match(phoneBlock, /font-size: 13\.5px; font-weight: 600;/);
  assert.match(phoneBlock, /\.cw-toolbar svg[^{]*\{ width: 20px; height: 20px;/);
});

test("long menus are one bottom sheet; short menus drop down under their button; items are 48px", () => {
  const sheet = phoneBlock.slice(phoneBlock.indexOf("Every pop-up menu"));
  for (const name of [".gb-menu", ".gb-sum-pop", ".ws-filters__pop", ".teachers-popover"]) {
    assert.ok(sheet.includes(name), `${name} is a sheet`);
  }
  assert.match(sheet, /position: fixed !important; left: 12px !important; right: 12px !important;/);
  assert.match(sheet, /max-height: min\(70dvh, 460px\) !important; overflow-y: auto; overscroll-behavior: contain;/);
  assert.match(sheet, /min-height: 48px;/);
  assert.match(phoneBlock, /body \.term-view-menu \.term-view-pop \{ position: absolute; top: calc\(100% \+ 6px\); right: 0;/);
});

test("each table scrolls inside its own box with a sticky header and sticky first columns", () => {
  assert.match(phoneBlock, /\.table-container, \.cw-table-wrap \{[^}]*overflow: auto;[^}]*overscroll-behavior: contain;/);
  assert.match(phoneBlock, /thead th[^{]*\{[^}]*position: sticky; top: 0;/);
  assert.match(phoneBlock, /th:first-child[^{]*\{[^}]*left: 0; width: 44px;/);
  assert.match(phoneBlock, /th:nth-child\(2\)[^{]*\{[^}]*left: 44px;[^}]*text-overflow: ellipsis;/);
  assert.match(phoneBlock, /font-variant-numeric: tabular-nums;/);
  assert.match(phoneBlock, /html \{ overflow-x: hidden; \}/);
});

test("the class header on a phone: title first, two 40px buttons, details in a grid, chips scroll", () => {
  const block = workspaceCss.slice(workspaceCss.indexOf("Phone classroom (<= 768px)"));
  assert.match(block, /grid-template-areas: "title info menu" "meta meta meta";/);
  assert.match(block, /\.workspace-meta-toggle, \.term-view-dots \{\s*width: 40px; height: 40px;/);
  assert.match(block, /\.workspace-tabbar \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x proximity;/);
  assert.match(block, /\.workspace-tab-close \{ flex: 0 0 32px; width: 32px;/);
  assert.match(block, /min-height: 48px; height: 48px;/, "Class Tools rows are 48px");
});

test("the class-details button uses the Lucide info icon, with no inline style and a changing label", () => {
  const button = dashboard.slice(dashboard.indexOf('<button type="button" class="workspace-meta-toggle"'));
  const tag = button.slice(0, button.indexOf("</button>"));
  assert.match(tag, /navIcon\('info'/);
  assert.doesNotMatch(tag, /style=/);
  assert.doesNotMatch(tag, /sliders|<line /);
  assert.match(dashboard, /Hide class details/);
  assert.match(dashboard, /Show class details/);
});

test("the classroom pages load the shared phone stylesheet", () => {
  for (const view of ["common/classDashboard.ejs", "common/assessment.ejs", "common/allClassAssessmentExams.ejs", "common/studentDetails.ejs"]) {
    assert.match(read("views", ...view.split("/")), /classroomPhone\.css/, view);
  }
});

test("header pop-ups on a phone are sheets 8px from both edges, scrolling inside when tall", () => {
  const header = read("views", "partials", "header.ejs");
  assert.match(header, /\.notif-panel, \.help-menu-panel \{\s*position: fixed; left: 8px; right: 8px;/);
  assert.doesNotMatch(header, /right: -90px|right: -50px/);
  assert.match(read("public", "css", "header.css"), /is-mobile-collapsible:not\(\.is-expanded\) \.search-bar \{\s*width: var\(--mobile-search-collapsed-width\)/);
});

test("attendance, drawers and the term banner follow the shared phone rules", () => {
  assert.match(phoneBlock, /--att-ctl: 44px/);
  assert.match(phoneBlock, /attendance-sheet td\.student-name \{[^}]*text-overflow: ellipsis/);
  assert.match(phoneBlock, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(phoneBlock, /\.reuse-modal \.row-actions[^{]*\{\s*position: sticky; bottom: 0;/);
  for (const view of ["common/attendanceCollection.ejs", "common/weeklyBriefing.ejs", "account/myPaygira.ejs", "common/documents.ejs"]) {
    assert.match(read("views", ...view.split("/")), /classroomPhone\.css/, view);
  }
  assert.match(workspaceCss, /term-view-banner:not\(\[hidden\]\) \{ display: flex;/);
});

test("Filters is an icon-only 40px button on a phone, with its name kept for screen readers", () => {
  assert.match(phoneBlock, /\.cw-filter-btn\.cw-filter-btn \{[^}]*width: 40px;[^}]*height: 40px;/);
  assert.match(phoneBlock, /\.cw-filter-text[^{]*\{ display: none !important; \}/);
  for (const view of ["partials/gradebookTools.ejs", "common/allClassAssessmentExams.ejs", "common/attendanceCollection.ejs"]) {
    assert.match(read("views", ...view.split("/")), /aria-label="Filters"/, view);
  }
  assert.match(phoneBlock, /\.cw-save-ico \{ width: 18px; height: 18px; \}/);
});

test("the phone gradebook header cell is compact and the lock is an icon, not a pill", () => {
  assert.match(phoneBlock, /th\.gb-col \.assessment-status \{[^}]*width: 32px; height: 32px;/);
  assert.match(phoneBlock, /\.gb-status__txt \{ display: none; \}/);
  assert.match(phoneBlock, /td\.gb-cell input\[type="number"\][^{]*\{[^}]*width: 76px;[^}]*height: 36px;[^}]*font-size: 16px;/);
  assert.match(phoneBlock, /\.header-save-btn \{ gap: 8px; padding: 0 14px; flex: 0 0 auto; min-width: 88px; margin-left: auto; \}/);
  const view = read("views", "common", "assessment.ejs");
  assert.match(view, /navIcon\('unlock'/);
  assert.match(view, /navIcon\('lock'/);
});
