/**
 * SV Extraction Verification Tool
 * Parses all SV files with tree-sitter and cross-references with codegraph data.
 * Usage: node tools/verify_sv.js [project-path]
 *   project-path defaults to G:\ai\lvds_phy
 */

const fs = require('fs');
const path = require('path');
const P = require('web-tree-sitter');

const PROJECT_DIR = process.argv[2] || 'G:\\ai\\lvds_phy';
const WASM_PATH = 'src\\extraction\\wasm\\tree-sitter-systemverilog.wasm';
const TMP = process.env.TMP || process.env.TEMP;
const REPORT_DIR = path.join(TMP, 'sv_report');

// --- AST node types the SV extractor cares about ---
const CLASS_TYPES = ['module_declaration', 'class_declaration', 'package_declaration', 'covergroup_declaration'];
const EXTRA_CLASS_TYPES = ['checker_declaration', 'program_declaration', 'interface_class_declaration'];
const FUNC_TYPES = ['function_declaration', 'task_declaration'];
const INTERFACE_TYPES = ['interface_declaration'];
const TYPE_ALIAS_TYPES = ['type_declaration'];
const IMPORT_TYPES = ['package_import_declaration', 'dpi_import_export'];
const CALL_TYPES = ['module_instantiation', 'interface_instantiation', 'program_instantiation', 'method_call', 'checker_instantiation'];
const ALL_DECL_TYPES = [...CLASS_TYPES, ...EXTRA_CLASS_TYPES, ...FUNC_TYPES,
  ...INTERFACE_TYPES, ...TYPE_ALIAS_TYPES, ...IMPORT_TYPES, ...CALL_TYPES];

// --- Mapping: AST type → extraction kind ---
const TYPE_TO_KIND = {};
CLASS_TYPES.forEach(t => TYPE_TO_KIND[t] = 'class');
EXTRA_CLASS_TYPES.forEach(t => TYPE_TO_KIND[t] = 'class');
FUNC_TYPES.forEach(t => TYPE_TO_KIND[t] = 'function');
INTERFACE_TYPES.forEach(t => TYPE_TO_KIND[t] = 'interface');
TYPE_ALIAS_TYPES.forEach(t => TYPE_TO_KIND[t] = 'type_alias');
IMPORT_TYPES.forEach(t => TYPE_TO_KIND[t] = 'import');
CALL_TYPES.forEach(t => TYPE_TO_KIND[t] = 'call');

// --- Extract name from node using the same logic as systemverilog.ts ---
function getNodeText(n, source) {
  if (!n) return '';
  if (typeof n.startIndex !== 'number') return '';
  return source.substring(n.startIndex, n.endIndex).trim();
}

function findChildByType(node, type) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) return child;
  }
  return null;
}

function extractDeclName(node, source) {
  const type = node.type;
  const types = [
    'module_ansi_header', 'module_nonansi_header',
    'interface_ansi_header', 'interface_nonansi_header',
    'program_ansi_header', 'program_nonansi_header',
  ];
  for (const hType of types) {
    const header = findChildByType(node, hType);
    if (header) {
      const nameNode = header.childForFieldName('name');
      if (nameNode) return getNodeText(nameNode, source);
    }
  }
  const bodyTypes = ['function_body_declaration', 'task_body_declaration'];
  for (const bType of bodyTypes) {
    const body = findChildByType(node, bType);
    if (body) {
      const nameNode = body.childForFieldName('name');
      if (nameNode) return getNodeText(nameNode, source);
    }
  }
  if (['class_declaration', 'package_declaration', 'checker_declaration',
       'interface_class_declaration', 'covergroup_declaration'].includes(type)) {
    const n = node.childForFieldName('name');
    if (n) return getNodeText(n, source);
  }
  if (type === 'type_declaration') {
    const n = node.childForFieldName('name');
    if (n) return getNodeText(n, source);
  }
  if (CALL_TYPES.includes(type)) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === 'simple_identifier') return getNodeText(c, source);
    }
    return null;
  }
  if (type === 'method_call') {
    const body = findChildByType(node, 'method_call_body');
    if (body) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const c = body.namedChild(i);
        if (c && c.type === 'simple_identifier') return getNodeText(c, source);
      }
    }
    return null;
  }
  if (type === 'package_import_declaration') {
    const item = findChildByType(node, 'package_import_item');
    if (item) {
      for (let i = 0; i < item.namedChildCount; i++) {
        const c = item.namedChild(i);
        if (c && c.type === 'simple_identifier') return getNodeText(c, source);
      }
    }
    return null;
  }
  if (type === 'dpi_import_export') {
    return 'DPI-C';
  }
  // Fallback: find first simple_identifier child (handles forward typedefs like `typedef class Foo;`)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && (c.type === 'simple_identifier' || c.type === 'identifier')) {
      return getNodeText(c, source);
    }
  }
  return null;
}

