const fs = require('fs');
const P = require('web-tree-sitter');
(async () => {
  await P.Parser.init();
  const lang = await P.Language.load('src/extraction/wasm/tree-sitter-systemverilog.wasm');
  const p = new P.Parser(); p.setLanguage(lang);
  const src = fs.readFileSync('G:/ai/lvds_phy/lvds_phy_config.sv', 'utf8');
  const t = p.parse(src);

  // Find constraint_declaration and show full structure
  function walk(n, d) {
    if (n.type === 'constraint_declaration') {
      console.log('Found constraint_declaration at line', n.startPosition.row + 1);
      console.log('  has name field:', !!n.childForFieldName('name'));
      const nf = n.childForFieldName('name');
      if (nf) console.log('  name field value:', src.slice(nf.startIndex, nf.endIndex));
      // Check simple_identifier children
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        console.log('  [' + i + '] ' + c.type + ' = \"' + src.slice(c.startIndex, c.endIndex) + '\"');
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1);
  }
  walk(t.rootNode, 0);
})().catch(e => console.error(e.message));
