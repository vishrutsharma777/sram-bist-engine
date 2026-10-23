"""Windows-friendly build+run, for when `make` is not on PATH."""
import subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ["rtl/sram_model.v", "rtl/sram_faulty.v", "rtl/mbist_ctrl.v", "tb/tb_mbist.v"]
OUT = "sim/tb_mbist.out"

(ROOT / "sim").mkdir(exist_ok=True)
(ROOT / "docs").mkdir(exist_ok=True)

cmd = ["iverilog", "-g2005", "-Iinclude", "-o", OUT] + SRC
print(" ".join(cmd))
if subprocess.run(cmd, cwd=ROOT).returncode:
    sys.exit("compile failed")

run = ["vvp", OUT] + (["+dump"] if "--dump" in sys.argv else [])
print(" ".join(run))
sys.exit(subprocess.run(run, cwd=ROOT).returncode)
