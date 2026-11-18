# Satisfactory Build Planner — notes for Claude

A free production planner for Satisfactory, built for Scott (GitHub: Strikezx) and a friend who also uses it.
Live at https://strikezx.github.io/satisfactory-planner (GitHub Pages, deployed from `main`).
It must work as a plain website with no sign-in. The friend doesn't use Claude.

Scott likes the building part of the game. The planner's job is the math and engineering: ratios, machine counts, clock speeds, belt and pipe tiers, power, splits and logistics.

## Where it came from
- The planner started as a Claude artifact ("Satisfactory Build Planner", v1 Nov 2026). That artifact stays as a backup, so this repo doesn't need to match it.
- It used Claude-only browser features (`window.claude`, the artifact store set up in `initStore()`) that don't exist on GitHub Pages. Remove or replace them, and make sure nothing breaks when they're missing.
- A separate experiment, "Floor Plan Lab" (stacking a factory across floors, with a flow-by-floor chart, side view and floor plans), may be merged in later. Only do that when Scott asks.

## What the app does (tabs)
- **Plan:** targets in, LP solve, then build cards by stage. Each card shows machine counts, clock speeds, in/out flows, a recipe pick, Somersloop amplification and a "built" tick. There's also a Flow view.
- **Recipes:** switch recipes on or off per world, tick unlocked alternates, star preferred recipes. "Everything unlocked" covers creative worlds.
- **From a node:** plan from a resource node.
- **Power:** generator setups and power budget.
- **Transport:** trains, trucks, drones and the Dimensional Depot.
- **Splits:** splitter trees for even splits or for taking off an exact rate.
- **My factories:** saved builds per world, plus a world balance (shortfalls between factories).
- **World & data:** multiple worlds (one per save), best belt and pipe tier, Game Mode multipliers, and recipe data.
- Each tab has a "? Tips" tour.

## Data and math
- Recipe numbers come from the game's own `en-US.json` docs file. A built-in copy ships with the app, and players can load a newer file after a patch. Keep that import working.
- Belts are 60/120/270/480/780/1200 per minute and pipes are 300/600. Somersloop amplification doubles output and quadruples power. Game Mode cost and power multipliers apply.
- The solver is javascript-lp-solver from a CDN. If it fails to load, show a clear message rather than a blank page.
- Accuracy matters more than anything. After any change to the math, check a few known cases by hand. Example: 4 refineries making 80 plastic and 40 heavy oil residue per minute; Diluted Fuel in 1 Blender at 80% gives 80 fuel per minute.
- Show rates per minute, in the game's own item and building names. Clock speeds show to one decimal.

## Don't break people's saved data
- Saved data lives in the visitor's browser under these localStorage keys: `sbp_state` (worlds and settings), `sbp_factories`, `sbp_gamedata` (a loaded game file), `sbp_flcols` and `sbp_tips`.
- If the shape of saved data changes, migrate old data on load. Never rename or drop a key without a migration.
- Provide **Export** and **Import** (a backup file, and ideally a share link) so worlds and factories can move between PC and phone, from the old artifact, or to the friend.

## Design rules
- Dark by default: the "work order" look with charcoal panels, an orange accent and the hazard-stripe header. Keep the light mode working too.
- Keep it clean and efficient. Most use is on PC, but check phone width too.

## How to work
1. Make changes on a branch and open a pull request with a short, plain-English summary of what changed for players. Push straight to `main` only when Scott says to.
2. Test before finishing. Run `python3 -m http.server` in the repo, load the page, check for console errors, and click through the tabs you touched. Check dark and light modes and phone width.
3. Feature notes from the friend come in through Scott. Keep a running list in `ROADMAP.md` and tick items off when they ship.
4. Keep `README.md` in step when features change.
