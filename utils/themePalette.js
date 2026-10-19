// The school's brand colors (Settings > Customize > Brand color), keyed by
// organizations.theme_color. One list for every page: views read it as
// `themePalette` (app.locals), so a color picked in Settings shows the same
// everywhere instead of falling back to teal on pages with an older copy.
const THEME_PALETTE = {
  teal: { primary: '#01535b', hover: '#014a51', light: '#e6f4f5' },
  blue: { primary: '#2563eb', hover: '#1d4ed8', light: '#eff6ff' },
  green: { primary: '#2e7d32', hover: '#1b5e20', light: '#f0fdf4' },
  purple: { primary: '#7c3aed', hover: '#6d28d9', light: '#f5f3ff' },
  indigo: { primary: '#4f46e5', hover: '#4338ca', light: '#eef2ff' },
  rose: { primary: '#8b2635', hover: '#7a212e', light: '#fff1f2' },
  amber: { primary: '#d97706', hover: '#b45309', light: '#fffbeb' },
  yellow: { primary: '#eab308', hover: '#ca8a04', light: '#fefce8' },
  slate: { primary: '#334155', hover: '#1e293b', light: '#f1f5f9' },
  cyan: { primary: '#0891b2', hover: '#0e7490', light: '#ecfeff' },
  orange: { primary: '#ea580c', hover: '#c2410c', light: '#fff7ed' },
  charcoal: { primary: '#1f2937', hover: '#111827', light: '#f3f4f6' },
  classic: { primary: '#01535b', hover: '#014a51', light: '#e6f4f5' },
  bold: { primary: '#0b1020', hover: '#ffb703', light: '#fefce8' },
  modern: { primary: '#2563eb', hover: '#1d4ed8', light: '#eff6ff' },
  minimal: { primary: '#7c3aed', hover: '#6d28d9', light: '#f5f3ff' },
  gold: { primary: '#d4a017', hover: '#b8860b', light: '#fefce8' },
  red: { primary: '#e11d48', hover: '#be123c', light: '#fff1f2' },
  brown: { primary: '#7c4a03', hover: '#5c3802', light: '#fdf6ef' },
  // Deep brand colors: white text on them passes WCAG AA (contrast 5:1 or more).
  emerald: { primary: '#047857', hover: '#065f46', light: '#ecfdf5' },
  navy: { primary: '#1e3a8a', hover: '#172554', light: '#eff6ff' },
  sapphire: { primary: '#0c4a6e', hover: '#082f49', light: '#f0f9ff' },
  maroon: { primary: '#7f1d1d', hover: '#661616', light: '#fef2f2' },
  plum: { primary: '#6b21a8', hover: '#581c87', light: '#faf5ff' },
  orchid: { primary: '#86198f', hover: '#701a75', light: '#fdf4ff' },
  chestnut: { primary: '#7c2d12', hover: '#651f0b', light: '#fff7ed' },
  olive: { primary: '#4d5b18', hover: '#3d4813', light: '#f7f8ec' },
};

// Brand colors a school can pick (Settings > Customize > Brand color), in
// order. The value is what the website settings store; it maps to the key
// above that the rest of the app uses (organizations.theme_color).
const BRAND_COLOR_OPTIONS = [
  { value: 'classic', key: 'teal', name: 'Ocean Teal' },
  { value: 'modern', key: 'blue', name: 'Royal Blue' },
  { value: 'green', key: 'green', name: 'Evergreen' },
  { value: 'minimal', key: 'purple', name: 'Amethyst' },
  { value: 'indigo', key: 'indigo', name: 'Deep Indigo' },
  { value: 'rose', key: 'rose', name: 'Crimson Rose' },
  { value: 'amber', key: 'amber', name: 'Amber Gold' },
  { value: 'yellow', key: 'yellow', name: 'Solar Yellow' },
  { value: 'slate', key: 'slate', name: 'Slate' },
  { value: 'cyan', key: 'cyan', name: 'Cyan Breeze' },
  { value: 'orange', key: 'orange', name: 'Sunset Orange' },
  { value: 'charcoal', key: 'charcoal', name: 'Charcoal' },
  { value: 'emerald', key: 'emerald', name: 'Emerald' },
  { value: 'navy', key: 'navy', name: 'Navy' },
  { value: 'sapphire', key: 'sapphire', name: 'Deep Sapphire' },
  { value: 'maroon', key: 'maroon', name: 'Maroon' },
  { value: 'plum', key: 'plum', name: 'Royal Plum' },
  { value: 'orchid', key: 'orchid', name: 'Orchid' },
  { value: 'chestnut', key: 'chestnut', name: 'Chestnut' },
  { value: 'olive', key: 'olive', name: 'Olive' },
];
const BRAND_COLOR_VALUES = BRAND_COLOR_OPTIONS.map((o) => o.value);
const brandKeyFor = (value) => {
  const option = BRAND_COLOR_OPTIONS.find((o) => o.value === value || o.key === value);
  return option ? option.key : null;
};