function extractKindForNode(node) {
  const t = node.type;
  if (CLASS_TYPES.includes(t) || EXTRA_CLASS_TYPES.includes(t)) return 'class';
  if (FUNC_TYPES.includes(t)) return 'function';
  if (INTERFACE_TYPES.includes(t)) return 'interface';
  if (TYPE_ALIAS_TYPES.includes(t)) return 'type_alias';
  if (IMPORT_TYPES.includes(t)) return 'import';
  if (CALL_TYPES.includes(t)) return 'call';
  return null;
}

// --- Check if 'new' constructor is a function_declaration ---
function isConstructorNew(node, source) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === 'function_body_declaration') {
      const nameNode = c.childForFieldName('name');
      if (nameNode && getNodeText(nameNode, source) === 'new') return true;
    }
  }
  return false;
}

// --- Main ---
async function main() {
  console.log(`Analyzing SV project: ${PROJECT_DIR}`);
  
  // Find all SV files
  const svFiles = fs.readdirSync(PROJECT_DIR)
    .filter(f => /\.(sv|svh|v|svi)$/i.test(f))
    .map(f => path.join(PROJECT_DIR, f))
    .sort();

  console.log(`Found ${svFiles.length} SV files`);

  // Load codegraph data
  function loadCG(kind) {
    const file = path.join(REPORT_DIR, `cg_${kind}.json`);
    if (!fs.existsSync(file)) return [];
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  }
  const cgAll = [
    ...loadCG('classes').map(s => ({...s.node, cgKind: 'class'})),
    ...loadCG('funcs').map(s => ({...s.node, cgKind: 'function'})),
    ...loadCG('types').map(s => ({...s.node, cgKind: 'type_alias'})),
    ...loadCG('iface').map(s => ({...s.node, cgKind: 'interface'})),
    ...loadCG('imports').map(s => ({...s.node, cgKind: 'import'})),
    ...loadCG('files').map(s => ({...s.node, cgKind: 'file'})),
  ];

  // Build lookup: file -> [symbol]
  const cgByFile = {};
  for (const sym of cgAll) {
    const f = path.basename(sym.filePath);
    if (!cgByFile[f]) cgByFile[f] = [];
    cgByFile[f].push(sym);
  }

  // Initialize tree-sitter
  await P.Parser.init();
  const lang = await P.Language.load(WASM_PATH);
  const parser = new P.Parser();
  parser.setLanguage(lang);

  // --- Also find constructors (not in functionTypes but present in AST) ---
  function findConstructorsInAST(tree, source) {
    const ctors = [];
    function walk(n) {
      if (n.type === 'class_constructor_declaration') {
        ctors.push({
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
        });
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i));
    }
    walk(tree.rootNode);
    return ctors;
  }

  // --- Generate AST tree for a specific line range ---
  function generateASTTree(root, source, targetLine) {
    const lines = [];
    function walk(n, depth, found) {
      const startLine = n.startPosition.row + 1;
      const endLine = n.endPosition.row + 1;
      if (endLine < targetLine || startLine > targetLine) return found;
      found = true;
      const indicator = n.type === 'function_declaration' || n.type === 'task_declaration' ||
                        n.type === 'class_declaration' || n.type === 'interface_declaration' ||
                        n.type === 'type_declaration' || n.type === 'class_constructor_declaration' ||
                        n.type === 'package_import_declaration' || n.type === 'covergroup_declaration' ||
                        n.type === 'package_declaration' || n.type === 'method_call' ||
                        n.type === 'module_instantiation'
        ? '◆' : '·';
      const nameField = n.childForFieldName('name');
      const nameHint = nameField ? ' name="' + source.substring(nameField.startIndex, nameField.endIndex) + '"' : '';
      const text = n.isNamed
        ? source.substring(n.startIndex, n.endIndex).slice(0, 50).replace(/\n/g, '\\n').trim()
        : '';
      const asText = text ? `  "${text}"` : '';
      lines.push('  '.repeat(depth) + indicator + ' ' + n.type + nameHint + asText);
      for (let i = 0; i < n.childCount; i++) {
        walk(n.child(i), depth + 1, true);
      }
      return found;
    }
    walk(root, 0, false);
    return lines.join('\n');
  }

  const report = {
    project: PROJECT_DIR,
    files: [],
    stats: { totalFiles: 0, totalSymbols: 0, totalMatched: 0, totalMissing: 0, missingDetails: [] },
    missingConstructors: [],
    extractedConstructors: [],
    astExamples: [],
  };

  for (const filePath of svFiles) {
    const fileName = path.basename(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    const tree = parser.parse(source, null, { bufferSize: 1024 * 1024 });
    const root = tree.rootNode;

    // Walk the AST and collect declaration nodes
    const decls = [];
    function walk(n, depth) {
      const kind = extractKindForNode(n);
      const name = extractDeclName(n, source);
      if (kind && name) {
        decls.push({
          type: n.type,
          kind,
          name,
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          startCol: n.startPosition.column,
          endCol: n.endPosition.column,
        });
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        walk(n.namedChild(i), depth + 1);
      }
    }
    walk(root, 0);

    // Detect constructors (class_constructor_declaration — NOT in functionTypes)
    const constructors = findConstructorsInAST(tree, source);
    for (const ctor of constructors) {
      const inCG = cgByFile[fileName]?.find(s => s.kind === 'function' && s.name === 'new' && s.startLine === ctor.startLine);
      if (inCG) {
        report.extractedConstructors.push({ file: fileName, ...ctor });
      } else {
        report.missingConstructors.push({ file: fileName, ...ctor });
      }
    }

    // Cross-reference with codegraph data
    const cgSymbols = cgByFile[fileName] || [];
    const fileReport = {
      fileName,
      filePath,
      totalLines: lines.length,
      astDecls: decls,
      cgSymbols,
      matched: [],
      unmatched: [],
      extraInCG: [],
      constructors: constructors,  // store for HTML annotations
    };

    for (const decl of decls) {
      const match = cgSymbols.find(s =>
        s.kind === decl.kind &&
        s.name === decl.name &&
        s.startLine === decl.startLine
      );
      if (match) {
        fileReport.matched.push({ ...decl, cgId: match.id });
      } else if (decl.isConstructor) {
        fileReport.unmatched.push({ ...decl, reason: 'new() 是 function_declaration 但 grammar 中可能为特殊节点类型' });
      } else {
        fileReport.unmatched.push({ ...decl, reason: 'AST 中存在但 codegraph 未提取' });
      }
    }

    // Find symbols in CG that are not in our AST walk (shouldn't happen, but check)
    for (const sym of cgSymbols) {
      if (sym.kind === 'file') continue;
      const found = decls.find(d =>
        d.kind === sym.kind &&
        d.name === sym.name &&
        d.startLine === sym.startLine
      );
      if (!found) {
        fileReport.extraInCG.push(sym);
      }
    }
    // Collect AST tree examples (one per file, for the class/module declaration at the top)
    if (fileReport.matched.length > 0) {
      const topClass = decls.find(d => d.kind === 'class' || d.kind === 'interface');
      if (topClass && topClass.startLine > 0) {
        const astText = generateASTTree(root, source, topClass.startLine);
        report.astExamples.push({
          file: fileName,
          targetLine: topClass.startLine,
          declName: topClass.name,
          declKind: topClass.kind,
          astText,
        });
      }
    }

    report.files.push(fileReport);
    report.stats.totalFiles++;
    report.stats.totalSymbols += fileReport.matched.length;
    report.stats.totalMatched += fileReport.matched.length - fileReport.extraInCG.filter(s => s.kind !== 'file').length;
    report.stats.totalMissing += fileReport.unmatched.length;
    for (const u of fileReport.unmatched) {
      report.stats.missingDetails.push({ file: fileName, ...u });
    }
  }

  // Generate HTML report
  const html = generateHTML(report, PROJECT_DIR);
  const reportFile = path.join(REPORT_DIR, 'sv_extraction_report.html');
  fs.writeFileSync(reportFile, html, 'utf8');
  
  // Also print text summary
  console.log('\n========================================');
  console.log('SV EXTRACTION VERIFICATION SUMMARY');
  console.log('========================================');
  console.log(`Files analyzed: ${report.stats.totalFiles}`);
  console.log(`Symbols matched: ${report.stats.totalSymbols}`);
  console.log(`Missing (in AST but not CG): ${report.stats.totalMissing}`);
  console.log(`Constructors found: ${report.extractedConstructors.length} extracted, ${report.missingConstructors.length} missing`);
  console.log(`\nReport saved to: ${reportFile}`);

  // Print unmatched items
  if (report.stats.totalMissing > 0) {
    console.log('\n--- Missing Items ---');
    for (const m of report.stats.missingDetails) {
      console.log(`  ${m.file}:${m.startLine}  ${m.kind} ${m.name}  (${m.type})  ${m.reason || ''}`);
    }
  }

  // Open in browser
  const { execSync } = require('child_process');
  try {
    execSync(`start "" "${reportFile}"`, { shell: true });
    console.log('\nReport opened in browser.');
  } catch (e) {
    console.log(`\nOpen ${reportFile} in browser manually.`);
  }
}

