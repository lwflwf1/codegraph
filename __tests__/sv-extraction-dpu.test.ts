/**
 * SystemVerilog Extraction Tests — dpu_top project
 *
 * Validates the SystemVerilog extractor against a large real-world UVM
 * verification environment (245 .sv files, ~15.6 MB) in tests/source/dpu_top/.
 *
 * CodeGraph skips files >1 MB by design. 4 files in dpu_top exceed this:
 *   - env/register/ral_dpu_reg_top.sv (4.3 MB)
 *   - env/trans_model/reg_trans/module_base_trans/lut_3d_trans.sv (1.5 MB)
 *   - top/asr_mem_test/dpu_gmw_sp_mem_test.sv (1.4 MB)
 *   - testcases/vseq_lib/reg_vseq/dpu_top_interrupt_connectivity_vseq.sv (1.1 MB)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';

const DPU_TOP_SOURCE = path.resolve(__dirname, '..', 'tests', 'source', 'dpu_top');

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-dpu-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copySvFilesRecursive(srcDir: string, destDir: string): number {
  let count = 0;
  const entries = fs.readdirSync(srcDir);
  for (const entry of entries) {
    const src = path.join(srcDir, entry);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      const subDir = path.join(destDir, entry);
      fs.mkdirSync(subDir, { recursive: true });
      count += copySvFilesRecursive(src, subDir);
    } else if (entry.endsWith('.sv')) {
      fs.copyFileSync(src, path.join(destDir, entry));
      count++;
    }
  }
  return count;
}

describe('SystemVerilog: dpu_top extraction', () => {
  let tempDir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    tempDir = createTempDir();
    const copied = copySvFilesRecursive(DPU_TOP_SOURCE, tempDir);
    console.log(`[dpu_top] Copied ${copied} .sv files`);
    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
  }, 120000);

  afterEach(() => {
    if (cg) cg.close();
    cleanupTempDir(tempDir);
  });

  // ==========================================================================
  // File-level checks
  // ==========================================================================

  it('should index most .sv files (some >1MB skipped)', () => {
    const files = cg.getFiles();
    const svFiles = files.filter((f) => f.path.endsWith('.sv'));
    expect(files.length).toBeGreaterThanOrEqual(235);
    expect(files.length).toBeLessThanOrEqual(245);
    for (const f of svFiles) {
      expect(f.language).toBe('systemverilog');
    }
  });

  it('should skip files > 1MB', () => {
    const files = cg.getFiles();
    const paths = files.map((f) => f.path);
    const largeFiles = [
      'env/register/ral_dpu_reg_top.sv',
      'env/trans_model/reg_trans/module_base_trans/lut_3d_trans.sv',
      'top/asr_mem_test/dpu_gmw_sp_mem_test.sv',
      'testcases/vseq_lib/reg_vseq/dpu_top_interrupt_connectivity_vseq.sv',
    ];
    for (const lf of largeFiles) {
      expect(paths).not.toContain(lf);
    }
  });

  // ==========================================================================
  // Class extraction
  // ==========================================================================

  it('should extract many UVM classes', () => {
    const classes = cg.getNodesByKind('class');
    console.log(`[dpu_top] Classes: ${classes.length}`);
    expect(classes.length).toBeGreaterThanOrEqual(100);
    expect(classes.length).toBeLessThanOrEqual(500);

    const classNames = classes.map((c) => c.name);
    // SV extractor treats modules + packages as classes
    expect(classNames).toContain('dpu_top_config');
    expect(classNames).toContain('dpu_ctl_trans');
    expect(classNames).toContain('dpu_top_env');
    expect(classNames).toContain('dpu_top_virtual_sequencer');
    expect(classNames).toContain('tb_top');
    expect(classNames).toContain('dpu_top_pkg');
    expect(classNames).toContain('dpu_top_test_pkg');
    // Scoreboard classes
    expect(classNames).toContain('dpu_rdma_scoreboard');
    expect(classNames).toContain('dpu_prep_scoreboard');
    expect(classNames).toContain('dpu_cmps_scoreboard');
    expect(classNames).toContain('dpu_postp_scoreboard');
    expect(classNames).toContain('dpu_preobuf_scoreboard');
    expect(classNames).toContain('dpu_tmg_scoreboard');
    expect(classNames).toContain('dpu_wdma_scoreboard');
  });

  it('should extract trans_model classes', () => {
    const classes = cg.getNodesByKind('class');
    const classNames = classes.map((c) => c.name);
    expect(classNames).toContain('dpu_top_plus_trans');
    expect(classNames).toContain('hsv_seq_ctrl_trans');
    expect(classNames).toContain('tmg_seq_ctrl_trans');
    expect(classNames).toContain('dsc_rdma_seq_ctrl_trans');
  });

  it('should extract irq_handler classes', () => {
    const classes = cg.getNodesByKind('class');
    const classNames = classes.map((c) => c.name);
    expect(classNames).toContain('dpu_interrupt_handler');
    expect(classNames).toContain('dpu_top_interrupt_handler');
    expect(classNames).toContain('dpu_top_irq_handler');
    expect(classNames).toContain('dpu_top_offl0_interrupt_handler');
    expect(classNames).toContain('dpu_top_onl0_interrupt_handler');
  });

  // ==========================================================================
  // Interface extraction
  // ==========================================================================

  it('should extract parameterized interfaces', () => {
    const interfaces = cg.getNodesByKind('interface');
    console.log(`[dpu_top] Interfaces: ${interfaces.length}`);
    expect(interfaces.length).toBeGreaterThanOrEqual(6);
    expect(interfaces.length).toBeLessThanOrEqual(30);

    const ifaceNames = interfaces.map((i) => i.name);
    expect(ifaceNames).toContain('dpu_top_if');
    expect(ifaceNames).toContain('dpu_top_internal_if');
    expect(ifaceNames).toContain('buf_lvl_check_if');
    expect(ifaceNames).toContain('frm_timing_chk_if');
    expect(ifaceNames).toContain('tmg_obuf_interface');
  });

  // ==========================================================================
  // Package extraction
  // ==========================================================================

  it('should extract packages and tb_top as classes', () => {
    // SV extractor treats `package`, `module`, and `class` as class nodes
    const classes = cg.getNodesByKind('class');
    const classNames = classes.map((c) => c.name);
    expect(classNames).toContain('dpu_top_pkg');
    expect(classNames).toContain('dpu_top_test_pkg');
    expect(classNames).toContain('tb_top');
  });

  // ==========================================================================
  // Type aliases / enums
  // ==========================================================================

  it('should extract typedef enums', () => {
    const types = cg.getNodesByKind('type_alias');
    const typeNames = types.map((t) => t.name);
    // 3 enums in dpu_top_base_seq.sv
    expect(typeNames).toContain('reg_property_e');
    expect(typeNames).toContain('trigger_property_e');
    expect(typeNames).toContain('cfg_property_e');
  });

  // ==========================================================================
  // Constraint extraction
  // ==========================================================================

  it('should extract constraint blocks', () => {
    const constraints = cg.getNodesByKind('constraint');
    console.log(`[dpu_top] Constraints: ${constraints.length}`);
    expect(constraints.length).toBeGreaterThanOrEqual(50);

    // Key constraints from dpu_ctl_trans.sv
    const dpuCtlNodes = cg.getNodesInFile('env/dpu_ctl_trans.sv');
    const dpuCtlConstraints = dpuCtlNodes.filter((n) => n.kind === 'constraint');
    if (dpuCtlConstraints.length > 0) {
      const names = dpuCtlConstraints.map((c) => c.name);
      // Check for at least one well-known constraint
      const hasCtlConstraint = names.some((n) =>
        n.includes('latency') || n.includes('cmdlist') || n.includes('mmu')
      );
      expect(hasCtlConstraint).toBe(true);
    }
  });

  // ==========================================================================
  // Variable extraction
  // ==========================================================================

  it('should extract many variables from trans_model files', () => {
    const variables = cg.getNodesByKind('variable');
    console.log(`[dpu_top] Variables: ${variables.length}`);
    // Auto-generated register fields create thousands of variables
    expect(variables.length).toBeGreaterThan(500);

    // Check specific known variables
    const varNames = variables.map((v) => v.name);
    // Common UVM class member variables
    expect(varNames).toContain('cfg');
    expect(varNames).toContain('vif');
  });

  // ==========================================================================
  // Function / Method extraction
  // ==========================================================================

  it('should extract functions from classes', () => {
    const functions = cg.getNodesByKind('function');
    console.log(`[dpu_top] Functions: ${functions.length}`);
    expect(functions.length).toBeGreaterThan(100);

    const funcNames = functions.map((f) => f.name);
    // UVM phase methods
    expect(funcNames).toContain('build_phase');
    expect(funcNames).toContain('connect_phase');
    // constructor
    expect(funcNames).toContain('new');
  });

  it('should extract methods from scoreboard classes', () => {
    const scbFiles = [
      'env/scb_model/dpu_rdma_scoreboard.sv',
      'env/scb_model/dpu_prep_scoreboard.sv',
      'env/scb_model/dpu_cmps_scoreboard.sv',
    ];
    for (const f of scbFiles) {
      const nodes = cg.getNodesInFile(f);
      if (nodes.length > 1) {
        const funcs = nodes.filter((n) => n.kind === 'function');
        // Each scoreboard should have several methods
        expect(funcs.length).toBeGreaterThanOrEqual(2);

        const names = funcs.map((n) => n.name);
        expect(names).toContain('new');
      }
    }
  });

  // ==========================================================================
  // Syntax error detection
  // ==========================================================================

  it('should detect syntax errors in files with preprocessor-dependent code', () => {
    const files = cg.getFiles();
    let syntaxErrorCount = 0;
    const errorFiles: string[] = [];
    for (const f of files) {
      const file = cg.getFile(f.path);
      const syntaxErrors = file?.errors?.filter((e) => e.code === 'syntax_error') ?? [];
      if (syntaxErrors.length > 0) {
        syntaxErrorCount++;
        errorFiles.push(f.path);
      }
    }
    console.log(`[dpu_top] Files with syntax errors: ${syntaxErrorCount}`);
    // 16 files have parse errors — these use `define macros or `include
    // chains that tree-sitter can't preprocess (e.g. dpu_ctl_trans.sv uses
    // `RCH_NUM / `CMPS_NUM defined via nested includes).
    // This is expected for complex UVM codebases with macro-heavy code.
    expect(syntaxErrorCount).toBeGreaterThanOrEqual(10);
    expect(syntaxErrorCount).toBeLessThanOrEqual(30);
  });

  // ==========================================================================
  // Statistics snapshot
  // ==========================================================================

  it('should report sensible overall statistics', () => {
    const stats = cg.getStats();
    console.log(`[dpu_top] Files: ${stats.fileCount}, Nodes: ${stats.nodeCount}, Edges: ${stats.edgeCount}`);
    console.log('[dpu_top] Nodes by kind:', JSON.stringify(stats.nodesByKind));

    // Sensible bounds for 241 files in a UVM verification env
    expect(stats.nodeCount).toBeGreaterThan(1000);
    expect(stats.nodeCount).toBeLessThan(50000);
    expect(stats.edgeCount).toBeGreaterThan(500);
  });
});
