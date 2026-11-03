# Project conventions

- Keep public Mira demonstration styles and color tokens scoped to `.mira-page`; this prevents presentation changes from affecting school and account screens.
- Render the Mira EJS view directly in Vite's development preview; production continues to use its existing Express controller so preview content cannot drift from the actual page.
- Use Vite only when development is invoked with port 8080; ordinary local development retains both Express servers to preserve the application's existing workflow.
- In Vite's static homepage preview, render the shared EJS footer instead of its outdated exported footer so shared footer changes remain visible without duplicating presentation code.
- Keep workspace rail alignment in the shared workspace stylesheet so Settings, Reports, Admissions and Management use the same collapsed control positioning.
- Keep Report Builder data and initialization scripts inside its page root, scope listeners to that element and bind once per mounted page; initialization should not depend on a particular layout wrapper.
- Save and export Report Builder's last successful request, not subsequently edited criteria; this keeps those actions consistent with the displayed results.- Decide Management, Reports and Admissions menu items in `utils/workspaceAccess.js`, and mirror each item's page guard there; the hamburger and hub pages both read it so a menu never offers a page that would redirect the person away.
- A person's saved permission rows are authoritative; role defaults apply only to someone never saved (`effectivePermissionsForRole`), so unticking a permission really removes it.
- Define permissions in `PERMISSION_OPTIONS` (group, description, `highRisk`, `parent`); the employee form renders from it, and a follow-up counts only while its `parent` is held. PayGira rows saved before follow-ups existed are expanded in `withLegacyPaygira`.
- Plan features are enforced centrally: `userHasPermission` refuses anything outside the school's plan for everyone, including owners, and `permissionOptionsFor` hides it from forms. Tie a permission to a plan with `PERMISSION_FEATURES` or its option's `features`; don't add a separate check.
