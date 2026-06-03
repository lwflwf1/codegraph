# AGENTS.md

## Project

CodeGraph — local-first code intelligence library + CLI + MCP server. Parses codebases with tree-sitter, stores symbols/edges/files in SQLite (FTS5), exposes a knowledge graph to AI agents over MCP. Per-project data lives in `.codegraph/`. npm: `@colbymchenry/codegraph`.

## Build, Test, Run

```bash
npm run build           # tsc + copy schema.sql & *.wasm into dist/ + chmod bin
npm run dev             # tsc --watch
npm test                # vitest run (all)
npm run test:watch      # vitest (watch)
npm run test:eval       # only __tests__/evaluation/
npm run eval            # build then run evaluation runner via tsx
npm run cli             # build then run dist/bin/codegraph.js

# Single test file / pattern
npx vitest run __tests__/installer-targets.test.ts
npx vitest run __tests__/extraction.test.ts -t "TypeScript"
```

`copy-assets` (part of `build`) copies `src/db/schema.sql` and `src/extraction/wasm/*.wasm` into `dist/`. **Any new SQL or grammar wasm must be copied or it won't ship.**

## Architecture

```
files → ExtractionOrchestrator (tree-sitter) → DB (nodes/edges/files)
             ↓
      ReferenceResolver (imports, name-matching, framework patterns)
             ↓
      GraphQueryManager / GraphTraverser (callers, callees, impact)
             ↓
      ContextBuilder (markdown/JSON for AI consumption)
```

- `src/index.ts` — `CodeGraph` class: public API surface. Library users touch this file only.
- `src/db/` — `DatabaseConnection`, `QueryBuilder`, `schema.sql`. Backed by `node:sqlite` (Node 22.5+ built-in). Native `better-sqlite3` as primary, wasm fallback.
- `src/extraction/` — `ExtractionOrchestrator`, tree-sitter wrappers, per-language extractors under `languages/` (one file per language: typescript.ts, python.ts, go.ts, etc.), standalone extractors for non-tree-sitter formats (svelte, vue, liquid, dfm). `parse-worker.ts` runs heavy parsing off main thread.
- `src/resolution/` — `ReferenceResolver`, `import-resolver.ts`, `name-matcher.ts`, `frameworks/` (Express, Laravel, Rails, FastAPI, Django, Flask, Spring, Gin, Axum, ASP.NET, Vapor, React Router, SvelteKit, Vue/Nuxt, Cargo workspaces). Frameworks emit `route` nodes + `references` edges.
- `src/graph/` — `GraphTraverser` (BFS/DFS, impact radius) and `GraphQueryManager`.
- `src/context/` — `ContextBuilder` + markdown/JSON formatter.
- `src/mcp/` — MCP server (`MCPServer`, `tools.ts`, `transport.ts`). `server-instructions.ts` is the **single source of truth** for agent-facing tool guidance — do NOT duplicate tool instructions into `CLAUDE.md`/`AGENTS.md`.
- `src/installer/` — `codegraph install` entry point. `targets/registry.ts` lists agents. One new file in `targets/` + one registry entry = new agent support.
- `src/bin/codegraph.ts` — CLI (commander): `install`, `init`, `uninit`, `index`, `sync`, `status`, `query`, `files`, `context`, `affected`, `serve --mcp`.

## Key Gotchas

- **Node engines**: `>=20.0.0 <25.0.0`. Hard exit on Node 25.x — bypass with env `CODEGRAPH_ALLOW_UNSAFE_NODE=1` (set by vitest.config.ts for tests).
- **Module system**: CommonJS (`"module": "commonjs"` in tsconfig). No ESM.
- **Skip lib check**: `skipLibCheck: true` in tsconfig — type-check errors in `node_modules` are expected noise.
- **Tests use real SQLite and real files**. `fs.mkdtempSync` + cleanup in `afterEach`. No DB mocking.
- **Windows-gated tests**: Use `it.runIf(process.platform === 'win32')(...)` / `it.runIf(process.platform !== 'win32')(...)`.
- **Releases**: Never run `npm publish`, `git push`, or `git tag` yourself. The GitHub Actions "Release" workflow handles everything. Changelog entries go under `## [Unreleased]` — user-facing, one sentence, no internal paths or benchmark numbers.
- **Installer changes MUST have test coverage** in `__tests__/installer-targets.test.ts` — parameterized contract tests across all agent targets.
- **MCP server tool guidance** lives exclusively in `src/mcp/server-instructions.ts`. The installer no longer writes duplicate instructions blocks into agent config files (issue #529).
- **Zero-config**: CodeGraph has no config file. Exclusion is via `.gitignore` + built-in defaults (node_modules, dist, vendor, etc.). Files >1MB are skipped.

## Language Extractors

Each language extractor in `src/extraction/languages/` implements `LanguageExtractor` and returns `ExtractionResult` (nodes + edges). Register new languages in `src/extraction/languages/index.ts`. Tree-sitter grammars live as `.wasm` files in `src/extraction/wasm/` — they ship via `copy-assets`.

- **SystemVerilog**: `src/extraction/languages/systemverilog.ts`. Tests in `__tests__/sv-extraction.test.ts` (lvds_phy, 11 files) and `__tests__/sv-extraction-dpu.test.ts` (dpu_top, 245 files). Improvements backlog: `docs/sv-improvements.md`.

## Syntax Error Detection

`src/extraction/tree-sitter.ts` checks `tree.rootNode.hasError` after parsing and reports `syntax_error` warnings with ERROR node counts. These are stored in the file record's `errors` field. Test by checking `cg.getFile(path)?.errors`.

## NodeKind / EdgeKind

Defined in `src/types.ts`. Extractors and resolvers must use these exact strings:
- **NodeKind**: `file`, `module`, `class`, `struct`, `interface`, `trait`, `protocol`, `function`, `method`, `property`, `field`, `variable`, `constant`, `enum`, `enum_member`, `type_alias`, `namespace`, `parameter`, `import`, `export`, `route`, `component`.
- **EdgeKind**: `contains`, `calls`, `imports`, `exports`, `extends`, `implements`, `references`, `type_of`, `returns`, `instantiates`, `overrides`, `decorates`.
