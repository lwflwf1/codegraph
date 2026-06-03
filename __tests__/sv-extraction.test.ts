/**
 * SystemVerilog Extraction Tests — lvds_phy project
 *
 * Validates the SystemVerilog extractor against the real-world lvds_phy UVM
 * testbench source files located in tests/source/lvds_phy/.
 *
 * NOTE: The source file lvds_phy_transaction.sv has a typo on line 39-40:
 * `constriant` instead of `constraint`. This causes tree-sitter to fail
 * parsing the constraint body, so c_hsync and abc are not extracted as
 * constraint nodes. The constructor (function new) also fails to parse.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-sv-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LVDS_PHY_SOURCE = path.resolve(__dirname, '..', 'tests', 'source', 'lvds_phy');

function copySvFiles(sourceDir: string, destDir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(sourceDir);
  for (const entry of entries) {
    const src = path.join(sourceDir, entry);
    if (entry.endsWith('.sv')) {
      fs.copyFileSync(src, path.join(destDir, entry));
      files.push(entry);
    }
  }
  return files;
}

describe('SystemVerilog: lvds_phy extraction', () => {
  let tempDir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    tempDir = createTempDir();
    copySvFiles(LVDS_PHY_SOURCE, tempDir);
    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
  });

  afterEach(() => {
    if (cg) cg.close();
    cleanupTempDir(tempDir);
  });

  it('should index all 11 .sv files', () => {
    const files = cg.getFiles();
    expect(files).toHaveLength(11);
    for (const f of files) {
      expect(f.language).toBe('systemverilog');
    }
  });

  describe('Classes', () => {
    it('should extract all 8 UVM classes', () => {
      const classes = cg.getNodesByKind('class');
      const classNames = classes.map((c) => c.name).sort();

      const expected = [
        'lvds_phy_agent',
        'lvds_phy_config',
        'lvds_phy_driver',
        'lvds_phy_env',
        'lvds_phy_func_cov',
        'lvds_phy_monitor',
        'lvds_phy_sequencer',
        'lvds_phy_transaction',
      ];
      for (const name of expected) {
        expect(classNames).toContain(name);
      }
    });

    it('should extract covergroups as class nodes', () => {
      const classes = cg.getNodesByKind('class');
      const classNames = classes.map((c) => c.name);
      expect(classNames).toContain('cg_lvds_mode');
      expect(classNames).toContain('cg_lane_en');
      expect(classNames).toContain('cg_vsync_polarity');
      expect(classNames).toContain('cg_hsync_polarity');
      expect(classNames).toContain('cg_de_polarity');
    });
  });

  describe('Type aliases / enums', () => {
    it('should extract 3 typedef enums from define file', () => {
      const defineNodes = cg.getNodesInFile('lvds_phy_define.sv');
      const types = defineNodes.filter((n) => n.kind === 'type_alias');
      expect(types).toHaveLength(3);

      const typeNames = types.map((t) => t.name).sort();
      expect(typeNames).toContain('protocol_sel_e');
      expect(typeNames).toContain('lvds_mode_e');
      expect(typeNames).toContain('data_format_e');
    });

    it('should extract typedef class forward declarations as type aliases', () => {
      const pkgNodes = cg.getNodesInFile('lvds_phy_pkg.sv');
      const types = pkgNodes.filter((n) => n.kind === 'type_alias');
      expect(types.length).toBeGreaterThanOrEqual(8);

      const typeNames = types.map((t) => t.name);
      expect(typeNames).toContain('lvds_phy_transaction');
      expect(typeNames).toContain('lvds_phy_config');
      expect(typeNames).toContain('lvds_phy_monitor');
    });
  });

  describe('Variables', () => {
    it('should extract class member variables from config', () => {
      const configNodes = cg.getNodesInFile('lvds_phy_config.sv');
      const vars = configNodes.filter((n) => n.kind === 'variable');
      const varNames = vars.map((v) => v.name);

      expect(varNames).toContain('is_active');
      expect(varNames).toContain('has_func_cov');
      expect(varNames).toContain('lane_en');
      expect(varNames).toContain('lvds_mode');
      expect(varNames).toContain('vsync_polarity');
      expect(varNames).toContain('hsync_polarity');
      expect(varNames).toContain('de_polarity');
    });

    it('should extract transaction rand variables', () => {
      const transNodes = cg.getNodesInFile('lvds_phy_transaction.sv');
      const vars = transNodes.filter((n) => n.kind === 'variable');
      const varNames = vars.map((v) => v.name);

      expect(varNames).toContain('r');
      expect(varNames).toContain('g');
      expect(varNames).toContain('b');
      expect(varNames).toContain('line_id');
      expect(varNames).toContain('pixel_id');
    });

    it('should extract interface variables (wires/logic)', () => {
      const ifaceNodes = cg.getNodesInFile('lvds_phy_if.sv');
      const vars = ifaceNodes.filter((n) => n.kind === 'variable');

      // clk, resetn, enable, clk_p, clk_n, data_p, data_n, r, g, b,
      // hsync, vsync, data_en, sample_phase, clk_half_period, clk_p_posedge_time
      expect(vars.length).toBeGreaterThanOrEqual(15);

      const varNames = vars.map((v) => v.name);
      expect(varNames).toContain('clk');
      expect(varNames).toContain('resetn');
      expect(varNames).toContain('enable');
      expect(varNames).toContain('data_p');
      expect(varNames).toContain('data_n');
      expect(varNames).toContain('sample_phase');
    });

    it('should extract monitor class member variables', () => {
      const monitorNodes = cg.getNodesInFile('lvds_phy_monitor.sv');
      const vars = monitorNodes.filter((n) => n.kind === 'variable');
      expect(vars.length).toBeGreaterThanOrEqual(4);

      const varNames = vars.map((v) => v.name);
      expect(varNames).toContain('cfg');
      expect(varNames).toContain('vif');
      expect(varNames).toContain('trans_put_port');
      expect(varNames).toContain('frame_collected');
    });

    it('should extract func_cov class member variables', () => {
      const covNodes = cg.getNodesInFile('lvds_phy_func_cov.sv');
      const vars = covNodes.filter((n) => n.kind === 'variable');
      expect(vars.length).toBeGreaterThanOrEqual(3);

      const varNames = vars.map((v) => v.name);
      expect(varNames).toContain('cfg');
      expect(varNames).toContain('analysis_export');
      expect(varNames).toContain('trans_fifo');
    });
  });

  describe('Constants', () => {
    it('should extract interface parameters as constants', () => {
      const ifaceNodes = cg.getNodesInFile('lvds_phy_if.sv');
      const consts = ifaceNodes.filter((n) => n.kind === 'constant');
      expect(consts).toHaveLength(2);

      const constNames = consts.map((c) => c.name).sort();
      expect(constNames).toEqual(['DATA_WIDTH', 'NUM_LANES']);
    });
  });

  describe('Functions (includes methods and tasks)', () => {
    it('should extract class methods as function nodes', () => {
      // SV extractor uses 'function' kind for both functions and tasks
      const configFuncs = cg.getNodesInFile('lvds_phy_config.sv')
        .filter((n) => n.kind === 'function');
      expect(configFuncs.length).toBeGreaterThanOrEqual(6);

      const funcNames = configFuncs.map((f) => f.name);
      expect(funcNames).toContain('new');
      expect(funcNames).toContain('check_config');
      expect(funcNames).toContain('get_num_lanes');
      expect(funcNames).toContain('get_data_width');
      expect(funcNames).toContain('get_protocol');
      expect(funcNames).toContain('convert2string');
    });

    it('should extract monitor methods and tasks as function nodes', () => {
      const monitorFuncs = cg.getNodesInFile('lvds_phy_monitor.sv')
        .filter((n) => n.kind === 'function');
      expect(monitorFuncs.length).toBeGreaterThanOrEqual(8);

      const funcNames = monitorFuncs.map((f) => f.name);
      expect(funcNames).toContain('new');
      expect(funcNames).toContain('build_phase');
      // tasks also extracted as function kind
      expect(funcNames).toContain('run_phase');
      expect(funcNames).toContain('wait_for_reset');
      expect(funcNames).toContain('collect_transaction');
      expect(funcNames).toContain('drive_interface_signals');
      expect(funcNames).toContain('sample_lvds_data_by_phase');
      expect(funcNames).toContain('is_pixel_complete');
    });

    it('should extract func_cov methods as function nodes', () => {
      const covFuncs = cg.getNodesInFile('lvds_phy_func_cov.sv')
        .filter((n) => n.kind === 'function');
      expect(covFuncs.length).toBeGreaterThanOrEqual(6);

      const funcNames = covFuncs.map((f) => f.name);
      expect(funcNames).toContain('new');
      expect(funcNames).toContain('build_phase');
      expect(funcNames).toContain('connect_phase');
      expect(funcNames).toContain('sample_config_coverage');
      expect(funcNames).toContain('sample_transaction_coverage');
      expect(funcNames).toContain('report_phase');
    });

    it('should have constructors (function new) in most UVM classes', () => {
      const constructors = cg.getNodesByName('new');
      const funcConstructors = constructors.filter((n) => n.kind === 'function');
      // All classes except transaction (typo in source) should have new()
      expect(funcConstructors.length).toBeGreaterThanOrEqual(7);

      const ctorFiles = funcConstructors.map((c) => c.filePath);
      const expected = [
        'lvds_phy_agent.sv',
        'lvds_phy_config.sv',
        'lvds_phy_driver.sv',
        'lvds_phy_env.sv',
        'lvds_phy_func_cov.sv',
        'lvds_phy_monitor.sv',
        'lvds_phy_sequencer.sv',
      ];
      for (const f of expected) {
        expect(ctorFiles).toContain(f);
      }
    });
  });

  describe('Constraints', () => {
    it('should extract constraint c_lane_en from config', () => {
      const constraints = cg.getNodesByKind('constraint');
      expect(constraints).toHaveLength(1);
      expect(constraints[0]?.name).toBe('c_lane_en');

      const configNodes = cg.getNodesInFile('lvds_phy_config.sv');
      const configConstraints = configNodes.filter((n) => n.kind === 'constraint');
      expect(configConstraints).toHaveLength(1);
      expect(configConstraints[0]?.name).toBe('c_lane_en');
    });
  });

  describe('Interface', () => {
    it('should extract interface as interface node kind', () => {
      const interfaces = cg.getNodesByKind('interface');
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]?.name).toBe('lvds_phy_if');
      expect(interfaces[0]?.filePath).toBe('lvds_phy_if.sv');
    });
  });

  describe('Package', () => {
    it('should extract package (as class node)', () => {
      const pkgNodes = cg.getNodesInFile('lvds_phy_pkg.sv');
      const pkgClass = pkgNodes.find((n) =>
        n.kind === 'class' && n.name === 'lvds_phy_pkg'
      );
      expect(pkgClass).toBeDefined();
    });

    it('should extract import from pkg file', () => {
      const pkgNodes = cg.getNodesInFile('lvds_phy_pkg.sv');
      const imports = pkgNodes.filter((n) => n.kind === 'import');
      expect(imports).toHaveLength(1);
      expect(imports[0]?.name).toBe('uvm_pkg');
    });
  });

  describe('Syntax error detection', () => {
    it('should report syntax errors for lvds_phy_transaction.sv (constriant typo)', () => {
      const file = cg.getFile('lvds_phy_transaction.sv');
      expect(file).toBeDefined();
      expect(file?.errors).toBeDefined();
      expect(file!.errors!.length).toBeGreaterThanOrEqual(1);

      const syntaxErrors = file!.errors!.filter((e) => e.code === 'syntax_error');
      expect(syntaxErrors).toHaveLength(1);
      expect(syntaxErrors[0]!.severity).toBe('warning');
      expect(syntaxErrors[0]!.message).toContain('ERROR');
      expect(syntaxErrors[0]!.message).toContain('Syntax errors detected');
    });

    it('should NOT report syntax errors for clean files', () => {
      const cleanFiles = [
        'lvds_phy_define.sv',
        'lvds_phy_if.sv',
        'lvds_phy_config.sv',
        'lvds_phy_agent.sv',
        'lvds_phy_env.sv',
        'lvds_phy_monitor.sv',
        'lvds_phy_driver.sv',
        'lvds_phy_sequencer.sv',
        'lvds_phy_func_cov.sv',
        'lvds_phy_pkg.sv',
      ];
      for (const f of cleanFiles) {
        const file = cg.getFile(f);
        const syntaxErrors = file?.errors?.filter((e) => e.code === 'syntax_error') ?? [];
        expect(syntaxErrors).toHaveLength(0);
      }
    });
  });

  describe('Sanity checks', () => {
    it('should not create spurious function nodes from UVM macros', () => {
      const uvmMacros = [
        'uvm_info', 'uvm_warning', 'uvm_error',
        'uvm_component_utils', 'uvm_object_utils_begin',
        'uvm_object_utils_end', 'uvm_field_int', 'uvm_field_enum',
      ];
      for (const macro of uvmMacros) {
        const nodes = cg.getNodesByName(macro);
        const funcNodes = nodes.filter((n) => n.kind === 'function');
        expect(funcNodes).toHaveLength(0);
      }
    });

    it('should sync cleanly after initial index', async () => {
      const result = await cg.sync();
      expect(result.filesAdded).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(result.filesRemoved).toBe(0);
    });

    it('should report sensible node/edge counts', () => {
      const stats = cg.getStats();
      console.log(`[lvds_phy] Files: ${stats.fileCount}, Nodes: ${stats.nodeCount}, Edges: ${stats.edgeCount}`);
      console.log('[lvds_phy] Nodes by kind:', JSON.stringify(stats.nodesByKind));
      console.log('[lvds_phy] Edges by kind:', JSON.stringify(stats.edgesByKind));

      // Reasonable bounds for 11 SV UVM testbench files
      expect(stats.nodeCount).toBeGreaterThan(50);
      expect(stats.nodeCount).toBeLessThan(500);
      expect(stats.edgeCount).toBeGreaterThan(50);
    });
  });
});
