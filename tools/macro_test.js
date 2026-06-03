const fs = require('fs');
const P = require('web-tree-sitter');
(async () => {
  await P.Parser.init();
  const lang = await P.Language.load('src/extraction/wasm/tree-sitter-systemverilog.wasm');
  const p = new P.Parser(); p.setLanguage(lang);
  const src = 'ifdef A\ndefine WIDTH 8\nmodule m;\ninclude "foo.svh"\nuvm_component_utils(cls)\nendmodule\nendif';
  const t = p.parse(src);
  function walk(n, d) {
    if (d > 8) return;
    const s = n.isNamed ? '[N]' : '[A]';
    console.log('  '.repeat(d) + s + n.type + (n.isNamed && n.childCount===0 ? ' = "'+src.slice(n.startIndex, n.endIndex)+'"' : ''));
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1);
  }
  walk(t.rootNode, 0);
})().catch(e => console.error(e.message));
