# SystemVerilog Language Support for CodeGraph

This document describes how SystemVerilog language support was added to this forked CodeGraph repository.

## Modified Files

| File | Change |
|---|---|
| `src/types.ts` | Added `'systemverilog'` to `LANGUAGES` array |
| `src/extraction/grammars.ts` | Added WASM mapping, extension map entries, vendored path, display name |
| `src/extraction/languages/index.ts` | Registered `systemverilogExtractor` |
| `src/extraction/languages/systemverilog.ts` | **New** — full extractor implementation |
| `src/extraction/wasm/tree-sitter-systemverilog.wasm` | **New** — vendored WASM grammar |

## Extension Map

Files with these extensions are recognized as SystemVerilog:

| Extension | Description |
|---|---|
| `.sv` | SystemVerilog source |
| `.svh` | SystemVerilog header |
| `.v` | Verilog source |
| `.svi` | SystemVerilog include |

## Extractor Coverage (Medium)

### Extracted as symbols

| CodeGraph Kind | SV Constructs | AST Node Types |
|---|---|---|
| `class` | `module`, `class`, `package`, `covergroup`, `checker`, `program` | `module_declaration`, `class_declaration`, `package_declaration`, `covergroup_declaration`, `checker_declaration`, `program_declaration`, `interface_class_declaration` |
| `interface` | `interface` | `interface_declaration` |
| `function` | `function`, `task` | `function_declaration`, `task_declaration` |
| `type_alias` | `typedef` | `type_declaration` |
| `import` | `import pkg::*`, `import "DPI-C"` | `package_import_declaration`, `dpi_import_export` |

### Extracted as edges (calls/references)

| Edge Kind | SV Constructs | AST Node Types |
|---|---|---|
| `calls` / `references` | module/interface/program instantiation | `module_instantiation`, `interface_instantiation`, `program_instantiation`, `checker_instantiation` |
| `calls` / `references` | method/function calls | `method_call` |

### Not yet covered (future improvements)

| Construct | Reason / Approach |
|---|---|
| `struct` / `union` members | Embedded inside `data_type` node; needs `extractVariables` hook |
| `enum` members (`enum_name_declaration`) | Embedded inside `data_type` node; needs `enumMemberTypes` with custom walk |
| Variable declarations (`wire`, `reg`, `logic`) | No unified AST node type; needs `extractVariables` hook |
| System function calls (`$display`, `$fatal`, etc.) | Parsed as `system_tf_identifier` — built-in functions, low value for cross-reference tracking |
| Assertion nodes (`assert`, `assume`, `cover`) | Needs `visitNode` hook for `assertion_item` |
| Generate block symbols | Needs `visitNode` hook for `generate_region` |
| Modport connections | Cross-interface references via `modport_declaration` |
| Bind directives | Cross-module references via `bind_directive` |

## System Function Handling

SystemVerilog system functions/tasks (e.g., `$display`, `$fatal`, `$monitor`, `$time`) are intentionally **not** tracked as call edges because:

1. They are **built-in** to the language/simulator — not user-defined symbols
2. Adding call edges to them would create noise (unresolved references to non-existent targets)
3. They don't help understand project architecture or module dependencies

The grammar parses them as `system_tf_identifier` nodes (visible in `highlights.scm` as `@function.builtin`), but they are excluded from `callTypes`.

## WASM Grammar Source

The grammar WASM file `tree-sitter-systemverilog.wasm` was obtained from [`@lumis-sh/wasm-systemverilog`](https://www.npmjs.com/package/@lumis-sh/wasm-systemverilog) (pre-built from [`gmlarumbe/tree-sitter-systemverilog`](https://github.com/gmlarumbe/tree-sitter-systemverilog) v0.3.1).

It is **vendored** locally in `src/extraction/wasm/` rather than loaded from `tree-sitter-wasms` because the upstream npm package does not include a SystemVerilog WASM.

## How to Add New Language Support (Pattern)

To add another new language to CodeGraph:

1. **`src/types.ts`** — Add language name to `LANGUAGES` array
2. **`src/extraction/grammars.ts`** — Add to `WASM_GRAMMAR_FILES`, `EXTENSION_MAP`, `getLanguageDisplayName`; if vendoring WASM, add to vendored condition in `loadGrammarsForLanguages`
3. **`src/extraction/languages/<lang>.ts`** — Create extractor implementing `LanguageExtractor` interface
4. **`src/extraction/languages/index.ts`** — Import and register extractor
5. **`src/extraction/wasm/<grammar>.wasm`** — Add WASM file if vendoring
6. **Build** — `npm run build` (TypeScript compile + copy-assets)
7. **Deploy** — Copy `dist/` to global installation path
