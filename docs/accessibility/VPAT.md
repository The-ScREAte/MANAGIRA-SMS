# Voluntary Product Accessibility Template (VPAT) 2.5, WCAG edition

**Draft prepared from our own testing. It has not been reviewed by an outside accessibility auditor.**

| | |
|---|---|
| **Name of product / version** | Managira student information system, web application (the version running in November 2026) |
| **Report date** | November 24, 2026 |
| **Product description** | Browser-based school management system for K-12 schools and districts: sign-in, student records, attendance, gradebook, assessments and online tests, report cards, calendar, messaging, PayGira billing, the school website and online admission form, and portals for parents and guardians, students and drivers. |
| **Contact information** | [accessibility contact email, to be set before publishing] |
| **Notes** | Managira is operated by ScREAte. Schools add their own content (names, photos, uploaded files, school colors, website text); the product cannot guarantee the accessibility of that content. |
| **Evaluation methods used** | See "How we tested" below. |

**Applicable standard:** Web Content Accessibility Guidelines 2.1, Levels A and AA. This is the
WCAG edition only; Revised Section 508 and EN 301 549 tables are not included (their web chapters
point to the same WCAG criteria below).

**Terms** (from the VPAT): *Supports*: the functionality has at least one method that meets the
criterion without known defects, or meets it with equivalent facilitation. *Partially Supports*:
some functionality does not meet the criterion. *Does Not Support*: the majority of functionality
does not meet the criterion. *Not Applicable*: the criterion is not relevant to the product.
*Not Evaluated*: not tested.

## How we tested

