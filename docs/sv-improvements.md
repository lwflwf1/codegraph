# SystemVerilog Language Support — Improvements Backlog

Last updated: 2026-06-03

## Source File Fixes (no code changes)

| File | Issue | Impact |
|------|-------|--------|
| `tests/source/lvds_phy/lvds_phy_transaction.sv:39` | `constriant` typo (missing `n`) | 2 constraints (`c_hsync`, `abc`) + constructor `new` fail to parse. Fix: rename to `constraint`. |
| `tests/source/lvds_phy/lvds_phy_transaction.sv:52` | `abc.constraint_mode(0)` — calling method on constraint inside its own body? | Likely incorrect SV syntax alongside the typo above. |
| dpu_top `preocess` | `preocess_onl0_irq` — typo of `process` (5× in `dpu_top_onl0_irq_handler.sv`) | Doesn't affect parsing; only cosmetic. |
| dpu_top `disbaled` | `response_queue_error_report_disbaled` — typo of `disabled` (4 files) | Doesn't affect parsing. |
| dpu_top `cornor` | `cornor_scene_*`, `dpu_top_cornor_test` — typo of `corner` (~30 occurrences) | Doesn't affect parsing. |
| dpu_top CRLF | `RoundC_plus_trans.sv`, `tmg_trans.sv` have trailing `\r` | May cause parse issues on some toolchains. Header says "please use dos2unix". |

## Extractor Improvements (`src/extraction/languages/systemverilog.ts`)

### Module kind mapping
- **Current**: `module_declaration` → `classTypes` → produces `class` kind
- **Target**: `module_declaration` → separate `module` kind (NodeKind already defines `module`)
- **Impact**: `tb_top`, `clk_rst_gen` etc. would be distinguishable from UVM classes

### Method kind for class members
- **Current**: `methodTypes: []` — all functions/tasks inside classes are `function` kind
- **Target**: Add `methodTypes: ['function_declaration', 'task_declaration']` for declarations inside class bodies
- **Caution**: Need to distinguish top-level functions from class methods in AST

### Enum member extraction
- **Current**: `enumMemberTypes: []` — `typedef enum { JEIDA, VESA }` extracts the enum name but not the members
- **Target**: Map `enum_name_list` / individual enum members to `enum_member` kind
- **Impact**: enum values would appear in search results

### `define macro capture
- **Current**: `define ERR_NO_CFG 4'b0001` is preprocessor-only, not extracted
- **Target**: Capture `text_macro_definition` AST nodes as `constant` kind
- **Impact**: Hundreds of macros in dpu_top would become searchable

### SVA assertions / properties
- **Current**: `property` and `assert` constructs (~846 in dpu_top) are completely ignored
- **Target**: Extract named properties as nodes (could use `function` or new kind)
- **Impact**: Assertion-based verification code would be queryable

### Parameterized class inheritance
- **Current**: `class foo_plus extends foo#(8)` — the `#(8)` parameterized extension might not be captured as an `extends` edge
- **Need**: Verify and fix if parameterized extension edges are missing

### Virtual interface references
- **Current**: `virtual lvds_phy_if vif` — the type reference to `lvds_phy_if` may not create a `type_of` edge
- **Target**: Ensure virtual interface declarations emit `type_of` edges to the interface node

## Error Reporting (`src/extraction/tree-sitter.ts`)

### ERROR node location
- **Current**: `syntax_error` warning only reports ERROR node count
- **Target**: Include first ERROR node's line number via `node.startPosition.row`

### Detailed error enumeration
- **Current**: Only total count of ERROR nodes
- **Target**: Optionally list individual ERROR node types and their positions for debugging

## Tests

### Performance optimization
- **Current**: dpu_top test runs full index every time (~97s)
- **Target**: Use snapshot/expected.json so test can skip re-indexing in CI

### Edge case coverage
- `fork/join` blocks — test that they don't confuse call edge extraction
- `clocking` blocks — verify they're extracted or at least don't cause parse errors
- `generate` / `endgenerate` — verify module instances inside generate blocks
- Parameterized class extension — verify extends edges with `#()` parameters
- `extern` function declarations — verify they don't create duplicate function nodes

### Cross-file resolution
- Test that `import uvm_pkg::*` actually creates import edges
- Test that typedef class forward declarations resolve to the actual class definition
- Test `uvm_config_db#(type)::get()` creates `references` to the type

## Known Limitations

### Macro preprocessing
- tree-sitter has no preprocessor — `define / `include / `ifdef chains cannot be resolved
- **Impact**: 16/241 dpu_top files have syntax errors from unresolved macros (`RCH_NUM`, `CMPS_NUM`, etc.)
- **Workaround**: User must resolve `include chains manually or accept missing symbols in macro-heavy files

### Large file skipping
- Files >1MB are skipped by default (hardcoded in `src/extraction/index.ts:100`)
- **Impact**: 4 dpu_top files skipped (ral_dpu_reg_top 4.3MB, lut_3d_trans 1.5MB, etc.)
- **Mitigation**: These are auto-generated register models with repetitive content; skipping them is reasonable

### No preprocessor integration
- SV codebases heavily depend on `include for modular composition
- The extractor can only parse standalone files, not preprocessed compilation units
