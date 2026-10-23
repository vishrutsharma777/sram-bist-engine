`timescale 1ns/1ps
// ---------------------------------------------------------------------------
// sram_model.v - behavioural single-port synchronous SRAM (golden reference)
//
// Models the pin-level contract of a typical foundry single-port compiler
// macro: registered address/control, 1-cycle read latency, NO-CHANGE output
// behaviour during a write (dout holds its previous value).
//
// This is deliberately NOT a transistor-level 6T cell. In a real flow the
// array comes from a memory compiler (OpenRAM / foundry) and RTL only ever
// sees this interface.
// ---------------------------------------------------------------------------
module sram_model #(
  parameter ADDR_W = 6,
  parameter DATA_W = 8
)(
  input  wire               clk,
  input  wire               ce_n,   // chip enable,  active low
  input  wire               we_n,   // write enable, active low
  input  wire [ADDR_W-1:0]  addr,
  input  wire [DATA_W-1:0]  din,
  output reg  [DATA_W-1:0]  dout
);
  localparam DEPTH = (1 << ADDR_W);

  reg [DATA_W-1:0] mem [0:DEPTH-1];

  always @(posedge clk) begin
    if (!ce_n) begin
      if (!we_n) mem[addr] <= din;   // write
      else       dout      <= mem[addr];  // read, 1-cycle latency
    end
  end
endmodule
