`timescale 1ns/1ps
`include "fault_defs.vh"
// ---------------------------------------------------------------------------
// tb_mbist.v - fault-coverage sweep.
//
// For every fault in the case list, run the memory under both MATS+ and
// March C- and record whether the BIST engine flagged it. Emits a markdown
// table on stdout and to docs/fault_table.md.
//
// The interesting rows are the coupling faults: they are ORDER DEPENDENT, so
// an algorithm with only one direction of traversal misses half of them.
// That is the entire reason March C- walks both up and down.
// ---------------------------------------------------------------------------
module tb_mbist;

  localparam ADDR_W = 6;
  localparam DATA_W = 8;
  localparam DEPTH  = (1 << ADDR_W);
  localparam NC     = 12;

  reg clk = 1'b0;
  always #5 clk = ~clk;

  reg rst_n, start, algo;

  reg              f_en;
  reg [3:0]        f_type;
  reg [ADDR_W-1:0] f_vaddr, f_aaddr;
  reg [7:0]        f_vbit,  f_abit;
  reg              f_cfval;

  wire              ce_n, we_n;
  wire [ADDR_W-1:0] addr;
  wire [DATA_W-1:0] din, dout;

  wire              busy, done, fail;
  wire [ADDR_W-1:0] fail_addr;
  wire [DATA_W-1:0] fail_got, fail_exp;
  wire [2:0]        fail_elem;
  wire [31:0]       op_count;

  mbist_ctrl #(.ADDR_W(ADDR_W), .DATA_W(DATA_W)) u_bist (
    .clk(clk), .rst_n(rst_n), .start(start), .algo(algo),
    .ce_n(ce_n), .we_n(we_n), .addr(addr), .din(din), .dout(dout),
    .busy(busy), .done(done), .fail(fail), .fail_addr(fail_addr),
    .fail_got(fail_got), .fail_exp(fail_exp), .fail_elem(fail_elem),
    .op_count(op_count)
  );

  sram_faulty #(.ADDR_W(ADDR_W), .DATA_W(DATA_W)) u_sram (
    .clk(clk), .ce_n(ce_n), .we_n(we_n), .addr(addr), .din(din), .dout(dout),
    .f_en(f_en), .f_type(f_type), .f_vaddr(f_vaddr), .f_vbit(f_vbit),
    .f_aaddr(f_aaddr), .f_abit(f_abit), .f_cfval(f_cfval)
  );

  // ---- case table ---------------------------------------------------------
  reg [8*30:1]     cname [0:NC-1];
  reg [3:0]        c_ft  [0:NC-1];
  reg [ADDR_W-1:0] c_va  [0:NC-1];
  reg [7:0]        c_vb  [0:NC-1];
  reg [ADDR_W-1:0] c_aa  [0:NC-1];
  reg [7:0]        c_ab  [0:NC-1];
  reg              c_cfv [0:NC-1];
  reg              det_mats [0:NC-1];
  reg              det_marc [0:NC-1];

  integer i, fd;
  reg     d;

  task load_cases;
    begin
      cname[0]="fault-free (control)          ";        c_ft[0]=`F_NONE; c_va[0]=0;  c_vb[0]=0; c_aa[0]=0;  c_ab[0]=0; c_cfv[0]=0;
      cname[1]="SA0   cell[21][3]             ";           c_ft[1]=`F_SA0;  c_va[1]=21; c_vb[1]=3; c_aa[1]=0;  c_ab[1]=0; c_cfv[1]=0;
      cname[2]="SA1   cell[21][3]             ";           c_ft[2]=`F_SA1;  c_va[2]=21; c_vb[2]=3; c_aa[2]=0;  c_ab[2]=0; c_cfv[2]=0;
      cname[3]="TF^   cell[21][3] cant rise   "; c_ft[3]=`F_TFUP; c_va[3]=21; c_vb[3]=3; c_aa[3]=0;  c_ab[3]=0; c_cfv[3]=0;
      cname[4]="TFv   cell[21][3] cant fall   "; c_ft[4]=`F_TFDN; c_va[4]=21; c_vb[4]=3; c_aa[4]=0;  c_ab[4]=0; c_cfv[4]=0;
      cname[5]="CFin  agg[10]->vic[42] (a<v)  "; c_ft[5]=`F_CFIN; c_va[5]=42; c_vb[5]=1; c_aa[5]=10; c_ab[5]=6; c_cfv[5]=0;
      cname[6]="CFin  agg[42]->vic[10] (a>v)  "; c_ft[6]=`F_CFIN; c_va[6]=10; c_vb[6]=1; c_aa[6]=42; c_ab[6]=6; c_cfv[6]=0;
      cname[7]="CFid1 agg[10]->vic[42] (a<v)  "; c_ft[7]=`F_CFID; c_va[7]=42; c_vb[7]=1; c_aa[7]=10; c_ab[7]=6; c_cfv[7]=1;
      cname[8]="CFid1 agg[42]->vic[10] (a>v)  "; c_ft[8]=`F_CFID; c_va[8]=10; c_vb[8]=1; c_aa[8]=42; c_ab[8]=6; c_cfv[8]=1;
      cname[9]="CFid0 agg[10]->vic[42] (a<v)  "; c_ft[9]=`F_CFID; c_va[9]=42; c_vb[9]=1; c_aa[9]=10; c_ab[9]=6; c_cfv[9]=0;
      cname[10]="CFid0 agg[42]->vic[10] (a>v)  ";c_ft[10]=`F_CFID;c_va[10]=10;c_vb[10]=1;c_aa[10]=42;c_ab[10]=6;c_cfv[10]=0;
      cname[11]="AF    addr 7 aliases to 44    ";  c_ft[11]=`F_AF;  c_va[11]=44;c_vb[11]=0;c_aa[11]=7; c_ab[11]=0; c_cfv[11]=0;
    end
  endtask

  task clear_mem;
    integer k;
    begin
      for (k = 0; k < DEPTH; k = k + 1) u_sram.mem[k] = {DATA_W{1'b0}};
    end
  endtask

  task run_case;
    input              algo_i;
    input [3:0]        ft;
    input [ADDR_W-1:0] va;
    input [7:0]        vb;
    input [ADDR_W-1:0] aa;
    input [7:0]        ab;
    input              cfv;
    output             detected;
    integer            guard;
    begin
      algo    = algo_i;
      f_type  = ft;
      f_en    = (ft != `F_NONE);
      f_vaddr = va;  f_vbit = vb;
      f_aaddr = aa;  f_abit = ab;
      f_cfval = cfv;

      rst_n = 1'b0; start = 1'b0;
      repeat (3) @(posedge clk);
      clear_mem;
      rst_n = 1'b1;
      @(posedge clk);
      start = 1'b1; @(posedge clk); start = 1'b0;

      guard = 0;
      while (!done && guard < 40*DEPTH) begin
        @(posedge clk);
        guard = guard + 1;
      end
      if (!done) begin
        $display("ERROR: BIST did not complete (timeout) - check the FSM");
        $finish;
      end
      detected = fail;
    end
  endtask

  initial begin
    if ($test$plusargs("dump")) begin
      $dumpfile("sim/tb_mbist.vcd");
      $dumpvars(0, tb_mbist);
    end

    load_cases;

    for (i = 0; i < NC; i = i + 1) begin
      run_case(1'b0, c_ft[i], c_va[i], c_vb[i], c_aa[i], c_ab[i], c_cfv[i], d);
      det_mats[i] = d;
      run_case(1'b1, c_ft[i], c_va[i], c_vb[i], c_aa[i], c_ab[i], c_cfv[i], d);
      det_marc[i] = d;
    end

    // op-count self check on the final (March C-) run
    if (op_count !== 10*DEPTH)
      $display("WARNING: March C- issued %0d ops, expected %0d (10N)", op_count, 10*DEPTH);

    fd = $fopen("docs/fault_table.md", "w");
    $display("");
    $display("SRAM MBIST fault coverage   (%0d x %0d bits)", DEPTH, DATA_W);
    $display("");
    $display("| Injected fault                 | MATS+ (5N) | March C- (10N) |");
    $display("|--------------------------------|------------|----------------|");
    $fdisplay(fd, "# SRAM MBIST fault coverage (%0d x %0d bits)", DEPTH, DATA_W);
    $fdisplay(fd, "");
    $fdisplay(fd, "| Injected fault                 | MATS+ (5N) | March C- (10N) |");
    $fdisplay(fd, "|--------------------------------|------------|----------------|");

    for (i = 0; i < NC; i = i + 1) begin
      $display("| %-30s |   %-7s  |    %-9s   |", cname[i],
               det_mats[i] ? "DETECT" : "miss", det_marc[i] ? "DETECT" : "miss");
      $fdisplay(fd, "| %-30s |   %-7s  |    %-9s   |", cname[i],
               det_mats[i] ? "DETECT" : "miss", det_marc[i] ? "DETECT" : "miss");
    end
    $display("");
    $fclose(fd);

    // the control case must NOT report a failure, or the whole table is noise
    if (det_mats[0] || det_marc[0]) begin
      $display("FATAL: fault-free memory reported a BIST failure - engine is broken");
      $finish;
    end
    $display("Control case clean. Table written to docs/fault_table.md");
    $finish;
  end
endmodule
