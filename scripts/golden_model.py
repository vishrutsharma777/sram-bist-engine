"""Golden reference for the MBIST project.

Mirrors rtl/sram_faulty.v and rtl/mbist_ctrl.v operation-for-operation so the
Verilog fault table can be cross-checked without a simulator. Keep the two in
sync: if you add a fault model to the RTL, add it here too.
"""
ADDR_W, DATA_W = 6, 8
DEPTH, MASK = 1 << ADDR_W, (1 << DATA_W) - 1

MARCH_C_MINUS = [
    ("up", [("w", 0)]),
    ("up", [("r", 0), ("w", 1)]),
    ("up", [("r", 1), ("w", 0)]),
    ("dn", [("r", 0), ("w", 1)]),
    ("dn", [("r", 1), ("w", 0)]),
    ("up", [("r", 0)]),
]
MATS_PLUS = [
    ("up", [("w", 0)]),
    ("up", [("r", 0), ("w", 1)]),
    ("dn", [("r", 1), ("w", 0)]),
]


class FaultySram:
    def __init__(self, f):
        self.mem = [0] * DEPTH
        self.f = f

    def _eff(self, a):
        f = self.f
        if f and f["type"] == "AF" and a == f["aaddr"]:
            return f["vaddr"]
        return a

    def write(self, a, data):
        f, mem = self.f, self.mem
        ea = self._eff(a)
        agg_old = (mem[f["aaddr"]] >> f["abit"]) & 1 if f else 0
        nv = data
        if f and ea == f["vaddr"]:
            vic_old = (mem[ea] >> f["vbit"]) & 1
            vic_new = (data >> f["vbit"]) & 1
            if f["type"] == "TFUP" and vic_old == 0 and vic_new == 1:
                nv &= ~(1 << f["vbit"])
            if f["type"] == "TFDN" and vic_old == 1 and vic_new == 0:
                nv |= 1 << f["vbit"]
        mem[ea] = nv & MASK
        if f and f["type"] in ("CFIN", "CFID") and ea == f["aaddr"]:
            agg_new = (mem[ea] >> f["abit"]) & 1
            if agg_old != agg_new:
                if f["type"] == "CFIN":
                    mem[f["vaddr"]] ^= 1 << f["vbit"]
                elif f["cfval"]:
                    mem[f["vaddr"]] |= 1 << f["vbit"]
                else:
                    mem[f["vaddr"]] &= ~(1 << f["vbit"])

    def read(self, a):
        f, mem = self.f, self.mem
        ea = self._eff(a)
        rv = mem[ea]
        if f and ea == f["vaddr"]:
            if f["type"] == "SA0":
                rv &= ~(1 << f["vbit"])
            if f["type"] == "SA1":
                rv |= 1 << f["vbit"]
        return rv


def run_march(algorithm, fault):
    sram, ops = FaultySram(fault), 0
    for direction, element in algorithm:
        order = range(DEPTH) if direction == "up" else range(DEPTH - 1, -1, -1)
        for a in order:
            for op, bit in element:
                ops += 1
                word = MASK if bit else 0
                if op == "w":
                    sram.write(a, word)
                elif sram.read(a) != word:
                    return True, ops          # first-failure latch
    return False, ops


def fault(t, vaddr=0, vbit=0, aaddr=0, abit=0, cfval=0):
    if t == "NONE":
        return None
    return {"type": t, "vaddr": vaddr, "vbit": vbit,
            "aaddr": aaddr, "abit": abit, "cfval": cfval}


CASES = [
    ("fault-free (control)",         fault("NONE")),
    ("SA0   cell[21][3]",            fault("SA0",  vaddr=21, vbit=3)),
    ("SA1   cell[21][3]",            fault("SA1",  vaddr=21, vbit=3)),
    ("TF^   cell[21][3] cant rise",  fault("TFUP", vaddr=21, vbit=3)),
    ("TFv   cell[21][3] cant fall",  fault("TFDN", vaddr=21, vbit=3)),
    ("CFin  agg[10]->vic[42] (a<v)", fault("CFIN", vaddr=42, vbit=1, aaddr=10, abit=6)),
    ("CFin  agg[42]->vic[10] (a>v)", fault("CFIN", vaddr=10, vbit=1, aaddr=42, abit=6)),
    ("CFid1 agg[10]->vic[42] (a<v)", fault("CFID", vaddr=42, vbit=1, aaddr=10, abit=6, cfval=1)),
    ("CFid1 agg[42]->vic[10] (a>v)", fault("CFID", vaddr=10, vbit=1, aaddr=42, abit=6, cfval=1)),
    ("CFid0 agg[10]->vic[42] (a<v)", fault("CFID", vaddr=42, vbit=1, aaddr=10, abit=6, cfval=0)),
    ("CFid0 agg[42]->vic[10] (a>v)", fault("CFID", vaddr=10, vbit=1, aaddr=42, abit=6, cfval=0)),
    ("AF    addr 7 aliases to 44",   fault("AF",   vaddr=44, aaddr=7)),
]

if __name__ == "__main__":
    print(f"\nSRAM MBIST fault coverage   ({DEPTH} x {DATA_W} bits)\n")
    print("| Injected fault                 | MATS+ (5N) | March C- (10N) |")
    print("|--------------------------------|------------|----------------|")
    for name, f in CASES:
        d0, n0 = run_march(MATS_PLUS, f)
        d1, n1 = run_march(MARCH_C_MINUS, f)
        print(f"| {name:<30} |   {'DETECT' if d0 else 'miss':<7}  |"
              f"    {'DETECT' if d1 else 'miss':<9}   |")
    _, n = run_march(MARCH_C_MINUS, None)
    print(f"\nMarch C- op count on a clean memory: {n}  (expected 10N = {10*DEPTH})")
