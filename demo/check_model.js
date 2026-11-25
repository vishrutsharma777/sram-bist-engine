// node demo/check_model.js
// Asserts the browser model against what the Verilog produced, and checks
// every claim the page makes:
//   1. cycle model, 12 tb_mbist.v cases x 2 algorithms == docs/fault_table.md
//   2. op counts on a clean memory: MATS+ 5N = 320, March C- 10N = 640
//   3. op-level model (used for the coverage maps) == cycle model on every
//      aggressor/victim pair of every coupling and AF fault, both algorithms
//   4. the statements in the page text
const fs = require('fs');
const path = require('path');
const M = require('./model.js');
const here = path.join(__dirname, '..');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS  ' : 'FAIL  ') + msg); if (!c) fails++; };

// ---- 1. testbench table ----------------------------------------------------
const md = fs.readFileSync(path.join(here, 'docs', 'fault_table.md'), 'utf8');
const rows = md.split('\n').filter((l) => /^\|\s*(fault-free|SA|TF|CF|AF)/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((s) => s.trim()));
ok(rows.length === M.TB_CASES.length, `docs/fault_table.md has ${rows.length} rows (model has ${M.TB_CASES.length})`);
let cells = 0;
rows.forEach((r, i) => {
  const c = M.TB_CASES[i];
  const nameOk = r[0].replace(/\s+/g, ' ') === c.name.replace(/\s+/g, ' ');
  const got = [0, 1].map((a) => (M.tb_case(a, c.f).detected ? 'DETECT' : 'miss'));
  const same = got[0] === r[1] && got[1] === r[2];
  if (same && nameOk) cells += 2;
  ok(nameOk && same, `${c.name.padEnd(30)} model ${got.join(' / ').padEnd(16)} RTL ${r[1]} / ${r[2]}`);
});
ok(cells === 24, `${cells}/24 results identical`);

// ---- 2. op counts ------------------------------------------------------------
{
  const clean = M.TB_CASES[0].f;
  const a = M.tb_case(0, clean), b = M.tb_case(1, clean);
  ok(a.op_count === 5 * M.DEPTH, `MATS+ op_count = ${a.op_count} (5N = ${5 * M.DEPTH})`);
  ok(b.op_count === 10 * M.DEPTH, `March C- op_count = ${b.op_count} (10N = ${10 * M.DEPTH})`);
}

// ---- 3. op-level model == cycle model ----------------------------------------
{
  let n = 0, bad = 0;
  const types = [['CFIN', {}], ['CFID', { cfv: 0 }], ['CFID', { cfv: 1 }], ['AF', {}]];
  for (const [t, extra] of types) for (const algo of [0, 1]) {
    for (let a = 0; a < 64; a++) for (let v = 0; v < 64; v++) {
      const f = t === 'AF' ? M.fault('AF', { va: v, aa: a }) : M.fault(t, Object.assign({ va: v, vb: 1, aa: a, ab: 6 }, extra));
      const cyc = M.tb_case(algo, f), fast = M.runMarch(M.PROGRAMS[algo], f);
      n++;
      if (cyc.detected !== fast.detected || (cyc.detected && (cyc.fail_elem !== fast.elem || cyc.fail_addr !== fast.addr
          || cyc.fail_got !== fast.got || cyc.fail_exp !== fast.exp))) bad++;
    }
  }
  for (const t of ['SA0', 'SA1', 'TFUP', 'TFDN']) for (const algo of [0, 1]) {
    for (let a = 0; a < 64; a++) for (let b = 0; b < 8; b++) {
      const f = M.fault(t, { va: a, vb: b });
      const cyc = M.tb_case(algo, f), fast = M.runMarch(M.PROGRAMS[algo], f);
      n++;
      if (cyc.detected !== fast.detected || (cyc.detected && (cyc.fail_elem !== fast.elem || cyc.fail_addr !== fast.addr))) bad++;
    }
  }
  ok(bad === 0, `op-level model == cycle model on ${n} fault placements (detect, element, address, data)`);
}

