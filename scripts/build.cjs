const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function build(target, destination = path.join(root, 'build', target)) {
  if (!['chrome', 'firefox'].includes(target)) throw new Error('Unknown browser target');
  fs.mkdirSync(destination, { recursive: true });
  const source = path.join(root, 'extension');
  for (const name of fs.readdirSync(source)) {
    if (name !== 'manifest.json') fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (target === 'chrome') {
    delete manifest.browser_specific_settings;
    delete manifest.sidebar_action;
    manifest.description = '在 Chrome 侧栏中聊天、阅读网页、点击、填表并完成任务。';
    manifest.minimum_chrome_version = '116';
    manifest.permissions.push('sidePanel');
    manifest.background = { service_worker: 'service-worker.js' };
    manifest.side_panel = { default_path: 'panel.html' };
    manifest.icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
    manifest.action.default_icon = manifest.icons;
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return destination;
}
module.exports = { build };
if (require.main === module) for (const target of ['chrome', 'firefox']) console.log(build(target));
