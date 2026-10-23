# SRAM MBIST fault coverage (64 x 8 bits)

| Injected fault                 | MATS+ (5N) | March C- (10N) |
|--------------------------------|------------|----------------|
| fault-free (control)           |   miss     |    miss        |
| SA0   cell[21][3]              |   DETECT   |    DETECT      |
| SA1   cell[21][3]              |   DETECT   |    DETECT      |
| TF^   cell[21][3] cant rise    |   DETECT   |    DETECT      |
| TFv   cell[21][3] cant fall    |   miss     |    DETECT      |
| CFin  agg[10]->vic[42] (a<v)   |   DETECT   |    DETECT      |
| CFin  agg[42]->vic[10] (a>v)   |   miss     |    DETECT      |
| CFid1 agg[10]->vic[42] (a<v)   |   DETECT   |    DETECT      |
| CFid1 agg[42]->vic[10] (a>v)   |   miss     |    DETECT      |
| CFid0 agg[10]->vic[42] (a<v)   |   miss     |    DETECT      |
| CFid0 agg[42]->vic[10] (a>v)   |   DETECT   |    DETECT      |
| AF    addr 7 aliases to 44     |   DETECT   |    DETECT      |
