const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { build } = require('../scripts/build.cjs');
const source = path.join(__dirname, '..', 'extension');
function worker() {
  let messageListener, connectListener;
  const behaviors = [], captured = [];
  const tabs = new Map([[1, { id: 1, windowId: 10, url: 'https://example.com/', status: 'complete' }]]);
  let activeId = 1;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { messageListener = fn; } }, onConnect: { addListener(fn) { connectListener = fn; } }, onInstalled: { addListener() {} } },
    sidePanel: { setPanelBehavior: async value => behaviors.push(value) },
    storage: { local: { get: async () => ({}) } },
    tabs: { get: async id => tabs.get(id), query: async () => [{ id: activeId }], captureVisibleTab: async id => { captured.push(id); return 'data:image/jpeg;base64,abc'; } },
    scripting: { executeScript: async () => [{ result: { text: 'loaded' } }] }
  };
  const ctx = vm.createContext({ chrome, URL, AbortController, DOMException, setTimeout, clearTimeout, console, indexedDB: new IDBFactory(), IDBKeyRange, crypto: require('node:crypto').webcrypto });
  ctx.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(path.join(source, file), 'utf8'), ctx); };
  vm.runInContext(fs.readFileSync(path.join(source, 'service-worker.js'), 'utf8'), ctx);
  const run = { tabId: 1, windowId: 10, allowedTabs: new Set([1]), controller: new AbortController(), emit() {} };
  return { ctx, chrome, run, behaviors, captured, tabs, active: id => { activeId = id; }, message: (...args) => messageListener(...args), connect: port => connectListener(port) };
}
test('Chrome service worker loads without browser or DOM and enables toolbar side panel', () => {
  const s = worker();
  assert.equal(s.ctx.browser, s.chrome);
  assert.equal(s.behaviors[0].openPanelOnActionClick, true);
});
test('Chrome callback messaging preserves the channel for IndexedDB operations', async () => {
  const s = worker();
  let keepOpen;
  const reply = await new Promise(resolve => { keepOpen = s.message({ type: 'sessions:create' }, {}, resolve); });
  assert.equal(keepOpen, true);
  assert.equal(reply.ok, true);
  const read = await new Promise(resolve => s.message({ type: 'sessions:read', id: reply.data.id }, {}, resolve));
  assert.equal(read.data.session.id, reply.data.id);
  assert.equal(s.message({ type: 'unrelated' }, {}, () => assert.fail()), undefined);
});
test('Chrome screenshots only capture the bound visible tab and reject switching during capture', async () => {
  const s = worker();
  const result = await s.ctx.ZP.execute(s.run, 'screenshot', {});
  assert.equal(result.image, 'data:image/jpeg;base64,abc');
  assert.deepEqual(s.captured, [10]);
  s.active(2);
  await assert.rejects(s.ctx.ZP.execute(s.run, 'screenshot', {}), /当前可见/);
  assert.deepEqual(s.captured, [10]);
  s.active(1);
  s.chrome.tabs.captureVisibleTab = async () => { s.active(2); return 'wrong image'; };
  await assert.rejects(s.ctx.ZP.execute(s.run, 'screenshot', {}), /丢弃/);
});
test('worker answers heartbeat traffic without starting a task', () => {
  const s = worker(); let onMessage; const events = [];
  s.connect({ name: 'zenpilot-panel', postMessage: event => events.push(event), onMessage: { addListener(fn) { onMessage = fn; } }, onDisconnect: { addListener() {} } });
  onMessage({ type: 'ping' });
  assert.equal(events[0].type, 'pong');
});
test('navigation waits through temporary about:blank and stays within the task window', async () => {
  const s = worker(); let calls = 0;
  s.chrome.tabs.get = async () => ++calls === 1 ? { id: 1, windowId: 10, url: 'about:blank', status: 'complete' } : s.tabs.get(1);
  assert.equal((await s.ctx.ZP.waitLoad(s.run)).url, 'https://example.com/');
  s.chrome.tabs.get = async () => ({ ...s.tabs.get(1), windowId: 20 });
  await assert.rejects(s.ctx.ZP.waitLoad(s.run), /范围/);
});
test('both browser packages contain correct manifests and all required assets', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zenpilot-build-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const target of ['chrome', 'firefox']) {
    const output = build(target, path.join(temp, target));
    const m = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    const assets = [...Object.values(m.icons), ...(m.background.scripts || [m.background.service_worker]), m.side_panel?.default_path || m.sidebar_action.default_panel];
    for (const asset of assets) assert.ok(fs.existsSync(path.join(output, asset)), asset);
    if (target === 'chrome') {
      assert.equal(m.minimum_chrome_version, '116');
      assert.equal(m.sidebar_action, undefined);
      assert.equal(m.browser_specific_settings, undefined);
      assert.ok(m.permissions.includes('sidePanel'));
      for (const asset of Object.values(m.icons)) assert.equal(fs.readFileSync(path.join(output, asset)).subarray(1, 4).toString(), 'PNG');
    } else assert.equal(m.browser_specific_settings.gecko.id, 'zenpilot@local.browser');
  }
});
