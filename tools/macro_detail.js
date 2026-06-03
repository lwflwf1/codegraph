const fs = require('fs');
const P = require('web-tree-sitter');
(async () => {
  await P.Parser.init();
  const lang = await P.Language.load('src/extraction/wasm/tree-sitter-systemverilog.wasm');
  const p = new P.Parser(); p.setLanguage(lang);
  const src = fs.readFileSync('G:/ai/lvds_phy/lvds_phy_agent.sv', 'utf8');
  const t = p.parse(src);

  // Show macro nodes with their parent chain
  function showMacro(n, d) {
    if (n.type.includes('macro') || n.type.includes('define')) {
      const line = n.startPosition.row + 1;
      const text = src.slice(n.startIndex, n.endIndex).replace(/\n/g,'\\\\n').slice(0, 60);
      console.log('  '.repeat(d) + n.type + ' L' + line + ' text="' + text + '"');
    }
    for (let i = 0; i < n.childCount; i++) showMacro(n.child(i), d + 1);
  }
  showMacro(t.rootNode, 0);

  // Also show what text_macro_usage looks like - parent and children
  function findMacroUsage(n) {
    if (n.type === 'text_macro_usage') {
      const line = n.startPosition.row + 1;
      const text = src.slice(n.startIndex, n.endIndex).replace(/\n/g,' ').slice(0,80);
      console.log('\\ntext_macro_usage L' + line + ' text="' + text + '"');
      console.log('  parent:', n.parent ? n.parent.type : '?');
      console.log('  children:');
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        console.log('    [' + i + '] ' + c.type + ' named=' + c.isNamed + ' text="' + src.slice(c.startIndex, c.endIndex) + '"');
      }
    }
    for (let i = 0; i < n.childCount; i++) findMacroUsage(n.child(i));
  }
  findMacroUsage(t.rootNode);
})().catch(e => console.error(e.message));