function generateHTML(report, projectDir) {
  // Also compute detailed stats per kind
  const kindStats = { class: 0, function: 0, type_alias: 0, interface: 0, import: 0 };
  for (const f of report.files) {
    for (const m of f.matched) {
      if (kindStats[m.kind] !== undefined) kindStats[m.kind]++;
    }
  }
  const totalCG = Object.values(kindStats).reduce((a, b) => a + b, 0);
  const escapeHtml = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  let filesHtml = '';
  for (const file of report.files) {
    const sourceLines = fs.readFileSync(file.filePath, 'utf8').split('\n');
    const fileName = file.fileName;

    // Build line annotations
    const annotations = {};
    for (const m of file.matched) {
      for (let line = m.startLine; line <= Math.min(m.endLine, m.startLine); line++) {
        if (!annotations[line]) annotations[line] = [];
        annotations[line].push({ kind: m.kind, name: m.name, match: 'matched' });
      }
    }
    for (const u of file.unmatched) {
      for (let line = u.startLine; line <= Math.min(u.endLine, u.startLine); line++) {
        if (!annotations[line]) annotations[line] = [];
        annotations[line].push({ kind: u.kind, name: u.name, match: 'unmatched', reason: u.reason });
      }
    }
    // Add constructor annotations
    for (const c of (file.constructors || [])) {
      const line = c.startLine;
      if (!annotations[line]) annotations[line] = [];
      annotations[line].push({ kind: 'function', name: 'new', match: 'constructor' });
    }

    let tableRows = '';
    for (let i = 0; i < sourceLines.length; i++) {
      const lineNum = i + 1;
      const code = escapeHtml(sourceLines[i]);
      const anns = annotations[lineNum] || [];
      let annHtml = '';
      if (anns.length > 0) {
        annHtml = anns.map(a => {
          let cls, label;
          if (a.match === 'matched') { cls = 'tag-matched'; label = '✓'; }
          else if (a.match === 'unmatched') { cls = 'tag-unmatched'; label = '✗'; }
          else if (a.match === 'constructor') { cls = 'tag-ctor'; label = '⚙'; }
          else { cls = 'tag-partial'; label = '●'; }
          return `<span class="tag ${cls}" title="${escapeHtml(a.reason || '')}">${label} ${a.kind}: ${a.name}</span>`;
        }).join(' ');
      }
      const rowClass = anns.some(a => a.match === 'unmatched') ? 'row-unmatched' :
                       anns.some(a => a.match === 'constructor') ? 'row-ctor' :
                       anns.length > 0 ? 'row-matched' : '';
      tableRows += `<tr class="${rowClass}">
        <td class="linenum">${lineNum}</td>
        <td class="code"><pre>${code || ' '}</pre></td>
        <td class="tags">${annHtml}</td>
      </tr>\n`;
    }

    // Matched summary
    const matchedCount = file.matched.length;
    const unmatchedCount = file.unmatched.length;
    const ctorCount = (file.constructors || []).length;
    filesHtml += `
    <div class="file-section" id="file-${escapeHtml(fileName)}">
      <h2 class="file-header collapsible" onclick="toggleFile(this)">
        <span>📄 ${escapeHtml(fileName)}</span>
        <span class="badge badge-ok">${matchedCount} symbols</span>
        ${unmatchedCount > 0 ? `<span class="badge badge-warn">${unmatchedCount} missing</span>` : ''}
        ${ctorCount > 0 ? `<span class="badge badge-neutral">${ctorCount} ctors</span>` : ''}
        <span class="lines">${file.totalLines} lines</span>
      </h2>
      <div class="file-body">
        <div class="table-wrap">
          <table class="code-table">
            <tr><th>Line</th><th>Source Code</th><th>Extraction</th></tr>
            ${tableRows}
          </table>
        </div>
      </div>
    </div>`;
  }

  const astExamplesHtml = report.astExamples.map(ex => {
    return `<div class="file-section">
      <h2 class="file-header collapsible" onclick="toggleFile(this)">
        <span>🌳 ${escapeHtml(ex.file)} — ${escapeHtml(ex.declKind)} <code>${escapeHtml(ex.declName)}</code> (line ${ex.targetLine})</span>
      </h2>
      <div class="file-body">
        <pre class="ast-tree">${escapeHtml(ex.astText)}</pre>
      </div>
    </div>`;
  }).join('\n');

  const cc = report.missingConstructors.length;
  const ce = report.extractedConstructors.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SV Extraction Verification Report</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'Segoe UI', 'Cascadia Code', Consolas, monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
h1 { color: #58a6ff; margin-bottom: 5px; font-size: 24px; }
h2 { font-size: 18px; margin: 20px 0 10px; color: #58a6ff; }
h3 { font-size: 14px; margin: 16px 0 8px; color: #8b949e; }
.subtitle { color: #8b949e; margin-bottom: 20px; font-size: 14px; }
.stats { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
.stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 20px; min-width: 120px; flex: 1; }
.stat-card .num { font-size: 28px; font-weight: bold; }
.stat-card .label { font-size: 12px; color: #8b949e; }
.stat-card.ok .num { color: #3fb950; }
.stat-card.warn .num { color: #d29922; }
.stat-card.err .num { color: #f85149; }
.file-section { margin-bottom: 12px; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
.file-header { background: #161b22; padding: 10px 14px; cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 14px; }
.file-header:hover { background: #1c2128; }
.file-header .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.badge-ok { background: #1b3a2a; color: #3fb950; }
.badge-warn { background: #3a2f1b; color: #d29922; }
.badge-neutral { background: #1b2a3a; color: #58a6ff; }
.lines { color: #8b949e; font-size: 12px; margin-left: auto; }
.file-body { display: none; padding: 4px 0; }
.file-body.open { display: block; }
.table-wrap { overflow-x: auto; }
.code-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.code-table th { background: #0d1117; border-bottom: 1px solid #30363d; padding: 6px 10px; text-align: left; position: sticky; top: 0; white-space: nowrap; }
.code-table td { padding: 1px 10px; vertical-align: top; border-bottom: 1px solid #21262d; }
.code-table .linenum { color: #484f58; text-align: right; width: 45px; user-select: none; font-size: 11px; }
.code-table .linecol { color: #30363d; text-align: center; width: 50px; font-size: 10px; }
.code-table .code {  }
.code-table .code pre { font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; white-space: pre; margin: 0; color: #e6edf3; }
.row-matched { background: #0d1f17; }
.row-unmatched { background: #1f1414; }
.row-ctor { background: #1a1a2e; }
.row-matched td.code pre { color: #7ee787; }
.row-unmatched td.code pre { color: #ff7b72; }
.row-ctor td.code pre { color: #d2a8ff; }
.tags { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.tag { font-size: 10px; padding: 1px 5px; border-radius: 4px; white-space: nowrap; }
.tag-matched { background: #1b3a2a; color: #7ee787; border: 1px solid #2ea043; }
.tag-unmatched { background: #3a1b1b; color: #ff7b72; border: 1px solid #da3633; }
.tag-ctor { background: #2a1a3a; color: #d2a8ff; border: 1px solid #a371f7; }
.collapsible::after { content: '▼'; font-size: 10px; color: #8b949e; margin-left: auto; }
.collapsible.open::after { content: '▲'; }
.missing-list { margin-top: 12px; }
.missing-list li { margin: 4px 0; }
.ast-tree { background: #0d1117; padding: 12px; font-family: 'Cascadia Code', Consolas, monospace; font-size: 11px; line-height: 1.5; color: #8b949e; overflow-x: auto; white-space: pre; }
.kind-breakdown { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.kind-item { padding: 6px 14px; border-radius: 6px; border: 1px solid #30363d; display: flex; gap: 6px; align-items: center; font-size: 13px; }
.kind-item .num { font-weight: bold; font-size: 16px; }
.kind-class .num { color: #3fb950; }
.kind-function .num { color: #d29922; }
.kind-type_alias .num { color: #58a6ff; }
.kind-interface .num { color: #f0883e; }
.kind-import .num { color: #a371f7; }
@media (prefers-color-scheme: light) {
  body { background: #fff; color: #1f2328; }
  h1, h2 { color: #0969da; }
  h3 { color: #656d76; }
  .file-header { background: #f6f8fa; }
  .file-header:hover { background: #eef1f5; }
  .stat-card { background: #f6f8fa; border-color: #d0d7de; }
  .code-table th { background: #f6f8fa; }
  .row-matched { background: #dcffe4; }
  .row-unmatched { background: #ffe6e6; }
  .row-ctor { background: #f0e6ff; }
  .row-matched td.code pre { color: #116329; }
  .row-unmatched td.code pre { color: #cf222e; }
  .row-ctor td.code pre { color: #8250df; }
  .code-table td { border-color: #d0d7de; }
  .code-table .linenum { color: #8c959f; }
  .code-table .linecol { color: #d0d7de; }
  .tag-matched { background: #dafbe1; color: #1a7f37; border-color: #2da44e; }
  .tag-unmatched { background: #ffebe9; color: #cf222e; border-color: #ff8182; }
  .tag-ctor { background: #f0e6ff; color: #8250df; border-color: #a371f7; }
  .code-table .code pre { color: #1f2328; }
  .badge-ok { background: #dafbe1; color: #1a7f37; }
  .badge-warn { background: #fff8c5; color: #9a6700; }
  .badge-neutral { background: #ddf4ff; color: #0969da; }
  .subtitle, .lines { color: #656d76; }
  .file-section { border-color: #d0d7de; }
  .ast-tree { background: #f6f8fa; color: #656d76; }
  .kind-item { border-color: #d0d7de; }
}
</style>
</head>
<body>
<h1>SV Extraction Verification Report</h1>
<p class="subtitle">Project: ${escapeHtml(projectDir)} &mdash; Cross-referencing tree-sitter AST with codegraph extraction</p>

<div class="stats">
  <div class="stat-card ok">
    <div class="num">${report.stats.totalFiles}</div>
    <div class="label">Files Analyzed</div>
  </div>
  <div class="stat-card ok">
    <div class="num">${totalCG}</div>
    <div class="label">Symbols Extracted ✓</div>
  </div>
  <div class="stat-card ${report.stats.totalMissing > 0 ? 'warn' : 'ok'}">
    <div class="num">${report.stats.totalMissing}</div>
    <div class="label">AST Decls Missing ✗</div>
  </div>
  <div class="stat-card ${cc > 0 ? 'warn' : 'ok'}">
    <div class="num">${cc}</div>
    <div class="label">Constructors Missed ✗</div>
  </div>
</div>

<h3>Extraction by Kind</h3>
<div class="kind-breakdown">
  <div class="kind-item kind-class"><span class="num">${kindStats.class}</span> class</div>
  <div class="kind-item kind-function"><span class="num">${kindStats.function}</span> function</div>
  <div class="kind-item kind-type_alias"><span class="num">${kindStats.type_alias}</span> type_alias</div>
  <div class="kind-item kind-interface"><span class="num">${kindStats.interface}</span> interface</div>
  <div class="kind-item kind-import"><span class="num">${kindStats.import}</span> import</div>
</div>

${report.stats.totalMissing > 0 ? `
<h3>⚠️ Missing Declarations</h3>
<ul class="missing-list" style="margin-bottom: 16px; padding-left: 20px;">
${report.stats.missingDetails.map(m => `<li><b>${escapeHtml(m.file)}:${m.startLine}</b> — ${m.kind} <code>${escapeHtml(m.name)}</code> (AST: ${m.type})${m.reason ? ' — ' + escapeHtml(m.reason) : ''}</li>`).join('\n')}
</ul>
` : '<p style="color:#3fb950;margin-bottom:12px;">✓ All AST declarations match codegraph symbols.</p>'}

${cc > 0 ? `
<h3>⚠️ Constructors Not Extracted (${cc})</h3>
<p style="font-size:12px;color:#8b949e;margin-bottom:8px;">
  SV grammar parses <code>function new(...)</code> as <code>class_constructor_declaration</code>, not <code>function_declaration</code>.
  The extractor's <code>functionTypes</code> only includes <code>['function_declaration', 'task_declaration']</code>.
  To extract constructors, add <code>'class_constructor_declaration'</code> to <code>functionTypes</code> or <code>extraClassNodeTypes</code>.
</p>
<ul class="missing-list" style="margin-bottom: 16px; padding-left: 20px; font-size: 12px;">
${report.missingConstructors.map(c => `<li><b>${escapeHtml(c.file)}:${c.startLine}</b> — constructor</li>`).join('\n')}
</ul>
` : ''}

${astExamplesHtml.length > 0 ? `
<h2>AST Tree Examples</h2>
<p style="color:#8b949e;font-size:12px;margin-bottom:12px;">Tree-sitter parse tree for each file's main class/interface declaration. (◆ = extractable node)</p>
${astExamplesHtml}
` : ''}

<h2>File-by-File Extraction</h2>
<p style="color:#8b949e;font-size:12px;margin-bottom:12px;">Click a file header to expand. Green = extracted, Purple = constructor (not extracted), Red = missing.</p>

${filesHtml}

<script>
function toggleFile(header) {
  header.classList.toggle('open');
  const body = header.nextElementSibling;
  body.classList.toggle('open');
}
document.querySelector('.file-header')?.classList.add('open');
document.querySelector('.file-body')?.classList.add('open');
</script>
</body>
</html>`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
