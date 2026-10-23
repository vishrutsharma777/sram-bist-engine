`timescale 1ns/1ps
// ---------------------------------------------------------------------------
// mbist_ctrl.v - march-algorithm memory BIST engine
//
//   algo = 0 : MATS+    (5N)  {updownarrow(w0); up(r0,w1); down(r1,w0)}
//   algo = 1 : March C- (10N) {updownarrow(w0); up(r0,w1); up(r1,w0);
//                              down(r0,w1); down(r1,w0); updownarrow(r0)}
//
// Both algorithms share the same element decoder; MATS+ is just a shorter
// walk through the same element table. That makes the coverage difference
// between them a one-bit experiment.
//
// Read-compare pipeline
// ---------------------
// The SRAM registers its output, so data for a read issued in cycle N is only
// valid in cycle N+1. The engine therefore carries a one-deep shadow
// (chk_v / chk_exp / chk_addr / chk_elem) and compares against it a cycle
// late. Getting this wrong is the single most common bug in a hand-written
// BIST engine - it silently passes because the compare lands on stale data.
//
// Only the FIRST failure is latched, matching real first-fail-latch silicon
// used to drive redundancy allocation.
// ---------------------------------------------------------------------------
module mbist_ctrl #(
  parameter ADDR_W = 6,
  parameter DATA_W = 8
)(
  input  wire               clk,
  input  wire               rst_n,
  input  wire               start,
  input  wire               algo,

  // SRAM port
  output reg                ce_n,
  output reg                we_n,
  output reg  [ADDR_W-1:0]  addr,
  output reg  [DATA_W-1:0]  din,
  input  wire [DATA_W-1:0]  dout,

  // status
  output reg                busy,
  output reg                done,
  output reg                fail,
  output reg  [ADDR_W-1:0]  fail_addr,
  output reg  [DATA_W-1:0]  fail_got,
  output reg  [DATA_W-1:0]  fail_exp,
  output reg  [2:0]         fail_elem,
  output reg  [31:0]        op_count
);
  localparam DEPTH = (1 << ADDR_W);

  localparam S_IDLE = 2'd0, S_RUN = 2'd1, S_DRAIN = 2'd2, S_DONE = 2'd3;

  reg [1:0]        state;
  reg [2:0]        step;   // index into the algorithm's element list
  reg              opi;    // operation index within the current element
  reg [ADDR_W-1:0] acnt;
  reg [1:0]        drain;

  // ---- algorithm -> element mapping --------------------------------------
  reg [2:0] elem;
  always @* begin
    if (algo) elem = step;                 // March C- : 0,1,2,3,4,5
    else case (step)                       // MATS+    : 0,1,4
           3'd0:    elem = 3'd0;
           3'd1:    elem = 3'd1;
           default: elem = 3'd4;
         endcase
  end
  wire [2:0] step_max     = algo ? 3'd5 : 3'd2;
  wire       at_last_step = (step == step_max);

  // ---- element decode -----------------------------------------------------
  // nops2 = 1 -> element issues two operations per address
  reg cur_rd, cur_dat, dir_down, nops2;
  always @* begin
    cur_rd = 1'b0; cur_dat = 1'b0; dir_down = 1'b0; nops2 = 1'b1;
    case (elem)
      3'd0: begin nops2 = 1'b0; cur_rd = 1'b0; cur_dat = 1'b0; end           // up   w0
      3'd1: begin dir_down = 1'b0;                                            // up   r0,w1
              if (!opi) begin cur_rd = 1'b1; cur_dat = 1'b0; end
              else      begin cur_rd = 1'b0; cur_dat = 1'b1; end end
      3'd2: begin dir_down = 1'b0;                                            // up   r1,w0
              if (!opi) begin cur_rd = 1'b1; cur_dat = 1'b1; end
              else      begin cur_rd = 1'b0; cur_dat = 1'b0; end end
      3'd3: begin dir_down = 1'b1;                                            // down r0,w1
              if (!opi) begin cur_rd = 1'b1; cur_dat = 1'b0; end
              else      begin cur_rd = 1'b0; cur_dat = 1'b1; end end
      3'd4: begin dir_down = 1'b1;                                            // down r1,w0
              if (!opi) begin cur_rd = 1'b1; cur_dat = 1'b1; end
              else      begin cur_rd = 1'b0; cur_dat = 1'b0; end end
      3'd5: begin nops2 = 1'b0; cur_rd = 1'b1; cur_dat = 1'b0; end           // up   r0
      default: ;
    endcase
  end

  wire [ADDR_W-1:0] cur_addr  = dir_down ? (DEPTH-1-acnt) : acnt;
  wire              last_op   = (opi == nops2);
  wire              last_addr = (acnt == DEPTH-1);

  // ---- SRAM port drive ----------------------------------------------------
  always @* begin
    ce_n = 1'b1;
    we_n = 1'b1;
    addr = cur_addr;
    din  = {DATA_W{cur_dat}};
    if (state == S_RUN) begin
      ce_n = 1'b0;
      we_n = cur_rd ? 1'b1 : 1'b0;
    end
  end

  // ---- sequencer + one-deep compare shadow --------------------------------
  reg              chk_v;
  reg [DATA_W-1:0] chk_exp;
  reg [ADDR_W-1:0] chk_addr;
  reg [2:0]        chk_elem;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      state <= S_IDLE; step <= 3'd0; opi <= 1'b0; acnt <= {ADDR_W{1'b0}};
      drain <= 2'd0;   busy <= 1'b0;  done <= 1'b0; fail <= 1'b0;
      op_count <= 32'd0;
      chk_v <= 1'b0; chk_exp <= {DATA_W{1'b0}}; chk_addr <= {ADDR_W{1'b0}};
      chk_elem <= 3'd0;
      fail_addr <= {ADDR_W{1'b0}}; fail_got <= {DATA_W{1'b0}};
      fail_exp  <= {DATA_W{1'b0}};  fail_elem <= 3'd0;
    end else begin
      chk_v <= 1'b0;

      case (state)
        S_IDLE: begin
          busy <= 1'b0;
          if (start) begin
            state <= S_RUN; step <= 3'd0; opi <= 1'b0; acnt <= {ADDR_W{1'b0}};
            drain <= 2'd0; busy <= 1'b1; done <= 1'b0; fail <= 1'b0;
            op_count <= 32'd0;
          end
        end

        S_RUN: begin
          op_count <= op_count + 32'd1;

          chk_v    <= cur_rd;
          chk_exp  <= {DATA_W{cur_dat}};
          chk_addr <= cur_addr;
          chk_elem <= elem;

          if (!last_op) opi <= opi + 1'b1;
          else begin
            opi <= 1'b0;
            if (!last_addr) acnt <= acnt + 1'b1;
            else begin
              acnt <= {ADDR_W{1'b0}};
              if (!at_last_step) step <= step + 3'd1;
              else begin state <= S_DRAIN; drain <= 2'd2; end
            end
          end
        end

        S_DRAIN: begin
          if (drain == 2'd0) state <= S_DONE;
          else               drain <= drain - 2'd1;
        end

        S_DONE: begin
          busy <= 1'b0;
          done <= 1'b1;
        end

        default: state <= S_IDLE;
      endcase

      // first-failure latch - evaluated in every state so the drained read
      // at the end of the last element is still compared
      if (chk_v && (dout !== chk_exp) && !fail) begin
        fail      <= 1'b1;
        fail_addr <= chk_addr;
        fail_got  <= dout;
        fail_exp  <= chk_exp;
        fail_elem <= chk_elem;
      end
    end
  end
endmodule
