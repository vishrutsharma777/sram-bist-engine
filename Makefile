# OSS CAD Suite provides iverilog / vvp / gtkwave / yosys / make on Windows.
IV   = iverilog
VVP  = vvp
INC  = -Iinclude
SRC  = rtl/sram_model.v rtl/sram_faulty.v rtl/mbist_ctrl.v
TB   = tb/tb_mbist.v
OUT  = sim/tb_mbist.out

.PHONY: all sweep waves synth golden clean

all: sweep

$(OUT): $(SRC) $(TB) include/fault_defs.vh
	@mkdir -p sim docs
	$(IV) -g2005 $(INC) -o $(OUT) $(SRC) $(TB)

sweep: $(OUT)          ## run the fault-coverage sweep, write docs/fault_table.md
	$(VVP) $(OUT)

waves: $(OUT)          ## same run, but dump VCD and open GTKWave
	$(VVP) $(OUT) +dump
	gtkwave sim/tb_mbist.vcd &

synth:                 ## BIST controller area only - the SRAM macro is a blackbox
	yosys -p "read_verilog $(INC) rtl/mbist_ctrl.v; synth -top mbist_ctrl; stat"

golden:                ## Python cross-check of the same fault table
	python scripts/golden_model.py

clean:
	rm -rf sim/*.out sim/*.vcd
