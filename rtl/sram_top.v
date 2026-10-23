`timescale 1ns/1ps
// ---------------------------------------------------------------------------
// sram_top.v - synthesisable integration: functional port + MBIST, muxed.
// This is the block you actually push through Yosys for the area report.
// ---------------------------------------------------------------------------
module sram_top #(
  parameter ADDR_W = 6,
  parameter DATA_W = 8
)(
  input  wire               clk,
  input  wire               rst_n,

  // functional port
  input  wire               ce_n,
  input  wire               we_n,
  input  wire [ADDR_W-1:0]  addr,
  input  wire [DATA_W-1:0]  din,
  output wire [DATA_W-1:0]  dout,

  // BIST control
  input  wire               bist_mode,
  input  wire               bist_start,
  input  wire               bist_algo,
  output wire               bist_busy,
  output wire               bist_done,
  output wire               bist_fail,
  output wire [ADDR_W-1:0]  bist_fail_addr
);
  wire              b_ce_n, b_we_n;
  wire [ADDR_W-1:0] b_addr;
  wire [DATA_W-1:0] b_din;

  wire              m_ce_n = bist_mode ? b_ce_n : ce_n;
  wire              m_we_n = bist_mode ? b_we_n : we_n;
  wire [ADDR_W-1:0] m_addr = bist_mode ? b_addr : addr;
  wire [DATA_W-1:0] m_din  = bist_mode ? b_din  : din;

  mbist_ctrl #(.ADDR_W(ADDR_W), .DATA_W(DATA_W)) u_bist (
    .clk(clk), .rst_n(rst_n), .start(bist_start), .algo(bist_algo),
    .ce_n(b_ce_n), .we_n(b_we_n), .addr(b_addr), .din(b_din), .dout(dout),
    .busy(bist_busy), .done(bist_done), .fail(bist_fail),
    .fail_addr(bist_fail_addr), .fail_got(), .fail_exp(), .fail_elem(),
    .op_count()
  );

  sram_model #(.ADDR_W(ADDR_W), .DATA_W(DATA_W)) u_sram (
    .clk(clk), .ce_n(m_ce_n), .we_n(m_we_n),
    .addr(m_addr), .din(m_din), .dout(dout)
  );
endmodule
