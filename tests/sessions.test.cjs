const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const crypto = require('node:crypto').webcrypto;
function setup(indexedDB = new IDBFactory()) {
  const context = vm.createContext({ ZP: {}, indexedDB, IDBKeyRange, crypto, Date, console });
  for (const file of ['chat-content.js', 'sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8'), context);
  return { store: context.ZP.sessions, ZP: context.ZP, indexedDB };
}
const image = { name: 'test.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8HwQACfsD/Qpo2X0AAAAASUVORK5CYII=' };
test('full transcripts and user images survive another database connection', async () => {
  const s = setup(), session = await s.store.create();
  for (let i = 0; i < 25; i++) await s.store.append(session.id, { role: i % 2 ? 'assistant' : 'user', content: `Message ${i}`, ...(i === 0 ? { attachments: [image] } : {}) });
  const restored = await setup(s.indexedDB).store.read(session.id);
  assert.equal(restored.entries.length, 25); assert.equal(restored.entries[0].attachments[0].data, image.data);
  assert.equal(restored.session.title, 'Message 0');
});
test('concurrent append operations retain unique ordered entries', async () => {
  const { store } = setup(), session = await store.create();
  await Promise.all(Array.from({ length: 15 }, (_, i) => store.append(session.id, { role: 'assistant', content: String(i) })));
  const saved = await store.read(session.id);
  assert.equal(saved.entries.length, 15); assert.equal(new Set(saved.entries.map(e => e.sequence)).size, 15); assert.equal(saved.session.entryCount, 15);
});
test('rename stays intact and deletion removes the transcript and images', async () => {
  const { store } = setup(), session = await store.create();
  await store.rename(session.id, '图片分析'); await store.append(session.id, { role: 'user', content: 'Describe this', attachments: [image] });
  assert.equal((await store.read(session.id)).session.title, '图片分析');
  await store.delete(session.id); const saved = await store.read(session.id);
  assert.equal(saved.session, null); assert.equal(saved.entries.length, 0); assert.equal((await store.list()).length, 0);
});
test('legacy recent messages migrate once without importing unrelated settings', async () => {
  const { store } = setup();
  const legacy = { 'history-7': [{ role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' }], settings: { apiKey: 'secret' } };
  await store.migrate(legacy); await store.migrate(legacy);
  const sessions = await store.list(); assert.equal(sessions.length, 1);
  const saved = await store.read(sessions[0].id); assert.equal(saved.entries.length, 2); assert.ok(!JSON.stringify(saved).includes('secret'));
});
test('user attachment format works in both APIs without requiring browser tools', () => {
  const { ZP } = setup();
  const chat = ZP.userMessage('', [image], 'chat'), responses = ZP.userMessage('What is this?', [image], 'responses');
  assert.equal(chat.content[1].type, 'image_url'); assert.equal(chat.content[1].image_url.url, image.data);
  assert.equal(responses.content[1].type, 'input_image'); assert.equal(responses.content[1].image_url, image.data);
  assert.throws(() => ZP.validateAttachments([{ data: 'data:image/svg+xml;base64,PHN2Zz4=' }]), /无效/);
  assert.throws(() => ZP.validateAttachments(Array(5).fill(image)), /4/);
});
test('model context is bounded while the saved transcript remains complete', () => {
  const { ZP } = setup();
  const entries = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Message ${i}` }));
  const context = ZP.conversationContext(entries, 'chat');
  assert.equal(context.length, 20); assert.equal(entries.length, 50); assert.equal(context.at(-1).content, 'Message 49');
});
