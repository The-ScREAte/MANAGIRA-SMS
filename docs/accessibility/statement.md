# Managira accessibility statement

*Draft for publication. Last reviewed: November 24, 2026.*

Managira, a student information system for K-12 schools and districts operated by ScREAte, is
designed so that staff, students, parents and guardians, and drivers can use it with a keyboard,
a screen reader, magnification and other assistive technology. We aim to meet the Web Content
Accessibility Guidelines (WCAG) 2.1 at Level AA, which is the standard most districts and the
U.S. Department of Education and Department of Justice rules point to.

## Where we are

- We test with automated tools (axe-core, WCAG 2.0 and 2.1 A and AA rules) on the main pages for
  every kind of person who signs in, and by hand with the keyboard on the key tasks: signing in,
  taking attendance, opening and closing side panels and dialogs, and reading results.
- The latest automated pass found no failures on the pages tested after our fixes. Automated tools
  find only part of the problems, so we describe the product as **partially conformant** with
  WCAG 2.1 AA, not fully conformant. The Voluntary Product Accessibility Template (VPAT 2.5,
  WCAG edition) lists every criterion and what we know about it:
  `docs/accessibility/VPAT.md`.
- What works today: pages can be zoomed (we do not block pinch-zoom); the edge of fields and the off
  state of switches meet the 3:1 contrast WCAG asks for, in Light, Classic and Dark; every page has
  one main heading; fields in error say so in words; a "Skip to main content"
  link is the first stop on every signed-in page; every field, icon button and switch has a name;
  panels and dialogs take the keyboard, close with Escape and give it back; messages and saved
  confirmations are announced to screen readers; there is a visible focus ring on every control;
  pages reflow to a 320 pixel wide screen without sideways scrolling.

## Known limits

- Some screens have not been checked by hand with a screen reader, in particular the report
  designer, the custom form editor, the data migration screens and the transport map.
- Files a school uploads (photos, videos, PDF documents, advertisements) are the school's own
  content. There is not yet a way to add a captions file to an uploaded video; the videos on the
  school website and sign-in page are played without sound.
- Two minutes before a signed-in session ends from inactivity, a dialog offers "Stay signed in".
  A sign-in time limit set by the school ends at that time and cannot be extended from the dialog.
- Dragging an event on the calendar, or items on the report card designer's canvas, has no full
  keyboard equivalent yet (calendar events can be edited in their form).
- Colors that a school chooses for its own logo and pages are not checked for contrast.
- The product is in English. Names and text that people type in another language are not marked
  with that language.

## Tell us about a problem

If something does not work for you, or you need information in another form, please write to us.
We answer within 5 business days and tell you what we can do and by when.

- Email: **[accessibility contact email, to be set before publishing]**
- Phone: **[accessibility contact phone, to be set before publishing]**
- Post: **[mailing address, to be set before publishing]**

Please tell us the page address, what you were trying to do, and the browser and assistive
technology you use if you can.

## Formal complaints

If you are not satisfied with our answer, you can contact the U.S. Department of Education Office
for Civil Rights, or your own district's Section 504 / ADA coordinator, who can also reach us.

*This statement describes the product as tested on the dates above. It is updated when the
product or the test results change.*
