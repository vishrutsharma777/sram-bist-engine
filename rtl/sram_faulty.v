`timescale 1ns/1ps
`include "fault_defs.vh"
// ---------------------------------------------------------------------------
// sram_faulty.v - same interface as sram_model, plus a runtime-configurable
// fault injector. Used ONLY by the testbench: it lets one compiled image sweep
// every fault model without recompiling.
//
// Injection points:
//   SA0/SA1  applied on the read path. A cell whose write is forced and whose
//            read is forced is observationally identical to one forced on read
//            alone, so we model the cheaper of the two.
//   TFUP/TFDN applied on the write path, conditioned on the PRE-write value.
//   CFIN/CFID applied on the write path after the aggressor cell settles, and
//            only when the aggressor actually TRANSITIONS (a write of the same
//            value is not a transition - this distinction is what makes
//            coupling faults order-dependent, and why march direction matters).
//   AF       applied to the decoded address for both reads and writes, so the
//            aggressor address and victim address become aliases.
// ---------------------------------------------------------------------------
module sram_faulty #(
  parameter ADDR_W = 6,
  parameter DATA_W = 8
)(
  input  wire               clk,
  input  wire               ce_n,
  input  wire               we_n,
  input  wire [ADDR_W-1:0]  addr,
  input  wire [DATA_W-1:0]  din,
  output reg  [DATA_W-1:0]  dout,

  // ---- fault configuration (driven by the testbench) ----
  input  wire               f_en,
  input  wire [3:0]         f_type,
  input  wire [ADDR_W-1:0]  f_vaddr,  // victim address
  input  wire [7:0]         f_vbit,   // victim bit index
  input  wire [ADDR_W-1:0]  f_aaddr,  // aggressor address
  input  wire [7:0]         f_abit,   // aggressor bit index
  input  wire               f_cfval   // forced value for CFid
);
  localparam DEPTH = (1 << ADDR_W);

  reg [DATA_W-1:0] mem [0:DEPTH-1];

  // Memory words are copied into temporaries before any bit-select: strict
  // Verilog-2001 does not permit mem[addr][bit] directly.
  reg [ADDR_W-1:0] ea;
  reg [DATA_W-1:0] nv, rv, agg_word, vic_word;
  reg              agg_old, agg_new;

  // address-decoder fault: f_aaddr is swallowed by f_vaddr
  function [ADDR_W-1:0] eff_addr;
    input [ADDR_W-1:0] a;
    begin
      eff_addr = (f_en && (f_type == `F_AF) && (a == f_aaddr)) ? f_vaddr : a;
    end
  endfunction

  always @(posedge clk) begin
    if (!ce_n) begin
      ea = eff_addr(addr);

      if (!we_n) begin
        // ---------------- write path ----------------
        agg_word = mem[f_aaddr];          // sample BEFORE the write
        agg_old  = agg_word[f_abit];
        nv       = din;

        // transition fault on the victim cell
        if (f_en && (ea == f_vaddr)) begin
          vic_word = mem[ea];
          if ((f_type == `F_TFUP) && (vic_word[f_vbit] == 1'b0) && (din[f_vbit] == 1'b1))
            nv[f_vbit] = 1'b0;                           // cannot rise
          if ((f_type == `F_TFDN) && (vic_word[f_vbit] == 1'b1) && (din[f_vbit] == 1'b0))
            nv[f_vbit] = 1'b1;                           // cannot fall
        end

        mem[ea] = nv;

        // coupling fault: did the aggressor just transition?
        if (f_en && ((f_type == `F_CFIN) || (f_type == `F_CFID)) && (ea == f_aaddr)) begin
          agg_word = mem[ea];
          agg_new  = agg_word[f_abit];
          if (agg_old !== agg_new) begin
            vic_word = mem[f_vaddr];
            if (f_type == `F_CFIN) vic_word[f_vbit] = ~vic_word[f_vbit];
            else                   vic_word[f_vbit] = f_cfval;
            mem[f_vaddr] = vic_word;
          end
        end

      end else begin
        // ---------------- read path ----------------
        rv = mem[ea];
        if (f_en && (ea == f_vaddr)) begin
          if (f_type == `F_SA0) rv[f_vbit] = 1'b0;
          if (f_type == `F_SA1) rv[f_vbit] = 1'b1;
        end
        dout <= rv;
      end
    end
  end
endmodule
