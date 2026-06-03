const fs = require('fs');
const P = require('web-tree-sitter');
(async () => {
  await P.Parser.init();
  const lang = await P.Language.load('src/extraction/wasm/tree-sitter-systemverilog.wasm');
  const p = new P.Parser(); p.setLanguage(lang);
  const src = fs.readFileSync('G:/ai/lvds_phy/lvds_phy_agent.sv', 'utf8');
  const t = p.parse(src);

  // Find text_macro_definition and its children
  function findMacroDef(n) {
    if (n.type === 'text_macro_definition') {
      const line = n.startPosition.row + 1;
      console.log('text_macro_definition L' + line);
      console.log('  children:');
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        console.log('    [' + i + '] ' + c.type + ' named=' + c.isNamed + ' text="' + src.slice(c.startIndex, c.endIndex).replace(/\n/g,' ') + '"');
      }
    }
    for (let i = 0; i < n.childCount; i++) findMacroDef(n.child(i));
  }
  findMacroDef(t.rootNode);

  // Check if text_macro_usage with backtick is in callTypes or similar
  console.log('\n--- text_macro_usage parent types ---');
  function findMacroParent(n) {
    if (n.type === 'text_macro_usage') {
      let p = n.parent;
      const chain = [];
      while (p) { chain.unshift(p.type); p = p.parent; }
      console.log('  chain: ' + chain.join(' -> '));
    }
    for (let i = 0; i < n.childCount; i++) findMacroParent(n.child(i));
  }
  findMacroParent(t.rootNode);
})().catch(e => console.error(e.message));
