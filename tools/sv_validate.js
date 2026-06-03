#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN_DIR = path.join(ROOT, 'tests', 'sv', 'golden');
const EXPECTED_PATH = path.join(ROOT, 'tests', 'sv', 'expected.json');
const TEMP_BASE = path.join(ROOT, 'tmp_sv_validate');

function run(cmd, cwd) {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || e.message };
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function queryNodes(projectDir) {
  const allNodes = [];
  const seen = new Set();
  function addResults(jsonStr) {
    try {
      const results = JSON.parse(jsonStr);
      for (const entry of results) {
        const n = entry.node || entry;
        if (n && n.kind && !seen.has(n.id)) {
          seen.add(n.id);
          allNodes.push(n);
        }
      }
    } catch {}
  }
  for (const term of ['class', 'variable', 'constant', 'function', 'constraint',
    'type_alias', 'import']) {
    const qr = run(`codegraph query "${term}" --json -l 500`, projectDir);
    if (qr.ok) addResults(qr.out);
  }
  return allNodes;
}

function queryName(projectDir, name) {
  const r = run(`codegraph query "${name}" --json -l 1`, projectDir);
  if (!r.ok) return [];
  try {
    const results = JSON.parse(r.out.trim());
    return results.map(e => e.node || e);
  } catch { return []; }
}

function runGoldenTests() {
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf-8'));
  const files = fs.readdirSync(GOLDEN_DIR).filter(f => f.endsWith('.sv'));

  let totalPass = 0, totalFail = 0;
  const reports = [];

  for (const file of files) {
    const goldenPath = path.join(GOLDEN_DIR, file);
    const src = path.join(TEMP_BASE, file.replace('.sv', ''));
    const projectDir = path.join(src, 'project');

    cleanDir(src);
    ensureDir(projectDir);
    fs.copyFileSync(goldenPath, path.join(projectDir, file));

    const expectedEntries = expected[file] || [];
    const initR = run(`codegraph init`, projectDir);
    if (!initR.ok) {
      reports.push({ file, pass: false, errors: [`init failed: ${initR.err}`] });
      totalFail++;
      continue;
    }
    const indexR = run(`codegraph index`, projectDir);
    if (!indexR.ok) {
      reports.push({ file, pass: false, errors: [`index failed: ${indexR.err}`] });
      totalFail++;
      continue;
    }

    const nodes = queryNodes(projectDir);
    const seen = new Set();

    let filePass = true;
    const details = [];

    for (const exp of expectedEntries) {
      const nameResults = queryName(projectDir, exp.name);
      const match = nameResults.find(n => n.kind === exp.kind && n.name === exp.name && !seen.has(`${n.kind}:${n.name}`));
      // also check in bulk query results
      const bulkMatch = nodes.find(n => n.kind === exp.kind && n.name === exp.name && !seen.has(`${n.kind}:${n.name}`));
      const found = match || bulkMatch;
      if (found) {
        seen.add(`${found.kind}:${found.name}`);
        details.push(`  ✓ ${exp.kind} ${exp.name} (line ${found.startLine})`);
      } else {
        details.push(`  ✗ ${exp.kind} ${exp.name} — NOT FOUND`);
        filePass = false;
      }
    }

    if (filePass) {
      totalPass++;
      reports.push({ file, pass: true, details });
    } else {
      totalFail++;
      reports.push({ file, pass: false, details });
    }

    cleanDir(src);
  }

  console.log('\n=== Golden Test Results ===\n');
  for (const r of reports) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.file}`);
    if (r.details) for (const d of r.details) console.log(d);
    if (r.errors) for (const e of r.errors) console.log(`  ERROR: ${e}`);
    console.log();
  }
  console.log(`Pass: ${totalPass}/${files.length}, Fail: ${totalFail}/${files.length}`);
  process.exit(totalFail > 0 ? 1 : 0);
}

function runProjectValidation(projectPath) {
  const absPath = path.resolve(projectPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Project not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`\n=== Project Validation: ${absPath} ===\n`);
  const r = run(`codegraph status`, absPath);
  if (r.ok) {
    const lines = r.out.trim().split('\n').filter(l => l.trim());
    for (const l of lines) console.log(`  ${l}`);
  }

  const nodes = queryNodes(absPath);
  const byKind = {};
  for (const n of nodes) {
    byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  }
  console.log('\nNodes by kind:');
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }
  console.log(`\nTotal: ${nodes.length} nodes`);

  const constraints = nodes.filter(n => n.kind === 'constraint');
  if (constraints.length > 0) {
    console.log('\nConstraints:');
    for (const c of constraints) console.log(`  ${c.name} (${c.filePath}:${c.startLine})`);
  }

  const funcNews = nodes.filter(n => n.kind === 'function' && n.name === 'new');
  if (funcNews.length > 0) {
    console.log(`\nConstructors (function new): ${funcNews.length}`);
    for (const f of funcNews) console.log(`  ${f.qualifiedName} (${f.filePath}:${f.startLine})`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    runProjectValidation(args[0]);
  } else {
    runGoldenTests();
  }
}

main();
