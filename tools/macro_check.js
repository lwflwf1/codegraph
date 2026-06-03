const fs = require('fs');
const P = require('web-tree-sitter');
(async () => {
  await P.Parser.init();
  const lang = await P.Language.load('src/extraction/wasm/tree-sitter-systemverilog.wasm');
  const p = new P.Parser(); p.setLanguage(lang);
  
  // Parse a real file that uses macros
  const src = fs.readFileSync('G:/ai/lvds_phy/lvds_phy_agent.sv', 'utf8');
  
  // Check for ERROR nodes and macro-related parsing issues
  const t = p.parse(src);
  let errors = 0;
  let macroLike = 0;
  function walk(n, d) {
    if (n.isError || n.type === 'ERROR') { 
      errors++;
      if (errors <= 5) console.log('ERROR at line', n.startPosition.row+1, ':', src.slice(n.startIndex, n.endIndex).slice(0,80).replace(/\n/g,'\\n'));
    }
    // Find text_macro_usage or any node containing backtick-related things
    if (n.type.includes('macro') || n.type.includes('preproc')) {
      macroLike++;
      console.log('Found macro node at line', n.startPosition.row+1, ':', n.type);
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1);
  }
  walk(t.rootNode, 0);
  console.log('Total ERROR nodes:', errors);
  console.log('Total macro-like nodes:', macroLike);
  
  // Find uvm_component_utils usage
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('\x60uvm') || l.includes('\x60include')) console.log('Line', i+1, ':', l.trim());
  });
})().catch(e => console.error(e.message));
