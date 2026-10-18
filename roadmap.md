# Mira public page cleanup

- [x] Simplify the three examples and remove crowded, nested scrolling.
- [x] Improve mobile spacing, typography, and dashboard image visibility.
- [x] Verify the public page at desktop and narrow screen widths without changing account features.

# Shared footer and workspace menus

- [x] Finish small-screen shared footer verification at 320, 390, 759 and 1280px.
- [x] Move the existing Settings flag before its collapse control; center collapsed controls across all four workspace menus (the other three have no country flag).
- [x] Verify alignment using actual header markup and shared styles; confirm all affected EJS templates compile.
- [ ] Center collapsed navigation icons with the collapse control across Settings, Reports, Admissions and Management; verify actual menu markup.
- [ ] Verify authenticated menu flows — blocked because the Vite preview does not serve the signed-in Express account screens.