1. **Automated.** axe-core 4.x with the rule sets `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, run
   inside a real browser (Chromium) on every kind of sign-in: public pages (sign-in, forgot
   password, admission form, school website, legal and help pages, plans), a school manager, a
   teacher, a student, a parent or guardian, and a driver. About 40 to 55 pages per role were
   covered: the home page of each role plus the pages linked from it, and by name the class
   dashboard, attendance, gradebook, online test and results pages, settings, PayGira, mailroom,
   custom forms and calendar. Results are in the table below.
2. **Keyboard, by hand.** With the keyboard only: skip link, header menu and notification panel
   (open, Escape, focus returns), taking attendance (Edit, tick boxes, Save), class workspace tabs,
   login fields, the session warning dialog, and a timed online test taken start to finish by a
   student with the keyboard only (a short test was created for this and removed afterwards),
   then opened by a parent with the keyboard.
3. **Reflow and zoom.** 26 pages (12 manager, 4 student, 4 parent, 6 public, including sign-in
   and the admission form) were loaded at 320 CSS pixels wide: no sideways scrolling on any of them. Zooming the page is no longer blocked.
4. **Structure checks.** Duplicate ids, `lang`, one main landmark, heading levels, and the text spacing override on six pages.
5. **Contrast in all three looks.** Text contrast (axe) and the edge of every text field and
   off-switch (measured: border or fill against the page behind it) were checked in Light,
   Classic and Dark on about 20 manager pages and the parent and driver pages.
6. **Not done.** We did not run a full pass with NVDA, JAWS, VoiceOver or TalkBack, did not test with
   speech-recognition software, did not test Windows High Contrast, and did not test the school's
   own color choices. Automated tools find roughly a third of WCAG problems, so a clean axe
   result is not a claim of full conformance.

### Automated results (axe violations, nodes found across the pages tested)

Before and after the fixes made in this pass. "Serious or critical" are the impact levels axe
calls blocking or serious.

| Kind of sign-in | Pages scanned (before / after) | Violations before (critical / serious / moderate) | Violations after |
|---|---|---|---|
| Public (sign-in, forgot password, admission form, plans, legal, help) | 45 / 44 | 86 (35 / 28 / 23) | 0 |
| School manager | 53 / 37 | 467 (362 / 52 / 53) | 0 |
| Teacher | 49 / 45 | 399 (307 / 55 / 37) | 0 |
| Student | 47 / 45 | 31 (0 / 5 / 26) | 0 |
| Parent or guardian | 42 / 42 | 37 (0 / 5 / 32) | 0 |
| Driver | 45 / 45 | 35 (1 / 14 / 20) | 0 |

The online admission form (switched on in the school settings for the test, then off again) was scanned by hand in its welcome and first steps after the main run; it had 4 contrast failures, now fixed, and 0 afterwards.

(Pages counts differ between before and after because the pages were found by following links, and
a few JSON responses that are not pages were left out.)

Before, by rule (nodes, all roles): form fields without a name 538 (`label`); pinch-zoom blocked
191 (`meta-viewport`); buttons without a name 120 (`button-name`, mostly the chat button on every
page); label not in name 89; low contrast 41; invalid ARIA attributes 39 (calendar); links in text
identified by color only 6; unnamed images 6; missing page language or title 7 each (an error page);
tab list problems 7; scrollable boxes the keyboard could not reach 2; one unnamed select; one
hidden drawer holding focusable controls. After: none of these remain on the pages tested.

What the fixes were is listed in the last section.

## Table 1: WCAG 2.1 Level A

| Criteria | Conformance level | Remarks and explanations |
|---|---|---|
| **1.1.1 Non-text Content** | Partially Supports | Icons that act as buttons now have names (the chat button, "more actions", close, calendar arrows). Product images have text alternatives and decorative icons are hidden from assistive technology (axe `image-alt`, `button-name`, `role-img-alt`, `input-image-alt`: no failures on the tested pages). Photos, logos and advertisements that a school uploads have only the alternative text the school types, and some have none. |
| **1.2.1 Audio-only and Video-only (Prerecorded)** | Partially Supports | The product plays no audio of its own. The videos a school can upload (website slideshow) and the sign-in ads are played muted, so there is no speech to caption; the slideshow's caption text next to each video is its text alternative, but the alternative is optional and not every school fills it in. There is no field for a transcript. |
| **1.2.2 Captions (Prerecorded)** | Partially Supports | Not supported for uploaded videos with sound. Adding a captions file (.vtt) to an uploaded video would need a new stored file per video, a migration and changes to every place a video is shown (website slideshow, sign-in ads, lesson files); we did not build it in this pass. Videos the school website and sign-in panel play are muted. A school that embeds captioned video from elsewhere keeps its captions. |
| **1.2.3 Audio Description or Media Alternative (Prerecorded)** | Partially Supports | Same as 1.2.1 and 1.2.2. |
| **1.3.1 Info and Relationships** | Partially Supports | Pages use landmarks (header, one main, footer), headings, real lists, tables with header cells, and labels tied to fields. Fields, selects and the score boxes in the attendance sheet and gradebook were given names naming the student and the item. Rows and cards that open something are exposed as buttons. Some older forms still pair a visual label with its field only by position; the page-wide axe `label` rule finds none on the tested pages. Heading levels skip on some settings pages. |
| **1.3.2 Meaningful Sequence** | Supports | The reading order follows the visual order on the pages tested; the keyboard order matched it in the tests. |
| **1.3.3 Sensory Characteristics** | Supports | Instructions name controls by their label, not by shape, color or position. Not every page was read for this. |
| **1.4.1 Use of Color** | Partially Supports | Links inside sentences are now underlined. Status chips (paid, overdue, present, absent) carry words. A few charts and the calendar layers use color as the main cue. |
| **1.4.2 Audio Control** | Supports | Nothing plays sound by itself. Videos are muted. |
| **2.1.1 Keyboard** | Partially Supports | Every page tested can be used with the keyboard. Fixed in this pass: the header menu button (a `div` that ignored Enter and Space), the Edit / Cancel controls in the attendance sheet, and cards or rows that opened a panel on click only (now focusable and pressed with Enter or Space). Done end to end with the keyboard only: a student starts a timed test, answers with the arrow keys, opens and cancels the submit question with Escape (focus returns to the Submit button), submits; then a parent reaches the result in the Documents list with Tab and opens it with Enter. Dragging has keyboard alternatives in the menu arranger, report designer and custom form editor (Alt + arrows, move buttons). The report card designer's canvas and the calendar's drag to move or resize an event have no full keyboard equivalent (an event can be edited in its own form). |
| **2.1.2 No Keyboard Trap** | Supports | No trap found. Dialogs that declare themselves modal keep Tab inside and close with Escape or their close button. |
| **2.1.4 Character Key Shortcuts** | Supports | No single-character shortcuts. |
| **2.2.1 Timing Adjustable** | Supports | A pop-up dialog opens under the header 2 minutes before a quiet sign-in ends: "Stay signed in" (extends it with a small request that counts as activity) or "Sign out"; the countdown is shown and the warning is announced. Escape means stay signed in. The school's own sign-in time limit (for example 24 hours) cannot be extended by activity; for that case the dialog says when the sign-in ends so the person can save their work. Teacher-set time limits on online tests are essential to the test; the student sees the clock and a screen reader is told when 5 minutes and 1 minute remain. Tested with a staff account: the dialog appeared, took focus, Tab stayed inside it, Enter on "Stay signed in" extended the sign-in. |
| **2.2.2 Pause, Stop, Hide** | Supports | The sign-in ad rotator has a Pause button and starts paused when the device asks for reduced motion; the school website slider has a pause button and also pauses on hover and focus. No other content on the pages tested moves for more than 5 seconds; the marketing home page was not checked for this. Loading spinners are brief. |
| **2.3.1 Three Flashes or Below Threshold** | Supports | Nothing flashes. The completion confetti is brief and skipped when the device asks for reduced motion. |
| **2.4.1 Bypass Blocks** | Supports | A "Skip to main content" link is the first stop on signed-in pages, and public pages already had "Skip to content". The page moves focus to the new page after a navigation inside the app. |
| **2.4.2 Page Titled** | Supports | Every page has a title; a change of page inside the app updates the title and announces it. |
| **2.4.3 Focus Order** | Supports | Order follows the page. A panel that opens from a click takes the keyboard into itself and gives it back when it closes. |
| **2.4.4 Link Purpose (In Context)** | Supports | Link text or its label says where it goes in the pages reviewed; not every page was read for this. |
| **2.5.1 Pointer Gestures** | Supports | The maps have zoom in / zoom out buttons. Drag to move or resize a calendar event is a path gesture; the event can be edited in its form instead. |
| **2.5.2 Pointer Cancellation** | Supports | Actions run on click, not on pointer down. |
| **2.5.3 Label in Name** | Supports | The axe `label-content-name-mismatch` rule has no failures after the fixes (the notification bell, teacher count, reply buttons and calendar cells were corrected). |
| **2.5.4 Motion Actuation** | Not Applicable | Nothing is operated by shaking or tilting the device. |
| **3.1.1 Language of Page** | Supports | `lang="en"` on every page of the application. |
| **3.2.1 On Focus** | Supports | Focus does not change the context. |
| **3.2.2 On Input** | Supports | The one selector that reloaded the page when its value changed (the academic period on a student's page in the parent portal) now has a "Show" button. Other selects wait for a button or only refine the view. |
| **3.3.1 Error Identification** | Supports | Server errors and "could not save" messages are text and announced (role alert / status). Fields the browser rejects (required, wrong format) now get a short text message beside them ("Email Address is required."), `aria-invalid="true"` and `aria-describedby`, and the message goes away when the entry is fixed (shared helper in public/js/a11y.js, also usable by pages as `a11yFieldError`). The custom form filler and the form-validation script set the same attributes. Tested on the forgot-password form. A few older long forms mark errors only by red border until sent; the helper adds the words when it sees the error class. |
| **3.3.2 Labels or Instructions** | Supports | Fields have an accessible name (visible label, or a name added in this pass where only a placeholder or position was used). Required fields are marked in the forms tested. |
| **4.1.1 Parsing** | Supports | No duplicate ids on the 26 pages checked, and no parsing failures reported by axe. (This criterion is removed in WCAG 2.2.) |
| **4.1.2 Name, Role, Value** | Partially Supports | Switches are native checkboxes with `role="switch"`, or buttons with `aria-checked`; menus and panels report `aria-expanded`; dialogs have a role and a name; the class workspace tabs expose which one is current. Third-party pieces (the calendar library) needed corrections that are applied after they draw. Custom widgets in rarely used screens have not all been reviewed. |

## Table 2: WCAG 2.1 Level AA

| Criteria | Conformance level | Remarks and explanations |
|---|---|---|
| **1.2.4 Captions (Live)** | Not Applicable | No live audio or video. |
| **1.2.5 Audio Description (Prerecorded)** | Partially Supports | Same as 1.2.1: videos uploaded by a school have no description track. |
| **1.3.4 Orientation** | Supports | No orientation lock. |
| **1.3.5 Identify Input Purpose** | Supports | Sign-in and password fields use `autocomplete` (`username`, `current-password`, `new-password`, `one-time-code`). On the pages where a person enters their own details (parent and student settings, driver settings, staff profile, school sign-up, the guardian part of the admission form, password reset) name, email, phone, address and password fields are given their standard tokens. Checked: parent settings, staff profile, the admission form. Fields about a student, an employee or the school are left alone on purpose. The sign-up page was not reachable without choosing a plan, so its attributes were not checked in the browser. |
| **1.4.3 Contrast (Minimum)** | Supports | After fixing grey text (price, helper notes, empty-state messages, the appearance picker's small print, calendar days of other months, badges, off sections in the Management menu), axe reports no contrast failure on the pages tested, and we measured text contrast again in each of the three looks (Light, Classic, Dark) on about 20 pages for the manager and on the parent and driver pages: no failures. The student portal is always Light. The school's own colors for headers and buttons, and text over photos, are not measured: a school that picks a pale brand color can fail this. |
| **1.4.4 Resize Text** | Supports | The viewport no longer blocks zoom (`maximum-scale=1` and `user-scalable=no` removed everywhere, including the driver screens). Pages reflow at 200% zoom in the tested pages. On a phone, text fields are kept at 16 px so the browser does not zoom them. |
| **1.4.5 Images of Text** | Partially Supports | The interface uses real text. PDF advertisements on the sign-in page are drawn as pictures; logos and school-supplied images may contain text. |
| **1.4.10 Reflow** | Supports | No sideways scrolling at 320 CSS pixels on the 26 pages checked; wide tables scroll inside their own box, which can take the keyboard. |
| **1.4.11 Non-text Contrast** | Supports | The edge of text fields, selects and text areas is now a mid grey (#8a8a8a in Light and Classic, a lighter grey in Dark): measured 3:1 or more against the page in all three looks on every field of the pages tested (about 250 fields on 16 manager pages, plus parent, driver, student and sign-in pages), set in public/js/appearance.js and a fallback in public/css/a11y.css. The OFF track of every on/off switch is a steel blue-grey (#7890b2): 3.2 to 3.5 on white and Classic, 4.8 on Dark; same 26 by 15 size. The focus ring (2 px blue) and the on state also meet 3:1. Error and focus colors keep their own hue. Native check boxes and radio buttons use the browser's own drawing. Buttons carry text, so their fill is not what identifies them. Controls on the school website and in a school's own colors were not measured. |
| **1.4.12 Text Spacing** | Partially Supports | The WCAG spacing override (line height 1.5, letter spacing 0.12 em, word spacing 0.16 em, paragraph spacing 2 em) was applied to six manager pages (dashboard, management, settings, calendar, mailroom, class dashboard): no text became clipped or hidden that was not already. The attendance sheet, gradebook, report designer and the other roles' pages were not tested this way. |
| **1.4.13 Content on Hover or Focus** | Partially Supports | Panels that appear on hover (the gradebook column details, teacher list) also appear on keyboard focus; whether each one can be dismissed with Escape was not checked. Native `title` tooltips on icon buttons are the browser's own and cannot be dismissed with Escape in every browser. |
| **2.4.5 Multiple Ways** | Supports | The header menus, a search that finds pages, and links on each dashboard. |
| **2.4.6 Headings and Labels** | Supports | Every page has exactly one level-1 heading and no skipped levels: where a page had none, a visually hidden `h1` with the page title is added; levels are corrected with `aria-level`, so no heading looks different. Checked on 40 pages across all roles: all pass (headings inside closed side panels are hidden from assistive technology and not counted). Labels describe their field. |
| **2.4.7 Focus Visible** | Supports | One focus ring (2 px blue, light blue on the Dark look) applies to links, buttons, tabs, switches and menu items on every page that loads the shared styles, even where a page's own style removed the browser ring. Fields keep a highlighted border. |
| **3.1.2 Language of Parts** | Partially Supports | The product is English only. Text a school types in another language is not tagged. |
| **3.2.3 Consistent Navigation** | Supports | The header and menus keep their order from page to page for each kind of user. |
| **3.2.4 Consistent Identification** | Supports | The same actions carry the same names across the product. |
| **3.3.3 Error Suggestion** | Partially Supports | The messages say what is wrong ("is required", or the browser's own text for a wrong format, such as the missing @ in an email); some server messages only say that saving failed. |
| **3.3.4 Error Prevention (Legal, Financial, Data)** | Supports | Deleting records, closing a school year, graduation, billing changes and payments ask for confirmation first and can be reviewed before they are final; grades can be corrected. |
| **4.1.3 Status Messages** | Supports | Saved and failed messages use `role="status"` or `role="alert"`; the app's alert bar is a live region; a page change announces the new page title; the chat window announces replies. |

## What was changed in this pass

Shared (every page):
- Zoom: removed `maximum-scale` / `user-scalable=no` from the shared viewport (server.js), 50+ page headers and the driver screens (public/js/driverNav.js, public/css/driverNav.css).
- Skip link and landmark target (views/layout.ejs), `.sr-only`, global focus ring, links in text underlined, month-grid contrast (public/css/a11y.css, added to the CSS bundle in utils/cssBundle.js).
- public/js/a11y.js (loaded from views/partials/head.ejs, views/home/partials/top.ejs and the standalone sign-in pages): announces page changes and moves focus after in-app navigation; gives pop-ups (`role="dialog"` and the panels that slide in under the header) focus, a focus trap when modal, Escape to close and focus back to the opener; Escape closes menus; Enter / Space press `div role="button"` and clickable cards or rows; names glyph-only and title-only buttons and unlabeled fields as a safety net; marks toast and snackbar elements as live regions; makes scrollable tables focusable; fixes the calendar library's output; marks a `<main>` nested inside the layout's `<main>` as presentation; sets `inert` on hidden drawers.
- Mira chat window: names for all four buttons and the field, `role="dialog"`, a polite log of messages, Escape closes and returns focus (public/js/chatbot.js).

Page specific:
- Names: attendance checkboxes, gradebook score boxes, class and school-year name fields, term dates, file input for the logo, country-code selects, "more actions" menus.
- Notification bell, teacher count and dashboard reply button: visible text is now part of the name.
- Class workspace tab bar (views/common/classDashboard.ejs): no longer an empty or invalid tab list.
- Online test: the 5 minute and 1 minute warnings are announced (public/js/examRoom.js).
- Sign-in ads: Pause button and reduced-motion start (public/js/loginAds.js).
- Colors: grey notes, empty-state text, plan badges and crossed-out prices, "partial" status, request demo hint.
- 404 fallback page has a language and title.

Second pass (non-text contrast, timeout, errors, headings, input purpose):
- Field borders (3:1 in all three looks): `fieldLine` in public/js/appearance.js, fallback in public/css/a11y.css. Off-switch tracks (#7890b2, same 26 by 15 size): public/css/alertRules.css, classSettings.css, sso.css, adminHubs.css, header.css and the switch styles in the views that carry their own (class settings, weekly briefing, admission settings, document editor, transportation, first setup, Mira, permission picker, account settings).
- Session warning ("Stay signed in" / "Sign out", 2 minutes before the end, under the header): public/js/sessionWatch.js and `POST /account/session-extend` in server.js.
- Academic period selector has a Show button instead of reloading on change (views/guardian/studentAcademicDetails.ejs).
- Field errors: shared helper in public/js/a11y.js (`a11yFieldError`, the browser's own `invalid` event, error classes), also used by public/js/turbo-init.js and public/js/customFormRender.js; styles in public/css/a11y.css.
- Headings: one level 1 per page, no skipped levels, through `aria-level` and a hidden title where a page had no `h1` (public/js/a11y.js).
- Input purpose tokens on the pages that collect a person's own details (public/js/a11y.js).
- Exam room: focus returns to the Submit button when the question is cancelled (public/js/examRoom.js).
- Text contrast in Classic and Dark: the Management menu's off sections, the appearance picker's small print; admission form welcome note and step labels.

## Known gaps and plan

1. Captions: no way to attach a captions file (.vtt) to an uploaded video (needs storage, a migration and a change wherever a video plays). Videos on the school website and the sign-in panel are muted. Not built.
2. The school's own sign-in time limit cannot be extended from the warning (it is a hard limit by design); the warning tells the person when it ends.
3. Hand testing with NVDA + Chrome, VoiceOver + Safari and TalkBack on the five main tasks (sign in, take attendance, enter grades, take a test, read a result).
4. Keyboard alternative for moving and resizing calendar events and for the report card designer's canvas (2.1.1).
5. Contrast of a school's own brand colors; a warning in the school settings when a chosen color is too pale for white text.
6. Some server-rendered errors only say that saving failed (3.3.3).
7. An outside audit before signing a district's accessibility addendum.
