const fs = require('fs');
const P = require('web-tree-sitter');
(async () => {
  await P.Parser.init();
  const lang = await P.Language.load('src/extraction/wasm/tree-sitter-systemverilog.wasm');
  const p = new P.Parser(); p.setLanguage(lang);

  // Test with ports
  const src1 = 'module my_mod(input logic clk, output wire [7:0] data, inout tri sig);\nendmodule';
  const t1 = p.parse(src1);
  console.log('=== Port Declaration AST ===');
  function walk1(n, d) {
    if (d > 10) return;
    const hasKids = n.childCount > 0;
    const text = !hasKids && n.isNamed ? ' = \"' + src1.slice(n.startIndex, n.endIndex) + '\"' : '';
    const indent = '  '.repeat(d);
    console.log(indent + (n.isNamed ? '[N]' : '[A]') + n.type + ' L' + (n.startPosition.row + 1) + text);
    for (let i = 0; i < n.childCount; i++) walk1(n.child(i), d + 1);
  }
  walk1(t1.rootNode, 0);

  // Test with constraint
  const src2 = 'class c;\nconstraint my_c { a > 0; b inside {[1:10]}; }\nendclass';
  const t2 = p.parse(src2);
  console.log('\n=== Constraint AST ===');
  function walk2(n, d) {
    if (d > 10) return;
    const hasKids = n.childCount > 0;
    const text = !hasKids && n.isNamed ? ' = \"' + src2.slice(n.startIndex, n.endIndex) + '\"' : '';
    console.log('  '.repeat(d) + (n.isNamed ? '[N]' : '[A]') + n.type + ' L' + (n.startPosition.row + 1) + text);
    for (let i = 0; i < n.childCount; i++) walk2(n.child(i), d + 1);
  }
  walk2(t2.rootNode, 0);
})().catch(e => console.error(e.message));
