// app.js -- drives the page. All memory and BIST behaviour comes from model.js.
(function () {
  'use strict';
  const M = window.MbistModel;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hx = (v) => (v === null || v === undefined) ? 'x' : v.toString(16).toUpperCase().padStart(2, '0');
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const E = M.ELEMENTS;
  const elemName = (id) => (id >= 0 && id < E.length) ? E[id].label : '—';

  // Verilog results, copied from docs/fault_table.md (written by Icarus):
  // [MATS+ detected, March C- detected] for the 12 rows of tb_mbist.v.
  const VERILOG = [[0, 0], [1, 1], [1, 1], [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 1], [0, 1], [1, 1], [1, 1]];

  const SPEEDS = [1, 2, 4, 8, 20, 60, 200, 1000];   // clock edges per second
  const HIST = 32;
  const ANIM_MAX = 8;                                // clk/s above which tokens are hidden
  const STEP_MS = 520;                               // one animated manual step

  // ------------------------------------------------------------- faults
  const sideOf = (f) => f.aa < f.va ? 'aggressor below victim' : f.aa > f.va ? 'aggressor above victim' : 'same word';
  function describe(f, short) {
    const a = `[${f.aa}].${f.ab}`, v = `[${f.va}].${f.vb}`;
    const side = sideOf(f);
    if (short && f.type === M.F.CFIN) return `CFin: aggressor ${a} changes → victim ${v} inverts`;
    if (short && f.type === M.F.CFID) return `CFid${f.cfv}: aggressor ${a} changes → victim ${v} forced to ${f.cfv}`;
    switch (f.type) {
      case M.F.NONE: return 'fault-free (control)';
      case M.F.SA0: return `SA0: cell ${v} always reads 0`;
      case M.F.SA1: return `SA1: cell ${v} always reads 1`;
      case M.F.TFUP: return `TF↑: cell ${v} cannot rise (0→1)`;
      case M.F.TFDN: return `TF↓: cell ${v} cannot fall (1→0)`;
      case M.F.CFIN: return `CFin: a change of aggressor ${a} inverts victim ${v} (${side})`;
      case M.F.CFID: return `CFid${f.cfv}: a change of aggressor ${a} forces victim ${v} to ${f.cfv} (${side})`;
      case M.F.AF: return `AF: address ${f.aa} decodes to word ${f.va}`;
    }
    return '?';
  }
  const hasAgg = (f) => f.type >= M.F.CFIN;
  const hasVic = (f) => f.type !== M.F.NONE;

  const sel = $('fault');
  M.TB_CASES.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = `${i}: ${describe(c.f)}`;
    sel.appendChild(o);
  });
  { const o = document.createElement('option'); o.value = 'custom'; o.textContent = 'custom…'; sel.appendChild(o); }
  sel.value = '9';

  function customFault() {
    const t = $('ctype').value;
    const o = { va: +$('cva').value & 63, vb: +$('cvb').value & 7, aa: +$('caa').value & 63, ab: +$('cab').value & 7 };
    if (t === 'CFID0' || t === 'CFID1') return M.fault('CFID', Object.assign(o, { cfv: t === 'CFID1' ? 1 : 0 }));
    return M.fault(t, o);
  }
  function setCustomFrom(f) {
    const t = f.type === M.F.CFID ? 'CFID' + f.cfv : M.F_NAME[f.type];
    $('ctype').value = t; $('cva').value = f.va; $('cvb').value = f.vb; $('caa').value = f.aa; $('cab').value = f.ab;
  }
  function currentFault() {
    return sel.value === 'custom' ? customFault() : M.TB_CASES[+sel.value].f;
  }

  // ------------------------------------------------------------- build svg
  const PILLS = [];
  M.STATE_NAME.forEach((n, i) => {
    const g = $('pills');
    const r = svg('rect', { x: 72 + i * 72, y: 116, width: 64, height: 20, rx: 10, class: 'pill' }, g);
    const t = svg('text', { x: 72 + i * 72 + 32, y: 126, class: 'pilltxt' }, g);
    t.textContent = n; PILLS.push(r);
  });

  const ELB = [];
  E.forEach((el, i) => {
    const g = $('elems'), x = 32 + i * 89, y = 166, w = 84;
    const box = svg('rect', { x, y, width: w, height: 50, rx: 6, class: 'elbox' }, g);
    const t = svg('text', { x: x + w / 2, y: y + 20, class: 'eltxt' }, g);
    const parts = [];
    const add = (s, cls) => { const ts = svg('tspan', cls ? { class: cls } : {}, t); ts.textContent = s; return ts; };
    add(el.sym + '(');
    el.ops.forEach((o, k) => { if (k) add(','); parts.push(add(o[0] + o[1])); });
    add(')');
    const sub = svg('text', { x: x + w / 2, y: y + 35, class: 'elsub' }, g);
    svg('rect', { x: x + 6, y: y + 41, width: w - 12, height: 3, rx: 1.5, class: 'elbg' }, g);
    const bar = svg('rect', { x: x + 6, y: y + 41, width: 0, height: 3, rx: 1.5, class: 'elbar' }, g);
    ELB.push({ box, parts, sub, bar, w: w - 12 });
  });

  // memory array: 4 columns of 16 words, bit 7 on the left
  const MX = 806, MY = 178, COLW = 92, CP = 9, RP = 10;
  const cellXY = (a, b) => [MX + (a >> 4) * COLW + 20 + (7 - b) * CP, MY + (a & 15) * RP];
  const MEMC = [], WLBL = [];
  {
    const g = $('mem');
    for (let a = 0; a < 64; a++) {
      const [x0, y0] = cellXY(a, 7);
      const lbl = svg('text', { x: x0 - 3, y: y0 + 4, class: 'wordlbl' }, g);
      lbl.textContent = a; WLBL.push(lbl);
      svg('rect', { x: x0 - 1, y: y0 - 1, width: 8 * CP + 1, height: RP, class: 'cellbg' }, g);
      const row = [];
      for (let b = 7; b >= 0; b--) {
        const [x, y] = cellXY(a, b);
        const r = svg('rect', { x, y, width: CP - 1, height: RP - 2, class: 'cell c0', 'data-a': a, 'data-b': b }, g);
        r.style.cursor = 'pointer';
        row[b] = r;
      }
      MEMC.push(row);
    }
    g.addEventListener('click', (e) => {
      const t = e.target; if (!t.dataset || t.dataset.a === undefined) return;
      const a = +t.dataset.a, b = +t.dataset.b;
      const f = currentFault();
      setCustomFrom(f);
      if (e.shiftKey) {
        if (!hasAgg(f)) $('ctype').value = 'CFIN';
        $('caa').value = a; $('cab').value = b;
      } else {
        if (f.type === M.F.NONE) $('ctype').value = 'SA0';
        $('cva').value = a; $('cvb').value = b;
      }
      sel.value = 'custom'; showCustom(); reset();
    });
  }
  const DOUTC = [];
  for (let b = 7; b >= 0; b--) {
    DOUTC[b] = svg('rect', { x: 716 + (7 - b) * 10, y: 392, width: 9, height: 12, rx: 1.5, class: 'cell c0' }, $('doutCells'));
  }

  // ------------------------------------------------------------- sim state
  let sys, hist, ops, pendingRead, stats, playing = false;

  function reset() {
    stop();
    sys = new M.System({ algo: +$('algo').value, fault: currentFault(), sameCycle: $('same').checked });
    hist = []; ops = []; pendingRead = null;
    stats = { checked: 0, act: 0, failCycle: -1 };
    stepQueue = 0;
    $('sim').classList.toggle('same', sys.sameCycle);
    render(); drawTokens(null);
  }

  function evNote(ev) {
    if (!ev) return '';
    const f = sys.sram.f, out = [];
    if (ev.aliased) out.push(`AF: [${ev.addr}] decoded as [${ev.ea}]`);
    if (ev.op === 'w') {
      if (ev.tf) out.push(`TF: bit ${f.vb} of [${f.va}] did not ${f.type === M.F.TFUP ? 'rise' : 'fall'}`);
      if (ev.cf) out.push(`aggressor ${ev.cf.rise ? 'rose' : 'fell'} → victim [${f.va}].${f.vb} ${ev.cf.before}→${ev.cf.after}`);
    } else if (ev.forced) out.push(`${M.F_NAME[f.type]} forced bit ${f.vb}`);
    return out.join('; ');
  }

  // One rising edge, with the bookkeeping for the log.
  function edge() {
    const start = sys.cycle === 0 ? 1 : 0;           // tb pulses start for one cycle
    const w = sys.edge(start);
    hist.push(w); if (hist.length > 400) hist.shift();
    if (!sys.sameCycle && w.checked) {
      stats.checked++;
      if (pendingRead) {
        pendingRead.got = w.dout; pendingRead.mis = w.mismatch; pendingRead.latched = w.latched;
        pendingRead = null;
      }
    }
    if (w.state === M.S_RUN) {
      const e = { cycle: w.cycle, elem: w.elem, addr: w.addr, op: w.cur_rd ? 'r' : 'w', data: w.din, note: evNote(w.ev) };
      if (e.note) stats.act++;
      if (w.cur_rd) {
        if (sys.sameCycle) {                         // compared now, against the stale dout
          stats.checked++;
          e.got = w.dout; e.stale = true; e.mis = (w.dout === null || w.dout !== w.din) ? 1 : 0; e.latched = w.latched;
        } else pendingRead = e;
      }
      ops.push(e); if (ops.length > 300) ops.shift();
    }
    if (w.latched) stats.failCycle = w.cycle;
    return w;
  }

  // ------------------------------------------------------------- scheduler
  // Same frame loop as the Manchester demo: while playing, the number of
  // edges due is computed from the wall clock, so the rate on the slider is
  // the rate you get. Tokens are placed by how far we are through the cycle.
  let tPlay = 0, edgesPlayed = 0, stepQueue = 0, tStep = 0, loopOn = false;
  const speedNow = () => SPEEDS[+$('speed').value];

  function fire(n) {
    let w = null, latched = false, act = false;
    for (let k = 0; k < n && !sys.done; k++) { w = edge(); latched = latched || w.latched; act = act || !!evNote(w.ev); }
    if (w) {
      pulseClock();
      if (latched) { flash('flashCmp'); flash('flashLatch'); }
      if (act && n === 1) flash('flashVic');
      render();
    }
  }

  function loop() {
    const now = performance.now();
    if (playing) {
      const spd = speedNow();
      let due = Math.floor((now - tPlay) * spd / 1000) - edgesPlayed;
      if (due > 5000) { fire(1); tPlay = now; edgesPlayed = 0; due = 0; }
      if (due > 0) { fire(due); edgesPlayed += due; }
      if (sys.done) stop();
      const frac = (now - tPlay) * spd / 1000 - edgesPlayed;
      drawTokens(playing && spd <= ANIM_MAX ? Math.min(1, Math.max(0, frac)) : null);
    } else if (stepQueue > 0) {
      const u = (now - tStep) / STEP_MS;
      if (u >= 1) {
        fire(1); stepQueue--; tStep = now;
        if (sys.done) stepQueue = 0;
        drawTokens(stepQueue > 0 ? 0 : null);
      } else drawTokens(u);
    } else drawTokens(null);
    loopOn = playing || stepQueue > 0;
    if (loopOn) setTimeout(loop, 16);
  }
  function kick() { if (!loopOn) { loopOn = true; setTimeout(loop, 0); } }

  function step(n) {
    stop();
    if (sys.done) return;
    if (stepQueue === 0) tStep = performance.now();
    stepQueue += n;
    kick();
  }
  function stepAddr() {                               // edges until acnt or step changes
    const w = sys.wires();
    if (w.state !== M.S_RUN) return step(1);
    step(w.nops2 && !w.opi ? 2 : 1);
  }
  function runUntil(pred, limit) {
    stop(); stepQueue = 0;
    let latched = false;
    for (let k = 0; k < (limit || 1e5) && !sys.done; k++) {
      const w = edge(); latched = latched || w.latched;
      if (pred(w)) break;
    }
    pulseClock(); if (latched) { flash('flashCmp'); flash('flashLatch'); }
    render(); drawTokens(null);
  }
  function play() {
    if (sys.done) reset();
    stepQueue = 0;
    playing = true; $('btnPlay').textContent = '❚❚ Pause';
    tPlay = performance.now(); edgesPlayed = 0;
    kick();
  }
  function stop() { playing = false; $('btnPlay').textContent = '▶ Play'; }
  function rebase() { if (playing) { tPlay = performance.now(); edgesPlayed = 0; } }

  // ------------------------------------------------------------- tokens
  const TOKENS = [
    { path: 'w_addr', r: 9, on: (w) => w.state === M.S_RUN,
      look: (w) => w.cur_rd ? ['R', css('--accent')] : [w.cur_dat ? 'W1' : 'W0', w.cur_dat ? css('--one') : css('--zero')] },
    { path: 'w_dout', r: 11, on: (w) => sys.sameCycle ? (w.state === M.S_RUN && w.cur_rd) : w.chk_v,
      look: (w) => {
        const mis = sys.sameCycle ? (w.dout === null || w.dout !== w.din) : w.mismatch;
        return [hx(w.dout), mis ? css('--err') : css('--accent')];
      } },
  ];
  for (const T of TOKENS) {
    const el = svg('g', { class: 'token' }, $('tokens'));
    T.c = svg('circle', { r: T.r }, el); T.t = svg('text', {}, el);
    el.style.display = 'none';
    T.el = el; T.p = $(T.path); T.len = T.p.getTotalLength();
  }
  function drawTokens(u) {
    const w = u === null || sys.done ? null : sys.wires();
    for (const T of TOKENS) {
      if (!w || !T.on(w)) { T.el.style.display = 'none'; continue; }
      const pt = T.p.getPointAtLength(T.len * u);
      const [txt, col] = T.look(w);
      T.el.style.display = '';
      T.el.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      T.c.setAttribute('fill', col); T.t.textContent = txt;
    }
  }
  function pulseClock() { const e = $('clkA'); e.classList.remove('pulse'); void e.getBBox(); e.classList.add('pulse'); }
  function flash(id) { const f = $(id); f.classList.remove('on'); void f.getBBox(); f.classList.add('on'); }

  // ------------------------------------------------------------- render
  function setReg(id, txt, cls) {
    $('r_' + id).setAttribute('class', 'reg' + (cls ? ' ' + cls : ''));
    $('t_' + id).textContent = txt;
  }
  function setWire(id, cls) { $(id).setAttribute('class', 'wire ' + cls); }

  function render() {
    const w = sys.wires(), f = sys.sram.f, run = w.state === M.S_RUN;
    const prog = M.PROGRAMS[sys.algo];

    // FSM
    PILLS.forEach((p, i) => p.setAttribute('class', 'pill' + (i === w.state ? ' on' : '')));
    $('t_drain').textContent = sys.drain;
    $('t_opcount').textContent = sys.op_count;
    $('t_prog').textContent = sys.algo ? 'algo = 1: March C− walks 0,1,2,3,4,5' : 'algo = 0: MATS+ walks 0,1,4';

    // elements
    const curIdx = run ? sys.step : (w.state === M.S_IDLE ? -1 : prog.length);
    E.forEach((el, i) => {
      const B = ELB[i], pos = prog.indexOf(i), inProg = pos >= 0;
      const cur = run && w.elem === i;
      B.box.setAttribute('class', 'elbox' + (inProg ? '' : ' skip') + (cur ? ' cur' : ''));
      B.parts.forEach((p, k) => p.setAttribute('class', cur && k === w.opi ? 'opcur' : ''));
      let frac = 0;
      if (inProg && pos < curIdx) frac = 1;
      else if (cur) frac = (w.acnt * (w.nops2 + 1) + w.opi) / (64 * (w.nops2 + 1));
      B.bar.setAttribute('width', (B.w * frac).toFixed(1));
      B.sub.textContent = !inProg ? `skipped` : cur ? `elem ${i} · @${w.cur_addr}` : `elem ${i}`;
      B.sub.setAttribute('class', 'elsub' + (inProg ? '' : ' skiptxt'));
    });

    // sequencer
    setReg('step', sys.step); setReg('elem', w.elem); setReg('opi', w.opi); setReg('acnt', w.acnt);
    $('t_curaddr').textContent = `cur_addr = ${w.dir_down ? '63 − acnt' : 'acnt'} = ${w.cur_addr}   (${w.dir_down ? 'walking down ⇓' : 'walking up ⇑'})`;
    let opnow = '', nxt = '';
    if (run) {
      opnow = w.cur_rd ? `this cycle: read [${w.cur_addr}], expect ${hx(w.din)}${sys.sameCycle ? ' (what-if: compared now)' : ' (compared next cycle)'}`
        : `this cycle: write ${hx(w.din)} to [${w.cur_addr}]`;
      nxt = !w.last_op ? 'next edge: opi → 1 (second op, same address)'
        : !w.last_addr ? `next edge: acnt → ${w.acnt + 1}`
          : !w.at_last_step ? `next edge: step → ${sys.step + 1} (next element)` : 'next edge: last op issued → DRAIN';
    } else if (w.state === M.S_IDLE) {
      opnow = sys.cycle === 0 ? 'idle: the testbench holds start = 1 for the first edge' : 'idle';
      nxt = sys.cycle === 0 ? 'next edge: start = 1 → RUN, counters cleared' : 'waiting for start';
    } else if (w.state === M.S_DRAIN) {
      opnow = 'drain: no new ops; the last read is compared on the first DRAIN edge';
      nxt = sys.drain === 0 ? 'next edge: → DONE' : `next edge: drain → ${sys.drain - 1}`;
    } else {
      opnow = 'done = 1: the testbench reads fail';
      nxt = 'stays in DONE (press Reset to run again)';
    }
    $('t_opnow').textContent = opnow; $('t_next').textContent = nxt;

    // port wires
    setWire('w_cen', w.ce_n ? 'v1' : 'v0'); $('v_cen').textContent = w.ce_n;
    setWire('w_wen', w.we_n ? 'v1' : 'v0'); $('v_wen').textContent = w.we_n;
    setWire('w_addr', 'bus' + (run ? ' act' : '')); $('v_addr').textContent = run ? w.addr : '';
    setWire('w_din', 'bus' + (run && !w.cur_rd ? ' act' : '')); $('v_din').textContent = run && !w.cur_rd ? hx(w.din) : '';

    // shadow + compare
    setReg('chkv', w.chk_v, w.chk_v ? 'r1' : '');
    setReg('chkexp', hx(w.chk_exp)); setReg('chkaddr', w.chk_addr); setReg('chkelem', w.chk_elem);
    const cmpNow = sys.sameCycle ? (run && w.cur_rd) : w.chk_v;
    const misNow = sys.sameCycle ? (run && w.cur_rd && (w.dout === null || w.dout !== w.din) ? 1 : 0) : w.mismatch;
    setWire('w_dout', 'bus' + (misNow ? ' hot' : cmpNow ? ' act' : ''));
    setWire('w_chkexp', w.chk_v && !sys.sameCycle ? 'act' : '');
    $('v_dout').textContent = hx(w.dout);
    $('cmp').setAttribute('class', 'cmp' + (misNow ? ' hot' : ''));
    setWire('w_mis', misNow ? 'hot' : '');
    $('v_mis').textContent = cmpNow ? (misNow ? 'mismatch' : 'match') : '';
    $('v_mis').style.fill = misNow ? css('--err') : css('--muted');

    // latch
    setReg('fail', sys.fail, sys.fail ? 'bad' : '');
    setReg('faddr', sys.fail ? sys.fail_addr : '–');
    setReg('fgot', sys.fail ? hx(sys.fail_got) : '–');
    setReg('fexp', sys.fail ? hx(sys.fail_exp) : '–');
    setReg('felem', sys.fail ? sys.fail_elem : '–');
    $('t_failmsg').textContent = sys.fail
      ? `latched at cycle ${stats.failCycle}: read [${sys.fail_addr}] in ${elemName(sys.fail_elem)}, got ${hx(sys.fail_got)}, expected ${hx(sys.fail_exp)}`
      : 'nothing latched yet';

    // sram
    $('t_fault').textContent = describe(f, true);
    let fs = 'f_en = 0: behaves exactly like sram_model.v';
    if (hasVic(f)) {
      const vb = (sys.sram.mem[f.va] >> f.vb) & 1;
      fs = (f.type === M.F.CFIN || f.type === M.F.CFID ? sideOf(f) + ' · ' : '') + `victim [${f.va}].${f.vb} holds ${vb}`;
      if (hasAgg(f) && f.type !== M.F.AF) fs += ` · aggressor holds ${(sys.sram.mem[f.aa] >> f.ab) & 1}`;
      if (f.type === M.F.AF) fs = `writes and reads of [${f.aa}] land in word [${f.va}]; word [${f.aa}] itself is never touched`;
      if (f.type === M.F.SA0 || f.type === M.F.SA1) fs += ` · reads always return ${f.type === M.F.SA1 ? 1 : 0} in that bit`;
    }
    $('t_faultstate').textContent = fs;
    const ea = run ? sys.sram.effAddr(w.addr) : null;
    $('t_ea').textContent = run ? `${w.addr}→${ea}` : '';
    $('t_ea').style.fill = run && ea !== w.addr ? css('--err') : '';

    const one = 'cell c1', zero = 'cell c0';
    for (let a = 0; a < 64; a++) {
      const m = sys.sram.mem[a];
      for (let b = 0; b < 8; b++) MEMC[a][b].setAttribute('class', (m >> b) & 1 ? one : zero);
      WLBL[a].setAttribute('class', 'wordlbl' + (run && a === w.addr ? ' cur' : ''));
    }
    const hl = $('memHl');
    if (run) {
      const [x, y] = cellXY(ea, 7);
      hl.setAttribute('x', x - 3); hl.setAttribute('y', y - 3);
      hl.setAttribute('width', 8 * CP + 5); hl.setAttribute('height', RP + 4);
      hl.style.stroke = w.cur_rd ? css('--accent') : css('--warn');
      hl.style.display = '';
    } else hl.style.display = 'none';
    const ring = (id, a, b, show) => {
      const r = $(id); if (!show) { r.style.display = 'none'; return; }
      const [x, y] = cellXY(a, b);
      r.setAttribute('x', x - 2); r.setAttribute('y', y - 2);
      r.setAttribute('width', CP + 3); r.setAttribute('height', RP + 2);
      r.style.display = '';
    };
    if (f.type === M.F.AF) { ring('ringV', f.va, 7, false); ring('ringA', f.aa, 7, false); }
    ring('ringV', f.va, f.vb, hasVic(f) && f.type !== M.F.AF);
    ring('ringA', f.aa, f.ab, hasAgg(f) && f.type !== M.F.AF);
    if (f.type === M.F.AF) {                          // outline both whole words
      const r1 = $('ringV'), r2 = $('ringA');
      let [x, y] = cellXY(f.va, 7);
      r1.setAttribute('x', x - 2); r1.setAttribute('y', y - 2); r1.setAttribute('width', 8 * CP + 3); r1.setAttribute('height', RP + 2); r1.style.display = '';
      [x, y] = cellXY(f.aa, 7);
      r2.setAttribute('x', x - 2); r2.setAttribute('y', y - 2); r2.setAttribute('width', 8 * CP + 3); r2.setAttribute('height', RP + 2); r2.style.display = '';
    }
    if (hasVic(f)) {
      const [x, y] = cellXY(f.va, f.vb), fv = $('flashVic');
      fv.setAttribute('cx', x + CP / 2); fv.setAttribute('cy', y + RP / 2);
    }
    for (let b = 0; b < 8; b++) {
      const d = w.dout;
      DOUTC[b].setAttribute('class', d === null ? 'cell c0' : ((d >> b) & 1 ? one : zero));
    }
    $('t_dout').textContent = hx(w.dout);

    // last edge
    const last = hist.length ? hist[hist.length - 1] : null;
    const ev1 = $('t_ev1'), ev2 = $('t_ev2'), ev3 = $('t_ev3');
    ev1.textContent = ''; ev2.textContent = ''; ev3.textContent = '';
    ev1.setAttribute('class', 'evtxt'); ev2.setAttribute('class', 'evtxt'); ev3.setAttribute('class', 'evtxt');
    if (last) {
      if (last.ev && last.ev.op === 'w') ev1.textContent = `cycle ${last.cycle}: wrote ${hx(last.ev.data)} to [${last.ev.addr}]` + (last.ev.aliased ? ` (landed in [${last.ev.ea}])` : '') + `, word now ${hx(last.ev.stored)}`;
      else if (last.ev) ev1.textContent = `cycle ${last.cycle}: read [${last.ev.addr}], dout <= ${hx(last.ev.rv)}` + (last.ev.forced ? ` (array holds ${hx(last.ev.raw)})` : '');
      else ev1.textContent = `cycle ${last.cycle}: no SRAM access (state ${M.STATE_NAME[last.state]})`;
      const note = evNote(last.ev);
      if (note) { ev2.textContent = 'fault: ' + note; ev2.setAttribute('class', 'evtxt hot'); }
      if (last.latched) { ev3.textContent = `compare: ${hx(last.dout)} ≠ ${hx(sys.fail_exp)} → fail latched`; ev3.setAttribute('class', 'evtxt hot'); }
      else if (last.checked && !sys.sameCycle) ev3.textContent = `compare: dout ${hx(last.dout)} vs chk_exp ${hx(last.chk_exp)} → ${last.mismatch ? 'mismatch (already latched)' : 'match'}`;
    } else ev1.textContent = 'none yet: press Step or Play';

    // stats
    $('sCycle').textContent = sys.cycle;
    $('sState').textContent = M.STATE_NAME[w.state];
    $('sOps').textContent = sys.op_count;
    $('sChecked').textContent = stats.checked;
    $('sAct').textContent = stats.act;
    const res = $('sResult');
    if (sys.fail) { res.textContent = `FAIL at [${sys.fail_addr}] (${elemName(sys.fail_elem)})${sys.done ? ', done' : ''}`; res.className = 'bad'; }
    else if (sys.done) { res.textContent = 'done, no failure (miss / clean)'; res.className = 'ok'; }
    else { res.textContent = 'running, no failure yet'; res.className = ''; }

    drawWave(w);
    drawLog();
  }

  // ------------------------------------------------------------- waveform
  const SIGS = [
    ['clk', null],
    ['state', 'state', 'bus', (v) => M.STATE_NAME[v], () => true],
    ['ce_n', 'ce_n'], ['we_n', 'we_n'],
    ['addr', 'addr', 'bus', (v) => String(v), (d) => !d.ce_n],
    ['din', 'din', 'bus', hx, (d) => !d.ce_n && !d.we_n],
    ['dout', 'dout', 'bus', hx, (d) => d.dout !== null],
    ['chk_v', 'chk_v'],
    ['chk_exp', 'chk_exp', 'bus', hx, (d) => d.chk_v],
    ['mismatch', 'mismatch', 'err'],
    ['fail', 'fail', 'err'],
  ];
  function sizeCanvas(cv, hCss) {
    const dpr = window.devicePixelRatio || 1, wCss = cv.clientWidth;
    if (cv.width !== Math.round(wCss * dpr) || cv.height !== Math.round(hCss * dpr)) {
      cv.width = Math.round(wCss * dpr); cv.height = Math.round(hCss * dpr);
    }
    cv.style.height = hCss + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, wCss, hCss];
  }
  function drawWave(cur) {
    const cv = $('wave');
    const rowH = 26, top = 18;
    const [ctx, W, H] = sizeCanvas(cv, top + SIGS.length * rowH + 6);
    const labW = 70, cols = HIST, cw = (W - labW - 6) / cols;
    const now = Object.assign({}, cur, { cycle: sys.cycle, upcoming: true });
    if (sys.sameCycle) now.mismatch = now.state === M.S_RUN && now.cur_rd && (now.dout === null || now.dout !== now.din) ? 1 : 0;
    const past = hist.slice(-(cols - 1)).map((d) => {
      if (!sys.sameCycle) return d;
      return Object.assign({}, d, { mismatch: d.state === M.S_RUN && d.cur_rd && (d.dout === null || d.dout !== d.din) ? 1 : 0 });
    });
    const data = past.concat([now]);
    const off = cols - data.length;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ui-monospace,Consolas,monospace';
    const ink = css('--ink'), muted = css('--muted'), line = css('--line'), acc = css('--accent'),
          errc = css('--err'), warn = css('--warn'), chip = css('--chip');
    ctx.fillStyle = chip; ctx.fillRect(labW + (cols - 1) * cw, 0, cw, H);
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      const x = labW + c * cw; ctx.beginPath(); ctx.moveTo(x + .5, top - 4); ctx.lineTo(x + .5, H); ctx.stroke();
    }
    ctx.fillStyle = muted;
    data.forEach((d, i) => { if (d.cycle % 4 === 0) ctx.fillText(String(d.cycle), labW + (off + i) * cw + 2, 11); });
    SIGS.forEach(([name, key, kind, fmt, valid], r) => {
      const y0 = top + r * rowH, hi = y0 + 5, lo = y0 + rowH - 7, mid = (hi + lo) / 2;
      ctx.fillStyle = ink; ctx.fillText(name, 4, y0 + rowH / 2 + 3);
      ctx.lineWidth = 1.6;
      if (key === null) {
        ctx.strokeStyle = warn; ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
          const x = labW + (off + i) * cw;
          ctx.moveTo(x, lo); ctx.lineTo(x, hi); ctx.lineTo(x + cw / 2, hi); ctx.lineTo(x + cw / 2, lo); ctx.lineTo(x + cw, lo);
        }
        ctx.stroke(); return;
      }
      if (kind === 'bus') {
        // group equal consecutive values into one box
        let i = 0;
        while (i < data.length) {
          const ok = valid(data[i]), v = ok ? data[i][key] : null;
          let j = i + 1;
          while (j < data.length && valid(data[j]) === ok && (!ok || data[j][key] === v)) j++;
          const x0 = labW + (off + i) * cw, x1 = labW + (off + j) * cw;
          ctx.strokeStyle = ok ? acc : muted;
          ctx.beginPath();
          if (ok) {
            const s = Math.min(3, (x1 - x0) / 4);
            ctx.moveTo(x0, mid); ctx.lineTo(x0 + s, hi); ctx.lineTo(x1 - s, hi); ctx.lineTo(x1, mid);
            ctx.lineTo(x1 - s, lo); ctx.lineTo(x0 + s, lo); ctx.closePath(); ctx.stroke();
            const txt = fmt(v), tw = ctx.measureText(txt).width;
            if (tw + 6 < x1 - x0) { ctx.fillStyle = ink; ctx.fillText(txt, (x0 + x1) / 2 - tw / 2, mid + 4); }
          } else {
            ctx.globalAlpha = .5; ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke(); ctx.globalAlpha = 1;
          }
          i = j;
        }
        return;
      }
      let prev = null;
      for (let i = 0; i < data.length; i++) {
        const v = data[i][key] ? 1 : 0, x = labW + (off + i) * cw, y = v ? hi : lo;
        ctx.strokeStyle = (kind === 'err' && v) ? errc : acc;
        ctx.beginPath();
        if (prev !== null && prev !== y) { ctx.moveTo(x, prev); ctx.lineTo(x, y); } else ctx.moveTo(x, y);
        ctx.lineTo(x + cw, y); ctx.stroke();
        if (v && kind === 'err') { ctx.fillStyle = errc; ctx.globalAlpha = .18; ctx.fillRect(x, hi, cw, lo - hi); ctx.globalAlpha = 1; }
        prev = y;
      }
    });
  }

  // ------------------------------------------------------------- op log
  function drawLog() {
    const tb = document.querySelector('#oplog tbody');
    const rows = ops.slice(-14).reverse().map((e) => {
      const opTxt = e.op === 'r' ? 'read' : 'write';
      let got = '', cmp = '';
      if (e.op === 'r') {
        if (e.got === undefined) cmp = '<span class="stat">next cycle</span>';
        else {
          got = hx(e.got);
          cmp = e.mis ? '<span class="bad">mismatch</span>' : '<span class="ok">match</span>';
          if (e.stale) cmp += ' <span class="stat">(stale dout)</span>';
          if (e.latched) cmp += ' <span class="bad">← latched</span>';
        }
      }
      return `<tr class="${e.latched ? 'latched' : ''}"><td class="mono">${e.cycle}</td><td class="l mono">${elemName(e.elem)}</td><td class="mono">${e.addr}</td>`
        + `<td class="l">${opTxt}</td><td class="mono">${hx(e.data)}</td><td class="mono">${got}</td><td class="l">${cmp}</td><td class="l fx">${e.note || ''}</td></tr>`;
    });
    tb.innerHTML = rows.join('') || '<tr><td colspan="8" class="stat" style="text-align:left">Press Step or Play. The first edge starts the engine.</td></tr>';
  }

  // ------------------------------------------------------------- sweep
  function runSweep() {
    const tb = document.querySelector('#sweepTbl tbody'); tb.innerHTML = '';
    $('btnSweep').disabled = true;
    let k = 0, allOk = true, nMiss = [0, 0];
    const t0 = performance.now();
    const cell = (r) => r.detected
      ? [`<span class="bad">DETECT</span>`, `${elemName(r.fail_elem)} · [${r.fail_addr}] got ${hx(r.fail_got)} exp ${hx(r.fail_exp)} · cycle ${r.failCycle}`]
      : [`<span class="ok">miss</span>`, `<span class="stat">no mismatch in ${r.op_count} ops</span>`];
    const next = () => {
      if (k >= M.TB_CASES.length) {
        $('sweepStatus').innerHTML = (allOk ? '<span class="ok">all 24 results identical to the Verilog run</span>' : '<span class="bad">mismatch with Verilog</span>')
          + ` · MATS+ misses ${nMiss[0] - 1} of 11, March C− misses ${nMiss[1] - 1} of 11 · ${((performance.now() - t0) / 1000).toFixed(2)} s`;
        $('btnSweep').disabled = false; return;
      }
      const i = k++, c = M.TB_CASES[i];
      const r = [M.tb_case(0, c.f), M.tb_case(1, c.f)];
      const ok = r[0].detected === VERILOG[i][0] && r[1].detected === VERILOG[i][1];
      allOk = allOk && ok;
      r.forEach((x, a) => { if (!x.detected) nMiss[a]++; });
      const [m0, d0] = cell(r[0]), [m1, d1] = cell(r[1]);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${describe(c.f)}</td><td class="l">${m0}</td><td class="l">${d0}</td><td class="l">${m1}</td><td class="l">${d1}</td>`
        + `<td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</td><td><button class="small" data-case="${i}">load</button></td>`;
      tb.appendChild(tr);
      setTimeout(next, 8);
    };
    next();
  }
  document.querySelector('#sweepTbl').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-case]'); if (!b) return;
    sel.value = b.dataset.case; showCustom(); reset();
    $('sim').scrollIntoView({ behavior: 'smooth' });
  });

  // ------------------------------------------------------------- coverage map
  let mapRes = null;
  function mapFault(type, a, v, trig) {
    if (type === 'AF') return M.fault('AF', { va: v, aa: a });
    if (type === 'CFIN') return M.fault('CFIN', { va: v, vb: 1, aa: a, ab: 6, trig });
    return M.fault('CFID', { va: v, vb: 1, aa: a, ab: 6, cfv: type === 'CFID1' ? 1 : 0, trig });
  }
  function computeMap() {
    const type = $('mType').value, algo = $('mAlgo').value, trig = +$('mTrig').value;
    $('mTrig').disabled = type === 'AF';
    const prog = M.PROGRAMS[algo];
    const elem = new Int8Array(4096), addr = new Int8Array(4096);
    for (let a = 0; a < 64; a++) for (let v = 0; v < 64; v++) {
      const r = M.runMarch(prog, mapFault(type, a, v, trig));
      elem[a * 64 + v] = r.elem; addr[a * 64 + v] = r.addr;
    }
    mapRes = { type, algo, trig, elem, addr, prog };
    drawMap(); mapTables();
  }
  let mapGeom = null;
  function drawMap() {
    if (!mapRes) return;
    const cv = $('map');
    const W = cv.clientWidth, L = 34, T = 22;
    const cs = Math.max(3, Math.floor((W - L - 6) / 64));
    const [ctx] = sizeCanvas(cv, T + cs * 64 + 8);
    mapGeom = { L, T, cs };
    ctx.clearRect(0, 0, W, T + cs * 64 + 8);
    const hit = css('--hit'), miss = css('--miss'), muted = css('--muted'), panel = css('--panel'), ink = css('--ink');
    ctx.fillStyle = panel; ctx.fillRect(L, T, cs * 64, cs * 64);
    const gap = cs >= 6 ? 1 : 0;
    const none = css('--line'), isAF = mapRes.type === 'AF';
    for (let a = 0; a < 64; a++) for (let v = 0; v < 64; v++) {
      ctx.fillStyle = isAF && a === v ? none : mapRes.elem[a * 64 + v] >= 0 ? hit : miss;
      ctx.fillRect(L + v * cs, T + a * cs, cs - gap, cs - gap);
    }
    ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.fillStyle = muted;
    for (let k = 0; k < 64; k += 16) {
      ctx.fillText(String(k), L + k * cs, T - 6);
      ctx.fillText(String(k).padStart(2, ' '), 6, T + k * cs + 9);
    }
    ctx.fillStyle = ink;
    ctx.fillText('victim →', L + 64 * cs - 52, T - 6);
    ctx.save(); ctx.translate(10, T + 64 * cs); ctx.rotate(-Math.PI / 2); ctx.fillText('aggressor →', 0, 0); ctx.restore();
  }
  function mapTables() {
    const R = mapRes, cnt = { lt: [0, 0], gt: [0, 0], eq: [0, 0] }, byElem = {};
    const isAF = R.type === 'AF';
    for (let a = 0; a < 64; a++) for (let v = 0; v < 64; v++) {
      if (isAF && a === v) continue;                  // decodes to itself: not a fault
      const e = R.elem[a * 64 + v], key = a < v ? 'lt' : a > v ? 'gt' : 'eq';
      cnt[key][e >= 0 ? 0 : 1]++;
      if (e >= 0) byElem[e] = (byElem[e] || 0) + 1;
    }
    const row = (lbl, c) => `<tr><td>${lbl}</td><td>${c[0]}</td><td class="${c[1] ? 'bad' : ''}">${c[1]}</td></tr>`;
    document.querySelector('#mapCounts tbody').innerHTML =
      row('aggressor below victim (a &lt; v)', cnt.lt) + row('aggressor above victim (a &gt; v)', cnt.gt)
      + (isAF ? '<tr><td>same address (a = v)</td><td colspan="2" class="stat">not a fault (grey)</td></tr>' : row('same word (a = v)', cnt.eq))
      + row(`<b>all ${isAF ? 4032 : 4096}</b>`, [cnt.lt[0] + cnt.gt[0] + cnt.eq[0], cnt.lt[1] + cnt.gt[1] + cnt.eq[1]]);
    document.querySelector('#mapElems tbody').innerHTML = R.prog.map((id) =>
      `<tr><td class="mono">${E[id].label}</td><td>${byElem[id] || 0}</td></tr>`).join('');
    // explanation for the current view
    let note = '';
    const total = isAF ? 4032 : 4096, caught = cnt.lt[0] + cnt.gt[0] + cnt.eq[0];
    if (R.algo === '0' && R.type !== 'AF' && (cnt.lt[1] === 2016 || cnt.gt[1] === 2016)) {
      note = `MATS+ walks one way per element, so it catches this coupling fault for one ordering of aggressor and victim and misses the other half of the map.`;
    } else if (R.algo === 'C-noR0' && caught < total && R.trig) {
      note = `Without the final ⇕(r0), ${total - caught} pairs are missed. Those faults are activated by the last write of ⇓(r1,w0), after the victim has already been read, so only a final read can see them. This is why March C− ends with ⇕(r0).`;
    } else if (R.algo === 'C-noR0' && !R.trig && R.type !== 'AF') {
      note = 'With the RTL’s coupling faults (they fire on either aggressor edge) the final ⇕(r0) catches nothing extra: every pair is already caught earlier. Set “coupling fires on” to a single edge to see where the final read matters.';
    } else if (R.type === 'AF') {
      note = 'Every algorithm here catches every address alias: in ⇑(r0,w1) one of the two addresses writes 1s into the shared word, so the next r0 of the other address reads 1s where 0s are expected. Same-address pairs (grey diagonal) are not a fault.';
    } else if (caught === total) note = 'Every pair caught.';
    else note = `${total - caught} of ${total} pairs missed.`;
    $('mapNote').textContent = note;
  }
  function mapHit(ev) {
    if (!mapGeom || !mapRes) return null;
    const r = $('map').getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top, { L, T, cs } = mapGeom;
    const v = Math.floor((x - L) / cs), a = Math.floor((y - T) / cs);
    if (v < 0 || v > 63 || a < 0 || a > 63) return null;
    return { a, v, x, y };
  }
  $('map').addEventListener('mousemove', (ev) => {
    const h = mapHit(ev), tip = $('tip');
    if (!h) { tip.style.display = 'none'; return; }
    const e = mapRes.elem[h.a * 64 + h.v], ad = mapRes.addr[h.a * 64 + h.v];
    const f = mapFault(mapRes.type, h.a, h.v, mapRes.trig);
    tip.innerHTML = `<b>aggressor ${h.a} → victim ${h.v}</b><br>${describe(f)}<br>`
      + (e >= 0 ? `<span class="ok">caught</span> in ${E[e].label}, reading [${ad}]` : `<span class="bad">missed</span> by ${M.ALGO_NAME[mapRes.algo]}`);
    tip.style.display = 'block';
    const bw = $('mapBox').clientWidth;
    tip.style.left = Math.min(h.x + 14, bw - 270) + 'px'; tip.style.top = (h.y + 14) + 'px';
  });
  $('map').addEventListener('mouseleave', () => { $('tip').style.display = 'none'; });
  $('map').addEventListener('click', (ev) => {
    const h = mapHit(ev); if (!h) return;
    if (mapRes.trig && mapRes.type !== 'AF') {
      $('tip').innerHTML = 'One-edge coupling is a what-if: the RTL fault injector cannot load it.';
      return;
    }
    const f = mapFault(mapRes.type, h.a, h.v, 0);
    setCustomFrom(f); sel.value = 'custom'; showCustom();
    if (mapRes.algo !== 'C-noR0') $('algo').value = mapRes.algo;
    reset();
    $('sim').scrollIntoView({ behavior: 'smooth' });
  });

  // every location, every type
  function computeAll() {
    const trig = +$('mTrig').value;
    const algos = [0, 1, 'C-noR0'];
    const rows = [];
    const cellTypes = [['SA0', 'SA0'], ['SA1', 'SA1'], ['TFUP', 'TF↑'], ['TFDN', 'TF↓']];
    for (const [t, name] of cellTypes) {
      const n = algos.map((al) => {
        let c = 0;
        for (let a = 0; a < 64; a++) for (let b = 0; b < 8; b++) c += M.runMarch(M.PROGRAMS[al], M.fault(t, { va: a, vb: b })).detected;
        return c;
      });
      rows.push([name, 512, n]);
    }
    for (const [t, name] of [['CFIN', 'CFin'], ['CFID0', 'CFid0'], ['CFID1', 'CFid1'], ['AF', 'AF']]) {
      const n = algos.map((al) => {
        let c = 0;
        for (let a = 0; a < 64; a++) for (let v = 0; v < 64; v++) {
          if (t === 'AF' && a === v) continue;
          c += M.runMarch(M.PROGRAMS[al], mapFault(t, a, v, trig)).detected;
        }
        return c;
      });
      rows.push([name + (trig && t !== 'AF' ? (trig === 1 ? ' (rising only)' : ' (falling only)') : ''), t === 'AF' ? 4032 : 4096, n]);
    }
    const pct = (c, n) => `${c} <span class="stat">(${(100 * c / n).toFixed(1)} %)</span>`;
    document.querySelector('#allTbl tbody').innerHTML = rows.map(([name, n, c]) =>
      `<tr><td>${name}</td><td>${n}</td>${c.map((x) => `<td class="${x < n ? 'bad' : ''}">${pct(x, n)}</td>`).join('')}</tr>`).join('');
  }

  // ------------------------------------------------------------- wiring
  function showCustom() { $('custom').classList.toggle('on', sel.value === 'custom'); }
  $('btnReset').onclick = reset;
  $('btnStep').onclick = () => step(1);
  $('btnStepAddr').onclick = stepAddr;
  $('btnStepElem').onclick = () => {
    const s0 = sys.step, st0 = sys.state;
    runUntil((w) => sys.step !== s0 || sys.state !== st0);
  };
  $('btnToFail').onclick = () => runUntil((w) => w.latched);
  $('btnToEnd').onclick = () => runUntil(() => false);
  $('btnPlay').onclick = () => (playing ? stop() : play());
  $('algo').onchange = reset;
  sel.onchange = () => { if (sel.value === 'custom') setCustomFrom(currentFault()); showCustom(); reset(); };
  for (const id of ['ctype', 'cva', 'cvb', 'caa', 'cab']) $(id).onchange = reset;
  $('same').onchange = reset;
  $('real').onchange = () => $('diagram').classList.toggle('real', $('real').checked);
  const spd = () => { $('speedLbl').textContent = SPEEDS[+$('speed').value] + ' clk/s'; };
  $('speed').oninput = () => { spd(); rebase(); }; spd();
  $('btnSweep').onclick = runSweep;
  $('mType').onchange = computeMap; $('mAlgo').onchange = computeMap;
  $('mTrig').onchange = () => { computeMap(); computeAll(); };
  $('themeBtn').onclick = () => {
    const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('sram.theme', r.dataset.theme); } catch (e) {}
    render(); drawMap();
  };
  try { const t = localStorage.getItem('sram.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { render(); drawMap(); }, 60); });

  // Deep links, e.g. ?fault=4&algo=0&steps=200&real=1&same=1&sweep=1&map=CFID1&malgo=C-noR0&trig=2
  const q = new URLSearchParams(location.search);
  if (q.get('algo') === '0' || q.get('algo') === '1') $('algo').value = q.get('algo');
  if (q.get('fault') !== null && M.TB_CASES[+q.get('fault')]) sel.value = String(+q.get('fault'));
  if (q.get('same') === '1') $('same').checked = true;
  if (q.get('real') === '1') { $('real').checked = true; $('real').onchange(); }
  if (q.get('map')) $('mType').value = q.get('map');
  if (q.get('malgo')) $('mAlgo').value = q.get('malgo');
  if (q.get('trig')) $('mTrig').value = q.get('trig');
  showCustom();
  reset();
  const n = Math.min(5000, parseInt(q.get('steps') || '0', 10) || 0);
  if (n) runUntil(() => false, n);
  if (q.get('tofail') === '1') runUntil((w) => w.latched);
  setTimeout(() => { computeMap(); computeAll(); }, 30);
  if (q.get('sweep') === '1') runSweep();
})();
