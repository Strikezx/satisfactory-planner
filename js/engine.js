/* Satisfactory planning engine: recipe math, LP solve, build cards, power, splits, game-file import. */
var ENG = (function () {
  var BELTS = [60, 120, 270, 480, 780, 1200];
  var PIPES = [300, 600];
  // World max extraction (all nodes, Mk3 at 250%) from SCIM, used to weight scarcity.
  var WORLD_MAX = {
    Desc_OreIron_C: 92100, Desc_Stone_C: 69300, Desc_Coal_C: 42300, Desc_OreCopper_C: 36900,
    Desc_OreGold_C: 15000, Desc_RawQuartz_C: 13500, Desc_LiquidOil_C: 12600, Desc_OreBauxite_C: 12300,
    Desc_NitrogenGas_C: 12000, Desc_Sulfur_C: 10800, Desc_SAM_C: 10200, Desc_OreUranium_C: 2100
  };
  var NODE_RES = Object.keys(WORLD_MAX).concat(['Desc_Water_C']);

  function prep(data) {
    var D = { src: data.src, items: data.items, buildings: data.buildings, recipes: data.recipes, byId: {}, producers: {}, consumers: {} };
    data.recipes.forEach(function (r) {
      D.byId[r.id] = r;
      r.o.forEach(function (p) { (D.producers[p[0]] = D.producers[p[0]] || []).push(r); });
      r.i.forEach(function (p) { (D.consumers[p[0]] = D.consumers[p[0]] || []).push(r); });
    });
    D.raw = {};
    NODE_RES.forEach(function (k) { if (D.items[k]) D.raw[k] = 'node'; });
    Object.keys(D.items).forEach(function (k) {
      if (D.raw[k]) return;
      var prods = (D.producers[k] || []);
      if (!prods.length) D.raw[k] = 'gathered';
    });
    return D;
  }

  function name(D, id) { return (D.items[id] && D.items[id].n) || id; }
  function isFluid(D, id) { return !!(D.items[id] && D.items[id].l); }

  // Per-machine rates at 100% clock, honouring amplification and Game Mode multipliers.
  function rates(D, r, o) {
    o = o || {};
    var b = D.buildings[r.b] || { p: 0, x: 1.321929, s: 0, n: r.b };
    var amp = o.amp && o.amp[r.id] && b.s > 0 ? 2 : 1;
    var cm = o.costMult || 1, pm = o.powerMult || 1;
    var per = 60 / r.t;
    var base = r.v ? (r.v[0] + r.v[1]) / 2 : b.p;
    return {
      ins: r.i.map(function (p) { return [p[0], p[1] * per * cm]; }),
      outs: r.o.map(function (p) { return [p[0], p[1] * per * amp]; }),
      power: base * pm * (amp === 2 ? 4 : 1),
      amp: amp === 2, building: b
    };
  }

  function rawWeight(D, id) {
    if (id === 'Desc_Water_C') return 0.0005;
    if (WORLD_MAX[id]) return 1000 / WORLD_MAX[id];
    return 25; // hand-gathered or otherwise unproducible
  }

  function recipeAllowed(D, r, o) {
    if (o.disabled && o.disabled[r.id]) return false;
    if (r.a && !(o.allAlts || (o.alts && o.alts[r.id]))) return false;
    if (r.b === 'Build_Converter_C' && !o.converter) return false;
    var lock = o.locks && o.locks[r.o[0][0]];
    if (lock && lock !== r.id) return false;
    // "Don't use": no recipe that consumes it. "Bring in as needed": don't make it here.
    if (o.bans && r.i.some(function (p) { return o.bans[p[0]]; })) return false;
    if (o.imports && o.imports[r.o[0][0]]) return false;
    return true;
  }

  /* o: {targets:[{item,rate}], maximize:item, inputs:[{item,rate}], onlyInputs, freeWater,
         goal:'raw'|'power'|'buildings', allAlts, alts, locks, amp, disabled, converter, costMult, powerMult} */
  function solve(D, o) {
    var LP = (typeof solver !== 'undefined') ? solver : require('javascript-lp-solver');
    var model = { optimize: 'cost', opType: 'min', constraints: {}, variables: {} };
    var goal = o.goal || 'raw';
    var touched = {};
    var steps = [];
    D.recipes.forEach(function (r, idx) {
      if (!recipeAllowed(D, r, o)) return;
      var rr = rates(D, r, o);
      var v = {};
      rr.outs.forEach(function (p) { v['i_' + p[0]] = (v['i_' + p[0]] || 0) + p[1]; touched[p[0]] = 1; });
      rr.ins.forEach(function (p) { v['i_' + p[0]] = (v['i_' + p[0]] || 0) - p[1]; touched[p[0]] = 1; });
      var cost;
      if (goal === 'power') cost = rr.power + 0.01;
      else if (goal === 'buildings') cost = 1 + rr.power * 0.0001;
      else cost = rr.power * 0.0002 + 0.002;
      // When asked which locked alternates a change needs, make each one costly so the fewest get used.
      if (o.lockedAltPenalty && r.a && !(o.alts && o.alts[r.id])) cost += o.lockedAltPenalty;
      v.cost = cost;
      model.variables['r' + idx] = v;
    });
    var targets = {};
    (o.targets || []).forEach(function (t) { if (t.item && t.rate > 0) { targets[t.item] = (targets[t.item] || 0) + t.rate; touched[t.item] = 1; } });
    var inputs = {};
    (o.inputs || []).forEach(function (t) { if (t.item && t.rate > 0) { inputs[t.item] = (inputs[t.item] || 0) + t.rate; touched[t.item] = 1; } });
    if (o.maximize) touched[o.maximize] = 1;
    Object.keys(o.imports || {}).forEach(function (it) { touched[it] = 1; });
    var rawScale = goal === 'raw' ? 1 : 0.01;
    Object.keys(touched).forEach(function (it) {
      var c = 'i_' + it;
      model.constraints[c] = { equal: targets[it] || 0 };
      model.variables['x_' + it] = { cost: 0 }; model.variables['x_' + it][c] = -1;
      if (o.imports && o.imports[it]) {
        var mv = { cost: o.importCost && o.importCost[it] != null ? o.importCost[it] : 0.01 }; mv[c] = 1;
        model.variables['m_' + it] = mv;
      }
      if (o.bans && o.bans[it]) return;
      if (D.raw[it]) {
        var allowRaw = !o.onlyInputs || (it === 'Desc_Water_C' && o.freeWater !== false);
        if (allowRaw) { var sv = { cost: rawWeight(D, it) * rawScale }; sv[c] = 1; model.variables['s_' + it] = sv; }
      }
      if (inputs[it]) {
        var iv = { cost: 0 }; iv[c] = 1; iv['cap_' + it] = 1;
        model.variables['g_' + it] = iv;
        model.constraints['cap_' + it] = { max: inputs[it] };
      }
    });
    if (o.maximize) {
      var tv = { cost: -1000 }; tv['i_' + o.maximize] = -1;
      model.variables.t_max = tv;
    }
    var res = LP.Solve(model, 1e-9);
    if (!res.feasible) return { ok: false, reason: 'infeasible' };
    if (res.bounded === false || (o.maximize && !isFinite(res.t_max || 0))) return { ok: false, reason: 'unbounded' };
    var out = { ok: true, steps: [], supply: {}, given: {}, imported: {}, excess: {}, targets: {}, opts: o, cost: res.result };
    Object.keys(res).forEach(function (k) {
      var val = res[k];
      if (typeof val !== 'number' || val < 1e-7) return;
      if (k[0] === 'r' && /^r\d+$/.test(k)) {
        var r = D.recipes[+k.slice(1)];
        out.steps.push({ recipe: r, x: val, rates: rates(D, r, o) });
      } else if (k.indexOf('s_') === 0) out.supply[k.slice(2)] = val;
      else if (k.indexOf('g_') === 0) out.given[k.slice(2)] = val;
      else if (k.indexOf('m_') === 0) out.imported[k.slice(2)] = val;
      else if (k.indexOf('x_') === 0) { if (val > 1e-5) out.excess[k.slice(2)] = val; }
    });
    Object.keys(targets).forEach(function (t) { out.targets[t] = targets[t]; });
    if (o.maximize) { out.targets[o.maximize] = res.t_max || 0; out.maxed = o.maximize; }
    // Byproducts that are also targets: excess of a target item counts toward nothing extra.
    orderSteps(D, out);
    return out;
  }

  function orderSteps(D, out) {
    var prodBy = {};
    out.steps.forEach(function (s, i) { s.outs = {}; s.ins = {};
      s.rates.outs.forEach(function (p) { s.outs[p[0]] = p[1] * s.x; (prodBy[p[0]] = prodBy[p[0]] || []).push(i); });
      s.rates.ins.forEach(function (p) { s.ins[p[0]] = (s.ins[p[0]] || 0) + p[1] * s.x; }); s.dist = Infinity; });
    // Distance from the finished products (BFS, so loops are fine); upstream steps get larger numbers.
    var queue = [];
    out.steps.forEach(function (s, i) { if (Object.keys(s.outs).some(function (it) { return out.targets[it] !== undefined || out.maxed === it; })) { s.dist = 0; queue.push(i); } });
    while (queue.length) {
      var i = queue.shift(), s = out.steps[i];
      Object.keys(s.ins).forEach(function (it) { (prodBy[it] || []).forEach(function (j) { if (out.steps[j].dist === Infinity) { out.steps[j].dist = s.dist + 1; queue.push(j); } }); });
    }
    var maxD = 0;
    out.steps.forEach(function (s) { if (s.dist === Infinity) s.dist = 0; if (s.dist > maxD) maxD = s.dist; });
    out.steps.forEach(function (s) { s.level = maxD - s.dist + 1; });
    out.steps.sort(function (a, b) { return a.level - b.level || a.recipe.n.localeCompare(b.recipe.n); });
  }

  function machineCount(r) { var m = 0; r.steps.forEach(function (s) { m += Math.ceil(s.x - 1e-6); }); return m; }
  // Drop tiny side-steps (under a quarter machine) one at a time while the plan still works.
  function solveClean(D, o) {
    // Price each "bring in as needed" item at half of what it would cost to make here,
    // so the planner uses it in place of building that line, but doesn't lean on it more than it needs.
    if (o.imports && Object.keys(o.imports).length) {
      o.importCost = {};
      Object.keys(o.imports).forEach(function (it) {
        var u = solve(D, { allAlts: o.allAlts, alts: o.alts, converter: o.converter, costMult: o.costMult, powerMult: o.powerMult, goal: o.goal, bans: o.bans, targets: [{ item: it, rate: 1 }] });
        o.importCost[it] = u.ok && u.cost > 0 ? u.cost * 0.5 : 0.01;
      });
    }
    var res = solve(D, o);
    if (!res.ok || o.clean === false) return res;
    var banned = {}, keep = {}, locked = {};
    Object.keys(o.disabled || {}).forEach(function (k) { banned[k] = o.disabled[k]; });
    Object.keys(o.locks || {}).forEach(function (k) { locked[o.locks[k]] = 1; });
    var best = o.maximize ? res.targets[o.maximize] : 0, base = res.cost, dropped = 0;
    var tol0 = o.cleanTol != null ? o.cleanTol : 0.15;
    function acceptable(r2, cur) {
      if (!r2.ok) return false;
      var okC = o.maximize ? r2.targets[o.maximize] >= best * 0.97 : r2.cost <= base * (1 + tol0) + 1e-9;
      return okC && machineCount(r2) < machineCount(cur);
    }
    // First try dropping every tiny step at once: small side-chains (like a little oil line) only go away together.
    for (var g = 0; g < 4; g++) {
      var tiny = res.steps.filter(function (s) { return s.x < 0.25 && !locked[s.recipe.id]; });
      if (!tiny.length) break;
      var bg = {}; Object.keys(banned).forEach(function (k) { bg[k] = 1; });
      tiny.forEach(function (s) { bg[s.recipe.id] = 1; });
      var og = {}; Object.keys(o).forEach(function (k) { og[k] = o[k]; }); og.disabled = bg;
      var rg = solve(D, og);
      if (!acceptable(rg, res)) break;
      banned = bg; dropped += tiny.length; res = rg;
    }
    for (var it = 0; it < 30; it++) {
      var cand = res.steps.filter(function (s) { return s.x < 0.25 && !keep[s.recipe.id] && !locked[s.recipe.id]; })
        .sort(function (a, b) { return a.x - b.x; })[0];
      if (!cand) break;
      banned[cand.recipe.id] = 1;
      var o2 = {}; Object.keys(o).forEach(function (k) { o2[k] = o[k]; }); o2.disabled = banned;
      var r2 = solve(D, o2);
      // Only tidy up when it really means fewer machines to build, and the plan stays close to the best one
      // (within the tolerance on raw use, or 97% of the max output).
      if (acceptable(r2, res)) { res = r2; dropped++; }
      else { delete banned[cand.recipe.id]; keep[cand.recipe.id] = 1; }
    }
    res.dropped = dropped; res.opts = o;
    if (dropped) {
      // What the skipped steps cost versus the strict optimum.
      var strict = solve(D, o), extra = [];
      if (o.maximize) {
        var lost = (strict.targets[o.maximize] || 0) - (res.targets[o.maximize] || 0);
        if (lost > 1e-6) extra.push({ item: o.maximize, rate: lost, lost: true });
      }
      var a1 = {}, a2 = {};
      [strict.supply, strict.given, strict.imported].forEach(function (m) { Object.keys(m).forEach(function (k) { a1[k] = (a1[k] || 0) + m[k]; }); });
      [res.supply, res.given, res.imported].forEach(function (m) { Object.keys(m).forEach(function (k) { a2[k] = (a2[k] || 0) + m[k]; }); });
      Object.keys(a2).forEach(function (k) { var d = a2[k] - (a1[k] || 0); if (d > 0.01 && d > a2[k] * 0.005 && k !== 'Desc_Water_C') extra.push({ item: k, rate: d }); });
      res.cleanCost = extra;
    }
    return res;
  }

  function roundClock(c) { return Math.round(c * 10000) / 10000; }

  // Turn a machine-count into buildable groups.
  function layout(D, step, o) {
    var maxC = (o.maxClock || 100) / 100;
    var b = step.rates.building;
    var exp = b.x || 1.321929;
    var x = step.x;
    var n = Math.max(1, Math.ceil(x / maxC - 1e-6));
    var groups = [];
    if ((o.layout || 'fill') === 'even') {
      groups.push({ count: n, clock: roundClock(x / n * 100) });
    } else {
      var full = Math.floor(x / maxC + 1e-6);
      if (full > 0) groups.push({ count: full, clock: roundClock(maxC * 100) });
      var rem = x - full * maxC;
      if (rem > 1e-6) groups.push({ count: 1, clock: roundClock(rem * 100) });
    }
    var power = 0, shards = 0;
    groups.forEach(function (g) {
      power += g.count * step.rates.power * Math.pow(g.clock / 100, exp);
      var sh = g.clock > 200.00001 ? 3 : g.clock > 150.00001 ? 2 : g.clock > 100.00001 ? 1 : 0;
      shards += sh * g.count;
    });
    var sloops = step.rates.amp ? b.s * n : 0;
    return { machines: n, groups: groups, power: power, shards: shards, sloops: sloops };
  }

  function beltFor(D, item, rate, o) {
    var fluid = isFluid(D, item);
    var tiers = fluid ? PIPES : BELTS;
    var maxTier = fluid ? (o.maxPipe || 2) : (o.maxBelt || 6);
    var cap = tiers[maxTier - 1];
    for (var t = 0; t < maxTier; t++) if (rate <= tiers[t] + 1e-6) return { fluid: fluid, tier: t + 1, lines: 1, label: (fluid ? 'Pipe Mk' : 'Belt Mk') + (t + 1) };
    var lines = Math.ceil(rate / cap - 1e-9);
    return { fluid: fluid, tier: maxTier, lines: lines, over: true, label: lines + ' × ' + (fluid ? 'Pipe Mk' : 'Belt Mk') + maxTier };
  }

  // Extraction helpers ("From a node").
  var EXTRACTORS = {
    mk1: { n: 'Miner Mk.1', base: 60, p: 5, solid: 1 },
    mk2: { n: 'Miner Mk.2', base: 120, p: 15, solid: 1 },
    mk3: { n: 'Miner Mk.3', base: 240, p: 45, solid: 1 },
    oil: { n: 'Oil Extractor', base: 120, p: 40, oil: 1 },
    water: { n: 'Water Extractor', base: 120, p: 20, water: 1, noPurity: 1 },
    well: { n: 'Resource Well (per satellite node)', base: 60, p: 0, well: 1 }
  };
  var PURITY = { impure: 0.5, normal: 1, pure: 2 };
  function extract(kind, purity, clock, count) {
    var e = EXTRACTORS[kind];
    var mult = e.noPurity ? 1 : PURITY[purity];
    var per = e.base * mult * clock / 100;
    var power = e.p * Math.pow(clock / 100, 1.321929);
    var sh = clock > 200.00001 ? 3 : clock > 150.00001 ? 2 : clock > 100.00001 ? 1 : 0;
    return { per: per, total: per * count, power: power * count, shards: sh * count };
  }

  // Generators.
  var GENS = {
    coal: { n: 'Coal-Powered Generator', mw: 75, water: 45, fuels: ['Desc_Coal_C', 'Desc_CompactedCoal_C', 'Desc_PetroleumCoke_C'] },
    fuel: { n: 'Fuel-Powered Generator', mw: 250, water: 0, fuels: ['Desc_LiquidFuel_C', 'Desc_LiquidTurboFuel_C', 'Desc_LiquidBiofuel_C', 'Desc_RocketFuel_C', 'Desc_IonizedFuel_C'] },
    nuclear: { n: 'Nuclear Power Plant', mw: 2500, water: 240, fuels: ['Desc_NuclearFuelRod_C', 'Desc_PlutoniumFuelRod_C', 'Desc_FicsoniumFuelRod_C'] },
    biomass: { n: 'Biomass Burner', mw: 30, water: 0, fuels: ['Desc_Biofuel_C', 'Desc_GenericBiomass_C', 'Desc_Wood_C', 'Desc_Mycelia_C', 'Desc_Leaves_C'] },
    geo: { n: 'Geothermal Generator', geo: { impure: 100, normal: 200, pure: 400 } }
  };
  var WASTE = { Desc_NuclearFuelRod_C: ['Desc_NuclearWaste_C', 50], Desc_PlutoniumFuelRod_C: ['Desc_PlutoniumWaste_C', 10] };
  function power(D, g, fuel, mode, value, clock, purity) {
    var G = GENS[g];
    clock = clock || 100;
    if (G.geo) {
      var mwEach = G.geo[purity || 'normal'];
      var cnt = mode === 'mw' ? Math.ceil(value / mwEach - 1e-9) : Math.max(1, Math.round(value));
      return { gens: cnt, mwEach: mwEach, mw: cnt * mwEach, fuelRate: 0, water: 0, extractors: 0, waste: null, note: 'Geothermal output swings around this average; it cannot be overclocked.' };
    }
    var mwEach = G.mw * clock / 100;
    var gens = mode === 'mw' ? Math.ceil(value / mwEach - 1e-9) : Math.max(1, Math.round(value));
    var e = (D.items[fuel] && D.items[fuel].e) || 1;
    var fuelEach = mwEach / e * 60;
    var waterEach = G.water * clock / 100;
    var w = WASTE[fuel];
    return {
      gens: gens, mwEach: mwEach, mw: gens * mwEach, fuelEach: fuelEach, fuelRate: gens * fuelEach,
      water: gens * waterEach, extractors: Math.max(0, Math.ceil(gens * waterEach / 120 - 1e-9)),
      waste: w ? { item: w[0], rate: gens * fuelEach * w[1] } : null
    };
  }

  // Splitter math.
  function smooth(n) { var a = 0, b = 0; while (n % 2 === 0) { n /= 2; a++; } while (n % 3 === 0) { n /= 3; b++; } return n === 1 ? { a: a, b: b } : null; }
  function nextSmooth(n) { for (var m = n; m < n * 4; m++) if (smooth(m)) return m; return n; }
  function treeText(m) {
    var f = smooth(m); var parts = [];
    for (var i = 0; i < f.b; i++) parts.push('3-way');
    for (var j = 0; j < f.a; j++) parts.push('2-way');
    return parts;
  }
  function splitEqual(rate, n) {
    var m = nextSmooth(n);
    return { n: n, m: m, each: rate / n, loop: m - n, layers: treeText(m) };
  }
  function splitTake(rate, want) {
    if (want <= 0 || want >= rate) return null;
    var f = want / rate, best = null;
    for (var a = 0; a <= 8; a++) for (var b = 0; b <= 5; b++) {
      var m = Math.pow(2, a) * Math.pow(3, b); if (m > 1296) continue;
      var k = Math.round(f * m); if (k <= 0 || k >= m) continue;
      var err = Math.abs(k / m - f);
      var score = err * rate + m * 0.0005;
      if (!best || score < best.score - 1e-12) best = { k: k, m: m, err: err, score: score };
    }
    if (!best) return null;
    var g = gcd(best.k, best.m); var k2 = best.k / g, m2 = best.m / g;
    return { k: k2, m: m2, got: rate * k2 / m2, layers: treeText(m2) };
  }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  /* ---------- Game file (en-US.json / Docs.json) import ---------- */
  function decodeBuffer(buf) {
    var u = new Uint8Array(buf);
    if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder('utf-16le').decode(u.subarray(2));
    if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder('utf-16be').decode(u.subarray(2));
    if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return new TextDecoder('utf-8').decode(u.subarray(3));
    if (u.length > 1 && u[1] === 0) return new TextDecoder('utf-16le').decode(u);
    return new TextDecoder('utf-8').decode(u);
  }
  var SLOTS = { Build_SmelterMk1_C:1, Build_ConstructorMk1_C:1, Build_AssemblerMk1_C:2, Build_FoundryMk1_C:2, Build_OilRefinery_C:2, Build_Converter_C:2, Build_ManufacturerMk1_C:4, Build_Blender_C:4, Build_HadronCollider_C:4, Build_QuantumEncoder_C:4, Build_Packager_C:0 };
  var PROD_BUILDINGS = ['Build_SmelterMk1_C', 'Build_ConstructorMk1_C', 'Build_AssemblerMk1_C', 'Build_FoundryMk1_C', 'Build_OilRefinery_C', 'Build_Converter_C', 'Build_ManufacturerMk1_C', 'Build_Blender_C', 'Build_HadronCollider_C', 'Build_QuantumEncoder_C', 'Build_Packager_C'];
  function parseAmounts(s) {
    var out = [], re = /([A-Za-z0-9_]+_C)\W*,\s*Amount=([\d.]+)/g, m;
    while ((m = re.exec(s || ''))) out.push([m[1], parseFloat(m[2])]);
    return out;
  }
  function importDocs(text) {
    var arr = JSON.parse(text.replace(/^﻿/, ''));
    if (!Array.isArray(arr)) throw new Error('This file is not the game\'s Docs file.');
    var items = {}, buildings = {}, recipesRaw = [];
    arr.forEach(function (grp) {
      var nc = grp.NativeClass || '';
      (grp.Classes || []).forEach(function (c) {
        var cn = c.ClassName || '';
        if (/\.FGRecipe'?$/.test(nc)) {
          if (c.mProduct && c.mIngredients !== undefined) recipesRaw.push(c);
        } else if (/FGBuildableManufacturer/.test(nc)) {
          if (PROD_BUILDINGS.indexOf(cn) >= 0) buildings[cn] = { n: c.mDisplayName, p: parseFloat(c.mPowerConsumption) || 0, x: parseFloat(c.mPowerConsumptionExponent) || 1.321929, s: SLOTS[cn] != null ? SLOTS[cn] : (parseInt(c.mProductionShardSlotSize, 10) || 0) };
        } else if (c.mForm && c.mDisplayName !== undefined && /^(Desc_|BP_)/.test(cn)) {
          var liquid = c.mForm === 'RF_LIQUID' || c.mForm === 'RF_GAS';
          var e = { n: c.mDisplayName || cn };
          if (liquid) e.l = 1;
          var pts = parseInt(c.mResourceSinkPoints, 10); if (pts) e.p = pts;
          var ev = parseFloat(c.mEnergyValue); if (ev) e.e = liquid ? ev * 1000 : ev;
          var SS = { SS_ONE: 1, SS_SMALL: 50, SS_MEDIUM: 100, SS_BIG: 200, SS_HUGE: 500 };
          if (!liquid && SS[c.mStackSize]) e.ss = SS[c.mStackSize];
          items[cn] = e;
        }
      });
    });
    var recipes = [];
    recipesRaw.forEach(function (c) {
      var pin = (c.mProducedIn || '').match(/Build_[A-Za-z0-9_]+_C/g) || [];
      var b = pin.filter(function (x) { return buildings[x]; })[0];
      if (!b) return;
      var ins = parseAmounts(c.mIngredients), outs = parseAmounts(c.mProduct);
      if (!outs.length) return;
      if (outs.some(function (p) { return /Xmas|Ficsmas|Fireworks|Snow|Candy/i.test(p[0]); })) return; // seasonal FICSMAS recipes
      var ok = true;
      ins.concat(outs).forEach(function (p) { if (!items[p[0]]) ok = false; else if (items[p[0]].l) p[1] = p[1] / 1000; });
      if (!ok) return;
      var alt = /Alternate/i.test(c.ClassName) || /^Alternate:/i.test(c.mDisplayName || '');
      var r = { id: c.ClassName, n: (c.mDisplayName || c.ClassName).replace(/^Alternate:\s*/i, ''), a: alt ? 1 : 0, t: parseFloat(c.mManufactoringDuration) || 1, b: b, i: ins, o: outs };
      var vc = parseFloat(c.mVariablePowerConsumptionConstant), vf = parseFloat(c.mVariablePowerConsumptionFactor);
      // Every recipe carries a default 0/1 pair; only other values mean variable power.
      if (vf > 0 && (vc > 0 || Math.abs(vf - 1) > 1e-9)) r.v = [vc || 0, (vc || 0) + vf];
      recipes.push(r);
    });
    if (recipes.length < 100 || !Object.keys(buildings).length) throw new Error('Could not find the recipe tables in this file. Make sure it is en-US.json from the Docs folder.');
    var used = {};
    recipes.forEach(function (r) { r.i.concat(r.o).forEach(function (p) { used[p[0]] = 1; }); });
    var keep = {};
    Object.keys(items).forEach(function (k) { if (used[k] || NODE_RES.indexOf(k) >= 0 || items[k].e) keep[k] = items[k]; });
    recipes.sort(function (a, b) { return a.a - b.a || a.n.localeCompare(b.n); });
    return { src: 'Your game file', items: keep, recipes: recipes, buildings: buildings };
  }

  // Find recycling loops: groups of steps that feed each other in a circle (e.g. Recycled Rubber <-> Recycled Plastic).
  // A loop can't start on its own, so the planner warns and says how much to prime it with.
  function findLoops(res) {
    if (!res || !res.ok) return [];
    var st = res.steps, n = st.length, adj = [];
    for (var i = 0; i < n; i++) {
      adj.push([]);
      for (var j = 0; j < n; j++) if (i !== j && st[i].rates.outs.some(function (o) { return st[j].rates.ins.some(function (q) { return q[0] === o[0]; }); })) adj[i].push(j);
    }
    var index = 0, idx = [], low = [], on = [], stack = [], comps = [];
    function sc(v) {
      idx[v] = low[v] = index++; stack.push(v); on[v] = true;
      adj[v].forEach(function (w) { if (idx[w] == null) { sc(w); low[v] = Math.min(low[v], low[w]); } else if (on[w]) low[v] = Math.min(low[v], idx[w]); });
      if (low[v] === idx[v]) { var c = [], w; do { w = stack.pop(); on[w] = false; c.push(w); } while (w !== v); if (c.length > 1) comps.push(c); }
    }
    for (var v = 0; v < n; v++) if (idx[v] == null) sc(v);
    return comps.map(function (c) {
      var steps = c.map(function (k) { return st[k]; }), made = {}, used = {};
      steps.forEach(function (s) {
        s.rates.outs.forEach(function (q) { made[q[0]] = (made[q[0]] || 0) + q[1] * s.x; });
        s.rates.ins.forEach(function (q) { used[q[0]] = (used[q[0]] || 0) + q[1] * s.x; });
      });
      var items = Object.keys(made).filter(function (k) { return used[k] > 1e-9; }).map(function (k) { return { item: k, rate: Math.min(made[k], used[k]) }; });
      return { steps: steps, items: items };
    }).filter(function (l) { return l.items.length; });
  }

  return { findLoops: findLoops, BELTS: BELTS, PIPES: PIPES, WORLD_MAX: WORLD_MAX, EXTRACTORS: EXTRACTORS, PURITY: PURITY, GENS: GENS,
    prep: prep, name: name, isFluid: isFluid, rates: rates, solve: solveClean, solveRaw: solve, layout: layout, beltFor: beltFor,
    extract: extract, power: power, splitEqual: splitEqual, splitTake: splitTake, decodeBuffer: decodeBuffer, importDocs: importDocs, recipeAllowed: recipeAllowed };
})();
if (typeof module !== 'undefined') module.exports = ENG;
