/**
 * icons.js – Inline SVG icon library for TRAIN.
 *
 * Every function returns an SVG string. All icons:
 *   • Are 24×24 viewBox by default (scalable via CSS width/height).
 *   • Use currentColor so they inherit the parent element's color.
 *   • Include aria-hidden="true" because the parent <button> carries
 *     the aria-label – the icon itself is decorative.
 *   • Are stroked (not filled) for a clean, modern look consistent
 *     with the app's design language.
 */

const SVG = (path, extra = '') =>
  `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;

// ─── Navigation ───────────────────────────────────────────────────────────────

/** Left chevron – previous week */
export const chevronLeft = () =>
  SVG('<polyline points="15 18 9 12 15 6"/>');

/** Right chevron – next week */
export const chevronRight = () =>
  SVG('<polyline points="9 18 15 12 9 6"/>');

/** Up chevron – collapse accordion */
export const chevronUp = () =>
  SVG('<polyline points="18 15 12 9 6 15"/>');

/** Down chevron – expand accordion */
export const chevronDown = () =>
  SVG('<polyline points="6 9 12 15 18 9"/>');

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Plus / Add */
export const plus = () =>
  SVG('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>');

/** Copy / Duplicate week (two stacked pages) */
export const copy = () =>
  SVG('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');

/** Download / Export (arrow into tray) */
export const download = () =>
  SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');

/** Upload / Import (arrow out of tray) */
export const upload = () =>
  SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>');

/** Trash / Delete */
export const trash = () =>
  SVG('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>');

/** Lock (day is marked done & locked) */
export const lock = () =>
  SVG('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');

/** Unlock */
export const unlock = () =>
  SVG('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>');

/** Settings / Gear */
export const settings = () =>
  SVG(`<circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
      a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
      A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
      l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
      A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
      l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
      a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
      l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
      a1.65 1.65 0 0 0-1.51 1z"/>`);

/** Check / Done */
export const check = () =>
  SVG('<polyline points="20 6 9 17 4 12"/>');

/** X mark – set failed / not completed */
export const xMark = () =>
  SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');

/** Close / X */
export const x = () =>
  SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');

/** Drag handle (grip dots) */
export const grip = () =>
  SVG(`<circle cx="9"  cy="6"  r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="6"  r="1" fill="currentColor" stroke="none"/>
    <circle cx="9"  cy="12" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
    <circle cx="9"  cy="18" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>`);

/** Dumbbell / workout */
export const dumbbell = () =>
  SVG(`<path d="M6 4v16"/><path d="M10 4v16"/>
    <path d="M14 4v16"/><path d="M18 4v16"/>
    <path d="M3 8h3"/><path d="M3 16h3"/>
    <path d="M18 8h3"/><path d="M18 16h3"/>`);

/** Body / person silhouette */
export const person = () =>
  SVG('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>');

/** Chart / bar chart (analysis tab) */
export const barChart = () =>
  SVG('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>');

/** Calendar */
export const calendar = () =>
  SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');

/** Save / floppy disk */
export const save = () =>
  SVG('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>');

/** Refresh / reset */
export const refresh = () =>
  SVG('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/>');

/** Minus / remove set */
export const minus = () =>
  SVG('<line x1="5" y1="12" x2="19" y2="12"/>');

/** Timer / clock */
export const timer = () =>
  SVG('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>');

/** Zap / deload/power */
export const zap = () =>
  SVG('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>');

/** Info circle */
export const info = () =>
  SVG('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>');

// ─── Helper: screen-reader-only text ─────────────────────────────────────────

/**
 * Returns visually hidden text for screen readers.
 * Include this inside buttons alongside icons.
 * @param {string} label
 */
export const srOnly = label =>
  `<span class="sr-only">${label}</span>`;
