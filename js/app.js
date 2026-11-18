(function(){
"use strict";
var $ = function(s, r){ return (r||document).querySelector(s); };
var esc = function(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
function fmt(n, d){ if (n==null || !isFinite(n)) return '–'; var a=Math.abs(n); var dp = d!=null ? d : (a>=1000?0:a>=100?1:a>=10?2:a>=1?2:3); var s = n.toFixed(dp); if (s.indexOf('.')>=0) s = s.replace(/0+$/,'').replace(/\.$/,''); return s==='-0'?'0':s; }
function fmtClock(c){ return fmt(c, 4) + '%'; }
function uid(){ return Math.random().toString(36).slice(2,10); }
// Save text as a file through the browser's normal download.
function downloadFile(name, data, mime){
  var url = URL.createObjectURL(new Blob([data], { type: mime })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
}
function dateStamp(){ var d = new Date(), z = function(n){ return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function copyText(text, okMsg){
  var fallback = function(){ var el = $('#bkLink'); if (el){ el.focus(); el.select(); } toast('Select the link and copy it.'); };
  try { navigator.clipboard.writeText(text).then(function(){ toast(okMsg); }, fallback); } catch(e){ fallback(); }
}
/* Dark by default; the choice is kept in sbp_theme. */
function themeNow(){ return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
function themeApply(t, remember){
  document.documentElement.setAttribute('data-theme', t);
  var b = $('#themeBtn'); if (b) b.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  if (remember){ try { localStorage.setItem('sbp_theme', t); } catch(e){} }
}

/* ---------------- state ---------------- */
var S = {
  D: null, dataIsMine: false, compare: null,
  worlds: [], wid: null, plans: {}, factories: [],
  tab: 'plan', view: 'list', result: null,
  node: { res:'Desc_OreIron_C', kind:'mk3', purity:'pure', clock:100, count:1 },
  power: { gen:'coal', fuel:'Desc_Coal_C', mode:'count', value:8, clock:100, purity:'normal' },
  split: { rate:480, n:4, take:120 },
  tr: { src:'item', item:'Desc_SteelPlate_C', rate:60, fac:'', facItem:'', mode:'train', rt:5, cpt:4, up:0, stacks:1 },
  altFilter: '',
  bk: { pending:null, msg:null, link:'', withGame:true }
};
function newWorld(name, creative){
  return { id: uid(), name: name, allAlts: !!creative, alts: {}, disabled: {}, prefer: {}, converter: false, maxBelt: 6, maxPipe: 2, costMult: 1, powerMult: 1 };
}
function examplePlan(){ return { mode:'rate', targets:[{item:'Desc_ModularFrame_C', rate:10}], maxItem:'', inputs:[], onlyInputs:false, freeWater:true, goal:'raw', locks:{}, amp:{}, maxClock:100, layout:'fill', example:true }; }
function world(){ var w = S.worlds.filter(function(w){ return w.id===S.wid; })[0] || S.worlds[0]; if (w){ if (!w.disabled) w.disabled = {}; if (!w.prefer) w.prefer = {}; if (!w.alts) w.alts = {}; } return w; }
function plan(){ var w = world(); if (!S.plans[w.id]) S.plans[w.id] = examplePlan(); return S.plans[w.id]; }

/* ---------------- storage: this browser only (localStorage) ----------------
   Keys: sbp_state (worlds + settings), sbp_factories, sbp_gamedata (a loaded game file), sbp_flcols, sbp_tips, sbp_theme.
   Back up and move data between devices with Export / Import on the World & data tab. */
function lsGet(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } }
var lsWarned = false;
function lsSet(k,v){
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch(e){
    if (!lsWarned){ lsWarned = true; toast('This browser won\'t let the planner save (storage is full or blocked). Use Export on the World & data tab to keep a backup.'); }
    return false;
  }
}
function snapshotState(){ return { worlds:S.worlds, wid:S.wid, plans:S.plans, node:S.node, power:S.power, split:S.split, tr:S.tr, v:1 }; }
function applyState(st){
  if (!st || !st.worlds || !st.worlds.length) return;
  // Work on an editable copy so saved data is never changed by accident.
  st = JSON.parse(JSON.stringify(st));
  S.worlds = st.worlds; S.wid = st.wid || st.worlds[0].id; S.plans = st.plans || {};
  if (st.node) S.node = st.node; if (st.power) S.power = st.power; if (st.split) S.split = st.split; if (st.tr) S.tr = Object.assign(S.tr, st.tr);
}
function save(){ lsSet('sbp_state', snapshotState()); }

/* ---------------- data ---------------- */
var itemByName = {};
function useData(raw, mine){
  S.D = ENG.prep(raw); S.dataIsMine = !!mine;
  var opts = Object.keys(S.D.items).map(function(k){ return S.D.items[k].n; }).sort();
  itemByName = {}; Object.keys(S.D.items).forEach(function(k){ itemByName[S.D.items[k].n.toLowerCase()] = k; });
  $('#itemList').innerHTML = opts.map(function(n){ return '<option value="' + esc(n) + '">'; }).join('');
  var chip = $('#dataChip');
  chip.textContent = mine ? 'Your game file' : 'Game data · 1.2';
  chip.className = 'datachip mine';
  chip.title = mine ? 'Recipes loaded from a game file you picked' : 'Recipes from your game\'s en-US.json (1.2), built in. Load a newer file after a game patch.';
}
function iname(id){ return ENG.name(S.D, id); }
function idFromName(n){ return itemByName[String(n||'').trim().toLowerCase()] || ''; }

/* ---------------- solving ---------------- */
function worldOpts(w){ w = w || world(); return { allAlts:w.allAlts, alts:w.alts || {}, converter:w.converter, disabled:w.disabled || {} }; }
function recipeOn(r, w){ w = w || world(); if (w.disabled && w.disabled[r.id]) return false; if (r.b === 'Build_Converter_C' && !w.converter) return false; return !r.a || w.allAlts || !!w.alts[r.id]; }
function solveOpts(){
  var w = world(), p = plan();
  // preferred recipes from the Recipes tab, unless this plan pins something else
  var locks = {};
  Object.keys(w.prefer || {}).forEach(function(k){ var rc = S.D.byId[w.prefer[k]]; if (rc && recipeOn(rc, w)) locks[k] = w.prefer[k]; });
  Object.keys(p.locks).forEach(function(k){ locks[k] = p.locks[k]; });
  var dis = {}; Object.keys(w.disabled || {}).forEach(function(k){ dis[k] = 1; });
  var o = { allAlts:w.allAlts, alts:w.alts, converter:w.converter, disabled:dis, costMult:w.costMult, powerMult:w.powerMult,
    goal:p.goal, clean:p.clean!==false, locks:locks, amp:p.amp, onlyInputs:p.onlyInputs, freeWater:p.freeWater };
  o.inputs = []; o.imports = {}; o.bans = {};
  p.inputs.forEach(function(t){ if (!t.item) return; var m = t.mode || 'have'; if (m === 'need') o.imports[t.item] = 1; else if (m === 'ban') o.bans[t.item] = 1; else o.inputs.push(t); });
  if (p.mode === 'max'){ o.maximize = p.maxItem; o.targets = []; }
  else o.targets = p.targets;
  return o;
}
function resolve(){
  var p = plan();
  if (p.mode === 'max' && !p.maxItem){ S.result = { ok:false, reason:'noitem' }; return; }
  if (p.mode === 'rate' && !p.targets.some(function(t){ return t.item && t.rate > 0; })){ S.result = { ok:false, reason:'empty' }; return; }
  try {
    S.result = ENG.solve(S.D, solveOpts());
    if (p.noLoops && S.result.ok) avoidLoops(p);
  }
  catch(e){ console.error(e); S.result = { ok:false, reason:'error', msg:String(e && e.message || e) }; }
}
// "Avoid recycling loops": switch off one recipe in each loop (alternates first) until none are left.
function avoidLoops(p){
  var off = {}, names = [], tries = 0, loops = ENG.findLoops(S.result);
  while (loops.length && tries++ < 6){
    var cand = loops[0].steps.slice().sort(function(a, b){ return b.recipe.a - a.recipe.a || a.x - b.x; }), done = false;
    for (var i = 0; i < cand.length && !done; i++){
      var o = solveOpts(); Object.keys(off).forEach(function(k){ o.disabled[k] = 1; }); o.disabled[cand[i].recipe.id] = 1;
      var r2 = ENG.solve(S.D, o);
      if (r2.ok){ off[cand[i].recipe.id] = 1; names.push(cand[i].recipe.n); S.result = r2; done = true; }
    }
    if (!done){ S.result.loopStuck = true; break; }
    loops = ENG.findLoops(S.result);
  }
  S.result.loopOff = names;
}
function loopNotice(r){
  var p = plan(), h = '';
  if (r.loopOff && r.loopOff.length) h += '<div class="notice good">Planned without a recycling loop by leaving out <strong>' + esc(r.loopOff.join(', ')) + '</strong>.</div>';
  ENG.findLoops(r).forEach(function(L){
    var steps = L.steps.map(function(s){ return s.recipe.n; }), its = L.items.map(function(x){ return iname(x.item); });
    var prime = L.items.slice().sort(function(a, b){ return a.rate - b.rate; })[0], pn = iname(prime.item), amt = Math.ceil(prime.rate);
    var user = L.steps.filter(function(s){ return s.rates.ins.some(function(q){ return q[0] === prime.item; }); })[0];
    var fl = ENG.isFluid(S.D, prime.item), ss = fl ? 0 : stackOf(prime.item), stacks = ss ? Math.ceil(amt / ss) : 0;
    h += '<div class="notice"><strong>Recycling loop:</strong> ' + esc(steps.join(' ↔ ')) + ' pass ' + esc(its.join(' and ')) + ' back and forth. A loop can\'t start by itself, because each machine needs the other\'s output first.' +
      '<ul class="loopsteps"><li><strong>Prime it once:</strong> put about ' + amt + (fl ? ' m³' : '') + ' ' + esc(pn) + (stacks ? ' (' + stacks + ' stack' + (stacks > 1 ? 's' : '') + ')' : '') + ' into the ' + esc(user ? user.recipe.n : 'loop') + ' ' + esc(user ? user.rates.building.n : 'machine') + '. That\'s one minute of what the loop uses. Once its output comes back around, the loop keeps itself fed.</li>' +
      '<li><strong>Or add a starter line:</strong> feed a little ' + esc(pn) + ' from a normal recipe into the loop through a Priority Merger, with the loop\'s own return on the top input. It starts the loop and restarts it after any jam.</li>' +
      '<li><strong>Or skip it:</strong> tick "Avoid recycling loops" on the left.</li></ul></div>';
  });
  if (r.loopStuck) h += '<div class="notice bad">This plan can\'t be made without a recycling loop using the recipes switched on.</div>';
  return h;
}

/* ---------------- render: shell ---------------- */
var rendering = false, rerender = false;
function render(){
  if (rendering){ rerender = true; return; }
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
  if (rerender){ rerender = false; setTimeout(render, 0); }
}
function renderNow(){
  var sel = $('#worldSel');
  sel.innerHTML = S.worlds.map(function(w){ return '<option value="' + w.id + '"' + (w.id===S.wid?' selected':'') + '>' + esc(w.name) + '</option>'; }).join('');
  document.querySelectorAll('nav.tabs a').forEach(function(a){ if (a.dataset.tab === S.tab) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  var m = $('#main');
  var f = { plan:renderPlan, recipes:renderRecipes, node:renderNode, power:renderPower, transport:renderTransport, splits:renderSplits, factories:renderFactories, world:renderWorld }[S.tab];
  var keep = document.activeElement && document.activeElement.id;
  var pos = keep && document.activeElement.selectionStart;
  var fw0 = document.getElementById('flowwrap'), fsl = fw0 ? fw0.scrollLeft : null;
  m.innerHTML = f();
  var fw1 = document.getElementById('flowwrap'); if (fw1 && fsl != null) fw1.scrollLeft = fsl;
  if (Tour.box) tourPlace();
  if (keep){ var el = document.getElementById(keep); if (el){ el.focus(); try { if (pos!=null && el.setSelectionRange) el.setSelectionRange(pos,pos); } catch(e){} } }
}
function toast(msg){ var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function(){ t.hidden = true; }, Math.max(2200, msg.length * 55)); }

/* ---------------- Plan ---------------- */
function itemInput(id, val, extra){ return '<input type="text" list="itemList" id="' + id + '" value="' + esc(val ? iname(val) : '') + '" placeholder="Item name" autocomplete="off" ' + (extra||'') + '>'; }
function seg(name, cur, opts){ return '<div class="seg" role="group">' + opts.map(function(o){ return '<button type="button" data-seg="' + name + '" data-val="' + o[0] + '" aria-pressed="' + (String(cur)===String(o[0])) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }

function renderPlan(){
  var p = plan(), w = world();
  var left = '<div class="panel sticky">';
  left += '<div class="sectionhead"><h2>What to make</h2>' + (p.example ? '<span class="example">Example plan</span>' : '') + '</div>';
  left += '<div data-tour="mode">' + seg('mode', p.mode, [['rate','Exact rate'],['max','As much as possible']]) + '</div>';
  if (p.mode === 'rate'){
    left += '<div class="field" data-tour="targets">' + p.targets.map(function(t,i){
      return '<div class="row"><div class="grow">' + itemInput('t_item_'+i, t.item, 'data-bind="t_item" data-i="'+i+'"') + '</div><input type="number" class="rate" id="t_rate_'+i+'" min="0" step="any" value="' + (t.rate||'') + '" data-bind="t_rate" data-i="'+i+'" aria-label="Rate per minute"><span class="unit">/min</span><button class="iconbtn" data-act="t_del" data-i="'+i+'" aria-label="Remove">×</button></div>';
    }).join('') + '<div><button class="btn small" data-act="t_add">+ Add product</button></div></div>';
  } else {
    left += '<div class="field" data-tour="targets"><span class="lbl">Item to maximise</span>' + itemInput('max_item', p.maxItem, 'data-bind="max_item"') + '<span class="hint">Uses only the inputs listed below.</span></div>';
  }
  var facs = S.factories.filter(function(f){ return f.wid === w.id; });
  left += '<div class="field" data-tour="inputs"><span class="lbl">Inputs and limits</span>' + (p.inputs.length ? '' : '<span class="hint">List parts or resources you already have, ones coming from another factory, or ones to keep out of this plan. Leave empty to let the planner pull raw resources freely.</span>') +
    p.inputs.map(function(t,i){
      var m = t.mode || 'have';
      return '<div class="inrow"><div class="row"><div class="grow">' + itemInput('in_item_'+i, t.item, 'data-bind="in_item" data-i="'+i+'"') + '</div><button class="iconbtn" data-act="in_del" data-i="'+i+'" aria-label="Remove">×</button></div>' +
        '<div class="row"><select id="in_mode_'+i+'" data-bind="in_mode" data-i="'+i+'" aria-label="How to handle this item" class="grow">' +
          [['have','Have up to'],['need','Bring in as needed'],['ban','Don\'t use']].map(function(o){ return '<option value="'+o[0]+'"'+(m===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('') + '</select>' +
        (m === 'have' ? '<input type="number" class="rate" id="in_rate_'+i+'" min="0" step="any" value="' + (t.rate||'') + '" data-bind="in_rate" data-i="'+i+'" aria-label="Rate per minute"><span class="unit">/min</span>' : '') + '</div>' +
        (t.src ? '<div class="hint">From your factory: ' + esc(t.src) + '</div>' : t.removed && m === 'ban' ? '<div class="hint">Removed from the plan with "Remove part".</div>' : m === 'need' ? '<div class="hint">Not made here. The plan shows how much has to come in.</div>' : m === 'ban' ? '<div class="hint">No recipes that need it, and not taken from nodes.</div>' : '') + '</div>';
    }).join('') + '<div class="row" style="flex-wrap:wrap"><button class="btn small" data-act="in_add">+ Add item</button>' +
    (facs.length ? '<select id="fromFac" data-bind="fromFac" style="width:auto;flex:1 1 170px;font-size:12px;padding:4px 6px" aria-label="Add outputs from a saved factory"><option value="">+ From a saved factory…</option>' + facs.map(function(f){ return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('') + '</select>' : '') + '</div>' +
    '<label class="check"><input type="checkbox" id="onlyInputs" data-bind="onlyInputs"' + (p.onlyInputs||p.mode==='max'?' checked':'') + (p.mode==='max'?' disabled':'') + '><span>Only use these inputs</span></label>' +
    '<label class="check"><input type="checkbox" id="freeWater" data-bind="freeWater"' + (p.freeWater!==false?' checked':'') + '><span>Water is always available</span></label></div>';
  left += '<div class="field" data-tour="goal"><span class="lbl">Optimise for</span>' + seg('goal', p.goal, [['raw','Least raw'],['power','Least power'],['buildings','Fewest machines']]) + '<span class="hint">' + ({raw:'Weights each ore by how rare it is on the map, so uranium and SAM count far more than iron.',power:'Cheapest on power. Raw use still matters a little.',buildings:'Fewest machines to build. Raw use still matters a little.'})[p.goal] + '</span></div>';
  left += '<label class="check"><input type="checkbox" id="noLoops" data-bind="noLoops"' + (p.noLoops?' checked':'') + '><span>Avoid recycling loops<br><span class="hint">Plans without loops like Recycled Rubber ↔ Recycled Plastic, which need priming to start.</span></span></label>';
  left += '<label class="check"><input type="checkbox" id="clean" data-bind="clean"' + (p.clean!==false?' checked':'') + '><span>Skip tiny side-steps<br><span class="hint">Drops steps under a quarter of a machine when that means fewer machines and less than 15% more raw use. Turn off to see the strict optimum.</span></span></label>';
  left += '<div class="field" data-tour="layout"><span class="lbl">Machine layout</span>' + seg('layout', p.layout, [['fill','Full + one remainder'],['even','All the same clock']]) + '</div>';
  left += '<div class="field"><label class="lbl" for="maxClock">Max clock speed</label><select id="maxClock" data-bind="maxClock">' + [100,150,200,250].map(function(c){ return '<option value="'+c+'"' + (p.maxClock==c?' selected':'') + '>' + c + '%' + (c>100?' (' + (c>200?3:c>150?2:1) + (c>150?' shards':' shard') + ' per machine)':'') + '</option>'; }).join('') + '</select></div>';
  var lockN = Object.keys(p.locks).length, ampN = Object.keys(p.amp).length;
  var nDis = Object.keys(w.disabled || {}).length, nPref = Object.keys(w.prefer || {}).length;
  left += '<div class="hint">' + (w.allAlts ? 'All alternate recipes are allowed in this world.' : Object.keys(w.alts).filter(function(k){return w.alts[k];}).length + ' alternates unlocked in this world.') + (nDis ? ' ' + nDis + ' recipe' + (nDis>1?'s':'') + ' switched off.' : '') + (nPref ? ' ' + nPref + ' preferred.' : '') + ' <a href="#recipes">Choose recipes</a>.' + (lockN ? ' ' + lockN + ' recipe choice' + (lockN>1?'s':'') + ' pinned.' : '') + (ampN ? ' ' + ampN + ' step' + (ampN>1?'s':'') + ' amplified.' : '') + '</div>';
  if (lockN || ampN) left += '<div><button class="btn small ghost" data-act="clear_pins">Clear pinned recipes and Somersloops</button></div>';
  left += '</div>';
  return '<div class="grid2">' + left + '<div class="results">' + renderResult() + '</div></div>';
}

function removedBar(){
  var p = plan(), rm = p.inputs.filter(function(t){ return t.removed && t.item && t.mode === 'ban'; });
  var h = '';
  if (S.rmMsg) h += '<div class="notice ' + S.rmMsg.kind + '">' + S.rmMsg.html + '</div>';
  if (rm.length) h += '<div class="rmbar"><span class="lbl">Removed from this plan</span>' + rm.map(function(t){ return '<button type="button" class="rmchip" data-act="rm_undo" data-item="' + t.item + '" title="Put ' + esc(iname(t.item)) + ' back">' + esc(iname(t.item)) + ' <span aria-hidden="true">×</span></button>'; }).join('') + '</div>';
  return h;
}
function renderResult(){
  var r = S.result, p = plan();
  if (!r) return '';
  if (!r.ok) return removedBar() + renderResultInner(r, p);
  return renderResultInner(r, p);
}
function renderResultInner(r, p){
  if (!r.ok){
    var msg = { empty:'Add a product and a rate to see the build.', noitem:'Pick the item you want as much of as possible.',
      infeasible:'This can\'t be made with the inputs and recipes allowed. Add more inputs, remove a "Don\'t use" item, untick "Only use these inputs", or switch on more recipes in the Recipes tab.',
      unbounded:'Without limits there is no maximum. Add the inputs you have with their rates, and use "Have up to" here, not "Bring in as needed".',
      error:'The solver hit an error: ' + esc(r.msg) }[r.reason] || 'No result.';
    return '<div class="notice ' + (r.reason==='empty'||r.reason==='noitem'?'info':'bad') + '">' + msg + '</div>';
  }
  var o = { maxClock:p.maxClock, layout:p.layout, maxBelt:world().maxBelt, maxPipe:world().maxPipe };
  var totM = 0, totP = 0, totSh = 0, totSl = 0;
  r.steps.forEach(function(s){ s.L = ENG.layout(S.D, s, o); totM += s.L.machines; totP += s.L.power; totSh += s.L.shards; totSl += s.L.sloops; });
  var rawCount = Object.keys(r.supply).length + Object.keys(r.given).length + Object.keys(r.imported || {}).length;
  var h = '';
  h = removedBar() + h;
  if (r.dropped){
    var cc = (r.cleanCost || []).map(function(c){ return fmt(c.rate) + '/min ' + (c.lost ? 'less ' : 'more ') + iname(c.item); });
    h += '<div class="hint">Skipped ' + r.dropped + ' tiny side-step' + (r.dropped>1?'s':'') + ' to keep this buildable' + (cc.length ? '. This costs ' + esc(cc.join(', ')) + ' versus the strict optimum. Untick "Skip tiny side-steps" to see that version.' : ', at no extra cost.') + '</div>';
  }
  h += loopNotice(r);
  if (r.maxed) h += '<div class="notice good"><strong>' + esc(iname(r.maxed)) + ': ' + fmt(r.targets[r.maxed]) + ' /min</strong> is the most these inputs can make.</div>';
  h += '<div class="summary"><div><div class="k">Machines</div><div class="v">' + totM + '</div></div><div><div class="k">Power</div><div class="v">' + fmt(totP,1) + ' <small>MW</small></div></div><div><div class="k">Inputs</div><div class="v">' + rawCount + ' <small>items</small></div></div><div><div class="k">Shards · Sloops</div><div class="v">' + totSh + ' <small>·</small> ' + totSl + '</div></div></div>';
  h += '<div class="restabs" data-tour="save">' + seg('view', S.view, [['list','Build list'],['flow','Flow'],['sheet','Sheet']]) + '<span class="spacer" style="flex:1"></span><input type="text" id="saveName" placeholder="Name this factory" style="width:auto;flex:0 1 220px"><button class="btn primary" data-act="save_factory">Save factory</button></div>';
  var bTot = r.steps.length, bDone = r.steps.filter(function(s){ return (p.built || {})[s.recipe.id]; }).length;
  if (bTot) h += '<div class="progress"><span class="lbl">Built ' + bDone + ' of ' + bTot + ' steps</span><span class="bar" aria-hidden="true"><i style="width:' + Math.round(bDone / bTot * 100) + '%"></i></span>' + (bDone ? '<button class="btn small ghost" data-act="built_clear">Clear ticks</button>' : '') + '</div>';
  if (S.view === 'sheet') h += renderSheet(r, p);
  else if (S.view === 'flow') h += renderFlow(r);
  else {
    var stages = {};
    r.steps.forEach(function(s){ (stages[s.level] = stages[s.level] || []).push(s); });
    var levels = Object.keys(stages).map(Number).sort(function(a,b){ return a-b; });
    levels.forEach(function(lv, i){
      h += '<section class="stage"><div class="stagehead"><span class="n">Stage ' + (i+1) + (i===levels.length-1?' · final':'') + '</span><span class="rule"></span></div><div class="cards">' + stages[lv].map(function(s){ return stepCard(s, o); }).join('') + '</div></section>';
    });
  }
  h += inputsTable(r, o);
  var ex = Object.keys(r.excess).filter(function(k){ return !(k in r.targets); });
  if (ex.length) h += '<div class="field"><h3>Byproducts and leftovers</h3><div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">Rate</th><th>Carry</th><th class="num">Sink value</th></tr></thead><tbody>' + ex.map(function(k){
    var b = ENG.beltFor(S.D, k, r.excess[k], o); var pts = S.D.items[k].p;
    return '<tr><td>' + esc(iname(k)) + '</td><td class="num">' + fmt(r.excess[k]) + ' /min</td><td><span class="chip ' + (b.fluid?'pipe':'belt') + (b.over?' over':'') + '">' + b.label + '</span></td><td class="num">' + (S.D.items[k].l ? 'fluid, can\'t sink' : pts ? fmt(pts*r.excess[k],0) + ' pts/min' : '–') + '</td></tr>';
  }).join('') + '</tbody></table></div><span class="hint">Feed these into another line, store them, or sink them. Fluids must be packaged before sinking.</span></div>';
  h += '<p class="hint">Power counts production machines only, at your clock settings. Miners and extractors are not included; see From a node. </p>';
  return h;
}

function flowRows(list, perMachine, dirLabel, nMach){
  return list.map(function(pr, i){
    var it = pr[0], total = pr[1];
    var b = ENG.beltFor(S.D, it, total, { maxBelt:world().maxBelt, maxPipe:world().maxPipe });
    return '<span class="dir">' + (i===0?dirLabel:'') + '</span><span class="nm' + (b.fluid?' fl':'') + '" title="' + esc(iname(it)) + '">' + esc(iname(it)) + '</span><span class="r">' + fmt(total) + '</span><span><span class="chip ' + (b.fluid?'pipe':'belt') + (b.over?' over':'') + '">' + b.label + '</span></span>';
  }).join('');
}
function stepCard(s, o){
  var r = s.recipe, L = s.L, p = plan();
  var ins = s.rates.ins.map(function(q){ return [q[0], q[1]*s.x]; });
  var outs = s.rates.outs.map(function(q){ return [q[0], q[1]*s.x]; });
  var groups = L.groups.map(function(g, i){ return (i?'<span class="plus">+</span>':'') + '<span>' + g.count + ' × ' + fmtClock(g.clock) + '</span>'; }).join('');
  var per = s.rates.ins.concat(s.rates.outs).map(function(q){ return fmt(q[1]) + ' ' + esc(iname(q[0])); });
  var prod = r.o[0][0];
  var ro = (S.result && S.result.opts) || {};
  var wo = worldOpts(); wo.bans = ro.bans;
  var alts = (S.D.producers[prod] || []).filter(function(x){ return ENG.recipeAllowed(S.D, x, wo); });
  var pref = (world().prefer || {})[prod];
  var swap = '<select data-bind="lock" data-item="' + prod + '" aria-label="Recipe for ' + esc(iname(prod)) + '"><option value="">' + (pref && !p.locks[prod] ? 'Preferred: ' : 'Auto: ') + esc(r.n) + '</option>' + alts.map(function(x){ return '<option value="' + x.id + '"' + (p.locks[prod]===x.id?' selected':'') + '>' + (x.a?'Alt: ':'') + esc(x.n) + (pref===x.id?' ★':'') + '</option>'; }).join('') + '</select>';
  var canAmp = s.rates.building.s > 0;
  var isBuilt = !!(p.built || {})[r.id];
  return '<article class="card' + (isBuilt ? ' built' : '') + '"><div class="head"><div><div class="title">' + esc(r.n) + ' ' + (r.a?'<span class="chip alt">ALT</span>':'') + (s.rates.amp?' <span class="chip sloop">Amplified</span>':'') + '</div><div class="bld">' + esc(s.rates.building.n) + ' · ' + fmt(L.power,1) + ' MW' + (L.shards?' · ' + L.shards + ' shards':'') + (L.sloops?' · ' + L.sloops + ' Somersloops':'') + '</div></div><label class="builtbox" title="Tick when you\'ve built this step"><input type="checkbox" data-bind="built" data-rid="' + r.id + '"' + (isBuilt?' checked':'') + '><span>Built</span></label></div>' +
    '<div class="machines">' + groups + (L.groups.length>1||L.groups[0].count>1 ? '<span class="of">= ' + L.machines + ' machines</span>' : '') + '</div>' +
    '<div class="flows">' + flowRows(ins, true, 'IN') + flowRows(outs, true, 'OUT') + '</div>' +
    '<div class="hint mono" title="Per machine at 100%">Each at 100%: ' + per.join(' · ') + '</div>' +
    '<div class="foot">' + swap + '<span class="spacer"></span>' + (!(prod in (S.result.targets || {})) ? '<button class="btn small ghost" data-act="rm_part" data-item="' + prod + '" title="Take ' + esc(iname(prod)) + ' out of this plan and route around it">Remove part</button>' : '') + (canAmp ? '<button class="btn small" data-act="amp" data-rid="' + r.id + '" aria-pressed="' + !!p.amp[r.id] + '">' + (p.amp[r.id] ? 'Remove Somersloops' : 'Fill Somersloops (' + s.rates.building.s + ' each)') + '</button>' : '') + '</div></article>';
}
function nodes(x){ return x < 0.1 ? 'under a tenth of' : '≈ ' + fmt(x, x < 10 ? 1 : 0); }
function nodeHint(k, rate){
  if (k === 'Desc_Water_C'){ var w = Math.ceil(rate/120 - 1e-9); return w + ' Water Extractor' + (w===1?'':'s'); }
  if (k === 'Desc_LiquidOil_C') return nodes(rate/240) + ' pure Oil Extractor (' + fmt(rate/120,1) + ' normal)';
  if (k === 'Desc_NitrogenGas_C') return 'Resource Well: ' + nodes(rate/120) + ' pure satellites';
  if (S.D.raw[k] === 'node') return nodes(rate/480) + ' pure node at Mk3 100% (' + fmt(rate/240,1) + ' normal)';
  if (S.D.raw[k] === 'gathered') return 'Gathered by hand';
  return 'From your inputs';
}
function inputsTable(r, o){
  var rows = [];
  Object.keys(r.given).forEach(function(k){ rows.push([k, r.given[k], 'given']); });
  Object.keys(r.supply).forEach(function(k){ rows.push([k, r.supply[k], 'raw']); });
  Object.keys(r.imported || {}).forEach(function(k){ rows.push([k, r.imported[k], 'import']); });
  if (!rows.length) return '';
  rows.sort(function(a,b){ return b[1]-a[1]; });
  return '<div class="field"><h3>Inputs to bring in</h3><div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">Rate</th><th>Carry</th><th>Source</th><th></th></tr></thead><tbody>' + rows.map(function(x){
    var b = ENG.beltFor(S.D, x[0], x[1], o);
    var rows2 = plan().inputs.filter(function(t){ return t.item===x[0] && (t.mode||'have')==='have'; });
    var cap = rows2.reduce(function(a,t){ return a + (t.rate||0); }, 0), srcs = rows2.filter(function(t){ return t.src; }).map(function(t){ return t.src; });
    var src = x[2]==='given' ? (srcs.length ? 'From ' + esc(srcs.join(', ')) : 'Your input') + ' (' + fmt(cap) + ' available)' : x[2]==='import' ? '<strong>Bring in from elsewhere</strong>' : nodeHint(x[0], x[1]);
    return '<tr><td>' + esc(iname(x[0])) + '</td><td class="num">' + fmt(x[1]) + ' /min</td><td><span class="chip ' + (b.fluid?'pipe':'belt') + (b.over?' over':'') + '">' + b.label + '</span></td><td class="hint">' + src + '</td><td>' + (x[2]==='raw' ? '<button class="btn small ghost" data-act="rm_part" data-item="' + x[0] + '" title="Plan without ' + esc(iname(x[0])) + '">Remove</button>' : '') + '</td></tr>';
  }).join('') + '</tbody></table></div></div>';
}

/* ---------------- Flow diagram ---------------- */
function clockText(L, dp, tight){ return L.groups.map(function(g){ return g.count + (tight ? '×' : ' × ') + fmt(g.clock, dp) + '%'; }).join(' + '); }
function tipFlows(list, label){
  return list.map(function(q, i){
    var b = ENG.beltFor(S.D, q[0], q[1], { maxBelt:world().maxBelt, maxPipe:world().maxPipe });
    return '<span class="d">' + (i ? '' : label) + '</span><span class="n">' + esc(iname(q[0])) + '</span><span class="v">' + fmt(q[1]) + '</span><span class="e">' + (q[2] != null ? fmt(q[2]) + ' each' : '') + '</span><span><span class="chip ' + (b.fluid ? 'pipe' : 'belt') + (b.over ? ' over' : '') + '">' + b.label + '</span></span>';
  }).join('');
}
function flowTip(n, r){
  var h = '';
  if (n.step){
    var s = n.step, L = s.L, rc = s.recipe;
    h += '<div class="tt">' + esc(rc.n) + (rc.a ? ' <span class="chip alt">ALT</span>' : '') + (s.rates.amp ? ' <span class="chip sloop">Amplified</span>' : '') + '</div>';
    h += '<div class="ts">' + esc(s.rates.building.n) + ' · cycle ' + fmt(rc.t) + ' s</div>';
    h += '<div class="tg">' + L.groups.map(function(g){ return '<div><b>' + g.count + ' ×</b> ' + fmt(g.clock, 4) + '%</div>'; }).join('') + '</div>';
    var each = function(q){ return q[1]; };
    h += '<div class="tf">' + tipFlows(s.rates.ins.map(function(q){ return [q[0], q[1] * s.x, q[1]]; }), 'IN') + tipFlows(s.rates.outs.map(function(q){ return [q[0], q[1] * s.x, q[1]]; }), 'OUT') + '</div>';
    h += '<div class="tk"><span>Power <b>' + fmt(L.power, 1) + ' MW</b></span><span>Machines <b>' + L.machines + '</b></span>' + (L.shards ? '<span>Shards <b>' + L.shards + '</b></span>' : '') + (L.sloops ? '<span>Somersloops <b>' + L.sloops + '</b></span>' : '') + '</div>';
    h += '<div class="tn">"Each" is one machine at 100%.</div>';
  } else {
    var it = n.key.slice(n.key.indexOf(':') + 1), rate = n.kind === 'src' ? (Object.keys(n.outs).reduce(function(a, k){ return a + n.outs[k]; }, 0)) : (Object.keys(n.ins).reduce(function(a, k){ return a + n.ins[k]; }, 0));
    var b = ENG.beltFor(S.D, it, rate, { maxBelt:world().maxBelt, maxPipe:world().maxPipe }), pts = S.D.items[it] && S.D.items[it].p;
    h += '<div class="tt">' + esc(iname(it)) + '</div>';
    h += '<div class="ts">' + ({ src:'Input', out:'Finished product', bp:'Spare byproduct' })[n.kind] + '</div>';
    h += '<div class="tk"><span>Rate <b>' + fmt(rate) + ' /min</b></span><span><span class="chip ' + (b.fluid ? 'pipe' : 'belt') + (b.over ? ' over' : '') + '">' + b.label + '</span></span></div>';
    if (n.kind === 'src'){
      var srcTxt = r.given[it] ? 'From your inputs' : (r.imported || {})[it] ? 'Brought in from elsewhere' : nodeHint(it, rate);
      h += '<div class="tn">' + esc(srcTxt) + '</div>';
    } else if (S.D.items[it] && S.D.items[it].l) h += '<div class="tn">Fluid. Package it before sinking, or pipe it to another line.</div>';
    else if (pts) h += '<div class="tn">Sink value ' + fmt(pts * rate, 0) + ' points/min (' + pts + ' each).</div>';
  }
  return h;
}
function renderFlow(r){
  S.flowTips = {};
  var NW = 172, GW = 196, PS = 20, VG = 26, TOPY = 40, LABZ = 124;
  var nodes = [], byKey = {}, links = [];
  function node(key, kind, label, sub, col){ if (!byKey[key]){ byKey[key] = { key:key, kind:kind, label:label, sub:sub, col:col, ins:{}, outs:{} }; nodes.push(byKey[key]); } return byKey[key]; }
  var maxLv = 0; r.steps.forEach(function(s){ if (s.level > maxLv) maxLv = s.level; });
  var outCol = maxLv + 1;
  Object.keys(r.given).forEach(function(k){ var sr = plan().inputs.filter(function(t){ return t.item === k && t.src; })[0]; node('src:'+k, 'src', iname(k), fmt(r.given[k]) + ' /min ' + (sr ? 'from ' + sr.src : 'in'), 0); });
  Object.keys(r.imported || {}).forEach(function(k){ node('src:'+k, 'src', iname(k), fmt(r.imported[k]) + ' /min brought in', 0); });
  Object.keys(r.supply).forEach(function(k){ node('src:'+k, 'src', iname(k), fmt(r.supply[k]) + ' /min raw', 0); });
  r.steps.forEach(function(s, i){ s._key = 'st:'+i; node(s._key, 'step', s.recipe.n, s.L.machines + ' × ' + s.rates.building.n, s.level).step = s; });
  Object.keys(r.targets).forEach(function(k){ node('out:'+k, 'out', iname(k), fmt(r.targets[k] + (r.excess[k]||0)) + ' /min', outCol); });
  Object.keys(r.excess).forEach(function(k){ if (!(k in r.targets)) node('bp:'+k, 'bp', iname(k), fmt(r.excess[k]) + ' /min spare', outCol); });
  // Split each item's production across its consumers in proportion.
  var items = {};
  function add(it, side, key, amt){ items[it] = items[it] || { p:[], c:[] }; items[it][side].push([key, amt]); }
  Object.keys(r.given).forEach(function(k){ add(k,'p','src:'+k,r.given[k]); });
  Object.keys(r.imported || {}).forEach(function(k){ add(k,'p','src:'+k,r.imported[k]); });
  Object.keys(r.supply).forEach(function(k){ add(k,'p','src:'+k,r.supply[k]); });
  r.steps.forEach(function(s){ Object.keys(s.outs).forEach(function(k){ add(k,'p',s._key,s.outs[k]); }); Object.keys(s.ins).forEach(function(k){ add(k,'c',s._key,s.ins[k]); }); });
  Object.keys(r.targets).forEach(function(k){ add(k,'c','out:'+k,r.targets[k]); });
  Object.keys(r.excess).forEach(function(k){ add(k,'c', (k in r.targets) ? 'out:'+k : 'bp:'+k, r.excess[k]); });
  Object.keys(items).forEach(function(it){
    var P = items[it].p, C = items[it].c, tp = P.reduce(function(a,x){ return a+x[1]; }, 0);
    if (tp <= 0) return;
    P.forEach(function(p){ C.forEach(function(c){ var f = p[1]*c[1]/tp; if (f > 1e-6 && p[0] !== c[0]) links.push({ s:byKey[p[0]], t:byKey[c[0]], v:f, item:it }); }); });
  });
  var maxV = 1e-9; links.forEach(function(l){ if (l.v > maxV) maxV = l.v; l.s.outs[l.item] = (l.s.outs[l.item]||0) + l.v; l.t.ins[l.item] = (l.t.ins[l.item]||0) + l.v; });
  // Columns: every machine sits left of the machines it feeds. Recycling loops are found first and left out.
  var stepN = nodes.filter(function(n){ return n.kind === 'step'; });
  var succ = {}, pred = {};
  links.forEach(function(l){ if (l.s.kind === 'step' && l.t.kind === 'step'){ (succ[l.s.key] = succ[l.s.key] || []).push(l); (pred[l.t.key] = pred[l.t.key] || []).push(l); } });
  var mark = {};
  function dfs(n){ mark[n.key] = 1; (succ[n.key] || []).forEach(function(l){ if (mark[l.t.key] === 1) l.cyc = true; else if (!mark[l.t.key]) dfs(l.t); }); mark[n.key] = 2; }
  stepN.slice().sort(function(a, b){ return (pred[a.key] || []).length - (pred[b.key] || []).length; }).forEach(function(n){ if (!mark[n.key]) dfs(n); });
  var lvl = {};
  function asap(n){ if (lvl[n.key]) return lvl[n.key]; lvl[n.key] = -1; var m = 1; (pred[n.key] || []).forEach(function(l){ if (!l.cyc) m = Math.max(m, asap(l.s) + 1); }); lvl[n.key] = m; return m; }
  stepN.forEach(asap);
  var maxL = 0; stepN.forEach(function(n){ if (lvl[n.key] > maxL) maxL = lvl[n.key]; });
  outCol = maxL + 1;
  // Pull a machine right, toward what it feeds, when that shortens more line than it adds.
  stepN.slice().sort(function(a, b){ return lvl[b.key] - lvl[a.key]; }).forEach(function(n){
    var lim = outCol - 1, outW = 0, inW = 0;
    links.forEach(function(l){
      if (l.s === n && !l.cyc){ outW += l.v; if (l.t.kind === 'step') lim = Math.min(lim, lvl[l.t.key] - 1); }
      if (l.t === n && !l.cyc) inW += l.v;
    });
    if (lim > lvl[n.key] && outW >= inW) lvl[n.key] = lim;
  });
  nodes.forEach(function(n){ if (n.kind === 'step') n.col = lvl[n.key]; else if (n.kind === 'out' || n.kind === 'bp') n.col = outCol; });
  // Part-type columns: group blocks by the game codex's part categories, in the order this factory flows.
  var colHeads = null;
  if ((S.flowCols || 'type') === 'type'){
    var CAT = FLOWCATS.cat, ORD = FLOWCATS.order;
    var real = nodes.filter(function(n){ return n.kind === 'src' || n.kind === 'step'; });
    real.forEach(function(n){ var it = mainItem(n); n.cat = CAT[it] || (S.D.raw[it] ? 'Ores' : 'Special'); });
    var catSet = {}, cEdge = {}, indeg = {};
    real.forEach(function(n){ catSet[n.cat] = 1; indeg[n.cat] = 0; });
    links.forEach(function(l){
      if (l.cyc || !l.s.cat || !l.t.cat || l.s.cat === l.t.cat || l.t.kind === 'out' || l.t.kind === 'bp') return;
      cEdge[l.s.cat] = cEdge[l.s.cat] || {};
      if (!cEdge[l.s.cat][l.t.cat]){ cEdge[l.s.cat][l.t.cat] = 1; indeg[l.t.cat]++; }
    });
    var rank = function(c){ var i = ORD.indexOf(c); return i < 0 ? 99 : i; };
    var left = Object.keys(catSet), order = [];
    while (left.length){
      var ready = left.filter(function(c){ return indeg[c] === 0; });
      if (!ready.length) ready = left.slice(); // a loop between groups: fall back to codex order
      ready.sort(function(a, b){ return rank(a) - rank(b); });
      var pick = ready[0]; order.push(pick); left.splice(left.indexOf(pick), 1);
      Object.keys(cEdge[pick] || {}).forEach(function(t){ indeg[t]--; });
    }
    var sub = {}, busy = {};
    var subOf = function(n){
      if (sub[n.key] != null) return sub[n.key];
      if (busy[n.key]) return 0; busy[n.key] = 1;
      var m = 0;
      links.forEach(function(l){ if (l.t === n && !l.cyc && l.s.cat === n.cat && (l.s.kind === 'src' || l.s.kind === 'step')) m = Math.max(m, subOf(l.s) + 1); });
      busy[n.key] = 0; return (sub[n.key] = m);
    };
    var colNo = 0, offs = {}; colHeads = [];
    order.forEach(function(c){
      var mx = 0; real.forEach(function(n){ if (n.cat === c) mx = Math.max(mx, subOf(n)); });
      offs[c] = colNo; colHeads.push({ label:c, from:colNo, to:colNo + mx }); colNo += mx + 1;
    });
    real.forEach(function(n){ n.col = offs[n.cat] + subOf(n); });
    outCol = colNo;
    nodes.forEach(function(n){ if (n.kind === 'out' || n.kind === 'bp') n.col = outCol; });
    colHeads.push({ label:'Outputs', from:outCol, to:outCol });
  }
  // Colour each item. Raw resources get a colour that suits them; no two items meeting at one block share a colour.
  var PREF = { Desc_Water_C:0, Desc_OreCopper_C:1, Desc_NitrogenGas_C:2, Desc_OreGold_C:3, Desc_Sulfur_C:3, Desc_RawQuartz_C:4, Desc_OreUranium_C:5, Desc_LiquidOil_C:6, Desc_OreIron_C:7, Desc_OreBauxite_C:7 };
  var itemCol = {}, firstCol = {}, rate = {}, nb = {};
  links.forEach(function(l){ var c = l.s.col; if (!(l.item in firstCol) || c < firstCol[l.item]) firstCol[l.item] = c; rate[l.item] = (rate[l.item] || 0) + l.v; });
  nodes.forEach(function(n){
    var its = Object.keys(n.ins).concat(Object.keys(n.outs));
    its.forEach(function(a){ nb[a] = nb[a] || {}; its.forEach(function(b){ if (a !== b) nb[a][b] = 1; }); });
  });
  Object.keys(firstCol).sort(function(a, b){ return firstCol[a] - firstCol[b] || (a in PREF ? 0 : 1) - (b in PREF ? 0 : 1) || rate[b] - rate[a]; }).forEach(function(it){
    var used = {}; Object.keys(nb[it] || {}).forEach(function(o){ if (o in itemCol) used[itemCol[o]] = (used[itemCol[o]] || 0) + 1; });
    // Spread colours: prefer one nobody uses yet; if all are taken, reuse the one whose items sit furthest away.
    var score = function(c){
      var sc = (used[c] || 0) * 1000;
      Object.keys(itemCol).forEach(function(o){ if (itemCol[o] === c){ var d = Math.abs(firstCol[o] - firstCol[it]); sc += 10 + Math.max(0, 4 - d) * 5; } });
      return sc;
    };
    var pick = (it in PREF && !used[PREF[it]] && score(PREF[it]) < 10) ? PREF[it] : -1;
    if (pick < 0){ pick = 0; var best = Infinity; for (var c = 0; c < 8; c++){ var v = score(c); if (v < best){ best = v; pick = c; } } }
    itemCol[it] = pick;
  });
  function kc(it){ return itemCol[it] != null ? itemCol[it] : 0; }
  function mainItem(n){ if (n.kind === 'src' || n.kind === 'out' || n.kind === 'bp') return n.key.slice(n.key.indexOf(':') + 1); var o = Object.keys(n.outs); o.sort(function(a, b){ return n.outs[b] - n.outs[a]; }); return o[0]; }
  // Long forward links get placeholder lanes in the columns they pass through; loops go round the bottom.
  var segs = [], backs = [];
  links.forEach(function(l){
    if (l.t.col <= l.s.col){ l.back = true; backs.push(l); return; }
    var chain = [l.s];
    for (var c = l.s.col + 1; c < l.t.col; c++){ var d = { key:'d'+nodes.length, kind:'dummy', col:c, ins:{}, outs:{}, h:4 }; d.ins[l.item] = l.v; d.outs[l.item] = l.v; nodes.push(d); chain.push(d); }
    chain.push(l.t); l.chain = chain;
    for (var j = 0; j < chain.length - 1; j++) segs.push({ a:chain[j], b:chain[j+1], item:l.item, v:l.v, w:1 + Math.sqrt(l.v/maxV) * 3 });
  });
  nodes.forEach(function(n){
    n.pin = Object.keys(n.ins); n.pout = Object.keys(n.outs);
    if (n.kind !== 'dummy') n.h = Math.max(n.kind === 'step' ? 64 : 48, PS * Math.max(n.pin.length, n.pout.length, 1) + 18);
  });
  var cols = []; nodes.forEach(function(n){ (cols[n.col] = cols[n.col] || []).push(n); });
  for (var ci = 0; ci < cols.length; ci++) cols[ci] = cols[ci] || [];
  var inSeg = {}, outSeg = {};
  segs.forEach(function(sg){ (inSeg[sg.b.key] = inSeg[sg.b.key] || []).push(sg); (outSeg[sg.a.key] = outSeg[sg.a.key] || []).push(sg); });
  // 1) Order blocks in each column to cut down crossings (barycentre sweeps).
  function idx(){ cols.forEach(function(c){ c.forEach(function(n, i){ n.pos = i; }); }); }
  idx();
  for (var it = 0; it < 10; it++){
    var down = it % 2 === 0;
    for (var k = 0; k < cols.length; k++){
      var c = down ? k : cols.length - 1 - k;
      cols[c].forEach(function(n){
        var list = down ? (inSeg[n.key] || []) : (outSeg[n.key] || []), sw = 0, sp = 0;
        list.forEach(function(sg){ var o = down ? sg.a : sg.b; sw += sg.w; sp += o.pos * sg.w; });
        n.bary = sw ? sp / sw : n.pos;
      });
      cols[c].sort(function(a, b){ return a.bary - b.bary || a.pos - b.pos; });
      cols[c].forEach(function(n, i){ n.pos = i; });
    }
  }
  // 2) Vertical positions: line each block's ports up with the blocks it connects to.
  function gapBetween(a, b){ return a.kind === 'dummy' && b.kind === 'dummy' ? 8 : (a.kind === 'dummy' || b.kind === 'dummy') ? 14 : VG; }
  function portOff(n, side, item){
    if (n.kind === 'dummy') return 2;
    var list = side === 'in' ? n.pin : n.pout, k = list.indexOf(item), m = list.length;
    return n.h / 2 + (k - (m - 1) / 2) * PS;
  }
  cols.forEach(function(c){ var y = 0; c.forEach(function(n, i){ if (i) y += gapBetween(c[i-1], n); n.y = y; y += n.h; }); });
  function sortPorts(){
    nodes.forEach(function(n){
      if (n.kind === 'dummy') return;
      var avg = function(side, item){
        var list = (side === 'in' ? inSeg[n.key] : outSeg[n.key]) || [], s = 0, w = 0;
        list.forEach(function(sg){ if (sg.item !== item) return; var o = side === 'in' ? sg.a : sg.b; s += (o.y + o.h / 2) * sg.v; w += sg.v; });
        backs.forEach(function(l){ if ((side === 'in' ? l.t : l.s) === n && l.item === item){ s += 1e6 * l.v; w += l.v; } });
        return w ? s / w : n.y;
      };
      n.pin.sort(function(a, b){ return avg('in', a) - avg('in', b); });
      n.pout.sort(function(a, b){ return avg('out', a) - avg('out', b); });
    });
  }
  function place(c, desired){
    var off = [], o = 0, blocks = [];
    c.forEach(function(n, i){ if (i) o += c[i-1].h + gapBetween(c[i-1], n); off.push(o); });
    c.forEach(function(n, i){
      var w = n.kind === 'dummy' ? 0.6 : 1, t = desired[i] - off[i];
      blocks.push({ s:t * w, w:w, from:i, to:i });
      while (blocks.length > 1){
        var b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.s / a.w <= b.s / b.w) break;
        blocks.pop(); a.s += b.s; a.w += b.w; a.to = b.to;
      }
    });
    blocks.forEach(function(b){ for (var i = b.from; i <= b.to; i++) c[i].y = off[i] + b.s / b.w; });
  }
  for (var pass = 0; pass < 18; pass++){
    sortPorts();
    var mode = pass >= 12 ? 'both' : (pass % 2 === 0 ? 'in' : 'out');
    for (var q = 0; q < cols.length; q++){
      var cc = mode === 'out' ? cols.length - 1 - q : q, col = cols[cc];
      var desired = col.map(function(n){
        var s = 0, w = 0;
        if (mode !== 'out') (inSeg[n.key] || []).forEach(function(sg){ s += (sg.a.y + portOff(sg.a, 'out', sg.item) - portOff(n, 'in', sg.item)) * sg.w; w += sg.w; });
        if (mode !== 'in') (outSeg[n.key] || []).forEach(function(sg){ s += (sg.b.y + portOff(sg.b, 'in', sg.item) - portOff(n, 'out', sg.item)) * sg.w; w += sg.w; });
        return w ? s / w : n.y;
      });
      place(col, desired);
    }
  }
  // Snap near-straight lines so tiny jogs disappear.
  var minY = Infinity; nodes.forEach(function(n){ if (n.y < minY) minY = n.y; });
  nodes.forEach(function(n){ n.y = Math.round(n.y - minY + TOPY); });
  // Straighten: nudge a block (or a pass-through lane) to remove a small jog when there's room.
  cols.forEach(function(c){ c.sort(function(a, b){ return a.y - b.y; }); });
  function fits(n, ny){
    var c = cols[n.col], i = c.indexOf(n), up = c[i-1], dn = c[i+1];
    if (ny < TOPY) return false;
    if (up && ny < up.y + up.h + gapBetween(up, n)) return false;
    if (dn && ny + n.h + gapBetween(n, dn) > dn.y) return false;
    return true;
  }
  for (var sp2 = 0; sp2 < 8; sp2++){
    var moved = false;
    segs.forEach(function(sg){
      var y1 = sg.a.y + portOff(sg.a, 'out', sg.item), y2 = sg.b.y + portOff(sg.b, 'in', sg.item), dy = y1 - y2;
      if (Math.abs(dy) < 0.5) return;
      var limB = sg.b.kind === 'dummy' ? 400 : 16, limA = sg.a.kind === 'dummy' ? 400 : 16;
      // only move a real block if its other lines stay at least as straight
      function cost(n){ var t = 0; (inSeg[n.key] || []).forEach(function(x){ t += Math.abs(x.a.y + portOff(x.a, 'out', x.item) - n.y - portOff(n, 'in', x.item)) > 0.5 ? x.w : 0; }); (outSeg[n.key] || []).forEach(function(x){ t += Math.abs(x.b.y + portOff(x.b, 'in', x.item) - n.y - portOff(n, 'out', x.item)) > 0.5 ? x.w : 0; }); return t; }
      function tryMove(n, d, lim){
        if (Math.abs(d) > lim || !fits(n, n.y + d)) return false;
        var before = cost(n); n.y += d; if (cost(n) > before){ n.y -= d; return false; } return true;
      }
      if (tryMove(sg.b, dy, limB) || tryMove(sg.a, -dy, limA)) moved = true;
    });
    if (!moved) break;
  }
  function colX(c){ return 16 + c * (NW + GW); }
  var maxB = 0; nodes.forEach(function(n){ if (n.y + n.h > maxB) maxB = n.y + n.h; });
  // 3) Route lines.
  var paths = [], labels = [];
  function route(x1, y1, x2, y2, lane){
    if (Math.abs(y1 - y2) < 1.5) return ' H' + x2;
    var rr = Math.min(7, Math.abs(y2 - y1) / 2), sgn = y2 > y1 ? 1 : -1;
    return ' H' + (lane - rr) + ' Q' + lane + ' ' + y1 + ' ' + lane + ' ' + (y1 + sgn * rr) + ' V' + (y2 - sgn * rr) + ' Q' + lane + ' ' + y2 + ' ' + (lane + rr) + ' ' + y2 + ' H' + x2;
  }
  // lane assignment per gap
  var gaps = {};
  segs.forEach(function(sg){
    sg.x1 = colX(sg.a.col) + NW; sg.x2 = colX(sg.b.col);
    sg.y1 = sg.a.y + portOff(sg.a, 'out', sg.item); sg.y2 = sg.b.y + portOff(sg.b, 'in', sg.item);
    if (Math.abs(sg.y1 - sg.y2) >= 1.5) (gaps[sg.a.col] = gaps[sg.a.col] || []).push(sg);
  });
  Object.keys(gaps).forEach(function(g){
    var list = gaps[g];
    var dn = list.filter(function(s){ return s.y2 > s.y1; }).sort(function(a, b){ return a.y1 - b.y1; });
    var up = list.filter(function(s){ return s.y2 < s.y1; }).sort(function(a, b){ return b.y1 - a.y1; });
    var lanes = [];
    dn.concat(up).forEach(function(s){
      var lo = Math.min(s.y1, s.y2) - 5, hi = Math.max(s.y1, s.y2) + 5, L = 0;
      // lines from the same port to the same place can share a lane
      for (;; L++){
        lanes[L] = lanes[L] || [];
        if (!lanes[L].some(function(o){ return !(hi < o[0] || lo > o[1]) && !(o[2] === s.y1 && o[3] === s.item); })) break;
      }
      lanes[L].push([lo, hi, s.y1, s.item]); s.lane = L;
    });
    var n = Math.max(1, lanes.length), x1 = colX(+g) + NW, x2 = colX(+g + 1);
    var left = x1 + (+g === 0 ? 22 : LABZ), right = x2 - 16, step = Math.min(11, (right - left) / n);
    list.forEach(function(s){ s.lx = right - s.lane * step; });
  });
  links.forEach(function(l){
    if (l.back) return;
    var d = '', chain = l.chain;
    for (var j = 0; j < chain.length - 1; j++){
      var sg = segs.filter(function(x){ return x.a === chain[j] && x.b === chain[j+1] && x.item === l.item && x.v === l.v; })[0];
      if (!j) d = 'M' + sg.x1 + ' ' + sg.y1;
      d += route(sg.x1, sg.y1, sg.x2, sg.y2, sg.lx);
      if (chain[j+1].kind === 'dummy') d += ' H' + (colX(chain[j+1].col) + NW);
    }
    paths.push({ d:d, l:l, w:1.5 + Math.sqrt(l.v / maxV) * 5 });
  });
  backs.forEach(function(l, i){
    var x1 = colX(l.s.col) + NW, y1 = l.s.y + portOff(l.s, 'out', l.item), x2 = colX(l.t.col), y2 = l.t.y + portOff(l.t, 'in', l.item);
    var by = maxB + 22 + i * 14, ox = 10 + i * 6, rr = 6;
    var d = 'M' + x1 + ' ' + y1 + ' H' + (x1 + ox - rr) + ' Q' + (x1 + ox) + ' ' + y1 + ' ' + (x1 + ox) + ' ' + (y1 + rr) + ' V' + (by - rr) + ' Q' + (x1 + ox) + ' ' + by + ' ' + (x1 + ox - rr) + ' ' + by +
      ' H' + (x2 - ox + rr) + ' Q' + (x2 - ox) + ' ' + by + ' ' + (x2 - ox) + ' ' + (by - rr) + ' V' + (y2 + rr) + ' Q' + (x2 - ox) + ' ' + y2 + ' ' + (x2 - ox + rr) + ' ' + y2 + ' H' + x2;
    paths.push({ d:d, l:l, w:1.5 + Math.sqrt(l.v / maxV) * 5, back:true });
  });
  var H = maxB + 30 + backs.length * 14, W = colX(cols.length - 1) + NW + 16;
  var Z = S.flowZoom || 1; S.flowW = W;
  var svg = '<svg class="flow" width="' + Math.round(W * Z) + '" height="' + Math.round(H * Z) + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Production flow diagram">';
  if (colHeads) colHeads.forEach(function(hd){
    svg += '<text class="fl-head" x="' + (colX(hd.from) + 2) + '" y="16">' + esc(hd.label.toUpperCase()) + '</text>';
    svg += '<path class="fl-bracket" d="M' + colX(hd.from) + ' 26 V22 H' + (colX(hd.to) + NW) + ' V26"></path>';
  });
  else for (var c2 = 0; c2 < cols.length; c2++){
    var hl = c2 === 0 ? 'Inputs' : c2 === cols.length - 1 ? 'Outputs' : 'Stage ' + c2;
    svg += '<text class="fl-head" x="' + (colX(c2) + 2) + '" y="16">' + hl.toUpperCase() + '</text>';
  }
  paths.forEach(function(p){
    var fl = ENG.isFluid(S.D, p.l.item);
    var w = fl ? Math.max(p.w, 4.5) : p.w;
    svg += '<path class="fl-e k' + kc(p.l.item) + (p.back ? ' back' : '') + '" d="' + p.d + '" stroke-width="' + w.toFixed(1) + '"><title>' + esc(iname(p.l.item) + ': ' + fmt(p.l.v) + '/min, ' + p.l.s.label + ' → ' + p.l.t.label) + '</title></path>';
    if (fl && !p.back) svg += '<path class="fl-core" d="' + p.d + '" stroke-width="' + (w * 0.4).toFixed(1) + '"></path>';
  });
  nodes.forEach(function(n){
    if (n.kind === 'dummy') return;
    var x = colX(n.col), cls = { src:'fl-n src', step:'fl-n step', out:'fl-n out', bp:'fl-n bp' }[n.kind], mi = mainItem(n), kk = kc(mi);
    var tipLbl = n.label + (n.step ? ', ' + clockText(n.step.L, 4) : ', ' + n.sub);
    svg += '<g class="fl-g" data-k="' + esc(n.key) + '" tabindex="0" aria-label="' + esc(tipLbl) + '. Show details"><rect class="' + cls + (n.kind === 'out' ? ' k' + kk : '') + '" x="' + x + '" y="' + n.y + '" width="' + NW + '" height="' + n.h + '" rx="5"></rect>';
    svg += '<rect class="f' + kk + '" x="' + (x + 1) + '" y="' + (n.y + 1) + '" width="5" height="' + (n.h - 2) + '" rx="2"></rect>';
    var cy = n.y + n.h / 2;
    if (n.step){
      var over = n.step.L.groups.some(function(g){ return g.clock > 100.0001; });
      svg += '<text class="fl-t" x="' + (x + 14) + '" y="' + (cy - 10) + '">' + esc(clip(n.label, 21)) + '</text>';
      svg += '<text class="fl-s" x="' + (x + 14) + '" y="' + (cy + 5) + '">' + esc(clip(n.sub, 27)) + '</text>';
      svg += '<text class="fl-c' + (over ? ' over' : '') + '" x="' + (x + 14) + '" y="' + (cy + 20) + '">' + esc(clip(clockText(n.step.L, 2, true), 26)) + '</text>';
      if ((plan().built || {})[n.step.recipe.id]) svg += '<text class="fl-done" x="' + (x + NW - 16) + '" y="' + (n.y + 16) + '">✓<title>Built</title></text>';
    } else {
      svg += '<text class="fl-t" x="' + (x + 14) + '" y="' + (cy - 3) + '">' + esc(clip(n.label, 21)) + '</text>';
      svg += '<text class="fl-s" x="' + (x + 14) + '" y="' + (cy + 12) + '">' + esc(clip(n.sub, 27)) + '</text>';
    }
    S.flowTips[n.key] = flowTip(n, r);
    n.pin.forEach(function(it){ svg += '<circle class="f' + kc(it) + '" cx="' + x + '" cy="' + (n.y + portOff(n, 'in', it)) + '" r="3.5"></circle>'; });
    n.pout.forEach(function(it){
      var py = n.y + portOff(n, 'out', it);
      svg += '<circle class="f' + kc(it) + '" cx="' + (x + NW) + '" cy="' + py + '" r="3.5"></circle>';
      if (n.kind === 'step') labels.push('<text class="fl-lab" x="' + (x + NW + 8) + '" y="' + (py - 6) + '">' + esc(clip(iname(it), 15)) + ' <tspan class="fl-num">' + fmt(n.outs[it]) + '</tspan></text>');
    });
    svg += '</g>';
  });
  svg += labels.join('') + '</svg>';
  var note = backs.length ? ' Dashed lines loop a byproduct back to an earlier stage.' : '';
  var legend = Object.keys(itemCol).sort(function(a, b){ return firstCol[a] - firstCol[b] || rate[b] - rate[a]; }).map(function(it){
    return '<span><i class="c' + itemCol[it] + (ENG.isFluid(S.D, it) ? ' pipe' : '') + '"></i>' + esc(iname(it)) + '</span>';
  }).join('');
  var tools = '<div class="fltools" role="group" aria-label="Zoom"><button type="button" class="btn small" data-act="fz_out" aria-label="Zoom out">−</button><button type="button" class="btn small mono" data-act="fz_one" title="Back to 100%">' + Math.round(Z * 100) + '%</button><button type="button" class="btn small" data-act="fz_in" aria-label="Zoom in">+</button><button type="button" class="btn small" data-act="fz_fit">Fit</button><span class="fltoggle"><span class="lbl">Columns</span>' + seg('flcols', S.flowCols || 'type', [['type','Part type'],['steps','Steps']]) + '</span><span class="hint">Drag the chart to move it. Ctrl + scroll to zoom.</span></div>';
  return tools + '<div class="flowwrap" id="flowwrap">' + svg + '<div class="fl-legend" aria-label="Item colours">' + legend + '</div></div><p class="hint">Blocks run left to right from raw inputs to outputs, grouped by part type (switch to Steps to group by how many steps each part is from raw). Each item has its own colour: its lines, its connection dots, and the band on the block that makes it. Hollow lines are pipes carrying fluids. Labels show each item and its rate where it leaves a machine.' + note + ' Point at a block (or tap it) for full details. Hover a line for its item and rate.</p><div id="flTip" class="fl-tip" role="tooltip" hidden></div>';
}
function clip(s, n){ s = String(s); return s.length > n ? s.slice(0, n-1) + '…' : s; }

/* ---------------- From a node ---------------- */
var RES_LIST = ['Desc_OreIron_C','Desc_OreCopper_C','Desc_Stone_C','Desc_Coal_C','Desc_OreGold_C','Desc_RawQuartz_C','Desc_Sulfur_C','Desc_OreBauxite_C','Desc_OreUranium_C','Desc_SAM_C','Desc_LiquidOil_C','Desc_Water_C','Desc_NitrogenGas_C'];
function kindsFor(res){
  if (res === 'Desc_LiquidOil_C') return ['oil','well'];
  if (res === 'Desc_Water_C') return ['water','well'];
  if (res === 'Desc_NitrogenGas_C') return ['well'];
  return ['mk1','mk2','mk3'];
}
function renderNode(){
  var n = S.node, kinds = kindsFor(n.res);
  if (kinds.indexOf(n.kind) < 0) n.kind = kinds[kinds.length-1];
  var e = ENG.EXTRACTORS[n.kind];
  var x = ENG.extract(n.kind, n.purity, n.clock, n.count);
  var b = ENG.beltFor(S.D, n.res, x.per, { maxBelt:world().maxBelt, maxPipe:world().maxPipe });
  var bt = ENG.beltFor(S.D, n.res, x.total, { maxBelt:world().maxBelt, maxPipe:world().maxPipe });
  var h = '<div class="grid2"><div class="panel" data-tour="node-in"><h2>From a node</h2><p class="lede" style="margin:0">Pick a node and extractor to see the output and what it can feed.</p>';
  h += '<div class="field"><label class="lbl" for="n_res">Resource</label><select id="n_res" data-bind="n_res">' + RES_LIST.filter(function(k){ return S.D.items[k]; }).map(function(k){ return '<option value="'+k+'"'+(k===n.res?' selected':'')+'>'+esc(iname(k))+'</option>'; }).join('') + '</select></div>';
  h += '<div class="field"><label class="lbl" for="n_kind">Extractor</label><select id="n_kind" data-bind="n_kind">' + kinds.map(function(k){ return '<option value="'+k+'"'+(k===n.kind?' selected':'')+'>'+esc(ENG.EXTRACTORS[k].n)+'</option>'; }).join('') + '</select></div>';
  if (!e.noPurity) h += '<div class="field"><span class="lbl">Purity</span>' + seg('purity', n.purity, [['impure','Impure'],['normal','Normal'],['pure','Pure']]) + '</div>';
  h += '<div class="field"><label class="lbl" for="n_clock">Clock speed</label><div class="row"><input type="range" id="n_clock_r" min="1" max="250" step="1" value="' + n.clock + '" data-bind="n_clock" class="grow" aria-label="Clock speed slider"><input type="number" id="n_clock" min="1" max="250" step="any" value="' + n.clock + '" data-bind="n_clock" class="rate"><span class="unit">%</span></div></div>';
  h += '<div class="field"><label class="lbl" for="n_count">' + (e.well ? 'Satellite nodes' : 'How many like this') + '</label><input type="number" id="n_count" min="1" step="1" value="' + n.count + '" data-bind="n_count"></div>';
  h += '</div><div class="results">';
  h += '<div class="panel" data-tour="node-out"><div class="lbl">Output</div><div class="big">' + fmt(x.total) + ' <span class="unit" style="font-size:14px">' + (S.D.items[n.res].l?'m³':'') + '/min</span></div>';
  h += '<div class="kv"><div><div class="k">Each</div><div class="v">' + fmt(x.per) + '/min</div></div><div><div class="k">' + (b.fluid?'Pipe':'Belt') + ' per extractor</div><div class="v">' + b.label.replace('Belt ','').replace('Pipe ','') + '</div></div><div><div class="k">Total line</div><div class="v">' + bt.label.replace('Belt ','').replace('Pipe ','') + '</div></div><div><div class="k">Power</div><div class="v">' + (e.well ? '150 MW*' : fmt(x.power,1) + ' MW') + '</div></div><div><div class="k">Power shards</div><div class="v">' + x.shards + '</div></div></div>';
  if (b.over) h += '<div class="notice">One ' + (b.fluid?'pipe':'belt') + ' at your world\'s top tier can\'t carry a single extractor at this clock. Lower the clock or raise the tier in World &amp; data.</div>';
  if (e.well) h += '<p class="hint">*A Resource Well Pressurizer uses 150 MW at 100% and powers every satellite node around it. Rates above are per satellite.</p>';
  h += '</div>';
  var uses = (S.D.consumers[n.res] || []).filter(function(r){ return ENG.recipeAllowed(S.D, r, worldOpts()); });
  uses.sort(function(a,b){ return a.a-b.a || a.n.localeCompare(b.n); });
  h += '<div class="field" data-tour="node-feed"><h3>What this can feed</h3><div class="tablewrap"><table><thead><tr><th>Recipe</th><th>Machine</th><th class="num">Uses each</th><th class="num">Machines fed</th><th></th></tr></thead><tbody>' + uses.map(function(r){
    var rr = ENG.rates(S.D, r, { costMult:world().costMult });
    var use = rr.ins.filter(function(q){ return q[0]===n.res; })[0][1];
    var others = rr.ins.filter(function(q){ return q[0]!==n.res; }).map(function(q){ return iname(q[0]); });
    return '<tr><td>' + esc(r.n) + ' ' + (r.a?'<span class="chip alt">ALT</span>':'') + (others.length?'<div class="hint">also needs ' + esc(others.join(', ')) + '</div>':'') + '</td><td>' + esc(rr.building.n) + '</td><td class="num">' + fmt(use) + '/min</td><td class="num">' + fmt(x.total/use) + '</td><td><button class="btn small" data-act="node_plan" data-item="' + r.o[0][0] + '">Plan max ' + esc(clip(iname(r.o[0][0]),18)) + '</button></td></tr>';
  }).join('') + '</tbody></table></div><span class="hint">"Plan max" opens Plan with this node as your input and works out the most you can make.</span></div>';
  h += '</div></div>';
  return h;
}

/* ---------------- Power ---------------- */
function renderPower(){
  var P = S.power, G = ENG.GENS[P.gen];
  if (!G.geo && G.fuels.indexOf(P.fuel) < 0) P.fuel = G.fuels[0];
  var x = ENG.power(S.D, P.gen, P.fuel, P.mode, +P.value || 0, +P.clock || 100, P.purity);
  var h = '<div class="grid2"><div class="panel" data-tour="pow-in"><h2>Power</h2><p class="lede" style="margin:0">Size a power plant from a target or a generator count.</p>';
  h += '<div class="field"><label class="lbl" for="p_gen">Generator</label><select id="p_gen" data-bind="p_gen">' + Object.keys(ENG.GENS).map(function(k){ return '<option value="'+k+'"'+(k===P.gen?' selected':'')+'>'+esc(ENG.GENS[k].n)+'</option>'; }).join('') + '</select></div>';
  if (!G.geo) h += '<div class="field"><label class="lbl" for="p_fuel">Fuel</label><select id="p_fuel" data-bind="p_fuel">' + G.fuels.filter(function(f){ return S.D.items[f]; }).map(function(f){ return '<option value="'+f+'"'+(f===P.fuel?' selected':'')+'>'+esc(iname(f))+'</option>'; }).join('') + '</select></div>';
  else h += '<div class="field"><span class="lbl">Geyser purity</span>' + seg('p_purity', P.purity, [['impure','Impure'],['normal','Normal'],['pure','Pure']]) + '</div>';
  h += '<div class="field"><span class="lbl">Size by</span>' + seg('p_mode', P.mode, [['count','Generator count'],['mw','Target MW']]) + '<div class="row"><input type="number" id="p_value" min="0" step="any" value="' + P.value + '" data-bind="p_value" class="grow"><span class="unit">' + (P.mode==='mw'?'MW':'generators') + '</span></div></div>';
  if (!G.geo) h += '<div class="field"><label class="lbl" for="p_clock">Clock speed</label><div class="row"><input type="number" id="p_clock" min="1" max="250" step="any" value="' + P.clock + '" data-bind="p_clock" class="grow"><span class="unit">%</span></div><span class="hint">Generator output and fuel use scale straight with clock speed.</span></div>';
  h += '</div><div class="results"><div class="panel" data-tour="pow-out"><div class="lbl">' + esc(G.n) + '</div><div class="big">' + fmt(x.mw,1) + ' <span class="unit" style="font-size:14px">MW</span></div><div class="kv">';
  h += '<div><div class="k">Generators</div><div class="v">' + x.gens + '</div></div><div><div class="k">Each</div><div class="v">' + fmt(x.mwEach,1) + ' MW</div></div>';
  if (!G.geo){
    h += '<div><div class="k">' + esc(iname(P.fuel)) + '</div><div class="v">' + fmt(x.fuelRate) + '/min</div></div><div><div class="k">Per generator</div><div class="v">' + fmt(x.fuelEach) + '/min</div></div>';
    if (x.water) h += '<div><div class="k">Water</div><div class="v">' + fmt(x.water) + ' m³/min</div></div><div><div class="k">Water Extractors</div><div class="v">' + x.extractors + '</div></div>';
    if (x.waste) h += '<div><div class="k">' + esc(iname(x.waste.item)) + '</div><div class="v">' + fmt(x.waste.rate) + '/min</div></div>';
  }
  h += '</div>';
  if (x.note) h += '<p class="hint">' + esc(x.note) + '</p>';
  if (x.water) h += '<p class="hint">Water Extractors need grid power before they start, so bring this plant up from an existing grid. Each extractor uses 20 MW at 100%.</p>';
  if (x.waste) h += '<div class="notice">Nuclear waste never goes away on its own and can\'t be sunk. Plan storage or reprocessing before you build.</div>';
  if (!G.geo) h += '<div class="row" style="flex-wrap:wrap"><button class="btn primary" data-act="power_plan">Plan ' + fmt(x.fuelRate) + '/min ' + esc(iname(P.fuel)) + '</button><span class="hint">Opens Plan with this fuel as the target.</span></div>';
  h += '</div>';
  h += '<div class="field"><h3>Fuel reference at 100%</h3><div class="tablewrap"><table><thead><tr><th>Generator</th><th>Fuel</th><th class="num">MW each</th><th class="num">Fuel per generator</th><th class="num">Water</th></tr></thead><tbody>';
  Object.keys(ENG.GENS).forEach(function(g){ var GG = ENG.GENS[g]; if (GG.geo) return; GG.fuels.forEach(function(f){ if (!S.D.items[f]) return; var y = ENG.power(S.D, g, f, 'count', 1, 100); h += '<tr><td>' + esc(GG.n) + '</td><td>' + esc(iname(f)) + '</td><td class="num">' + fmt(y.mwEach) + '</td><td class="num">' + fmt(y.fuelEach) + '/min</td><td class="num">' + (y.water ? fmt(y.water) + ' m³/min' : '–') + '</td></tr>'; }); });
  h += '</tbody></table></div></div></div></div>';
  return h;
}

/* ---------------- Splits ---------------- */
function layerText(layers){ return layers.length ? layers.map(function(l,i){ return 'Layer ' + (i+1) + ': ' + l + ' splitter' + (i ? 's on every branch' : ''); }) : []; }
function renderSplits(){
  var sp = S.split, rate = +sp.rate || 0, n = Math.max(1, Math.round(+sp.n || 1)), take = +sp.take || 0;
  var e = ENG.splitEqual(rate, n), t = ENG.splitTake(rate, take);
  var h = '<div class="sectionhead"><div><h2>Splits and manifolds</h2><p class="lede">Exact splitter trees for when a manifold won\'t do. For most lines feeding identical machines, a plain manifold balances itself once the machines fill up.</p></div></div>';
  h += '<div class="grid2" style="margin-top:16px"><div class="panel" data-tour="split-in"><div class="field"><label class="lbl" for="s_rate">Line rate</label><div class="row"><input type="number" id="s_rate" min="0" step="any" value="' + sp.rate + '" data-bind="s_rate" class="grow"><span class="unit">/min</span></div></div>';
  h += '<div class="field"><label class="lbl" for="s_n">Split evenly into</label><div class="row"><input type="number" id="s_n" min="1" max="100" step="1" value="' + sp.n + '" data-bind="s_n" class="grow"><span class="unit">lines</span></div></div>';
  h += '<div class="field"><label class="lbl" for="s_take">Or take off exactly</label><div class="row"><input type="number" id="s_take" min="0" step="any" value="' + sp.take + '" data-bind="s_take" class="grow"><span class="unit">/min</span></div></div></div>';
  h += '<div class="results"><div class="panel" data-tour="split-even"><div class="lbl">Even split</div><div class="big">' + n + ' × ' + fmt(e.each) + ' <span class="unit" style="font-size:14px">/min</span></div><ol class="steps">';
  layerText(e.layers).forEach(function(l){ h += '<li>' + esc(l) + '</li>'; });
  if (e.loop) h += '<li>That gives ' + e.m + ' outputs. Merge ' + e.loop + ' of them back into the input line, just before the first splitter. The other ' + n + ' each carry ' + fmt(e.each) + '/min once the loop settles.</li>';
  else if (n === 1) h += '<li>No split needed.</li>';
  else h += '<li>Take the ' + n + ' outputs straight to your machines.</li>';
  h += '</ol></div>';
  h += '<div class="panel" data-tour="split-take"><div class="lbl">Take off a rate</div>';
  if (!t) h += '<p class="hint">Enter an amount less than the line rate.</p>';
  else {
    h += '<div class="big">' + fmt(t.got) + ' <span class="unit" style="font-size:14px">/min' + (Math.abs(t.got - take) > 0.01 ? ' (closest to ' + fmt(take) + ')' : '') + '</span></div><ol class="steps">';
    layerText(t.layers).forEach(function(l){ h += '<li>' + esc(l) + '</li>'; });
    h += '<li>That gives ' + t.m + ' equal outputs of ' + fmt(rate/t.m) + '/min. Merge ' + t.k + ' of them into your new line.</li><li>Merge the other ' + (t.m - t.k) + ' back together to continue the main line at ' + fmt(rate - t.got) + '/min.</li></ol>';
    if (Math.abs(t.got - take) > 0.01) h += '<p class="hint">An exact split isn\'t possible with splitters alone here. If the new line feeds machines that only pull what they need, an overflow (Smart Splitter set to overflow) gets the exact rate with no math.</p>';
  }
  h += '</div></div></div>';
  return h;
}




/* ---------------- Materials sheet ---------------- */
function sheetData(r, p){
  var o = { maxClock:p.maxClock, layout:p.layout }, it = {};
  function row(k){ return it[k] = it[k] || { item:k, inn:0, made:0, used:0, out:0, spare:0 }; }
  r.steps.forEach(function(s){
    s.rates.outs.forEach(function(q){ row(q[0]).made += q[1] * s.x; });
    s.rates.ins.forEach(function(q){ row(q[0]).used += q[1] * s.x; });
  });
  [r.supply, r.given, r.imported || {}].forEach(function(m){ Object.keys(m).forEach(function(k){ row(k).inn += m[k]; }); });
  Object.keys(r.targets).forEach(function(k){ row(k).out += r.targets[k]; });
  Object.keys(r.excess).forEach(function(k){ if (k in r.targets) row(k).out += r.excess[k]; else row(k).spare += r.excess[k]; });
  var roleOrder = { 'Raw input':0, 'Brought in':1, 'Your input':1, 'Made and used':2, 'Product':3, 'Spare':4 };
  var items = Object.keys(it).map(function(k){
    var x = it[k];
    x.role = x.out > 1e-9 ? 'Product' : x.spare > 1e-9 && x.made > 1e-9 && x.used < 1e-9 ? 'Spare' : x.inn > 1e-9 ? ((r.imported || {})[k] ? 'Brought in' : r.given[k] ? 'Your input' : 'Raw input') : x.spare > 1e-9 ? 'Spare' : 'Made and used';
    x.name = iname(k); x.fluid = ENG.isFluid(S.D, k); return x;
  }).sort(function(a, b){ return roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name); });
  var bl = {}, tot = { machines:0, power:0, shards:0, sloops:0 };
  r.steps.forEach(function(s){
    var L = ENG.layout(S.D, s, o), bn = s.rates.building.n;
    var e = bl[bn] = bl[bn] || { name:bn, machines:0, power:0, shards:0, sloops:0, steps:[] };
    e.machines += L.machines; e.power += L.power; e.shards += L.shards; e.sloops += L.sloops;
    e.steps.push(s.recipe.n + ' (' + clockText(L, 2, true) + ')');
    tot.machines += L.machines; tot.power += L.power; tot.shards += L.shards; tot.sloops += L.sloops;
  });
  var blds = Object.keys(bl).map(function(k){ return bl[k]; }).sort(function(a, b){ return b.machines - a.machines; });
  return { items:items, blds:blds, tot:tot };
}
function sheetTables(r, p){
  var d = sheetData(r, p), n = function(v){ return v > 1e-9 ? Math.round(v * 1000) / 1000 : ''; };
  var t1 = [['Item','Role','Unit','Brought in /min','Made /min','Used /min','Leaves as product /min','Spare /min','Brought in /hour','Leaves /hour']].concat(d.items.map(function(x){
    return [x.name, x.role, x.fluid ? 'm³' : 'items', n(x.inn), n(x.made), n(x.used), n(x.out), n(x.spare), n(x.inn * 60), n((x.out + x.spare) * 60)];
  }));
  var t2 = [['Building','Machines','Power MW','Power shards','Somersloops','Steps (clock speeds)']].concat(d.blds.map(function(b){
    return [b.name, b.machines, Math.round(b.power * 10) / 10, b.shards || '', b.sloops || '', b.steps.join('; ')];
  })).concat([['Total', d.tot.machines, Math.round(d.tot.power * 10) / 10, d.tot.shards || '', d.tot.sloops || '', '']]);
  return { d:d, t1:t1, t2:t2 };
}
function planTitle(r){ return Object.keys(r.targets).map(function(k){ return fmt(r.targets[k]) + ' ' + iname(k); }).join(' + ') || 'Plan'; }
function renderSheet(r, p){
  var T = sheetTables(r, p), d = T.d;
  var h = '<div class="sheetbar"><span class="lbl">Materials for ' + esc(planTitle(r)) + ' /min</span><span class="spacer" style="flex:1"></span><button class="btn small" data-act="sheet_copy">Copy for Sheets or Excel</button>' + '<button class="btn small" data-act="sheet_csv">Download CSV</button>' + '</div>';
  var roleCls = { 'Raw input':'raw', 'Brought in':'in', 'Your input':'in', 'Made and used':'mid', 'Product':'prod', 'Spare':'spare' };
  h += '<div class="tablewrap sheet"><table><thead><tr><th>Item</th><th>Role</th><th class="num">Brought in</th><th class="num">Made</th><th class="num">Used</th><th class="num">Leaves</th><th class="num">Per hour</th></tr></thead><tbody>' + d.items.map(function(x){
    var u = x.fluid ? ' m³' : '';
    var leaves = x.out + x.spare, ph = x.inn > 1e-9 ? x.inn * 60 : leaves * 60;
    return '<tr><td>' + esc(x.name) + '</td><td><span class="role ' + roleCls[x.role] + '">' + x.role + '</span></td><td class="num">' + (x.inn > 1e-9 ? fmt(x.inn) + u : '') + '</td><td class="num">' + (x.made > 1e-9 ? fmt(x.made) + u : '') + '</td><td class="num">' + (x.used > 1e-9 ? fmt(x.used) + u : '') + '</td><td class="num">' + (leaves > 1e-9 ? fmt(leaves) + u + (x.spare > 1e-9 && x.out < 1e-9 ? ' spare' : '') : '') + '</td><td class="num">' + (ph > 1e-9 ? fmt(ph, 0) + u : '') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  h += '<p class="hint">Rates are per minute. "Per hour" is what comes in for raw and brought-in items, and what leaves for products and spares.</p>';
  h += '<div class="tablewrap sheet"><table><thead><tr><th>Building</th><th class="num">Machines</th><th class="num">Power</th><th class="num">Shards</th><th class="num">Somersloops</th><th>Steps and clock speeds</th></tr></thead><tbody>' + d.blds.map(function(b){
    return '<tr><td>' + esc(b.name) + '</td><td class="num">' + b.machines + '</td><td class="num">' + fmt(b.power, 1) + ' MW</td><td class="num">' + (b.shards || '') + '</td><td class="num">' + (b.sloops || '') + '</td><td class="steps">' + esc(b.steps.join(' · ')) + '</td></tr>';
  }).join('') + '<tr class="tot"><td>Total</td><td class="num">' + d.tot.machines + '</td><td class="num">' + fmt(d.tot.power, 1) + ' MW</td><td class="num">' + (d.tot.shards || '') + '</td><td class="num">' + (d.tot.sloops || '') + '</td><td></td></tr></tbody></table></div>';
  h += '<div id="sheetFallback" hidden><p class="hint">Your browser blocked copying. Select all the text below and copy it.</p><textarea id="sheetText" rows="8" style="width:100%;font-family:var(--f-mono);font-size:12px;background:var(--panel2);color:var(--fg);border:1px solid var(--line);border-radius:4px"></textarea></div>';
  return h;
}
function sheetCopy(){
  var r = S.result, p = plan(); if (!r || !r.ok) return;
  var T = sheetTables(r, p), tsv = function(rows){ return rows.map(function(rw){ return rw.map(function(c){ return String(c).replace(/[\t\n]/g, ' '); }).join('\t'); }).join('\n'); };
  var text = 'Materials for ' + planTitle(r) + ' per minute\n' + tsv(T.t1) + '\n\nBuildings\n' + tsv(T.t2) + '\n';
  var fallback = function(){ var fb = document.getElementById('sheetFallback'), ta = document.getElementById('sheetText'); if (fb && ta){ fb.hidden = false; ta.value = text; ta.focus(); ta.select(); } };
  try { navigator.clipboard.writeText(text).then(function(){ toast('Copied. Paste it into a spreadsheet.'); }, fallback); } catch(e){ fallback(); }
}
function sheetCsv(){
  var r = S.result, p = plan(); if (!r || !r.ok) return;
  var T = sheetTables(r, p), csv = function(rows){ return rows.map(function(rw){ return rw.map(function(c){ c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); };
  var data = '﻿' + csv([['Materials for ' + planTitle(r) + ' per minute']]) + '\r\n' + csv(T.t1) + '\r\n\r\n' + csv([['Buildings']]) + '\r\n' + csv(T.t2) + '\r\n';
  var name = (planTitle(r).replace(/[^\w .+-]+/g, '').trim() || 'plan').slice(0, 80) + '.csv';
  downloadFile(name, data, 'text/csv;charset=utf-8'); toast('Saved ' + name);
}

/* ---------------- Transport ---------------- */
var DEPOT_UP = [15, 30, 60, 120, 240];
function stackOf(it){ var x = S.D.items[it]; if (x && x.ss) return x.ss; var b = COMMUNITY && COMMUNITY.items && COMMUNITY.items[it]; return (b && b.ss) || 100; }
function trCalc(mode, it, rate, rt, cpt){
  var fl = ENG.isFluid(S.D, it), ss = stackOf(it), need = rate * rt, o = { mode:mode };
  if (mode === 'train'){
    o.cap = fl ? 1600 : 32 * ss; o.capTxt = fl ? '1,600 m³ per fluid car' : '32 stacks × ' + ss + ' = ' + fmt(o.cap) + ' per car';
    o.units = Math.max(1, Math.ceil(need / o.cap - 1e-9)); o.unitName = fl ? 'Fluid Freight Car' : 'Freight Car';
    o.trains = Math.ceil(o.units / Math.max(1, cpt)); o.carsEach = Math.ceil(o.units / o.trains);
    o.power = o.trains * 2 * 50 + o.trains * 2 * o.carsEach * 50;
    o.powerTxt = 'Stations and platforms at both ends. Each locomotive also draws 25 to 110 MW while moving.';
  } else if (mode === 'truck'){
    o.cap = fl ? 3200 : 48 * ss; o.capTxt = fl ? '3,200 m³ per Fluid Truck' : '48 stacks × ' + ss + ' = ' + fmt(o.cap) + ' per Truck';
    o.units = Math.max(1, Math.ceil(need / o.cap - 1e-9)); o.unitName = fl ? 'Fluid Truck' : 'Truck';
    o.power = 2 * 20; o.powerTxt = 'One station at each end, 20 MW each. Trucks also burn fuel.';
  } else if (mode === 'drone'){
    if (fl){ o.blocked = 'Drones can\'t carry fluids. Package the fluid first (Packager) and send the packaged item.'; return o; }
    o.cap = 9 * ss; o.capTxt = '9 stacks × ' + ss + ' = ' + fmt(o.cap) + ' per trip';
    o.units = Math.max(1, Math.ceil(need / o.cap - 1e-9)); o.unitName = 'Drone Port (one drone each)';
    o.power = (o.units + 1) * 100; o.powerTxt = 'Each sending port plus the receiving port, 100 MW each, even when idle. Drones also use batteries or other fuel per trip; the port shows how much.';
  } else if (mode === 'depot'){
    if (fl){ o.blocked = 'The Dimensional Depot only takes items. Package the fluid first to store it.'; return o; }
    var up = DEPOT_UP[S.tr.up] || 15, lim = S.tr.stacks * ss;
    o.units = Math.max(1, Math.ceil(rate / up - 1e-9)); o.unitName = 'Depot Uploader'; o.cap = up; o.capTxt = up + ' items/min per uploader';
    o.limit = lim; o.fill = lim / rate; o.power = null;
  }
  if (o.cap && mode !== 'depot'){ o.perUnit = o.cap / rt; o.use = need / (o.units * o.cap); }
  return o;
}
function renderTransport(){
  var T = S.tr, w = world();
  var facs = S.factories.filter(function(f){ return f.wid === w.id; });
  var item = T.item, rate = +T.rate || 0, srcNote = '';
  if (T.src === 'fac'){
    var ff = facs.filter(function(f){ return f.id === T.fac; })[0] || facs[0];
    if (ff){ T.fac = ff.id; var outs = Object.keys(ff.outputs || {}); if (outs.indexOf(T.facItem) < 0) T.facItem = outs[0] || ''; item = T.facItem; rate = (ff.outputs || {})[item] || 0; srcNote = 'From ' + ff.name; }
    else { item = ''; rate = 0; }
  }
  var fl = item ? ENG.isFluid(S.D, item) : false, unit = fl ? 'm³' : '';
  var h = '<div class="grid2"><div class="panel" data-tour="tr-in"><h2>Transport</h2><p class="lede" style="margin:0">Work out how many trains, trucks or drones it takes to move a part between factories.</p>';
  h += '<div class="field"><span class="lbl">What to move</span>' + seg('t_src', T.src, [['item','Item and rate'],['fac','A saved factory\'s output']]) + '</div>';
  if (T.src === 'fac'){
    if (!facs.length) h += '<div class="notice info">No saved factories in this world yet. Save one from Plan first.</div>';
    else {
      var cur = facs.filter(function(f){ return f.id === T.fac; })[0] || facs[0];
      h += '<div class="field"><label class="lbl" for="t_fac">Factory</label><select id="t_fac" data-bind="t_fac">' + facs.map(function(f){ return '<option value="' + f.id + '"' + (f.id===T.fac?' selected':'') + '>' + esc(f.name) + '</option>'; }).join('') + '</select></div>';
      h += '<div class="field"><label class="lbl" for="t_fitem">Output</label><select id="t_fitem" data-bind="t_fitem">' + Object.keys(cur.outputs || {}).map(function(k){ return '<option value="' + k + '"' + (k===T.facItem?' selected':'') + '>' + esc(iname(k)) + ' · ' + fmt(cur.outputs[k]) + '/min</option>'; }).join('') + '</select></div>';
    }
  } else {
    h += '<div class="field"><label class="lbl" for="tr_item">Item</label>' + itemInput('tr_item', T.item, 'data-bind="tr_item"') + '</div>';
    h += '<div class="field"><label class="lbl" for="tr_rate">Rate</label><div class="row"><input type="number" id="tr_rate" min="0" step="any" value="' + T.rate + '" data-bind="tr_rate" class="grow"><span class="unit">' + unit + '/min</span></div></div>';
  }
  h += '<div class="field"><span class="lbl">How</span>' + seg('t_mode', T.mode, [['train','Train'],['truck', fl ? 'Fluid truck' : 'Truck'],['drone','Drone'],['depot','Depot']]) + '</div>';
  if (T.mode !== 'depot') h += '<div class="field"><label class="lbl" for="t_rt">Round trip</label><div class="row"><input type="number" id="t_rt" min="0.1" step="0.1" value="' + T.rt + '" data-bind="t_rt" class="grow"><span class="unit">minutes</span></div><span class="hint">' + ({ train:'Time for one train to load, travel, unload and come back. Time one run, or estimate it.', truck:'Time for one truck to load, drive there, unload and drive back.', drone:'The sending drone port shows the round-trip time once its destination is set.' })[T.mode] + '</span></div>';
  if (T.mode === 'train') h += '<div class="field"><label class="lbl" for="t_cpt">Most freight cars per train</label><input type="number" id="t_cpt" min="1" max="50" step="1" value="' + T.cpt + '" data-bind="t_cpt"></div>';
  if (T.mode === 'depot'){
    h += '<div class="field"><label class="lbl" for="t_up">Upload speed researched</label><select id="t_up" data-bind="t_up">' + DEPOT_UP.map(function(u, i){ return '<option value="' + i + '"' + (+T.up===i?' selected':'') + '>' + (i ? 'Upgrade ' + i : 'Base') + ' · ' + u + ' items/min</option>'; }).join('') + '</select></div>';
    h += '<div class="field"><label class="lbl" for="t_stacks">Depot storage per item</label><select id="t_stacks" data-bind="t_stacks">' + [1,2,3,4,5].map(function(n){ return '<option value="' + n + '"' + (+T.stacks===n?' selected':'') + '>' + n + ' stack' + (n>1?'s':'') + (n>1 ? ' (expansion ' + n*100 + '%)' : '') + '</option>'; }).join('') + '</select></div>';
  }
  h += '</div><div class="results">';
  if (!item || !rate){ h += '<div class="notice info">Pick an item and a rate to see the numbers.</div></div></div>'; return h; }
  var c = trCalc(T.mode, item, rate, +T.rt || 1, +T.cpt || 1);
  h += '<div class="panel" data-tour="tr-out"><div class="lbl">' + esc(iname(item)) + ' · ' + fmt(rate) + ' ' + unit + '/min' + (srcNote ? ' · ' + esc(srcNote) : '') + '</div>';
  if (c.blocked){ h += '<div class="notice">' + esc(c.blocked) + '</div></div>'; }
  else {
    h += '<div class="big">' + c.units + ' <span class="unit" style="font-size:14px">' + esc(c.unitName) + (c.units > 1 && !/\)$/.test(c.unitName) ? 's' : '') + '</span></div><div class="kv">';
    if (T.mode === 'train') h += '<div><div class="k">Trains</div><div class="v">' + c.trains + ' × ' + c.carsEach + ' cars</div></div>';
    if (T.mode !== 'depot'){
      h += '<div><div class="k">Each trip carries</div><div class="v">' + fmt(c.cap) + (fl?' m³':'') + '</div></div><div><div class="k">Moved per trip</div><div class="v">' + fmt(rate * (+T.rt || 1)) + (fl?' m³':'') + '</div></div><div><div class="k">Space used</div><div class="v">' + fmt(c.use * 100, 0) + '%</div></div>';
    } else {
      h += '<div><div class="k">Holds per item</div><div class="v">' + fmt(c.limit) + '</div></div><div><div class="k">Full after</div><div class="v">' + fmt(c.fill, 1) + ' min</div></div>';
    }
    if (c.power != null) h += '<div><div class="k">Power</div><div class="v">' + fmt(c.power) + ' MW</div></div>';
    h += '</div><p class="hint" style="margin:0">' + esc(c.capTxt) + '. ' + (c.powerTxt ? esc(c.powerTxt) : '') + '</p>';
    if (T.mode === 'train'){
      var per = rate / Math.max(1, c.carsEach), b = ENG.beltFor(S.D, item, per, { maxBelt:w.maxBelt, maxPipe:w.maxPipe });
      h += '<div class="notice info">Feed each ' + (fl ? 'fluid freight platform' : 'freight platform') + ' at about ' + fmt(per) + ' ' + unit + '/min (' + b.label + '). Loading or unloading a car takes about 27 seconds at each stop, so keep the round trip well above 1 minute.</div>';
    }
    if (T.mode === 'depot') h += '<div class="notice info">The Depot stores items for building and crafting anywhere. It can\'t send items back onto a belt, so it\'s for supplying you, not other factories. Once an item reaches its limit, extra items stay in the uploader.</div>';
    if (T.mode === 'drone') h += '<div class="notice info">The receiving port can take deliveries from many sending ports. Its own drone isn\'t needed for incoming trips.</div>';
    h += '</div>';
  }
  // compare
  if (T.mode !== 'depot'){
    var rows = ['train','truck','drone'].map(function(m){ var x = trCalc(m, item, rate, +T.rt || 1, +T.cpt || 1); return [m, x]; });
    h += '<div class="field"><h3>Compare at the same round trip (' + fmt(+T.rt || 1) + ' min)</h3><div class="tablewrap"><table><thead><tr><th>Method</th><th class="num">Needed</th><th class="num">Each carries</th><th class="num">Space used</th><th class="num">Power</th></tr></thead><tbody>' + rows.map(function(rw){
      var m = rw[0], x = rw[1], nm = { train: fl ? 'Train (fluid cars)' : 'Train', truck: fl ? 'Fluid truck' : 'Truck', drone:'Drone' }[m];
      if (x.blocked) return '<tr><td>' + nm + '</td><td colspan="4" class="hint">Can\'t carry fluids</td></tr>';
      return '<tr' + (m===T.mode?' style="font-weight:700"':'') + '><td>' + nm + '</td><td class="num">' + x.units + (m==='train' ? ' cars' : m==='drone' ? ' ports' : '') + '</td><td class="num">' + fmt(x.cap) + (fl?' m³':'') + '</td><td class="num">' + fmt(x.use*100,0) + '%</td><td class="num">' + fmt(x.power) + ' MW</td></tr>';
    }).join('') + '</tbody></table></div><span class="hint">Real round trips differ by method, so treat this as a rough comparison.</span></div>';
  }
  var bl = ENG.beltFor(S.D, item, rate, { maxBelt:w.maxBelt, maxPipe:w.maxPipe });
  h += '<p class="hint">For comparison, a direct ' + (fl ? 'pipe' : 'belt') + ' would need ' + bl.label + '. Stack size of ' + esc(iname(item)) + ': ' + (fl ? 'fluid' : stackOf(item)) + '.</p>';
  h += '</div></div>';
  return h;
}

/* ---------------- Recipes ---------------- */
S.rc = { q:'', f:'all', b:'' };
function rateRow(list, per){ return list.map(function(q){ return '<span class="rq"><b>' + fmt(q[1] * per) + '</b> ' + esc(iname(q[0])) + '</span>'; }).join('<span class="rp">+</span>'); }
function renderRecipes(){
  var w = world(), R = S.D.recipes, q = S.rc.q.trim().toLowerCase(), f = S.rc.f, bf = S.rc.b;
  var onN = R.filter(function(r){ return recipeOn(r, w); }).length, altN = R.filter(function(r){ return r.a; }).length;
  var altOn = R.filter(function(r){ return r.a && recipeOn(r, w); }).length, prefN = Object.keys(w.prefer || {}).length;
  var blds = {}; R.forEach(function(r){ blds[r.b] = (S.D.buildings[r.b] || {}).n || r.b; });
  var h = '<div class="sectionhead"><div><h2>Recipes</h2><p class="lede">Pick the recipes ' + esc(w.name) + ' can use. The planner only uses recipes that are on, and always uses your starred recipe for a part unless a plan pins another.</p></div></div>';
  h += '<div class="summary" style="margin-top:14px"><div><div class="k">Recipes on</div><div class="v">' + onN + ' <small>of ' + R.length + '</small></div></div><div><div class="k">Alternates on</div><div class="v">' + altOn + ' <small>of ' + altN + '</small></div></div><div><div class="k">Switched off</div><div class="v">' + Object.keys(w.disabled || {}).length + '</div></div><div><div class="k">Preferred</div><div class="v">' + prefN + '</div></div></div>';
  h += '<div class="panel rcbar" data-tour="rc-bar" style="margin-top:14px"><div class="row" style="flex-wrap:wrap;gap:8px"><input type="search" id="rc_q" data-bind="rc_q" placeholder="Search recipes, parts or ingredients" value="' + esc(S.rc.q) + '" style="flex:2 1 220px">' +
    '<select id="rc_b" data-bind="rc_b" style="flex:1 1 160px" aria-label="Filter by building"><option value="">All buildings</option>' + Object.keys(blds).sort(function(a, b){ return blds[a].localeCompare(blds[b]); }).map(function(k){ return '<option value="' + k + '"' + (bf===k?' selected':'') + '>' + esc(blds[k]) + '</option>'; }).join('') + '</select></div>' +
    seg('rc_f', f, [['all','All'],['std','Standard'],['alt','Alternates'],['on','On'],['off','Off'],['pref','Preferred']]) +
    '<label class="check"><input type="checkbox" id="w_all" data-bind="w_all"' + (w.allAlts?' checked':'') + '><span>Everything unlocked (creative, or a finished save). You can still switch single recipes off.</span></label>' +
    '<div class="row" style="flex-wrap:wrap;gap:6px"><button class="btn small" data-act="rc_altsall">Turn on all alternates</button><button class="btn small" data-act="rc_std">Standard recipes only</button><button class="btn small ghost" data-act="rc_reset">' + (S.confirmDel==='rc_reset' ? 'Press again to reset' : 'Reset switches and stars') + '</button></div></div>';
  // group by main product
  var groups = {};
  R.forEach(function(r){
    var on = recipeOn(r, w), prod = r.o[0][0];
    if (f === 'std' && r.a) return; if (f === 'alt' && !r.a) return; if (f === 'on' && !on) return; if (f === 'off' && on) return;
    if (f === 'pref' && (w.prefer || {})[prod] !== r.id) return;
    if (bf && r.b !== bf) return;
    if (q){ var hay = (r.n + ' ' + r.i.concat(r.o).map(function(x){ return iname(x[0]); }).join(' ')).toLowerCase(); if (hay.indexOf(q) < 0) return; }
    (groups[prod] = groups[prod] || []).push(r);
  });
  var keys = Object.keys(groups).sort(function(a, b){ return iname(a).localeCompare(iname(b)); });
  if (!keys.length) return h + '<div class="notice info" style="margin-top:14px">No recipes match. Clear the search or pick another filter.</div>';
  h += '<div class="rclist">' + keys.map(function(prod){
    var all = S.D.producers[prod] || [], anyOn = all.some(function(r){ return recipeOn(r, w) && r.o[0][0] === prod; });
    var rows = groups[prod].sort(function(a, b){ return a.a - b.a || a.n.localeCompare(b.n); }).map(function(r){
      var on = recipeOn(r, w), per = 60 / r.t, b = S.D.buildings[r.b] || { n:r.b, p:0 }, pw = r.v ? (r.v[0] + r.v[1]) / 2 : b.p, pref = (w.prefer || {})[prod] === r.id;
      var conv = r.b === 'Build_Converter_C' && !w.converter;
      return '<div class="rcrow' + (on ? '' : ' off') + '"><label class="rcuse" title="' + (on ? 'Switch off' : 'Switch on') + '"><input type="checkbox" data-bind="rc_on" data-rid="' + r.id + '"' + (on?' checked':'') + ' aria-label="Use ' + esc(r.n) + '"></label>' +
        '<div class="rcname"><div><strong>' + esc(r.n) + '</strong> ' + (r.a ? '<span class="chip alt">ALT</span>' : '') + '</div><div class="hint">' + esc(b.n) + ' · ' + fmt(pw, 1) + ' MW' + (r.v ? ' avg' : '') + ' · ' + fmt(r.t) + ' s' + (conv ? ' · Converter recipes are off in World &amp; data' : '') + '</div></div>' +
        '<div class="rcflow"><span class="rcin">' + (r.i.length ? rateRow(r.i, per) : '<span class="hint">no inputs</span>') + '</span><span class="rcarrow" aria-hidden="true">→</span><span class="rcout">' + rateRow(r.o, per) + '</span></div>' +
        '<button type="button" class="rcstar' + (pref ? ' on' : '') + '" data-act="rc_pref" data-rid="' + r.id + '" data-item="' + prod + '" aria-pressed="' + pref + '"' + (on ? '' : ' disabled') + ' title="' + (pref ? 'Preferred for ' + esc(iname(prod)) + '. Press to clear' : 'Prefer this recipe for ' + esc(iname(prod))) + '">' + (pref ? '★ Preferred' : '☆ Prefer') + '</button></div>';
    }).join('');
    return '<section class="rcgrp"><div class="rchead"><h3>' + esc(iname(prod)) + '</h3><span class="hint">' + all.length + ' recipe' + (all.length===1?'':'s') + '</span>' + (anyOn ? '' : '<span class="chip over">Nothing can make this</span>') + '</div>' + rows + '</section>';
  }).join('') + '</div><p class="hint">Rates are per minute for one machine at 100%.</p>';
  return h;
}

/* ---------------- My factories ---------------- */
function factorySummary(f){
  var outs = Object.keys(f.outputs || {}).map(function(k){ return fmt(f.outputs[k]) + ' ' + iname(k); });
  var ins = Object.keys(f.inputs || {}).map(function(k){ return fmt(f.inputs[k]) + ' ' + iname(k); });
  return { outs:outs, ins:ins };
}
function renderFactories(){
  var w = world();
  var list = S.factories.filter(function(f){ return f.wid === w.id; }).sort(function(a,b){ return (b.saved||0)-(a.saved||0); });
  var h = '<div class="sectionhead"><div><h2>My factories</h2><p class="lede">Saved builds in ' + esc(w.name) + '. Save one from the Plan tab.</p></div></div>';
  h += '<p class="hint" style="margin:12px 0 0">Factories are saved in this browser. To keep a copy or move them to another device, use <a href="#world">Export and Import</a> on the World &amp; data tab.</p>';
  if (!list.length){ h += '<div class="notice info" style="margin-top:16px">No factories saved for this world yet. Plan a build, name it, and press Save factory.</div>'; return h; }
  var totP = 0, net = {};
  list.forEach(function(f){ totP += f.power || 0; Object.keys(f.outputs||{}).forEach(function(k){ net[k] = (net[k]||0) + f.outputs[k]; }); Object.keys(f.inputs||{}).forEach(function(k){ net[k] = (net[k]||0) - f.inputs[k]; }); });
  h += '<div class="summary" style="margin-top:16px"><div><div class="k">Factories</div><div class="v">' + list.length + '</div></div><div><div class="k">Power use</div><div class="v">' + fmt(totP,1) + ' <small>MW</small></div></div><div><div class="k">Machines</div><div class="v">' + list.reduce(function(a,f){ return a+(f.machines||0); },0) + '</div></div><div><div class="k">Items tracked</div><div class="v">' + Object.keys(net).length + '</div></div></div>';
  h += '<div class="flist" style="margin-top:14px">' + list.map(function(f){
    var s = factorySummary(f);
    return '<article class="card"><div class="head"><div><div class="title">' + esc(f.name) + '</div><div class="bld">' + (f.machines||0) + ' machines · ' + fmt(f.power||0,1) + ' MW' + (f.steps ? ' · built ' + (f.builtDone||0) + ' of ' + f.steps + ' steps' : '') + '</div></div>' + (f.steps && f.builtDone === f.steps ? '<span class="chip" style="color:var(--good);border-color:var(--good)">All built</span>' : '') + '</div><div class="hint"><strong>Makes:</strong> ' + esc(s.outs.join(', ') || '–') + '</div><div class="hint"><strong>Takes in:</strong> ' + esc(s.ins.join(', ') || '–') + '</div><div class="foot"><button class="btn small" data-act="f_load" data-id="' + f.id + '">Open in Plan</button><span class="spacer"></span><button class="btn small danger" data-act="f_del" data-id="' + f.id + '">' + (S.confirmDel===f.id ? 'Press again to delete' : 'Delete') + '</button></div></article>';
  }).join('') + '</div>';
  var keys = Object.keys(net).filter(function(k){ return Math.abs(net[k]) > 1e-6; }).sort(function(a,b){ return net[a]-net[b]; });
  h += '<div class="field" style="margin-top:18px" data-tour="fac-balance"><h3>World balance</h3><div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">Made − used</th><th>Status</th></tr></thead><tbody>' + keys.map(function(k){
    var v = net[k]; var raw = S.D.raw[k];
    return '<tr><td>' + esc(iname(k)) + '</td><td class="num">' + (v>0?'+':'') + fmt(v) + ' /min</td><td>' + (v > 0 ? '<span class="chip" style="color:var(--good);border-color:var(--good)">Surplus</span>' : raw ? '<span class="chip">From nodes</span>' : '<span class="chip over">Shortfall</span>') + '</td></tr>';
  }).join('') + '</tbody></table></div><span class="hint">Counts each factory\'s outputs and inputs. A shortfall on a made item means another factory needs to supply it.</span></div>';
  return h;
}

/* ---------------- World & data ---------------- */
function renderWorld(){
  var w = world();
  var alts = S.D.recipes.filter(function(r){ return r.a; });
  var on = alts.filter(function(r){ return w.alts[r.id]; }).length;
  var f = S.altFilter.toLowerCase();
  var h = '<div class="grid2"><div class="panel" data-tour="world-set"><h2>World</h2>';
  h += '<div class="field"><label class="lbl" for="w_name">Name</label><input type="text" id="w_name" value="' + esc(w.name) + '" data-bind="w_name"></div>';
  h += '<div class="row" style="flex-wrap:wrap"><button class="btn small" data-act="w_new">+ New world</button><button class="btn small danger" data-act="w_del"' + (S.worlds.length<2?' disabled':'') + '>' + (S.confirmDel==='w:'+w.id ? 'Press again to delete' : 'Delete world') + '</button></div>';
  h += '<div class="field"><label class="lbl" for="w_belt">Best belt unlocked</label><select id="w_belt" data-bind="w_belt">' + ENG.BELTS.map(function(b,i){ return '<option value="'+(i+1)+'"'+(w.maxBelt===i+1?' selected':'')+'>Mk.' + (i+1) + ' · ' + b + '/min</option>'; }).join('') + '</select></div>';
  h += '<div class="field"><label class="lbl" for="w_pipe">Best pipe unlocked</label><select id="w_pipe" data-bind="w_pipe">' + ENG.PIPES.map(function(b,i){ return '<option value="'+(i+1)+'"'+(w.maxPipe===i+1?' selected':'')+'>Mk.' + (i+1) + ' · ' + b + ' m³/min</option>'; }).join('') + '</select></div>';
  h += '<div class="field"><span class="lbl">Game Mode multipliers (1.2)</span><div class="row"><label class="hint" for="w_cost" style="width:120px">Recipe part cost</label><input type="number" id="w_cost" min="0.25" max="2" step="0.05" value="' + w.costMult + '" data-bind="w_cost" class="grow"></div><div class="row"><label class="hint" for="w_power" style="width:120px">Power use</label><input type="number" id="w_power" min="0.25" max="5" step="0.05" value="' + w.powerMult + '" data-bind="w_power" class="grow"></div><span class="hint">Leave both at 1 unless you set them when creating this save. They can\'t be changed in-game afterwards.</span></div>';
  h += '<label class="check"><input type="checkbox" id="w_conv" data-bind="w_conv"' + (w.converter?' checked':'') + '><span>Allow Converter recipes (turn SAM and one ore into another)</span></label>';
  h += '</div><div class="results">';
  var allR = S.D.recipes, onN = allR.filter(function(r){ return recipeOn(r, w); }).length;
  h += '<div class="panel" data-tour="world-alts"><div class="sectionhead"><h2>Recipes</h2><span class="mono hint">' + onN + ' of ' + allR.length + ' on</span></div><p style="margin:0">Choose which recipes this world can use, including alternates you\'ve unlocked, in the Recipes tab.</p><div><a class="btn primary" href="#recipes" style="text-decoration:none;display:inline-block">Open Recipes</a></div></div>';
  h += '<div class="panel" data-tour="world-data"><h2>Recipe data</h2><p style="margin:0">Using <strong>' + (S.dataIsMine ? 'a game file you loaded' : 'your game\'s 1.2 recipe file (built in)') + '</strong>: ' + S.D.recipes.length + ' recipes, ' + alts.length + ' alternates. Seasonal FICSMAS recipes are left out.</p>';
  h += '<p class="hint" style="margin:0">After a game patch, load the updated file to refresh the numbers. It\'s at <span class="mono">D:\\SteamLibrary\\steamapps\\common\\Satisfactory\\CommunityResources\\Docs\\en-US.json</span> and stays private to you.</p>';
  h += '<div class="row" style="flex-wrap:wrap"><label class="btn primary" for="docsFile" style="cursor:pointer">Load game file</label><input type="file" id="docsFile" accept=".json,application/json" hidden>' + (S.dataIsMine ? '<button class="btn" data-act="data_reset">Use built-in 1.2 data</button>' : '') + '</div>';
  if (S.importMsg) h += '<div class="notice ' + S.importMsg.kind + '">' + S.importMsg.html + '</div>';
  h += '</div>' + renderBackup() + '</div></div>';
  return h;
}

/* ---------------- Back up, move and share ---------------- */
function bkDefaults(){ return { world:function(){ return newWorld('Imported world', false); }, plan:examplePlan }; }
function renderBackup(){
  var B = S.bk, h = '<div class="panel" data-tour="world-backup"><h2>Back up, move and share</h2>';
  h += '<p style="margin:0">Your worlds and factories are saved in this browser only. Export a file to keep a copy, move them to your phone or another PC, or send them to a friend.</p>';
  h += '<div class="row" style="flex-wrap:wrap"><button class="btn primary" data-act="bk_export">Export backup</button><label class="btn" for="bkFile" style="cursor:pointer">Import backup</label><input type="file" id="bkFile" accept=".json,application/json" hidden><button class="btn" data-act="bk_share">Share this world as a link</button></div>';
  if (S.dataIsMine) h += '<label class="check"><input type="checkbox" id="bkGame"' + (B.withGame !== false ? ' checked' : '') + '><span>Include the game file I loaded in the backup</span></label>';
  h += '<p class="hint" style="margin:0">A share link holds the selected world, its plan and its factories. Other worlds are not included.</p>';
  if (B.link) h += '<div class="field"><label class="lbl" for="bkLink">Share link</label><div class="row"><input type="text" id="bkLink" class="grow" readonly value="' + esc(B.link) + '"><button class="btn small" data-act="bk_copy">Copy</button></div>' + (B.link.length > 4000 ? '<span class="hint">This link is long (' + B.link.length + ' characters). Some chat apps cut long links. If it won\'t open, send an exported file instead.</span>' : '') + '</div>';
  if (B.msg) h += '<div class="notice ' + B.msg.kind + '">' + B.msg.html + '</div>';
  if (B.pending) h += renderPending(B.pending);
  return h + '</div>';
}
function renderPending(P){
  var d = BACKUP.describe(P.inc, { worlds:S.worlds, factories:S.factories });
  var h = '<div class="notice info"><strong>' + (P.source === 'link' ? 'A shared world is ready to import' : 'Ready to import ' + esc(P.name)) + '</strong><ul class="loopsteps">';
  d.worlds.forEach(function(w){ h += '<li>World <strong>' + esc(w.name) + '</strong> ' + (w.exists ? '(replaces your copy of this world)' : '(new)') + '</li>'; });
  if (d.factories) h += '<li>' + d.factories + ' saved factor' + (d.factories === 1 ? 'y' : 'ies') + (d.factoriesReplaced ? (d.factoriesReplaced === 1 ? ' (replaces your copy)' : ' (' + d.factoriesReplaced + ' replace your copies)') : '') + '</li>';
  if (d.gameRecipes) h += '<li><label class="check"><input type="checkbox" id="bkUseGame"' + (P.useGame !== false ? ' checked' : '') + '><span>Also load the game file in this backup (' + d.gameRecipes + ' recipes)</span></label></li>';
  P.inc.warnings.forEach(function(m){ h += '<li class="hint">' + esc(m) + '</li>'; });
  h += '</ul><div class="row" style="flex-wrap:wrap;margin-top:10px"><button class="btn primary" data-act="bk_merge">Add to what I have</button>';
  if (P.source !== 'link' && P.inc.worlds.length) h += '<button class="btn danger" data-act="bk_replace">' + (S.confirmDel === 'bk_replace' ? 'Press again to replace everything' : 'Replace everything') + '</button>';
  h += '<button class="btn ghost" data-act="bk_cancel">Cancel</button></div>';
  h += '<p class="hint" style="margin:8px 0 0">"Add" keeps your other worlds and factories. A world or factory that is already here is updated from the file.' + (P.source !== 'link' ? ' "Replace everything" removes what you have now and uses only this file.' : '') + '</p></div>';
  return h;
}
function bkExport(){
  var withGame = S.dataIsMine && S.bk.withGame !== false;
  var data = BACKUP.build({ state:snapshotState(), factories:S.factories, flowCols:S.flowCols, gameData: withGame ? lsGet('sbp_gamedata') : null });
  var name = 'satisfactory-planner-backup-' + dateStamp() + '.json';
  downloadFile(name, JSON.stringify(data), 'application/json');
  S.bk.msg = { kind:'good', html:'Saved <span class="mono">' + esc(name) + '</span> with ' + S.worlds.length + ' world' + (S.worlds.length === 1 ? '' : 's') + ' and ' + S.factories.length + ' factor' + (S.factories.length === 1 ? 'y' : 'ies') + '. Keep it somewhere safe, or open it on another device with Import backup.' };
  render();
}
function bkShare(){
  var w = world(), pl = {}; pl[w.id] = plan();
  var raw = BACKUP.build({ state:{ worlds:[w], wid:w.id, plans:pl, v:1 }, factories:S.factories.filter(function(f){ return f.wid === w.id; }) });
  BACKUP.encodeShare(raw).then(function(tok){
    S.bk.link = location.href.split('#')[0] + '#share=' + tok; S.bk.msg = null; render();
    copyText(S.bk.link, 'Link copied. Send it to your friend.');
  }).catch(function(e){ S.bk.msg = { kind:'bad', html:'Couldn\'t make a share link: ' + esc((e && e.message) || e) }; render(); });
}
// Plans can only use items that exist in the recipe data, so leave out any that don't rather than break the page.
function bkCheckItems(inc){
  var bad = 0;
  function known(id){ return !!(S.D.items[id] || (inc.gameData && inc.gameData.items[id])); }
  function fix(p){
    ['targets', 'inputs'].forEach(function(k){ var n = p[k].length; p[k] = p[k].filter(function(t){ return !t.item || known(t.item); }); bad += n - p[k].length; });
    if (p.maxItem && !known(p.maxItem)){ p.maxItem = ''; bad++; }
  }
  Object.keys(inc.plans).forEach(function(k){ fix(inc.plans[k]); });
  inc.factories.forEach(function(f){ fix(f.plan); });
  if (bad) inc.warnings.push(bad + ' item' + (bad === 1 ? '' : 's') + ' in the plans aren\'t in your recipe data and ' + (bad === 1 ? 'was' : 'were') + ' left out.');
}
function bkPrepare(raw, source, name){
  var inc = BACKUP.normalize(raw, bkDefaults());
  bkCheckItems(inc);
  S.bk.pending = { inc:inc, source:source, name:name, useGame:true }; S.bk.msg = null; S.confirmDel = null;
}
function bkFail(e){ S.bk.pending = null; S.bk.msg = { kind:'bad', html:'<strong>Couldn\'t import that.</strong> ' + esc((e && e.message) || e) }; S.confirmDel = null; }
function bkFile(input){
  var file = input.files && input.files[0]; if (!file) return;
  var fr = new FileReader();
  fr.onload = function(){ try { bkPrepare(BACKUP.parse(fr.result), 'file', file.name); } catch(e){ bkFail(e); } render(); };
  fr.onerror = function(){ bkFail(new Error('The browser couldn\'t open that file. Try again.')); render(); };
  fr.readAsText(file);
}
// A share link was opened (on page load, or by pasting it into this tab).
function handleShare(tok){
  try { history.replaceState(null, '', location.href.split('#')[0] + '#world'); } catch(e){}
  BACKUP.decodeShare(tok).then(function(raw){ bkPrepare(raw, 'link', ''); }).catch(function(){
    S.bk.pending = null; S.bk.msg = { kind:'bad', html:'<strong>That share link couldn\'t be opened.</strong> It may have been cut off when it was sent. Ask for a new link, or for an exported file.' };
  }).then(function(){ setTab('world'); });
}
function bkApply(mode){
  var P = S.bk.pending; if (!P) return;
  var inc = P.inc, res;
  try { res = BACKUP.merge({ worlds:S.worlds, plans:S.plans, wid:S.wid, factories:S.factories, node:S.node, power:S.power, split:S.split, tr:S.tr }, inc, mode, { select: P.source === 'link' }); }
  catch(e){ bkFail(e); render(); return; }
  S.worlds = res.worlds; S.plans = res.plans; S.wid = res.wid; S.factories = res.factories;
  S.node = res.node; S.power = res.power; S.split = res.split; S.tr = Object.assign(S.tr, res.tr);
  if (mode === 'replace' && inc.flowCols){ S.flowCols = inc.flowCols; lsSet('sbp_flcols', S.flowCols); }
  var game = '';
  if (inc.gameData && P.useGame !== false){ useData(inc.gameData, true); lsSet('sbp_gamedata', inc.gameData); game = ' The game file was loaded too.'; }
  lsSet('sbp_factories', S.factories); save();
  S.bk.pending = null; S.confirmDel = null;
  S.bk.msg = { kind:'good', html:'Imported ' + inc.worlds.length + ' world' + (inc.worlds.length === 1 ? '' : 's') + ' and ' + (inc.factories.length - (res.skippedFactories || 0)) + ' factor' + (inc.factories.length - (res.skippedFactories || 0) === 1 ? 'y' : 'ies') + '.' + game + (res.skippedFactories ? ' ' + res.skippedFactories + ' factor' + (res.skippedFactories === 1 ? 'y was' : 'ies were') + ' left out because ' + (res.skippedFactories === 1 ? 'its world isn\'t' : 'their worlds aren\'t') + ' here.' : '') + ' <a href="#plan">Open the Plan tab</a>' };
  resolve(); render();
}
function bkAct(a){
  if (a === 'bk_export') return bkExport();
  if (a === 'bk_share') return bkShare();
  if (a === 'bk_copy') return copyText(S.bk.link, 'Link copied. Send it to your friend.');
  if (a === 'bk_cancel'){ S.bk.pending = null; S.confirmDel = null; render(); return; }
  if (a === 'bk_merge') return bkApply('merge');
  if (a === 'bk_replace'){ if (S.confirmDel !== 'bk_replace'){ S.confirmDel = 'bk_replace'; render(); return; } return bkApply('replace'); }
}

/* ---------------- events ---------------- */
function setTab(t){ if (['plan','recipes','node','power','transport','splits','factories','world'].indexOf(t) < 0) t = 'plan'; if (Tour.box && Tour.tab !== t) tourEnd(true); S.tab = t; S.confirmDel = null; render(); tourMaybe(); }
window.addEventListener('hashchange', function(){ var tok = BACKUP.tokenFromHash(location.hash); if (tok) handleShare(tok); else setTab(location.hash.slice(1)); });
$('#themeBtn').addEventListener('click', function(){ themeApply(themeNow() === 'dark' ? 'light' : 'dark', true); });
$('#worldSel').addEventListener('change', function(e){ S.wid = e.target.value; resolve(); save(); render(); });

// Ticks follow the plan into its saved factory, so progress shows in My factories too.
function syncBuilt(){
  var p = plan(); if (!p.fid) return;
  var f = S.factories.filter(function(x){ return x.id === p.fid; })[0]; if (!f) return;
  f.plan.built = JSON.parse(JSON.stringify(p.built || {}));
  var done = 0; (S.result && S.result.ok ? S.result.steps : []).forEach(function(s){ if (f.plan.built[s.recipe.id]) done++; });
  f.builtDone = done; f.steps = S.result && S.result.ok ? S.result.steps.length : f.steps;
  lsSet('sbp_factories', S.factories);
}
function touchPlan(){ var p = plan(); p.example = false; S.rmMsg = null; resolve(); save(); }
// Take a part out of the plan, but only if the plan still works without it.
function removePart(item){
  var p = plan(), w = world();
  if (S.result && S.result.targets && item in S.result.targets){ toast('That\'s what this plan makes, so it can\'t be removed'); return; }
  var before = S.result && S.result.ok ? S.result : null;
  var o = solveOpts(); o.bans[item] = 1;
  // a recipe you pinned that needs this part is released so the planner can pick another
  var freed = [];
  Object.keys(p.locks).forEach(function(k){ var rc = S.D.byId[p.locks[k]]; if (rc && rc.i.some(function(q){ return q[0] === item; })){ freed.push(k); delete o.locks[k]; } });
  var test = ENG.solve(S.D, o);
  if (test.ok){
    freed.forEach(function(k){ delete p.locks[k]; });
    p.inputs = p.inputs.filter(function(t){ return t.item !== item || t.mode !== 'ban'; });
    p.inputs.push({ item:item, mode:'ban', removed:true });
    touchPlan();
    var msg = 'Removed <strong>' + esc(iname(item)) + '</strong>. The plan now works around it.';
    if (before){
      var m0 = 0, m1 = 0, oo = { maxClock:p.maxClock, layout:p.layout };
      before.steps.forEach(function(s){ m0 += ENG.layout(S.D, s, oo).machines; });
      S.result.steps.forEach(function(s){ m1 += ENG.layout(S.D, s, oo).machines; });
      var newR = S.result.steps.filter(function(s){ return !before.steps.some(function(b0){ return b0.recipe.id === s.recipe.id; }); }).map(function(s){ return s.recipe.n; });
      if (newR.length) msg += ' New steps: ' + esc(newR.join(', ')) + '.';
      if (m1 !== m0) msg += ' Machines: ' + m0 + ' → ' + m1 + '.';
    }
    if (freed.length) msg += ' Your pinned recipe for ' + esc(freed.map(iname).join(', ')) + ' needed it, so that pin was cleared.';
    S.rmMsg = { kind:'good', html:msg };
    render(); return;
  }
  // It can't be removed. Check whether locked alternates would make it possible.
  var o2 = solveOpts(); o2.bans[item] = 1; o2.allAlts = true; o2.locks = {}; o2.clean = false; o2.lockedAltPenalty = 50;
  var t2 = ENG.solve(S.D, o2), html;
  if (t2.ok && !w.allAlts){
    var need = t2.steps.filter(function(s){ return s.recipe.a && !w.alts[s.recipe.id]; }).map(function(s){ return s.recipe.n; });
    html = 'Can\'t remove <strong>' + esc(iname(item)) + '</strong> with the recipes unlocked in this world, so the plan is unchanged.' + (need.length ? (need.length === 1 ? ' It would work with the <strong>' + esc(need[0]) + '</strong> alternate. Switch it' : ' It would work with these alternates: <strong>' + esc(need.join(', ')) + '</strong>. Switch them') + ' on in the Recipes tab if you have ' + (need.length === 1 ? 'it' : 'them') + '.' : '');
  } else {
    var users = (S.result && S.result.ok ? S.result.steps : []).filter(function(s){ return s.recipe.i.some(function(q){ return q[0] === item; }); }).map(function(s){ return iname(s.recipe.o[0][0]); });
    html = 'Can\'t remove <strong>' + esc(iname(item)) + '</strong>: ' + (users.length ? 'every way to make ' + esc(users.filter(function(v, i, a){ return a.indexOf(v) === i; }).join(' or ')) + ' needs it' : 'the plan can\'t be made without it') + ', so the plan is unchanged.';
  }
  S.rmMsg = { kind:'bad', html:html };
  render();
}
var deb = null;
function later(fn){ clearTimeout(deb); deb = setTimeout(fn, 250); }

document.addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b) return;
  var p = plan(), w = world();
  if (b.dataset.seg){
    var k = b.dataset.seg, v = b.dataset.val;
    if (k === 'mode'){ p.mode = v; if (v==='max'){ p.onlyInputs = true; if (!p.maxItem && p.targets[0]) p.maxItem = p.targets[0].item; } touchPlan(); }
    else if (k === 'goal' || k === 'layout'){ p[k] = v; touchPlan(); }
    else if (k === 'view'){ S.view = v; }
    else if (k === 'rc_f'){ S.rc.f = v; }
    else if (k === 'flcols'){ S.flowCols = v; lsSet('sbp_flcols', v); }
    else if (k === 't_mode'){ S.tr.mode = v; save(); }
    else if (k === 't_src'){ S.tr.src = v; save(); }
    else if (k === 'purity'){ S.node.purity = v; save(); }
    else if (k === 'p_mode'){ S.power.mode = v; S.power.value = v==='mw' ? 1000 : 4; save(); }
    else if (k === 'p_purity'){ S.power.purity = v; save(); }
    render(); return;
  }
  var a = b.dataset.act; if (!a) return;
  if (a.indexOf('bk_') === 0){ bkAct(a); return; }
  var i = +b.dataset.i;
  if (a === 't_add'){ p.targets.push({ item:'', rate:10 }); render(); var el = document.getElementById('t_item_' + (p.targets.length-1)); if (el) el.focus(); return; }
  if (a === 't_del'){ p.targets.splice(i,1); touchPlan(); render(); return; }
  if (a === 'in_add'){ p.inputs.push({ item:'', rate:60, mode:'have' }); render(); var el2 = document.getElementById('in_item_' + (p.inputs.length-1)); if (el2) el2.focus(); return; }
  if (a === 'in_del'){ p.inputs.splice(i,1); touchPlan(); render(); return; }
  if (a === 'amp'){ var rid = b.dataset.rid; if (p.amp[rid]) delete p.amp[rid]; else p.amp[rid] = true; touchPlan(); render(); return; }
  if (a === 'rm_part') return removePart(b.dataset.item);
  if (a === 'fz_in') return setZoom((S.flowZoom || 1) * 1.2);
  if (a === 'fz_out') return setZoom((S.flowZoom || 1) / 1.2);
  if (a === 'fz_one') return setZoom(1);
  if (a === 'fz_fit'){ var fwf = document.getElementById('flowwrap'); if (fwf && S.flowW) setZoom(Math.min(1, (fwf.clientWidth - 26) / S.flowW)); return; }
  if (a === 'built_clear'){ p.built = {}; syncBuilt(); save(); render(); toast('Ticks cleared'); return; }
  if (a === 'sheet_copy') return sheetCopy();
  if (a === 'sheet_csv') return sheetCsv();
  if (a === 'rc_pref'){ var itp = b.dataset.item; if (w.prefer[itp] === b.dataset.rid) delete w.prefer[itp]; else w.prefer[itp] = b.dataset.rid; resolve(); save(); render(); toast(w.prefer[itp] ? 'Preferred for ' + iname(itp) : 'Preference cleared'); return; }
  if (a === 'rc_altsall'){ S.D.recipes.forEach(function(r){ if (r.a){ w.alts[r.id] = true; delete w.disabled[r.id]; } }); resolve(); save(); render(); toast('All alternates on'); return; }
  if (a === 'rc_std'){ w.allAlts = false; w.alts = {}; w.disabled = {}; Object.keys(w.prefer).forEach(function(k){ var rc = S.D.byId[w.prefer[k]]; if (!rc || rc.a) delete w.prefer[k]; }); resolve(); save(); render(); toast('Standard recipes only'); return; }
  if (a === 'rc_reset'){ if (S.confirmDel !== 'rc_reset'){ S.confirmDel = 'rc_reset'; render(); return; } S.confirmDel = null; w.disabled = {}; w.prefer = {}; resolve(); save(); render(); toast('Switches and stars reset'); return; }
  if (a === 'rm_undo'){ var it0 = b.dataset.item; p.inputs = p.inputs.filter(function(t){ return !(t.removed && t.item === it0); }); S.rmMsg = null; touchPlan(); render(); toast(iname(it0) + ' is back in the plan'); return; }
  if (a === 'clear_pins'){ p.locks = {}; p.amp = {}; touchPlan(); render(); return; }
  if (a === 'save_factory') return saveFactory();
  if (a === 'f_load'){ var f = S.factories.filter(function(x){ return x.id === b.dataset.id; })[0]; if (f){ S.plans[w.id] = JSON.parse(JSON.stringify(f.plan)); S.plans[w.id].example = false; S.plans[w.id].fid = f.id; resolve(); save(); location.hash = 'plan'; setTab('plan'); toast('Opened ' + f.name); } return; }
  if (a === 'f_del'){ var id = b.dataset.id; if (S.confirmDel !== id){ S.confirmDel = id; render(); return; } S.confirmDel = null; deleteFactory(id); return; }
  if (a === 'node_plan'){
    var x = ENG.extract(S.node.kind, S.node.purity, S.node.clock, S.node.count);
    S.plans[w.id] = Object.assign(examplePlan(), { example:false, mode:'max', maxItem:b.dataset.item, inputs:[{ item:S.node.res, rate:Math.round(x.total*1000)/1000 }], onlyInputs:true, targets:[{ item:b.dataset.item, rate:10 }] });
    resolve(); save(); location.hash = 'plan'; setTab('plan'); return;
  }
  if (a === 'power_plan'){
    var y = ENG.power(S.D, S.power.gen, S.power.fuel, S.power.mode, +S.power.value||0, +S.power.clock||100);
    S.plans[w.id] = Object.assign(examplePlan(), { example:false, targets:[{ item:S.power.fuel, rate:Math.round(y.fuelRate*1000)/1000 }] });
    resolve(); save(); location.hash = 'plan'; setTab('plan'); return;
  }
  if (a === 'w_new'){ var nw = newWorld('New world', false); S.worlds.push(nw); S.wid = nw.id; resolve(); save(); render(); var el3 = $('#w_name'); if (el3){ el3.focus(); el3.select(); } return; }
  if (a === 'w_del'){ if (S.worlds.length < 2) return; if (S.confirmDel !== 'w:'+w.id){ S.confirmDel = 'w:'+w.id; render(); return; } S.confirmDel = null; S.worlds = S.worlds.filter(function(x){ return x.id !== w.id; }); delete S.plans[w.id]; S.wid = S.worlds[0].id; resolve(); save(); render(); toast('World deleted'); return; }
  if (a === 'alts_none'){ w.alts = {}; resolve(); save(); render(); return; }
  if (a === 'data_reset'){ useData(COMMUNITY, false); S.importMsg = { kind:'info', html:'Switched back to the built-in 1.2 data.' }; try { localStorage.removeItem('sbp_gamedata'); } catch(e){} resolve(); render(); return; }
});

function onField(e){
  var t = e.target, bind = t.dataset && t.dataset.bind; if (!bind) return;
  var p = plan(), w = world(), i = +t.dataset.i, v = t.type === 'checkbox' ? t.checked : t.value;
  var rer = true, immediate = e.type === 'change';
  switch (bind){
    case 't_item': p.targets[i].item = idFromName(v); if (!p.targets[i].item) rer = false; break;
    case 't_rate': p.targets[i].rate = parseFloat(v) || 0; break;
    case 'in_item': p.inputs[i].item = idFromName(v); if (!p.inputs[i].item) rer = false; break;
    case 'in_rate': p.inputs[i].rate = parseFloat(v) || 0; break;
    case 'in_mode': p.inputs[i].mode = v; if (v === 'have' && !p.inputs[i].rate) p.inputs[i].rate = 60; break;
    case 'fromFac':
      if (e.type !== 'change') return;
      var ff = S.factories.filter(function(f){ return f.id === v; })[0]; if (!ff) return;
      var nAdded = 0;
      Object.keys(ff.outputs || {}).forEach(function(k){
        var ex = p.inputs.filter(function(t){ return t.item === k && t.src === ff.name; })[0];
        var rt = Math.round(ff.outputs[k] * 1000) / 1000;
        if (ex) ex.rate = rt; else p.inputs.push({ item:k, rate:rt, mode:'have', src:ff.name });
        nAdded++;
      });
      toast('Added ' + nAdded + ' item' + (nAdded===1?'':'s') + ' from ' + ff.name);
      break;
    case 'max_item': p.maxItem = idFromName(v); if (!p.maxItem) rer = false; break;
    case 'onlyInputs': p.onlyInputs = v; break;
    case 'freeWater': p.freeWater = v; break;
    case 'maxClock': p.maxClock = +v; break;
    case 'built':
      if (e.type !== 'change') return;
      p.built = p.built || {}; if (v) p.built[t.dataset.rid] = 1; else delete p.built[t.dataset.rid];
      syncBuilt(); save(); render(); return;
    case 'clean': p.clean = v; break;
    case 'noLoops': p.noLoops = v; break;
    case 'lock': if (v) p.locks[t.dataset.item] = v; else delete p.locks[t.dataset.item]; break;
    case 'n_res': S.node.res = v; break;
    case 'n_kind': S.node.kind = v; break;
    case 'n_clock': S.node.clock = Math.min(250, Math.max(1, parseFloat(v) || 100)); break;
    case 'n_count': S.node.count = Math.max(1, Math.round(parseFloat(v) || 1)); break;
    case 'p_gen': S.power.gen = v; break;
    case 'p_fuel': S.power.fuel = v; break;
    case 'p_value': S.power.value = v; break;
    case 'p_clock': S.power.clock = Math.min(250, Math.max(1, parseFloat(v) || 100)); break;
    case 's_rate': S.split.rate = v; break;
    case 's_n': S.split.n = v; break;
    case 's_take': S.split.take = v; break;
    case 'w_name': w.name = v || 'Untitled world'; save(); if (e.type==='change') render(); else $('#worldSel').options[$('#worldSel').selectedIndex].text = w.name; return;
    case 'w_belt': w.maxBelt = +v; break;
    case 'w_pipe': w.maxPipe = +v; break;
    case 'w_cost': w.costMult = Math.min(2, Math.max(0.25, parseFloat(v) || 1)); break;
    case 'w_power': w.powerMult = Math.min(5, Math.max(0.25, parseFloat(v) || 1)); break;
    case 'w_conv': w.converter = v; break;
    case 'w_all': w.allAlts = v; break;
    case 'alt': if (v) w.alts[t.dataset.rid] = true; else delete w.alts[t.dataset.rid]; break;
    case 'altFilter': S.altFilter = v; later(render); return;
    case 'rc_q': S.rc.q = v; later(render); return;
    case 'tr_item': var tid = idFromName(v); if (!tid) return; S.tr.item = tid; break;
    case 'tr_rate': S.tr.rate = v; break;
    case 't_rt': S.tr.rt = Math.max(0.1, parseFloat(v) || 1); break;
    case 't_cpt': S.tr.cpt = Math.max(1, Math.round(parseFloat(v) || 1)); break;
    case 't_up': S.tr.up = +v; break;
    case 't_stacks': S.tr.stacks = +v; break;
    case 't_fac': S.tr.fac = v; S.tr.facItem = ''; break;
    case 't_fitem': S.tr.facItem = v; break;
    case 'rc_b': S.rc.b = v; render(); return;
    case 'rc_on':
      if (e.type !== 'change') return;
      var rr = S.D.byId[t.dataset.rid]; if (!rr) return;
      if (v){
        delete w.disabled[rr.id];
        if (rr.a && !w.allAlts) w.alts[rr.id] = true;
        if (rr.b === 'Build_Converter_C' && !w.converter){ w.converter = true; S.D.recipes.forEach(function(x){ if (x.b === 'Build_Converter_C' && x.id !== rr.id) w.disabled[x.id] = 1; }); }
      } else {
        if (rr.a && !w.allAlts) delete w.alts[rr.id]; else w.disabled[rr.id] = 1;
        if (w.prefer[rr.o[0][0]] === rr.id) delete w.prefer[rr.o[0][0]];
      }
      break;
    default: return;
  }
  if (!rer && e.type === 'input') return;
  if (S.tab === 'plan') p.example = false;
  var solveToo = S.tab === 'plan' || S.tab === 'world' || S.tab === 'recipes';
  save();
  var go = function(){ if (solveToo) resolve(); render(); };
  if ((t.type === 'text' || t.type === 'number' || t.type === 'range') && !immediate) later(go); else go();
}
document.addEventListener('input', onField);
document.addEventListener('change', function(e){
  if (e.target.id === 'docsFile') return importFile(e.target);
  if (e.target.id === 'bkFile') return bkFile(e.target);
  if (e.target.id === 'bkGame'){ S.bk.withGame = e.target.checked; return; }
  if (e.target.id === 'bkUseGame'){ if (S.bk.pending) S.bk.pending.useGame = e.target.checked; return; }
  onField(e);
});

function saveFactory(){
  var r = S.result, p = plan(), w = world();
  if (!r || !r.ok){ toast('Nothing to save yet'); return; }
  var nameEl = $('#saveName'); var name = (nameEl && nameEl.value.trim()) || (Object.keys(r.targets).map(iname).join(' + ') + ' line');
  var o = { maxClock:p.maxClock, layout:p.layout };
  var machines = 0, power = 0;
  r.steps.forEach(function(s){ var L = ENG.layout(S.D, s, o); machines += L.machines; power += L.power; });
  var outputs = {}; Object.keys(r.targets).forEach(function(k){ outputs[k] = r.targets[k]; });
  Object.keys(r.excess).forEach(function(k){ if (!(k in outputs)) outputs[k] = r.excess[k]; });
  var inputs = {}; Object.keys(r.given).forEach(function(k){ inputs[k] = r.given[k]; }); Object.keys(r.supply).forEach(function(k){ inputs[k] = (inputs[k]||0) + r.supply[k]; }); Object.keys(r.imported || {}).forEach(function(k){ inputs[k] = (inputs[k]||0) + r.imported[k]; });
  var fid = uid(); p.fid = fid;
  var f = { id: fid, wid: w.id, name: name, saved: Date.now(), plan: JSON.parse(JSON.stringify(p)), outputs: outputs, inputs: inputs, machines: machines, power: power, steps: r.steps.length, builtDone: r.steps.filter(function(s){ return (p.built || {})[s.recipe.id]; }).length };
  S.factories.push(f); lsSet('sbp_factories', S.factories);
  toast('Saved ' + name);
}
function deleteFactory(id){
  S.factories = S.factories.filter(function(f){ return f.id !== id; }); lsSet('sbp_factories', S.factories);
  render(); toast('Factory deleted');
}

function importFile(input){
  var file = input.files && input.files[0]; if (!file) return;
  S.importMsg = { kind:'info', html:'Reading ' + esc(file.name) + '…' }; render();
  var fr = new FileReader();
  fr.onload = function(){
    try {
      var data = ENG.importDocs(ENG.decodeBuffer(fr.result));
      var before = ENG.prep(COMMUNITY), changed = [], added = 0;
      data.recipes.forEach(function(r){
        var o = before.byId[r.id]; if (!o){ added++; return; }
        var sig = function(x){ return JSON.stringify([x.t, x.i, x.o]); };
        if (sig(o) !== sig(r)) changed.push(r.n);
      });
      useData(data, true);
      lsSet('sbp_gamedata', data);
      var alts = data.recipes.filter(function(r){ return r.a; }).length;
      S.importMsg = { kind:'good', html:'Loaded <strong>' + data.recipes.length + ' recipes</strong> (' + alts + ' alternates) from your game file.' + (changed.length ? ' ' + changed.length + ' differ from the built-in data: ' + esc(changed.slice(0,12).join(', ')) + (changed.length>12?', and more':'') + '.' : ' None differ from the built-in data.') + (added ? ' ' + added + ' are new.' : '') };
      resolve(); save(); render();
    } catch(err){
      S.importMsg = { kind:'bad', html:'That file couldn\'t be read: ' + esc(err.message || err) + ' Pick <span class="mono">en-US.json</span> from the Docs folder.' }; render();
    }
  };
  fr.onerror = function(){ S.importMsg = { kind:'bad', html:'The browser couldn\'t open that file. Try again.' }; render(); };
  fr.readAsArrayBuffer(file);
}


/* ---------------- Flow drag and zoom ---------------- */
var flDrag = null, flSuppressClick = false;
function setZoom(z, anchorX){
  var fw = document.getElementById('flowwrap'), old = S.flowZoom || 1;
  z = Math.max(0.25, Math.min(2, Math.round(z * 100) / 100));
  if (z === old) return;
  var ax = anchorX != null ? anchorX : (fw ? fw.clientWidth / 2 : 0);
  var cx = fw ? (fw.scrollLeft + ax) / old : 0;
  S.flowZoom = z; render();
  var fw2 = document.getElementById('flowwrap'); if (fw2) fw2.scrollLeft = cx * z - ax;
}
document.addEventListener('pointerdown', function(e){
  var fw = e.target.closest && e.target.closest('#flowwrap');
  if (!fw || e.pointerType !== 'mouse' || e.button !== 0) return;
  flDrag = { fw:fw, x:e.clientX, y:e.clientY, sl:fw.scrollLeft, sy:window.scrollY, moved:false, id:e.pointerId };
});
document.addEventListener('pointermove', function(e){
  if (!flDrag || e.pointerId !== flDrag.id) return;
  var dx = e.clientX - flDrag.x, dy = e.clientY - flDrag.y;
  if (!flDrag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  if (!flDrag.moved){ flDrag.moved = true; flDrag.fw.classList.add('grabbing'); try { flDrag.fw.setPointerCapture(e.pointerId); } catch(err){} flHide(); }
  flDrag.fw.scrollLeft = flDrag.sl - dx;
  window.scrollTo(window.scrollX, flDrag.sy - dy);
  e.preventDefault();
});
function flDragEnd(){
  if (!flDrag) return;
  if (flDrag.moved){ flSuppressClick = true; setTimeout(function(){ flSuppressClick = false; }, 0); }
  flDrag.fw.classList.remove('grabbing'); flDrag = null;
}
document.addEventListener('pointerup', flDragEnd);
document.addEventListener('pointercancel', flDragEnd);
document.addEventListener('click', function(e){ if (flSuppressClick){ e.stopPropagation(); e.preventDefault(); flSuppressClick = false; } }, true);
document.addEventListener('wheel', function(e){
  var fw = e.target.closest && e.target.closest('#flowwrap');
  if (!fw || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  var rect = fw.getBoundingClientRect();
  setZoom((S.flowZoom || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - rect.left);
}, { passive:false });

/* ---------------- Flow block details ---------------- */
var flPinned = null;
function flShow(g, ev){
  var tip = document.getElementById('flTip'); if (!tip || !S.flowTips) return;
  var k = g.getAttribute('data-k'); if (!S.flowTips[k]) return;
  tip.innerHTML = S.flowTips[k]; tip.hidden = false;
  var r = g.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  var x = ev && ev.clientX != null ? ev.clientX + 16 : r.right + 10, y = ev && ev.clientY != null ? ev.clientY + 14 : r.top;
  if (x + tw > vw - 12) x = Math.max(12, (ev && ev.clientX != null ? ev.clientX : r.left) - tw - 16);
  if (y + th > vh - 12) y = Math.max(12, vh - th - 12);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function flHide(){ var tip = document.getElementById('flTip'); if (tip) tip.hidden = true; if (flPinned){ flPinned.classList.remove('on'); flPinned = null; } }
document.addEventListener('mousemove', function(e){
  if (flPinned) return;
  var g = e.target.closest && e.target.closest('svg.flow .fl-g');
  if (g) flShow(g, e); else { var tip = document.getElementById('flTip'); if (tip && !tip.hidden) tip.hidden = true; }
});
document.addEventListener('click', function(e){
  var g = e.target.closest && e.target.closest('svg.flow .fl-g');
  if (g){ if (flPinned === g){ flHide(); return; } flHide(); flPinned = g; g.classList.add('on'); flShow(g, e); return; }
  if (flPinned) flHide();
});
document.addEventListener('focusin', function(e){ var g = e.target.closest && e.target.closest('svg.flow .fl-g'); if (g) flShow(g, null); });
document.addEventListener('focusout', function(e){ if (e.target.closest && e.target.closest('svg.flow .fl-g') && !flPinned){ var tip = document.getElementById('flTip'); if (tip) tip.hidden = true; } });
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && flPinned) flHide(); });
window.addEventListener('scroll', function(){ flHide(); }, true);

/* ---------------- guided tips ---------------- */
var TOURS = {
  plan: [
    { t:'Welcome to the Build Planner', b:'Tell it what you want to build and it works out every machine, clock speed and belt you need. These tips take about a minute.', x:'Use Next, or the arrow keys. You can replay these anytime with "? Tips" up top.' },
    { sel:'#worldSel', t:'Pick your world', b:'Each world keeps its own unlocked alternate recipes, best belt and pipe, and saved factories.', x:'You start with a creative world where everything is unlocked. Set up a survival save under World & data.' },
    { sel:'[data-tour=targets]', t:'What to make', b:'Type an item name (it suggests as you type) and how many you want per minute.', x:'Add more products with "+ Add product" to plan a mixed factory in one go.' },
    { sel:'[data-tour=mode]', t:'Exact rate, or as much as possible', b:'"Exact rate" builds for the number you typed. "As much as possible" finds the most you can make from the inputs you list.', x:'"As much as possible" is the one to use when you\'re building out from a node.' },
    { sel:'[data-tour=inputs]', t:'Inputs and limits', b:'Add items and pick how each is handled. "Have up to" is a belt or node you already have. "Bring in as needed" means another factory supplies it, so it isn\'t built here. "Don\'t use" keeps it out of the plan.', x:'"+ From a saved factory" adds another factory\'s outputs as inputs in one go. Tick "Only use these inputs" to plan strictly around what you\'ve got.' },
    { sel:'[data-tour=goal]', t:'What to optimise for', b:'Least raw saves ore, weighted by how rare each one is on the map. Least power keeps the grid light. Fewest machines means less to build.', x:'Recipe choices change with this, especially when alternates are unlocked.' },
    { sel:'[data-tour=layout]', t:'How machines are clocked', b:'"Full + one remainder" gives builds like 2 × 100% + 1 × 66.67%. "All the same clock" spreads it evenly, like 3 × 88.89%.', x:'Raise Max clock speed if you have power shards. Each card then tells you how many shards it needs.' },
    { sel:'.results .summary', t:'The totals', b:'Machines to build, power draw, how many input items, and any shards or Somersloops the plan uses.' },
    { sel:'.results .card', t:'One card per step', b:'Build exactly what the big line says: how many machines at what clock. IN and OUT show each item\'s total rate and the belt or pipe tier it needs.', x:'Use the dropdown to swap to a different recipe, "Remove part" to plan without that part, or "Fill Somersloops" to amplify that step. Stages run top to bottom, raw materials first.' },
    { sel:'[data-tour=save]', t:'Views and saving', b:'"Flow" draws the whole factory as a diagram you can drag and zoom. "Sheet" lists every material made, used and brought in, plus buildings and power, ready to copy into a spreadsheet.', x:'Tick "Built" on a card as you finish each step. Name the build and press Save factory to keep it, ticks included.' },
    { sel:'nav.tabs', t:'More tools', b:'Recipes is where you pick the recipes and alternates the planner may use. From a node works out what one node can feed. Power sizes a power plant. Transport works out trains, trucks and drones. Splits works out splitter trees.', x:'Each tab has its own short tips the first time you open it.' }
  ],
  node: [
    { sel:'[data-tour=node-in]', t:'Describe the node', b:'Pick the resource, extractor, purity and clock speed. Set how many like this if you have several of the same node.' },
    { sel:'[data-tour=node-out]', t:'What it puts out', b:'Total output per minute, the belt or pipe tier it needs, power, and shards for overclocking.' },
    { sel:'[data-tour=node-feed]', t:'What it can feed', b:'Every recipe that uses this resource, and how many machines the node keeps running.', x:'"Plan max" sends the node to Plan as your input and works out the most you can make from it.' }
  ],
  power: [
    { sel:'[data-tour=pow-in]', t:'Choose a generator', b:'Pick the generator and fuel, then size it by generator count or by the megawatts you need.' },
    { sel:'[data-tour=pow-out]', t:'What the plant needs', b:'Generators, fuel per minute, water and Water Extractors, plus any nuclear waste to plan around.', x:'"Plan ... fuel" opens Plan with that fuel rate as the target, so you can build the fuel line too.' }
  ],
  splits: [
    { sel:'[data-tour=split-in]', t:'Your line', b:'Enter the belt\'s rate, then either how many equal lines you want or an exact amount to pull off.' },
    { sel:'[data-tour=split-even]', t:'Even split', b:'Layer by layer, which splitters to place, and when to loop outputs back to get an odd number like 5 or 7.' },
    { sel:'[data-tour=split-take]', t:'Take off a rate', b:'The splitter tree that pulls the closest exact rate, and what\'s left on the main line.', x:'For machines that only pull what they need, a plain manifold usually does the job with no math.' }
  ],
  factories: [
    { sel:['.flist','#main .notice'], t:'Your saved factories', b:'Every build you saved from Plan, for the world picked up top. "Open in Plan" brings one back to tweak.' },
    { sel:'[data-tour=fac-balance]', t:'World balance', b:'Adds up what all your factories make and use. A shortfall means one factory needs something another one should supply.' }
  ],
  recipes: [
    { sel:'.rcbar', t:'Find recipes', b:'Search by recipe, part or ingredient, filter by building, or show only alternates, recipes that are on or off, or your preferred ones.', x:'"Everything unlocked" turns on every alternate for creative or a finished save. You can still switch single recipes off.' },
    { sel:'.rcgrp', t:'Switch recipes on or off', b:'Recipes are grouped by the part they make. Untick a recipe and the planner won\'t use it in any plan for this world.', x:'For alternates, tick the ones you\'ve unlocked from hard drives.' },
    { sel:'.rcstar', t:'Prefer a recipe', b:'Star a recipe to make it the way that part is always made in this world. A plan can still pin a different one from its build card.' }
  ],
  transport: [
    { sel:'[data-tour=tr-in]', t:'What to move', b:'Pick an item and rate, or a saved factory\'s output. Then choose train, truck, drone or the Dimensional Depot, and enter the round-trip time.' },
    { sel:'[data-tour=tr-out]', t:'What you need', b:'How many cars, trucks or drone ports, how full each trip is, and the power for stations and ports. Stack sizes come from your game file.', x:'The table below compares all three methods at the same round trip.' }
  ],
  world: [
    { sel:'[data-tour=world-set]', t:'World settings', b:'Name the world, set your best belt and pipe, and enter Game Mode multipliers if you set any when creating the save.', x:'Use "+ New world" for each save you play. Each keeps its own settings and factories.' },
    { sel:'[data-tour=world-alts]', t:'Recipes', b:'Which recipes this world can use, including alternates you\'ve unlocked, now lives in the Recipes tab.' },
    { sel:'[data-tour=world-data]', t:'Recipe data', b:'The numbers come from your game\'s own recipe file, already built in. After a game patch, load the new file here to update them.' },
    { sel:'[data-tour=world-backup]', t:'Back up, move and share', b:'Your worlds and factories live in this browser only. Export a backup file to keep a copy or move to another device, and Import it there.', x:'"Share this world as a link" makes a link you can send to a friend. They get a preview first and nothing is changed until they choose.' }
  ]
};
var Tour = { tab:null, i:0, steps:[], ring:null, box:null, raf:0 };
function seenGet(){ try { return JSON.parse(localStorage.getItem('sbp_tips') || '{}') || {}; } catch(e){ return {}; } }
function seenSet(tab){ var s = seenGet(); s[tab] = 1; try { localStorage.setItem('sbp_tips', JSON.stringify(s)); } catch(e){} }
function tourTarget(st){
  if (!st.sel) return null;
  var list = Array.isArray(st.sel) ? st.sel : [st.sel];
  for (var k = 0; k < list.length; k++){ var el = document.querySelector(list[k]); if (el && el.getClientRects().length) return el; }
  return null;
}
function tourStart(tab, force){
  tourEnd(true);
  var steps = (TOURS[tab] || []);
  if (!steps.length) return;
  Tour.tab = tab; Tour.steps = steps; Tour.i = 0;
  if (!force) seenSet(tab);
  Tour.ring = document.createElement('div'); Tour.ring.className = 'tour-ring'; Tour.ring.setAttribute('aria-hidden','true');
  Tour.box = document.createElement('div'); Tour.box.className = 'tour'; Tour.box.setAttribute('role','dialog'); Tour.box.setAttribute('aria-live','polite');
  document.body.appendChild(Tour.ring); document.body.appendChild(Tour.box);
  tourShow(0, 1);
  window.addEventListener('scroll', tourPlace, true); window.addEventListener('resize', tourPlace);
}
function tourEnd(silent){
  if (!Tour.box) return;
  Tour.box.remove(); Tour.ring.remove(); Tour.box = Tour.ring = null; Tour.tab = null;
  window.removeEventListener('scroll', tourPlace, true); window.removeEventListener('resize', tourPlace);
  if (!silent){ var b = document.getElementById('tourBtn'); if (b) b.focus(); }
}
function tourShow(i, dir){
  // skip steps whose target isn't on screen right now (for example, no plan yet)
  while (i >= 0 && i < Tour.steps.length && Tour.steps[i].sel && !tourTarget(Tour.steps[i])) i += dir;
  if (i < 0) i = 0;
  if (i >= Tour.steps.length){ tourEnd(); return; }
  Tour.i = i;
  var st = Tour.steps[i], n = Tour.steps.length, last = i === n - 1;
  Tour.box.innerHTML = '<div class="tstep">TIP ' + (i+1) + ' OF ' + n + '</div><h4>' + esc(st.t) + '</h4><p>' + esc(st.b) + '</p>' + (st.x ? '<p>' + esc(st.x) + '</p>' : '') +
    '<div class="tbtns"><div class="dots">' + Tour.steps.map(function(_, k){ return '<i class="' + (k===i?'on':'') + '"></i>'; }).join('') + '</div><span class="spacer"></span>' +
    (last ? '' : '<button type="button" class="btn small ghost" data-tour-act="skip">Skip</button>') +
    (i > 0 ? '<button type="button" class="btn small" data-tour-act="back">Back</button>' : '') +
    '<button type="button" class="btn small primary" data-tour-act="next">' + (last ? 'Done' : 'Next') + '</button></div>';
  var el = tourTarget(st);
  if (el){
    var r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  tourPlace();
  setTimeout(tourPlace, 350);
  var nb = Tour.box.querySelector('[data-tour-act=next]'); if (nb) nb.focus({ preventScroll:true });
}
function tourPlace(){
  if (!Tour.box) return;
  cancelAnimationFrame(Tour.raf);
  Tour.raf = requestAnimationFrame(function(){
    if (!Tour.box) return;
    var st = Tour.steps[Tour.i], el = tourTarget(st), vw = window.innerWidth, vh = window.innerHeight;
    var bw = Tour.box.offsetWidth, bh = Tour.box.offsetHeight, pad = 8;
    if (!el){
      Tour.ring.style.cssText = 'top:50%;left:50%;width:0;height:0;border-width:0';
      Tour.box.dataset.side = 'center';
      Tour.box.style.left = Math.max(16, (vw - bw) / 2) + 'px'; Tour.box.style.top = Math.max(16, (vh - bh) / 2) + 'px';
      return;
    }
    var r = el.getBoundingClientRect();
    var top = Math.max(r.top - 6, 0), bottom = Math.min(r.bottom + 6, vh);
    Tour.ring.style.cssText = 'top:' + top + 'px;left:' + (r.left - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + Math.max(0, bottom - top) + 'px';
    var below = vh - r.bottom, above = r.top, side, y;
    if (below >= bh + 20) { side = 'below'; y = r.bottom + 14; }
    else if (above >= bh + 20) { side = 'above'; y = r.top - bh - 14; }
    else { side = 'center'; y = Math.max(16, vh - bh - 16); }
    var x = Math.min(Math.max(16, r.left + Math.min(r.width, 280) / 2 - 40), vw - bw - 16);
    var ax = Math.min(Math.max(14, r.left + Math.min(r.width, 280) / 2 - x - 6), bw - 26);
    Tour.box.dataset.side = side; Tour.box.style.left = x + 'px'; Tour.box.style.top = y + 'px'; Tour.box.style.setProperty('--ax', ax + 'px');
  });
}
document.addEventListener('click', function(e){
  var b = e.target.closest('[data-tour-act]');
  if (b){ var a = b.dataset.tourAct; if (a === 'next') tourShow(Tour.i + 1, 1); else if (a === 'back') tourShow(Tour.i - 1, -1); else tourEnd(); return; }
  if (e.target.closest('#tourBtn')) tourStart(S.tab, true);
}, true);
document.addEventListener('keydown', function(e){
  if (!Tour.box) return;
  if (e.key === 'Escape') tourEnd();
  else if (e.key === 'ArrowRight' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) tourShow(Tour.i + 1, 1);
  else if (e.key === 'ArrowLeft' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) tourShow(Tour.i - 1, -1);
});
function tourMaybe(){ if (!Tour.box && !seenGet()[S.tab]) setTimeout(function(){ if (!Tour.box && !seenGet()[S.tab]) tourStart(S.tab); }, 500); }

/* ---------------- boot ---------------- */
(function boot(){
  themeApply(themeNow(), false);
  var mine = lsGet('sbp_gamedata');
  useData(mine && mine.recipes ? mine : COMMUNITY, !!(mine && mine.recipes));
  var st = lsGet('sbp_state');
  if (st) applyState(st);
  if (!S.worlds.length){ var w = newWorld('Creative (everything unlocked)', true); S.worlds = [w]; S.wid = w.id; }
  S.factories = lsGet('sbp_factories') || [];
  S.flowCols = lsGet('sbp_flcols') || 'type';
  S.tab = (location.hash || '#plan').slice(1);
  if (['plan','recipes','node','power','transport','splits','factories','world'].indexOf(S.tab) < 0) S.tab = 'plan';
  if (typeof solver === 'undefined'){ $('#main').innerHTML = '<div class="notice bad">The solver library didn\'t load. Check your connection and reload the page.</div>'; return; }
  resolve(); render();
  var tok = BACKUP.tokenFromHash(location.hash);
  if (tok) handleShare(tok); else tourMaybe();
})();
})();
