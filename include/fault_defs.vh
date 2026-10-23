// ---------------------------------------------------------------------------
// fault_defs.vh - static fault models for SRAM
// Reference: van de Goor, "Testing Semiconductor Memories: Theory & Practice"
// ---------------------------------------------------------------------------
`ifndef FAULT_DEFS_VH
`define FAULT_DEFS_VH

`define F_NONE 4'd0  // fault-free reference
`define F_SA0  4'd1  // stuck-at-0   : victim cell always reads 0
`define F_SA1  4'd2  // stuck-at-1   : victim cell always reads 1
`define F_TFUP 4'd3  // transition   : victim cell cannot make a 0->1 transition
`define F_TFDN 4'd4  // transition   : victim cell cannot make a 1->0 transition
`define F_CFIN 4'd5  // coupling, inversion : transition on aggressor inverts victim
`define F_CFID 4'd6  // coupling, idempotent: transition on aggressor forces victim to f_cfval
`define F_AF   4'd7  // address decoder: aggressor address aliases onto victim address

`endif
