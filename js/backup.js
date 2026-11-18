/* Backup, restore and share links for saved data. No DOM in here, so it can be tested in Node.

   A backup file is JSON:
   { app:'satisfactory-build-planner', version:1, exported:'<ISO date>',
     state:{ worlds, wid, plans, node, power, split, tr, v:1 },   // same shape as localStorage sbp_state
     factories:[ ... ],                                           // same shape as localStorage sbp_factories
     flowCols:'type', gameData:{ ... } }                          // optional; gameData is a loaded game file (sbp_gamedata)
   Import also accepts a bare sbp_state object or a bare factories array, so data copied straight out of
   localStorage (for example from the old Claude artifact) can be brought in too.
   A share link is the same JSON for one world, compressed and put in the URL hash as  #share=<token>. */
var BACKUP = (function () {
  var APP = 'satisfactory-build-planner', VERSION = 1;
  var BAD_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };
  var MODES = { mode: ['rate', 'max'], goal: ['raw', 'power', 'buildings'], layout: ['fill', 'even'] };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // JSON.parse that drops keys which could tamper with object prototypes.
  function parseJSON(text) {
    return JSON.parse(String(text).replace(/^﻿/, ''), function (k, v) { return BAD_KEYS[k] ? undefined : v; });
  }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function str(x, max, dflt) { var s = x == null ? '' : String(x); s = s.slice(0, max); return s || dflt; }
  function num(x, lo, hi, dflt) { x = +x; return isFinite(x) && x >= lo && x <= hi ? x : dflt; }
  function plainMap(x) { return isObj(x) ? x : {}; }

  function build(p) {
    var o = { app: APP, version: VERSION, exported: new Date().toISOString(), state: p.state, factories: p.factories || [] };
    if (p.flowCols) o.flowCols = p.flowCols;
    if (p.gameData) o.gameData = p.gameData;
    return o;
  }

  /* ---- reading ---- */
  // Text -> { state, factories, flowCols, gameData } (not yet checked). Throws an Error with a plain-English message.
  function parse(text) {
    var obj;
    try { obj = parseJSON(text); } catch (e) { throw new Error('That file is not a backup (it is not valid JSON).'); }
    if (Array.isArray(obj) && obj.length && obj[0] && obj[0].NativeClass) throw new Error('That is the game\'s own recipe file. Load it under "Recipe data" instead.');
    if (Array.isArray(obj)) {
      if (obj.every(function (f) { return isObj(f) && f.plan; })) return { state: null, factories: obj };
      throw new Error('That file is not a Satisfactory Build Planner backup.');
    }
    if (!isObj(obj)) throw new Error('That file is not a Satisfactory Build Planner backup.');
    if (obj.app === APP) {
      if (obj.version > VERSION) throw new Error('That backup was made by a newer version of the planner. Reload this page and try again.');
      if (!isObj(obj.state) && !Array.isArray(obj.factories)) throw new Error('That backup is empty.');
      return { state: isObj(obj.state) ? obj.state : null, factories: obj.factories, flowCols: obj.flowCols, gameData: obj.gameData };
    }
    if (Array.isArray(obj.worlds)) return { state: obj, factories: null };
    if (obj.recipes && obj.items) throw new Error('That is a loaded game file, not a backup. Load the game\'s en-US.json under "Recipe data" instead.');
    throw new Error('That file is not a Satisfactory Build Planner backup.');
  }

  function cleanWorld(w, defaults) {
    if (!isObj(w) || typeof w.id !== 'string' || !w.id) return null;
    var o = Object.assign(defaults.world(), w);
    o.id = w.id.slice(0, 40);
    o.name = str(w.name, 80, 'Imported world');
    o.allAlts = !!o.allAlts; o.converter = !!o.converter;
    o.alts = plainMap(o.alts); o.disabled = plainMap(o.disabled); o.prefer = plainMap(o.prefer);
    o.maxBelt = Math.round(num(o.maxBelt, 1, 6, 6)); o.maxPipe = Math.round(num(o.maxPipe, 1, 2, 2));
    o.costMult = num(o.costMult, 0.01, 100, 1); o.powerMult = num(o.powerMult, 0.01, 100, 1);
    return o;
  }
  function cleanPlan(p, defaults) {
    if (!isObj(p)) return null;
    var o = Object.assign(defaults.plan(), p);
    o.targets = (Array.isArray(o.targets) ? o.targets : []).filter(isObj).map(function (t) { return { item: str(t.item, 80, ''), rate: num(t.rate, 0, 1e9, 0) }; });
    o.inputs = (Array.isArray(o.inputs) ? o.inputs : []).filter(isObj).map(function (t) { return { item: str(t.item, 80, ''), rate: num(t.rate, 0, 1e9, 0) }; });
    o.locks = plainMap(o.locks); o.amp = plainMap(o.amp); o.built = plainMap(o.built);
    o.maxItem = str(o.maxItem, 80, '');
    o.maxClock = num(o.maxClock, 1, 250, 100);
    Object.keys(MODES).forEach(function (k) { if (MODES[k].indexOf(o[k]) < 0) o[k] = defaults.plan()[k]; });
    return o;
  }
  function cleanFactory(f, defaults) {
    if (!isObj(f) || typeof f.id !== 'string' || !f.id || typeof f.wid !== 'string' || !f.wid) return null;
    var plan = cleanPlan(f.plan, defaults);
    if (!plan) return null;
    function nums(m) { var r = {}; Object.keys(plainMap(m)).forEach(function (k) { var v = +m[k]; if (isFinite(v)) r[k] = v; }); return r; }
    return {
      id: f.id.slice(0, 40), wid: f.wid.slice(0, 40), name: str(f.name, 120, 'Factory'), saved: num(f.saved, 0, 1e15, 0), plan: plan,
      outputs: nums(f.outputs), inputs: nums(f.inputs), machines: num(f.machines, 0, 1e9, 0), power: num(f.power, 0, 1e12, 0),
      steps: num(f.steps, 0, 1e6, 0), builtDone: num(f.builtDone, 0, 1e6, 0)
    };
  }
  function cleanGameData(g) {
    return isObj(g) && Array.isArray(g.recipes) && g.recipes.length >= 100 && isObj(g.items) && isObj(g.buildings) ? g : null;
  }

  /* defaults: { world: fn returning a fresh default world, plan: fn returning a fresh default plan }.
     Returns checked data plus plain-English warnings about anything that had to be dropped. */
  function normalize(raw, defaults) {
    var warnings = [], out = { worlds: [], plans: {}, wid: null, factories: [], node: null, power: null, split: null, tr: null, flowCols: null, gameData: null, warnings: warnings };
    var st = raw.state;
    if (st) {
      var seen = {}, badW = 0;
      (Array.isArray(st.worlds) ? st.worlds : []).forEach(function (w) {
        var c = cleanWorld(w, defaults);
        if (!c || seen[c.id]) { badW++; return; }
        seen[c.id] = 1; out.worlds.push(c);
        var p = plainMap(st.plans)[c.id];
        if (p) { var cp = cleanPlan(p, defaults); if (cp) out.plans[c.id] = cp; }
      });
      if (badW) warnings.push('Skipped ' + badW + ' world' + (badW === 1 ? '' : 's') + ' that could not be read.');
      out.wid = typeof st.wid === 'string' && seen[st.wid] ? st.wid : (out.worlds[0] && out.worlds[0].id) || null;
      ['node', 'power', 'split', 'tr'].forEach(function (k) { if (isObj(st[k])) out[k] = st[k]; });
    }
    var dropped = 0;
    (Array.isArray(raw.factories) ? raw.factories : []).forEach(function (f) { var c = cleanFactory(f, defaults); if (c) out.factories.push(c); else dropped++; });
    if (dropped) warnings.push('Skipped ' + dropped + ' factor' + (dropped === 1 ? 'y' : 'ies') + ' that could not be read.');
    if (raw.flowCols === 'type' || raw.flowCols === 'item') out.flowCols = raw.flowCols;
    if (raw.gameData) { out.gameData = cleanGameData(raw.gameData); if (!out.gameData) warnings.push('Left out the game file in this backup because it looks incomplete.'); }
    if (!out.worlds.length && !out.factories.length) throw new Error('There is nothing in that file to import.');
    return out;
  }

  /* ---- applying ---- */
  // What importing would do, for the preview. cur: { worlds, factories }.
  function describe(inc, cur) {
    var haveW = {}, haveF = {};
    cur.worlds.forEach(function (w) { haveW[w.id] = 1; });
    cur.factories.forEach(function (f) { haveF[f.id] = 1; });
    return {
      worlds: inc.worlds.map(function (w) { return { id: w.id, name: w.name, exists: !!haveW[w.id] }; }),
      factories: inc.factories.length,
      factoriesReplaced: inc.factories.filter(function (f) { return haveF[f.id]; }).length,
      gameRecipes: inc.gameData ? inc.gameData.recipes.length : 0
    };
  }

  /* cur: { worlds, plans, wid, factories, node, power, split, tr }  (not modified)
     mode: 'merge' (same id replaces, new ones are added, everything else stays) or 'replace' (backup becomes everything).
     opts.select: switch to the first imported world.  Returns the new { worlds, plans, wid, factories, ... } plus counts. */
  function merge(cur, inc, mode, opts) {
    opts = opts || {};
    var out;
    var skipped = 0;
    if (mode === 'replace') {
      if (!inc.worlds.length) throw new Error('This backup has no worlds, so it can only be added to what you have.');
      out = { worlds: clone(inc.worlds), plans: clone(inc.plans), wid: inc.wid, factories: clone(inc.factories),
        node: inc.node || cur.node, power: inc.power || cur.power, split: inc.split || cur.split, tr: inc.tr || cur.tr };
    } else {
      out = { worlds: clone(cur.worlds), plans: clone(cur.plans), wid: cur.wid, factories: clone(cur.factories), node: cur.node, power: cur.power, split: cur.split, tr: cur.tr };
      inc.worlds.forEach(function (w) {
        var i = -1; out.worlds.forEach(function (x, k) { if (x.id === w.id) i = k; });
        if (i >= 0) out.worlds[i] = clone(w); else out.worlds.push(clone(w));
        if (inc.plans[w.id]) out.plans[w.id] = clone(inc.plans[w.id]);
      });
      var ids = {}; out.worlds.forEach(function (w) { ids[w.id] = 1; });
      inc.factories.forEach(function (f) {
        if (!ids[f.wid]) { skipped++; return; }
        var i = -1; out.factories.forEach(function (x, k) { if (x.id === f.id) i = k; });
        if (i >= 0) out.factories[i] = clone(f); else out.factories.push(clone(f));
      });
      if (opts.select && inc.worlds.length) out.wid = inc.worlds[0].id;
    }
    out.skippedFactories = skipped;
    return out;
  }

  /* ---- share links ---- */
  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(t) {
    t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '=';
    var bin = atob(t), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function through(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  var canZip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined';

  // Token starts with "z" (compressed) or "r" (plain), then the data.
  function encodeShare(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (!canZip) return Promise.resolve('r' + toB64(bytes));
    return through(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'z' + toB64(z); });
  }
  function decodeShare(token) {
    return Promise.resolve().then(function () {
      var kind = token.charAt(0), bytes = fromB64(token.slice(1));
      if (kind === 'r') return bytes;
      if (kind === 'z') {
        if (!canZip) throw new Error('This browser is too old to open compressed share links.');
        return through(bytes, new DecompressionStream('deflate-raw'));
      }
      throw new Error('bad token');
    }).then(function (b) { return parse(new TextDecoder().decode(b)); });
  }
  // "#share=abc" -> "abc"; anything else -> null.
  function tokenFromHash(hash) { var m = /^#?share=([A-Za-z0-9_-]+)$/.exec(hash || ''); return m ? m[1] : null; }

  return { APP: APP, VERSION: VERSION, build: build, parse: parse, normalize: normalize, describe: describe, merge: merge,
    encodeShare: encodeShare, decodeShare: decodeShare, tokenFromHash: tokenFromHash };
})();
if (typeof module !== 'undefined') module.exports = BACKUP;
