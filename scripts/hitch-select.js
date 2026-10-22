// Hitch check of the class select (run with scripts/hitch-edge.mjs on "?test=1"): from the
// main menu, "Begin the Ascent", then pick every wizard in turn (each builds and shows its
// avatar casting its flourish), then "Begin Ascent" into floor 0. One tag per step.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tag = (t) => { window.__tag = t; };
  while (!window.__game || !document.querySelector('#bSolo') || window.__game.loadingFloor) await sleep(100);
  const g = window.__game;
  tag('menu'); await sleep(2500);
  tag('select'); document.querySelector('#bSolo').click(); await sleep(2500);
  const ids = [...document.querySelectorAll('.card[data-id]')].map((c) => c.dataset.id);
  for (const id of [...ids.slice(1), ids[0]]) { tag('cls:' + id); document.querySelector(`.card[data-id="${id}"]`)?.click(); await sleep(1800); }
  tag('begin'); document.querySelector('#bGo')?.click();
  await sleep(500);
  while (g.loadingFloor || g.menuMode) await sleep(50);
  tag('spawn'); await sleep(3000);
  tag('end');
  return { classes: ids.length, programs: g.renderer.renderer.info.programs.length };
})()
