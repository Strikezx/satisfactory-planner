# Satisfactory Build Planner

A free production planner for Satisfactory. It does the math and engineering: ratios, machine counts, clock speeds, belt and pipe tiers, power, splits and logistics.

**Use it:** https://strikezx.github.io/satisfactory-planner

No sign-in, no install. Your worlds and factories are saved in your own browser.

## What's in it

| Tab | What it does |
| --- | --- |
| **Plan** | Enter what you want to make, get a solved build by stage: machine counts, clock speeds, in/out flows, belt and pipe tiers, Somersloops, a "built" tick, plus a Flow view and a Sheet (copy or download CSV). |
| **Recipes** | Switch recipes on or off per world, tick unlocked alternates, star preferred recipes. |
| **From a node** | Plan from a resource node. |
| **Power** | Generator setups and power budget. |
| **Transport** | Trains, trucks, drones and the Dimensional Depot. |
| **Splits** | Splitter trees for an even split or an exact rate. |
| **My factories** | Saved builds per world, plus a world balance (shortfalls between factories). |
| **World & data** | Multiple worlds (one per save), best belt and pipe, Game Mode multipliers, recipe data, and **Export / Import / Share**. |

Every tab has a **? Tips** tour. Dark is the default; the **Light mode** button switches and remembers.

## Backing up and moving your data

Everything lives in this browser's storage, so use **World & data → Back up, move and share**:

- **Export backup** downloads a `.json` file with all your worlds, plans and factories (and your loaded game file, if you choose).
- **Import backup** reads that file on another device. You see a preview first, then choose **Add to what I have** (same worlds and factories are updated, everything else stays) or **Replace everything**.
- **Share this world as a link** makes a link holding one world, its plan and its factories. Opening it shows a preview; nothing changes until you choose to import.

## Recipe data

Numbers come from the game's own `en-US.json` (Docs folder). A copy for 1.2 is built in (`js/data.js`). After a game patch, use **Load game file** on World & data to load a newer one; it stays in your browser.

## Run it locally

It's plain HTML, CSS and JavaScript with no build step.

```bash
python3 -m http.server
```

Then open http://localhost:8000. The solver ([javascript-lp-solver](https://github.com/JWally/jsLPSolver)) loads from a CDN, so you need to be online.

## Files

```
index.html        page shell
css/style.css     all styling (dark and light)
js/engine.js      planning engine: recipe math, LP solve, power, splits, game-file import
js/data.js        built-in 1.2 recipe data
js/backup.js      export / import / share-link logic (no DOM)
js/app.js         the interface: tabs, rendering, saving
CLAUDE.md         notes for Claude when working in this repo
ROADMAP.md        running list of ideas and requests
```

## Saved data (localStorage keys)

`sbp_state` (worlds and settings), `sbp_factories`, `sbp_gamedata` (a loaded game file), `sbp_flcols`, `sbp_tips`, `sbp_theme`. If the shape of saved data ever changes it is migrated on load; keys are never renamed or dropped without a migration.

## Deploying

GitHub Pages serves the repository root from `main`. There is no build step.