// ---- 4. claims in the page text ----------------------------------------------
const count = (prog, mk, filt) => {
  let c = 0, tot = 0;
  for (let a = 0; a < 64; a++) for (let v = 0; v < 64; v++) {
    if (filt && !filt(a, v)) continue;
    tot++; c += M.runMarch(prog, mk(a, v)).detected;
  }
  return [c, tot];
};
{
  const tf = M.TB_CASES[4].f;
  const r0 = M.tb_case(0, tf), r1 = M.tb_case(1, tf);
  ok(!r0.detected && r1.detected && r1.fail_elem === 3, `TF-down: MATS+ miss; March C- catches it in ${M.ELEMENTS[r1.fail_elem].label}`);
  let mats = 0;
  for (let a = 0; a < 64; a++) for (let b = 0; b < 8; b++) mats += M.runMarch(M.PROGRAMS[0], M.fault('TFDN', { va: a, vb: b })).detected;
  ok(mats === 0, `TF-down: MATS+ catches ${mats} of 512 cells`);
}
{
  const cf = (t, cfv, trig) => (a, v) => M.fault(t, { va: v, vb: 1, aa: a, ab: 6, cfv, trig });
  // MATS+ misses exactly one side for each coupling type (both-edge model)
  for (const [t, cfv] of [['CFIN', 0], ['CFID', 0], ['CFID', 1]]) {
    const lt = count(M.PROGRAMS[0], cf(t, cfv, 0), (a, v) => a < v)[0];
    const gt = count(M.PROGRAMS[0], cf(t, cfv, 0), (a, v) => a > v)[0];
    ok((lt === 2016 && gt === 0) || (lt === 0 && gt === 2016), `MATS+ ${t}${t === 'CFID' ? cfv : ''}: a<v ${lt}/2016, a>v ${gt}/2016`);
    const all = count(M.PROGRAMS[1], cf(t, cfv, 0))[0];
    const noR0 = count(M.PROGRAMS['C-noR0'], cf(t, cfv, 0))[0];
    ok(all === 4096 && noR0 === 4096, `March C- ${t}${t === 'CFID' ? cfv : ''}: ${all}/4096; without final r0: ${noR0}/4096 (RTL both-edge model)`);
  }
  const af = count(M.PROGRAMS[0], (a, v) => M.fault('AF', { va: v, aa: a }), (a, v) => a !== v)[0];
  ok(af === 4032, `AF: MATS+ catches ${af}/4032 distinct-address pairs`);
  // where the final read matters: one-edge CFid<down;1>, aggressor below victim
  const lt = count(M.PROGRAMS['C-noR0'], cf('CFID', 1, 2), (a, v) => a < v)[0];
  const ltFull = count(M.PROGRAMS[1], cf('CFID', 1, 2), (a, v) => a < v)[0];
  ok(lt === 0 && ltFull === 2016, `what-if CFid<down;1>, a<v: without final r0 ${lt}/2016, with it ${ltFull}/2016`);
}
{
  // what-if: compare in the issuing cycle -> healthy memory flagged at the first read
  const r = M.tb_case(1, M.TB_CASES[0].f, false, { sameCycle: true });
  ok(r.detected && r.fail_elem === 1 && r.fail_addr === 0, `what-if same-cycle compare: fault-free memory flagged at [${r.fail_addr}] in ${M.ELEMENTS[r.fail_elem].label}`);
  // even with a defined dout, element 2's first read sees element 1's last data
  const s = new M.System({ algo: 1, fault: M.TB_CASES[0].f, sameCycle: true });
  s.sram.dout = 0;
  s.edge(1); let latched = null;
  while (!s.done) { const w = s.edge(0); if (w.latched) latched = w; }
  ok(s.fail && s.fail_elem === 2 && s.fail_addr === 0 && s.fail_got === 0 && s.fail_exp === 0xff,
     `what-if same-cycle compare with dout = 00 at start: flagged in ${M.ELEMENTS[s.fail_elem].label} at [${s.fail_addr}], got ${s.fail_got} exp ${s.fail_exp}`);
}

console.log(fails ? `${fails} FAILED` : 'ALL MODEL CHECKS PASSED');
process.exit(fails ? 1 : 0);
