const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.js'))) {
  new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
  console.log(`Syntax OK: ${name}`);
}
for (const name of [...manifest.background.scripts, manifest.sidebar_action.default_panel, ...Object.values(manifest.icons)]) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing manifest asset: ${name}`);
}
const html = fs.readFileSync(path.join(root, 'panel.html'), 'utf8');
for (const [, name] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing sidebar asset: ${name}`);
}
console.log('Manifest assets OK');
