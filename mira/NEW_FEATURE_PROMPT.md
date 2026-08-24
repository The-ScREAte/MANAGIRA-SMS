# Kickoff prompt: adding a new Mira action

Paste the block below (everything in the code fence) as the first message in a
new chat when you want to give Mira access to another admin page. Fill in the
URL and any HTML you copy from the page's action buttons before sending.

---

```
I want to add Mira actions for this admin page. Follow the same approach we've
used on every other page in this project (School Years/Terms, Classes/Subjects/
Graduation Year Groups, Assessments, Assessment Questions). Read mira/CAPABILITIES.md
first to see what's already built and how it's described, then apply this checklist:

## 1. Research before writing code
- Explore the target page's controller/route/view to find every action available
  (create, update, delete, lock/unlock, post/unpost, reorder, etc.) - not just the
  obvious ones. I'll give you the URL and can paste the page's action buttons/HTML.
- For every DELETE or other destructive action, check its DB foreign keys for
  ON DELETE CASCADE before exposing it to Mira. If real user data (students, scores,
  answers, enrollments...) would be silently destroyed with no existing safety check,
  fix the underlying controller function FIRST (add a dependency/blocker check that
  returns an error instead of cascading) - this protects the real browser UI too,
  not just Mira. Don't gate only on the Mira side.

## 2. Permissions - never guess from role names
- Every write action must call the real backend permission check
  (userHasPermission / assertHasPermission pattern in internalApiController.js),
  keyed off the specific PERMISSIONS constant for that feature - never off
  tenant.roleTags or a role name string.
- Use assertIsStaff(tenant, action) from mira/tools/_writeAuth.js as the first,
  cheap check (blocks guardians/students), then let the internal API's real
  permission check be the actual authority.
- Always pass userEmail through (tenant.userEmail) so the org-owner-email bypass
  that the real browser UI has is available via Mira too.

## 3. Org scoping
- Every internal API handler must filter by organizationId from req.tenant -
  never trust an ID the model could pass in without also verifying it belongs to
  this organization.

## 4. Destructive-action confirmation flow
- Any delete/unlock/irreversible action: first call (confirm omitted/false) fetches
  real impact data (counts of dependent records) and returns
  { status: "confirmation_required", warning: "<specific, real numbers, not vague>" }.
  Second call (confirm: true) executes, wrapped in try/catch that logs a
  "Delete Blocked" activity entry on failure.
- The tool description must explicitly tell the model: get explicit user confirmation
  before setting confirm: true; any later affirmative reply confirms the whole plan
  (don't re-ask).

## 5. Name-based resolution, not raw IDs
- Tools take human names (class/subject/term/test names), not IDs. Resolve them
  server-side with case-insensitive LOWER(TRIM(x)) matching. If year/term labels
  might have inconsistent spacing in real data, normalize whitespace too. Default
  optional termName to the org's current term; support an optional disambiguator
  (e.g. yearLabel) if the same name can repeat across terms/years.

## 6. Activity logging
- Every successful write action calls logMiraActivity(tenant, {...}) from
  mira/tools/_activityLog.js with a clear actionType, moduleName, recordType,
  recordLabel, and a human-readable description ending "via Mira (AI assistant)".
  This must show up on /common/activityLogs with the real user's name.

## 7. Tool design
- One tool file per action in mira/tools/<name>.js, registered in
  mira/tools/index.js's ALL_TOOLS array.
- required params only for what's truly required; never let Mira invent values
  (weights, scores, dates, categories) - say so explicitly in the description.
- Keep tool descriptions lean - they're sent on every request and are the dominant
  token cost, more than the system prompt or history.

## 8. Testing discipline (do this before calling anything done)
- Test the real logic live - either by calling the internal API/controller
  functions directly (fast, deterministic - I can write a throwaway Node script
  against mira/config/db.js) or via the actual HTTP chat endpoint with a real
  session.
- Cover: the happy path, a user who lacks the permission (real denial, not a
  role-tag guess), the confirmation flow for anything destructive, and org-scope
  isolation (an action can't reach another organization's data).
- Clean up every bit of test data you create and verify the DB is back to its
  baseline state afterward - don't leave test rows behind.
- If you can't test the UI directly, say so explicitly rather than claiming it
  works.

## 9. Documentation
- Update mira/CAPABILITIES.md after the feature works: add rows to the existing
  tables (or a new subsection) following the current tone - short, plain-English,
  one line per tool, permission required, and any sharp edges in a Notes column.

Here's the page: <URL>
<paste any action-button HTML / describe what each button does here>
```
