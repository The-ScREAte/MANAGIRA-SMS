# Project conventions

- Keep public Mira demonstration styles and color tokens scoped to `.mira-page`; this prevents presentation changes from affecting school and account screens.
- Render the Mira EJS view directly in Vite's development preview; production continues to use its existing Express controller so preview content cannot drift from the actual page.