# Project conventions

- Keep public Mira demonstration styles and color tokens scoped to `.mira-page`; this prevents presentation changes from affecting school and account screens.
- Render the Mira EJS view directly in Vite's development preview; production continues to use its existing Express controller so preview content cannot drift from the actual page.
- Use Vite only when development is invoked with port 8080; ordinary local development retains both Express servers to preserve the application's existing workflow.
- In Vite's static homepage preview, render the shared EJS footer instead of its outdated exported footer so shared footer changes remain visible without duplicating presentation code.
- Keep workspace rail alignment in the shared workspace stylesheet so Settings, Reports, Admissions and Management use the same collapsed control positioning.