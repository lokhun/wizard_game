// ---------------------------------------------------------------------------
// Which build this page is running, and whether the site has a newer one.
// The build writes version.json beside index.html (vite.config.js); an open
// game polls it so players move onto a new deploy (main.js decides when:
// at once in the menu, never mid-run). The dev server's build is 'dev'.
// ---------------------------------------------------------------------------
/* global __BUILD__ */
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

// resolves to the newer build's id, or null (same build, dev, or offline)
export async function newerBuild() {
  if (BUILD === 'dev') return null;
  try {
    const r = await fetch('./version.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const { v } = await r.json();
    return v && v !== BUILD ? v : null;
  } catch { return null; }
}
