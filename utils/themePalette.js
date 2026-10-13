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
};

module.exports = { THEME_PALETTE };
