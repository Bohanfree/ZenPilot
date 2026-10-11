const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  let active = { id: 1, windowId: 7, url: 'about:debugging' }, busy = false;
  const changes = [], events = {}, queries = [];
  const browser = { tabs: {
    query: async options => { queries.push(options); return [active]; },
    onActivated: { addListener(fn) { events.activate = fn; } },
    onUpdated: { addListener(fn) { events.update = fn; } },
    onRemoved: { addListener(fn) { events.remove = fn; } }
  } };
  const context = vm.createContext({ ZP: {}, browser });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'tab-context.js'), 'utf8'), context);
  const follower = context.ZP.createTabFollower({ onChange: tab => changes.push(tab), isBusy: () => busy });
  return { follower, events, changes, queries, browser, active: tab => { active = tab; }, busy: value => { busy = value; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('idle panel automatically follows from a protected page to a normal webpage', async () => {
  const s = setup(); await s.follower.refresh();
  s.active({ id: 2, windowId: 7, url: 'https://example.com' });
  s.events.activate({ tabId: 2, windowId: 7 }); await flush();
  assert.equal(s.changes.at(-1).id, 2); assert.equal(s.queries.at(-1).windowId, 7);
});
test('activation cannot redirect a running task, but next task resolves active tab', async () => {
  const s = setup(); await s.follower.refresh(); s.busy(true);
  s.active({ id: 2, windowId: 7, url: 'https://example.com' });
  s.events.activate({ tabId: 2, windowId: 7 }); await flush();
  assert.equal(s.changes.at(-1).id, 1);
  const target = await s.follower.refresh(true); assert.equal(target.id, 2);
});
test('other window activation is ignored and task ending resumes automatic following', async () => {
  const s = setup(); await s.follower.refresh();
  const count = s.queries.length; s.events.activate({ tabId: 9, windowId: 99 }); await flush();
  assert.equal(s.queries.length, count);
  s.busy(true); s.active({ id: 3, windowId: 7, url: 'https://example.com/next' });
  await s.follower.refresh(); assert.equal(s.changes.at(-1).id, 1);
  s.busy(false); await s.follower.refresh(); assert.equal(s.changes.at(-1).id, 3);
});
test('out-of-order tab queries cannot overwrite a newer page context', async () => {
  const s = setup(); const pending = [];
  s.browser.tabs.query = () => new Promise(resolve => pending.push(resolve));
  const first = s.follower.refresh(), second = s.follower.refresh();
  pending[1]([{ id: 2, windowId: 7, url: 'https://example.com/new' }]); await second;
  pending[0]([{ id: 1, windowId: 7, url: 'https://example.com/old' }]); await first;
  assert.equal(s.changes.length, 1); assert.equal(s.changes[0].id, 2);
});