// Footer colors for a brand: hand-tuned for the original colors, worked out
// from the brand for the rest (a deep band, a darker bottom strip, a light
// accent for links).
const FOOTER_PALETTE = {
  teal: { mid: '#01535b', deep: '#033f46', bottom: '#022830', gold: '#e8b84a' },
  blue: { mid: '#1d4ed8', deep: '#1e3a8a', bottom: '#172554', gold: '#93c5fd' },
  green: { mid: '#1b5e20', deep: '#14532d', bottom: '#0b3d1a', gold: '#86efac' },
  purple: { mid: '#6d28d9', deep: '#4c1d95', bottom: '#2e1065', gold: '#c4b5fd' },
  indigo: { mid: '#4338ca', deep: '#312e81', bottom: '#1e1b4b', gold: '#a5b4fc' },
  rose: { mid: '#7a212e', deep: '#5c1822', bottom: '#3f1017', gold: '#fca5a5' },
  amber: { mid: '#b45309', deep: '#92400e', bottom: '#6b2f08', gold: '#fde68a' },
  yellow: { mid: '#ca8a04', deep: '#a16207', bottom: '#7a4c04', gold: '#fef08a' },
  slate: { mid: '#334155', deep: '#1e293b', bottom: '#0f172a', gold: '#94a3b8' },
  cyan: { mid: '#0891b2', deep: '#0e7490', bottom: '#164e63', gold: '#67e8f9' },
  orange: { mid: '#ea580c', deep: '#c2410c', bottom: '#9a3412', gold: '#fdba74' },
  charcoal: { mid: '#1f2937', deep: '#111827', bottom: '#030712', gold: '#9ca3af' },
  bold: { mid: '#0b1020', deep: '#050a14', bottom: '#020408', gold: '#ffb703' },
  gold: { mid: '#b8860b', deep: '#8b6309', bottom: '#5c4006', gold: '#fef08a' },
  red: { mid: '#be123c', deep: '#9f1239', bottom: '#7c0d2e', gold: '#fca5a5' },
  brown: { mid: '#7c4a03', deep: '#5c3802', bottom: '#3d2601', gold: '#d4a574' },
  emerald: { mid: '#047857', deep: '#065f46', bottom: '#033b2c', gold: '#6ee7b7' },
  navy: { mid: '#1e3a8a', deep: '#172554', bottom: '#0b1433', gold: '#93c5fd' },
  sapphire: { mid: '#0c4a6e', deep: '#082f49', bottom: '#041c2c', gold: '#7dd3fc' },
  maroon: { mid: '#7f1d1d', deep: '#661616', bottom: '#430e0e', gold: '#fca5a5' },
  plum: { mid: '#6b21a8', deep: '#581c87', bottom: '#3b0764', gold: '#d8b4fe' },
  orchid: { mid: '#86198f', deep: '#701a75', bottom: '#4a044e', gold: '#f0abfc' },
  chestnut: { mid: '#7c2d12', deep: '#651f0b', bottom: '#431407', gold: '#fdba74' },
  olive: { mid: '#4d5b18', deep: '#3d4813', bottom: '#262d0b', gold: '#d9f99d' },
};
const LEGACY_KEYS = { classic: 'teal', modern: 'blue', minimal: 'purple' };
function footerPaletteFor(key) {
  const k = LEGACY_KEYS[key] || key;
  return FOOTER_PALETTE[k] || FOOTER_PALETTE.teal;
}

module.exports = { THEME_PALETTE, BRAND_COLOR_OPTIONS, BRAND_COLOR_VALUES, brandKeyFor, FOOTER_PALETTE, footerPaletteFor };
