# SRAM Subsystem with Memory BIST

A parameterisable synchronous SRAM, a fault-injectable model of the same
memory, and a march-algorithm BIST engine that finds the injected faults.
The deliverable is not "a memory in Verilog" - it is a **measured fault
coverage comparison between two march algorithms**.

## Live demo

**[vishrutsharma777.github.io/sram-bist-engine](https://vishrutsharma777.github.io/sram-bist-engine/)**:
an interactive, cycle-accurate walk-through of the BIST engine and the faulty
memory. Pick a fault and an algorithm, step the clock and watch the march walk
the 64 x 8 array, the read-compare shadow register, and the first-failure latch.
The page re-runs the testbench sweep in the browser and maps coverage over every
aggressor/victim address pair. `demo/model.js` is a JavaScript port of
`rtl/mbist_ctrl.v` and `rtl/sram_faulty.v`; `node demo/check_model.js` asserts
that it reproduces every result in `docs/fault_table.md`. Two what-if switches
(same-cycle compare, one-edge coupling faults) and a "real-silicon" view are
marked on the page as not part of this RTL.

## Result

Sweeping 11 classical fault models through a 64 x 8 memory:

| Injected fault                 | MATS+ (5N) | March C- (10N) |
|--------------------------------|------------|----------------|
| fault-free (control)           |   miss     |    miss        |
| SA0   cell[21][3]              |   DETECT   |    DETECT      |
| SA1   cell[21][3]              |   DETECT   |    DETECT      |
| TF^   cell[21][3] cant rise    |   DETECT   |    DETECT      |
| TFv   cell[21][3] cant fall    |   **miss** |    DETECT      |
| CFin  agg[10]->vic[42] (a<v)   |   DETECT   |    DETECT      |
| CFin  agg[42]->vic[10] (a>v)   |   **miss** |    DETECT      |
| CFid1 agg[10]->vic[42] (a<v)   |   DETECT   |    DETECT      |
| CFid1 agg[42]->vic[10] (a>v)   |   **miss** |    DETECT      |
| CFid0 agg[10]->vic[42] (a<v)   |   **miss** |    DETECT      |
| CFid0 agg[42]->vic[10] (a>v)   |   DETECT   |    DETECT      |
| AF    addr 7 aliases to 44     |   DETECT   |    DETECT      |

Each column answers "did the BIST flag a failure?", so `miss` on the
fault-free control row is the correct result: a healthy memory must not be
flagged. The testbench enforces this and stops with `FATAL` if it ever is.

**MATS+ misses 4 of 11. March C- catches all 11, for 2x the test time.**

Two things fall out of this table:

1. **MATS+ misses TF-down because it ends on a write.** Its last element is
   `down(r1,w0)`; a cell that cannot fall is left holding 1 and never read
   again. March C- appends `updownarrow(r0)` precisely to close this hole -
   that final read is not decoration.
2. **Coupling faults are order dependent.** Whether an aggressor is visited
   before or after its victim decides detection. A single-direction algorithm
   catches one ordering and misses the other; March C- walks ascending *and*
   descending, which is why it covers both columns.

## Layout

```
include/fault_defs.vh   fault model encodings
rtl/sram_model.v        golden behavioural SRAM (1-cycle read, no-change write)
rtl/sram_faulty.v       same interface + runtime fault injection (TB only)
rtl/mbist_ctrl.v        march engine: MATS+ and March C-, selected by `algo`
rtl/sram_top.v          synthesisable functional-port / BIST mux
tb/tb_mbist.v           fault sweep, emits docs/fault_table.md
scripts/golden_model.py Python reference implementing the same fault models
demo/                   interactive page (GitHub Pages) + JS model + check_model.js
```

## Build

Install the [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build/releases)
(Windows x64 tarball; extract, then run `environment.bat`). It provides
iverilog, vvp, gtkwave, yosys and make in one download.

```
make sweep     # fault coverage table
make waves     # same run + GTKWave
make synth     # BIST controller gate count (SRAM macro blackboxed)
make golden    # Python cross-check of the table
```

No make on PATH: `python scripts/run_sweep.py`.

## Design notes

**Read-compare pipeline.** The SRAM registers its output, so a read issued in
cycle N returns data in cycle N+1. `mbist_ctrl` carries a one-deep shadow
(`chk_v`, `chk_exp`, `chk_addr`) and compares a cycle late. Compare in the
same cycle and the engine passes everything - it is checking stale data.

**First-failure latch.** Only the first mismatch is captured
(`fail_addr`/`fail_got`/`fail_exp`/`fail_elem`), matching real silicon where
the latched address drives redundancy allocation rather than a full bitmap.

**Why the SRAM is behavioural.** The array is modelled at the pin contract of
a compiler macro, not as 6T cells. Transistor-level behaviour is not
expressible in Verilog, and in a real flow the array comes from a memory
compiler while RTL only ever sees this interface.

**One compiled image, many faults.** Fault configuration is a set of module
inputs rather than parameters or `ifdef`s, so the sweep runs every case
without recompiling.

## Extensions

- SECDED Hamming (39,32) ECC with correctable/uncorrectable counters
- AXI4-Lite slave wrapper on the functional port
- Multi-bank array + round-robin arbiter, with bank-conflict counters
- Data-retention fault model (needs a delayed-read element)
- Checkerboard data backgrounds to expose intra-word coupling
