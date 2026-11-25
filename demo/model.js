// model.js -- cycle-accurate JavaScript port of rtl/mbist_ctrl.v and
// rtl/sram_faulty.v, wired the way tb/tb_mbist.v wires them, plus a fast
// op-level model (the same algorithm as scripts/golden_model.py) for sweeps.
//
// Each call to System.edge() is one rising edge of clk. Both always blocks see
// the values from before the edge, exactly as the non-blocking assignments in
// the RTL do: the SRAM executes the operation the controller is driving now,
// and the controller compares the shadow registers against the dout that the
// SRAM registered on the previous edge.
//
// Works in the browser (window.MbistModel) and in node (module.exports).
(function (root) {
  'use strict';

  const ADDR_W = 6, DATA_W = 8, DEPTH = 1 << ADDR_W, MASK = (1 << DATA_W) - 1;

  // include/fault_defs.vh
  const F = { NONE: 0, SA0: 1, SA1: 2, TFUP: 3, TFDN: 4, CFIN: 5, CFID: 6, AF: 7 };
  const F_NAME = ['NONE', 'SA0', 'SA1', 'TFUP', 'TFDN', 'CFIN', 'CFID', 'AF'];

  // mbist_ctrl.v state encoding
  const S_IDLE = 0, S_RUN = 1, S_DRAIN = 2, S_DONE = 3;
  const STATE_NAME = ['IDLE', 'RUN', 'DRAIN', 'DONE'];

  // The element table that mbist_ctrl decodes. Element ids are the RTL's
  // `elem` values (also what fail_elem reports).
  const ELEMENTS = [
    { id: 0, sym: '⇕', ops: [['w', 0]],           down: false },
    { id: 1, sym: '⇑', ops: [['r', 0], ['w', 1]], down: false },
    { id: 2, sym: '⇑', ops: [['r', 1], ['w', 0]], down: false },
    { id: 3, sym: '⇓', ops: [['r', 0], ['w', 1]], down: true },
    { id: 4, sym: '⇓', ops: [['r', 1], ['w', 0]], down: true },
    { id: 5, sym: '⇕', ops: [['r', 0]],           down: false },
  ];
  ELEMENTS.forEach((e) => { e.label = e.sym + '(' + e.ops.map((o) => o[0] + o[1]).join(',') + ')'; });

  // algo = 0 : MATS+ walks elements 0,1,4 ; algo = 1 : March C- walks 0..5.
  // 'C-noR0' is a what-if (March C- without its final read). The RTL cannot
  // run it; only the op-level model uses it.
  const PROGRAMS = {
    0: [0, 1, 4],
    1: [0, 1, 2, 3, 4, 5],
    'C-noR0': [0, 1, 2, 3, 4],
  };
  const ALGO_NAME = { 0: 'MATS+', 1: 'March C−', 'C-noR0': 'March C− without final ⇕(r0)' };

  function elemOf(algo, step) {                 // the `elem` always @* block
    if (algo) return step & 7;
    if (step === 0) return 0;
    if (step === 1) return 1;
    return 4;
  }

  function decode(elem, opi) {                  // the element-decode always @* block
    let rd = 0, dat = 0, down = 0, nops2 = 1;
    switch (elem) {
      case 0: nops2 = 0; rd = 0; dat = 0; break;
      case 1: down = 0; if (!opi) { rd = 1; dat = 0; } else { rd = 0; dat = 1; } break;
      case 2: down = 0; if (!opi) { rd = 1; dat = 1; } else { rd = 0; dat = 0; } break;
      case 3: down = 1; if (!opi) { rd = 1; dat = 0; } else { rd = 0; dat = 1; } break;
      case 4: down = 1; if (!opi) { rd = 1; dat = 1; } else { rd = 0; dat = 0; } break;
      case 5: nops2 = 0; rd = 1; dat = 0; break;
      default: break;
    }
    return { rd, dat, down, nops2 };
  }

  const bit = (w, b) => (w >> b) & 1;

  // ---------------------------------------------------------------- faults
  // f = { type, va, vb, aa, ab, cfv } (victim / aggressor address and bit).
  // trig is a what-if that is NOT in the RTL: sram_faulty.v fires a coupling
  // fault on either aggressor edge (trig 0). trig 1 / 2 = rising / falling
  // edge only, i.e. the one-edge coupling faults of the textbook.
  function fault(type, o) {
    o = o || {};
    return { type: F[type], va: o.va | 0, vb: o.vb | 0, aa: o.aa | 0, ab: o.ab | 0, cfv: o.cfv | 0, trig: o.trig | 0 };
  }

  // The 12 rows of tb_mbist.v's case table, in order.
  const TB_CASES = [
    { name: 'fault-free (control)',         f: fault('NONE') },
    { name: 'SA0   cell[21][3]',            f: fault('SA0',  { va: 21, vb: 3 }) },
    { name: 'SA1   cell[21][3]',            f: fault('SA1',  { va: 21, vb: 3 }) },
    { name: 'TF^   cell[21][3] cant rise',  f: fault('TFUP', { va: 21, vb: 3 }) },
    { name: 'TFv   cell[21][3] cant fall',  f: fault('TFDN', { va: 21, vb: 3 }) },
    { name: 'CFin  agg[10]->vic[42] (a<v)', f: fault('CFIN', { va: 42, vb: 1, aa: 10, ab: 6 }) },
    { name: 'CFin  agg[42]->vic[10] (a>v)', f: fault('CFIN', { va: 10, vb: 1, aa: 42, ab: 6 }) },
    { name: 'CFid1 agg[10]->vic[42] (a<v)', f: fault('CFID', { va: 42, vb: 1, aa: 10, ab: 6, cfv: 1 }) },
    { name: 'CFid1 agg[42]->vic[10] (a>v)', f: fault('CFID', { va: 10, vb: 1, aa: 42, ab: 6, cfv: 1 }) },
    { name: 'CFid0 agg[10]->vic[42] (a<v)', f: fault('CFID', { va: 42, vb: 1, aa: 10, ab: 6, cfv: 0 }) },
    { name: 'CFid0 agg[42]->vic[10] (a>v)', f: fault('CFID', { va: 10, vb: 1, aa: 42, ab: 6, cfv: 0 }) },
    { name: 'AF    addr 7 aliases to 44',   f: fault('AF',   { va: 44, aa: 7 }) },
  ];

  // ---------------------------------------------------------------- sram_faulty.v
  class FaultySram {
    constructor(f) {
      this.f = f || fault('NONE');
      this.mem = new Uint8Array(DEPTH);       // tb clear_mem: all zeros
      this.dout = null;                       // never reset in the RTL: x until the first read
    }
    get en() { return this.f.type !== F.NONE; }
    effAddr(a) {                              // address-decoder fault
      const f = this.f;
      return (this.en && f.type === F.AF && a === f.aa) ? f.va : a;
    }
    // Both return a small event record so the page can explain what happened.
    write(a, din) {
      const f = this.f, mem = this.mem, en = this.en;
      const ea = this.effAddr(a);
      const ev = { op: 'w', addr: a, ea, data: din, aliased: ea !== a, tf: false, cf: null };
      const aggOld = bit(mem[f.aa], f.ab);    // sampled BEFORE the write
      let nv = din;
      if (en && ea === f.va) {
        const vic = mem[ea];
        if (f.type === F.TFUP && bit(vic, f.vb) === 0 && bit(din, f.vb) === 1) { nv &= ~(1 << f.vb); ev.tf = true; }
        if (f.type === F.TFDN && bit(vic, f.vb) === 1 && bit(din, f.vb) === 0) { nv |= (1 << f.vb); ev.tf = true; }
      }
      mem[ea] = nv & MASK;
      if (en && (f.type === F.CFIN || f.type === F.CFID) && ea === f.aa) {
        const aggNew = bit(mem[ea], f.ab);
        if (aggOld !== aggNew && (!f.trig || (f.trig === 1) === (aggNew === 1))) {
          const before = bit(mem[f.va], f.vb);
          let w = mem[f.va];
          if (f.type === F.CFIN) w ^= (1 << f.vb);
          else w = f.cfv ? (w | (1 << f.vb)) : (w & ~(1 << f.vb));
          mem[f.va] = w & MASK;
          ev.cf = { rise: aggNew === 1, before, after: bit(mem[f.va], f.vb) };
        }
      }
      ev.stored = mem[ea];
      return ev;
    }
    read(a) {
      const f = this.f, ea = this.effAddr(a);
      const raw = this.mem[ea];
      let rv = raw;
      if (this.en && ea === f.va) {
        if (f.type === F.SA0) rv &= ~(1 << f.vb);
        if (f.type === F.SA1) rv |= (1 << f.vb);
      }
      return { op: 'r', addr: a, ea, raw, rv: rv & MASK, aliased: ea !== a, forced: rv !== raw };
    }
  }

  // ---------------------------------------------------------------- mbist_ctrl.v + tb wiring
  class System {
    constructor(opts) {
      opts = opts || {};
      this.algo = opts.algo ? 1 : 0;
      // What-if, NOT in the RTL: compare dout in the cycle the read is issued,
      // without the one-deep chk_* shadow.
      this.sameCycle = !!opts.sameCycle;
      this.sram = new FaultySram(opts.fault);
      this.reset();
      this.cycle = 0;
    }
    reset() {                                 // rst_n low
      Object.assign(this, {
        state: S_IDLE, step: 0, opi: 0, acnt: 0, drain: 0,
        busy: 0, done: 0, fail: 0, op_count: 0,
        chk_v: 0, chk_exp: 0, chk_addr: 0, chk_elem: 0,
        fail_addr: 0, fail_got: 0, fail_exp: 0, fail_elem: 0,
      });
    }

    // Combinational outputs for the current register state.
    wires() {
      const elem = elemOf(this.algo, this.step);
      const d = decode(elem, this.opi);
      const step_max = this.algo ? 5 : 2;
      const cur_addr = d.down ? (DEPTH - 1 - this.acnt) : this.acnt;
      const run = this.state === S_RUN;
      const dout = this.sram.dout;
      const mismatch = this.chk_v && (dout === null || dout !== this.chk_exp) ? 1 : 0;
      return {
        state: this.state, elem, opi: this.opi, acnt: this.acnt, step: this.step,
        cur_rd: d.rd, cur_dat: d.dat, dir_down: d.down, nops2: d.nops2,
        cur_addr, last_op: this.opi === d.nops2 ? 1 : 0, last_addr: this.acnt === DEPTH - 1 ? 1 : 0,
        at_last_step: this.step === step_max ? 1 : 0,
        ce_n: run ? 0 : 1, we_n: run ? (d.rd ? 1 : 0) : 1, addr: cur_addr, din: d.dat ? MASK : 0,
        dout, chk_v: this.chk_v, chk_exp: this.chk_exp, chk_addr: this.chk_addr, chk_elem: this.chk_elem,
        mismatch, fail: this.fail, busy: this.busy, done: this.done,
      };
    }

    // One rising edge. Returns the wires that were in force during the cycle
    // that just ended, plus what the SRAM did and whether a failure latched.
    edge(start) {
      const w = this.wires();
      w.start = start ? 1 : 0;
      w.cycle = this.cycle;

      // ---- sram_faulty: always @(posedge clk) ----
      let ev = null;
      const doutBefore = this.sram.dout;
      let doutNext = doutBefore;
      if (!w.ce_n) {
        if (!w.we_n) ev = this.sram.write(w.addr, w.din);
        else { ev = this.sram.read(w.addr); doutNext = ev.rv; }   // dout <= rv
      }

      // ---- mbist_ctrl: always @(posedge clk or negedge rst_n) ----
      const n = {};                           // non-blocking assignments
      n.chk_v = 0;
      switch (this.state) {
        case S_IDLE:
          n.busy = 0;
          if (start) {
            Object.assign(n, { state: S_RUN, step: 0, opi: 0, acnt: 0, drain: 0, busy: 1, done: 0, fail: 0, op_count: 0 });
          }
          break;
        case S_RUN:
          n.op_count = (this.op_count + 1) >>> 0;
          n.chk_v = w.cur_rd;
          n.chk_exp = w.din;                  // {DATA_W{cur_dat}}
          n.chk_addr = w.cur_addr;
          n.chk_elem = w.elem;
          if (!w.last_op) n.opi = (this.opi + 1) & 1;
          else {
            n.opi = 0;
            if (!w.last_addr) n.acnt = (this.acnt + 1) & (DEPTH - 1);
            else {
              n.acnt = 0;
              if (!w.at_last_step) n.step = (this.step + 1) & 7;
              else { n.state = S_DRAIN; n.drain = 2; }
            }
          }
          break;
        case S_DRAIN:
          if (this.drain === 0) n.state = S_DONE;
          else n.drain = this.drain - 1;
          break;
        case S_DONE:
          n.busy = 0; n.done = 1;
          break;
        default:
          n.state = S_IDLE;
      }
      // first-failure latch, evaluated in every state (uses pre-edge values)
      let latched = false;
      if (!this.sameCycle) {
        if (this.chk_v && (doutBefore === null || doutBefore !== this.chk_exp) && !this.fail) {
          Object.assign(n, { fail: 1, fail_addr: this.chk_addr, fail_got: doutBefore, fail_exp: this.chk_exp, fail_elem: this.chk_elem });
          latched = true;
        }
      } else if (this.state === S_RUN && w.cur_rd && (doutBefore === null || doutBefore !== w.din) && !this.fail) {
        Object.assign(n, { fail: 1, fail_addr: w.cur_addr, fail_got: doutBefore, fail_exp: w.din, fail_elem: w.elem });
        latched = true;
      }

      Object.assign(this, n);
      this.sram.dout = doutNext;
      this.cycle++;
      w.ev = ev;
      w.latched = latched;
      w.checked = w.chk_v;                    // a compare happened at this edge
      return w;
    }
  }

  // tb_mbist.v run_case(): reset, clear memory, one edge with start high,
  // then clock until done. Returns what the testbench records, plus details.
  function tb_case(algo, f, keepEvents, opts) {
    const s = new System(Object.assign({ algo, fault: f }, opts || {}));
    const trace = keepEvents ? [] : null;
    let failCycle = -1, guard = 0;
    let w = s.edge(1);
    if (trace) trace.push(w);
    while (!s.done && guard < 40 * DEPTH) {
      w = s.edge(0); guard++;
      if (trace) trace.push(w);
      if (w.latched) failCycle = w.cycle;
    }
    if (!s.done) throw new Error('BIST did not complete (timeout)');
    return {
      detected: s.fail, fail_addr: s.fail_addr, fail_got: s.fail_got, fail_exp: s.fail_exp,
      fail_elem: s.fail_elem, op_count: s.op_count, cycles: s.cycle, failCycle, trace,
    };
  }

  // ---------------------------------------------------------------- op-level model
  // Same algorithm as scripts/golden_model.py: run the march op by op and stop
  // at the first mismatch. Much faster than the cycle model; used for the
  // coverage maps. check_model.js asserts both models agree.
  function runMarch(program, f) {
    const sram = new FaultySram(f);
    let ops = 0;
    for (const id of program) {
      const E = ELEMENTS[id];
      for (let k = 0; k < DEPTH; k++) {
        const a = E.down ? DEPTH - 1 - k : k;
        for (const [op, v] of E.ops) {
          ops++;
          const word = v ? MASK : 0;
          if (op === 'w') sram.write(a, word);
          else {
            const r = sram.read(a).rv;
            if (r !== word) return { detected: 1, elem: id, addr: a, got: r, exp: word, ops };
          }
        }
      }
    }
    return { detected: 0, elem: -1, addr: -1, ops };
  }

  const api = {
    ADDR_W, DATA_W, DEPTH, MASK, F, F_NAME, STATE_NAME, ELEMENTS, PROGRAMS, ALGO_NAME, TB_CASES,
    S_IDLE, S_RUN, S_DRAIN, S_DONE,
    fault, elemOf, decode, FaultySram, System, tb_case, runMarch,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MbistModel = api;
})(typeof window !== 'undefined' ? window : this);
