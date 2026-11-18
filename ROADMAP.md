# Roadmap

Running list of ideas and requests. Feature notes from friends come in through Scott. Tick items off when they ship.

## Done
- [x] Moved the planner out of the Claude artifact into this repo as a plain GitHub Pages site (no sign-in, files split into `index.html`, `css/`, `js/`).
- [x] Removed the Claude-only pieces (account storage, host file-save), so everything saves in the browser.
- [x] Export / Import backup file, and share links for one world.
- [x] Dark / light mode button (dark by default, choice remembered).
- [x] CSV download of the materials sheet works on any browser.
- [x] Moving data out of the old artifact: the artifact now has an Export backup button, and its file imports straight into the website (confirmed by Scott).
- [x] Site is live on GitHub Pages: https://strikezx.github.io/satisfactory-planner

## Requests and ideas
<!-- Add new items here, newest last. Format: - [ ] Short description (who asked) -->

## To discuss
- [ ] "Floor Plan Lab" (stacking a factory across floors, with a flow-by-floor chart, side view and floor plans): merge in only when Scott asks. Artifact: https://claude.ai/artifact/DVgzhiVVCC65vPsHw4u2hC (left as it is; fix these in the merge, not in the artifact).
  - Its engine is identical to `js/engine.js`, so it can share it.
  - Fix on merge, all checked by running the Lab's layout code on 214 plans:
    - [ ] Lift flows drop raw input when an item is also made inside (48 plans, the aluminium chains that make Water). Treat raw input as a source.
    - [ ] Product and spare flows are counted once per producing machine (5 plans, e.g. Thermal Propulsion Rocket shows 2,150 Heavy Oil Residue/min leaving, should be 1,075). Treat the finished product as a sink so each item balances.
    - [ ] Saved state is not validated, so a bad belt index crashes the page. Clamp or reject on load.
    - [ ] Keyboard focus is lost after every click because the page re-renders. Restore focus like the planner does.
    - [ ] Two separate "who feeds whom" calculations (lifts and flow chart). Use one.
    - [ ] Pipe capacity is fixed at Mk.2 and the belt is its own setting. Use the world's belt and pipe tiers.
    - [ ] Machine sizes are a fixed table but the page says they come from the game file. Import them from the game file or reword.
    - [ ] Flow chart opens at 100% with mostly empty bands. Open at Fit.
  - Plan for the merge: a "Floors" tab that takes the planner's current plan ("Stack this plan") instead of its own preset picker, so it follows world settings and Game Mode multipliers. Scope its CSS (`.sheet` and `.fl-tip` clash with the planner's), give it its own file, add a tips tour, keep saved settings under a documented key, and update the README.
  - Not worth doing: caching the solve (a re-render takes 16 to 27 ms).
