# Roadmap

Running list of ideas and requests. Feature notes from friends come in through Scott. Tick items off when they ship.

## Done
- [x] Moved the planner out of the Claude artifact into this repo as a plain GitHub Pages site (no sign-in, files split into `index.html`, `css/`, `js/`).
- [x] Removed the Claude-only pieces (account storage, host file-save), so everything saves in the browser.
- [x] Export / Import backup file, and share links for one world.
- [x] Dark / light mode button (dark by default, choice remembered).
- [x] CSV download of the materials sheet works on any browser.

## Requests and ideas
<!-- Add new items here, newest last. Format: - [ ] Short description (who asked) -->

## To discuss
- [ ] Moving data out of the old artifact: the old artifact keeps its data in a Claude account store, so it can't be read from this site. It would need its own Export button (or a one-off console snippet) to produce a file that Import here can read. Import already accepts the `sbp_state` / `sbp_factories` shapes.
- [ ] "Floor Plan Lab" (stacking a factory across floors, with a flow-by-floor chart, side view and floor plans): merge in only when Scott asks.
