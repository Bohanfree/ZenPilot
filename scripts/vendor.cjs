const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'extension', 'vendor');
fs.mkdirSync(output, { recursive: true });
for (const [source, target] of [
  ['marked/lib/marked.umd.js', 'marked.umd.js'], ['marked/LICENSE.md', 'marked-LICENSE.md'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'], ['dompurify/LICENSE', 'dompurify-LICENSE']
]) fs.copyFileSync(path.join(root, 'node_modules', source), path.join(output, target));
console.log('Bundled Markdown parser, sanitizer and their licenses.');
