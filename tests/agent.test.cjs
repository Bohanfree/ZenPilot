const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
function setup() {
  const tabs = new Map([[1, { id: 1, windowId: 10, url: 'https://example.com/a', status: 'complete' }], [2, { id: 2, windowId: 10, url: 'https://example.com/b', status: 'complete' }], [3, { id: 3, windowId: 20, url: 'https://example.com/c', status: 'complete' }]]);
  const injected = [], ports = [];
  const browser = {
    tabs: { get: async id => { if (!tabs.has(id)) throw new Error('tab closed'); return tabs.get(id); }, query: async () => [...tabs.values()], update: async (id, changes) => Object.assign(tabs.get(id), changes) },
    scripting: { executeScript: async options => { injected.push(options.target.tabId); return [{ result: { text: 'page state' } }]; } },
    action: { onClicked: { addListener() {} } }, sidebarAction: { toggle() {} },
    storage: { local: { get: async () => ({ settings: { model: 'test-model', auto: true } }) } },
    runtime: { onConnect: { addListener(fn) { ports.push(fn); } } }
  };
  const context = vm.createContext({ browser, URL, Set, Map, console, setTimeout, clearTimeout, AbortController, DOMException, indexedDB: new IDBFactory(), IDBKeyRange, crypto: require('node:crypto').webcrypto });
  for (const file of ['core.js', 'chat-content.js', 'sessions.js', 'tools.js', 'provider.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8'), context);
  const run = { tabId: 1, windowId: 10, allowedTabs: new Set([1]), controller: new AbortController(), emit() {} };
  return { context, browser, run, injected, tabs, ports };
}
test('page actions remain on the bound tab even when active tab changes', async () => {
  const s = setup(); s.browser.tabs.query = async () => [s.tabs.get(2)];
  await s.context.ZP.execute(s.run, 'click', { target: 'e1' });
  assert.deepEqual(s.injected, [1]);
});

test('default web search uses DuckDuckGo and safely encodes terms on the bound tab', async () => {
  const s = setup();
  const query = ' Zen 浏览器 & privacy #tips? ';
  await s.context.ZP.execute(s.run, 'search_web', { query });
  const url = new URL(s.tabs.get(1).url);
  assert.equal(url.origin, 'https://duckduckgo.com');
  assert.equal(url.searchParams.get('q'), query.trim());
  assert.equal(url.hash, '');
  assert.equal(s.tabs.get(2).url, 'https://example.com/b');
  assert.deepEqual(s.injected, [1]);
  assert.ok(s.context.ZP.mutating.has('search_web'));
  for (const query of ['', '   ', null, 42]) {
    await assert.rejects(s.context.ZP.execute(s.run, 'search_web', { query }), /关键词/);
  }
  assert.deepEqual(s.injected, [1]);
});
test('explicit switch rebinds task, but cannot cross window boundaries', async () => {
  const s = setup(); await s.context.ZP.execute(s.run, 'switch_tab', { tabId: 2 });
  assert.equal(s.run.tabId, 2); assert.deepEqual(s.injected, [2]);
  await assert.rejects(s.context.ZP.execute(s.run, 'switch_tab', { tabId: 3 }), /窗口/);
});
test('abort prevents any further page mutation', async () => {
  const s = setup(); s.run.controller.abort();
  await assert.rejects(s.context.ZP.execute(s.run, 'click', { target: 'e1' }), { name: 'AbortError' });
  assert.deepEqual(s.injected, []);
});
test('browser protected URLs and unscoped tab access are rejected', async () => {
  const s = setup(); await assert.rejects(s.context.ZP.target(s.run, 2), /范围/);
  s.tabs.get(1).url = 'about:config';
  await assert.rejects(s.context.ZP.execute(s.run, 'inspect', {}), /HTTP/);
  assert.deepEqual(s.injected, []);
});
test('API credentials are only allowed at HTTPS or loopback endpoints', () => {
  const { context: { ZP } } = setup();
  assert.throws(() => ZP.endpoint({ baseUrl: 'http://example.com/v1' }), /HTTPS/);
  assert.throws(() => ZP.endpoint({ baseUrl: 'https://user:secret@example.com/v1' }), /地址/);
  assert.equal(ZP.endpoint({ baseUrl: 'http://localhost:1234/v1', mode: 'chat' }), 'http://localhost:1234/v1/chat/completions');
  assert.equal(ZP.endpoint({ baseUrl: 'https://example.com/v1/', mode: 'responses' }), 'https://example.com/v1/responses');
});
test('screenshot is sent transiently in both API formats', () => {
  const { context: { ZP } } = setup();
  const chat = [], responses = [], call = { id: 'call-1' }, result = { image: 'data:image/jpeg;base64,abc', text: 'Screenshot' };
  ZP.addResult(chat, 'chat', call, result); ZP.addResult(responses, 'responses', call, result);
  assert.equal(chat[0].role, 'tool'); assert.equal(chat[1].content[1].image_url.url, result.image);
  assert.equal(responses[0].type, 'function_call_output'); assert.equal(responses[1].content[1].type, 'input_image');
});
test('disconnecting one sidebar does not abort another sidebar task', async () => {
  const s = setup(); const pendingRequests = [];
  s.context.ZP.request = async (settings, messages, signal) => new Promise((resolve, reject) => { pendingRequests.push(signal); signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError'))); });
  function panel(tabId) {
    let onMessage, onDisconnect;
    const port = { name: 'zenpilot-panel', postMessage() {}, onMessage: { addListener(fn) { onMessage = fn; } }, onDisconnect: { addListener(fn) { onDisconnect = fn; } } };
    s.ports[0](port); onMessage({ type: 'start', text: 'inspect page', tabId });
    return () => onDisconnect();
  }
  const disconnectOne = panel(1), disconnectTwo = panel(3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingRequests.length, 2);
  disconnectOne(); assert.equal(pendingRequests[0].aborted, true); assert.equal(pendingRequests[1].aborted, false);
  disconnectTwo();
});
test('step cap is bounded and malformed values are rejected', () => {
  const { context: { ZP } } = setup();
  assert.equal(ZP.steps('20'), 20);
  for (const value of [0, 61, 2.5, 'bad']) assert.throws(() => ZP.steps(value), /1–60/);
});
test('stopping during settings load cancels startup before any API request', async () => {
  const s = setup(); let release;
  s.browser.storage.local.get = () => new Promise(resolve => { release = resolve; });
  let requests = 0; s.context.ZP.request = async () => { requests++; };
  let listener; const events = [];
  const port = { name: 'zenpilot-panel', postMessage(event) { events.push(event); }, onMessage: { addListener(fn) { listener = fn; } }, onDisconnect: { addListener() {} } };
  s.ports[0](port); listener({ type: 'start', text: 'fill form', tabId: 1 }); listener({ type: 'stop' });
  release({ settings: { model: 'test' } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0); assert.ok(events.some(e => e.type === 'stopped'));
});
function pageFixture() {
  const s = setup();
  class Element {
    constructor(tag, type) { this.tagName = tag; this.type = type; this.isConnected = true; this.disabled = false; this.innerText = tag; this.name = ''; this.events = []; }
    getBoundingClientRect() { return { width: 100, height: 30 }; }
    getAttribute() { return null; }
    scrollIntoView() {}
    focus() {}
    dispatchEvent(event) { this.events.push(event.type); }
    click() { this.clicked = true; }
  }
  class Input extends Element { get value() { return this._value || ''; } set value(value) { this._value = value; } }
  class Textarea extends Input {}
  class Select extends Element {}
  const input = new Input('INPUT', 'text'), button = new Element('BUTTON'), select = new Select('SELECT');
  select.options = [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }];
  const nodes = [input, button, select];
  const doc = { title: 'Fixture', body: { innerText: 'Form fixture' }, querySelectorAll: selector => selector === 'iframe' ? [] : nodes, querySelector: selector => ({ '#input': input, '#button': button, '#select': select })[selector] };
  Object.assign(s.context, { document: doc, location: { href: 'https://example.com/form' }, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select, Event: class { constructor(type) { this.type = type; } }, innerHeight: 800 });
  return { ...s, input, button, select };
}
test('DOM fill uses native setter and dispatches input/change without submitting', async () => {
  const s = pageFixture(); await s.context.ZP.page('inspect', {});
  const result = await s.context.ZP.page('fill', { target: 'e1', text: 'Alice' });
  assert.equal(s.input.value, 'Alice'); assert.deepEqual(s.input.events, ['input', 'change']);
  assert.equal(result.observed.title, 'Fixture'); assert.equal(s.button.clicked, undefined);
});
test('DOM select rejects absent options and accepts an existing option', async () => {
  const s = pageFixture();
  await assert.rejects(s.context.ZP.page('select', { target: '#select', value: 'missing' }), /选项/);
  await s.context.ZP.page('select', { target: '#select', value: 'b' });
  assert.equal(s.select.value, 'b'); assert.deepEqual(s.select.events, ['input', 'change']);
});
test('DOM actions reject disabled, stale and password fields before changing them', async () => {
  const s = pageFixture(); await s.context.ZP.page('inspect', {});
  s.input.type = 'password'; await assert.rejects(s.context.ZP.page('fill', { target: 'e1', text: 'secret' }), /敏感/);
  s.button.disabled = true; await assert.rejects(s.context.ZP.page('click', { target: 'e2' }), /不可操作/);
  s.button.disabled = false; s.button.isConnected = false; await assert.rejects(s.context.ZP.page('click', { target: 'e2' }), /变化/);
  assert.equal(s.input.value, ''); assert.equal(s.button.clicked, undefined);
});
async function conversation(s, message, replies) {
  const events = [], requests = []; let listener, finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const port = { name: 'zenpilot-panel', postMessage(event) { events.push(event); if (['done', 'error', 'stopped'].includes(event.type)) finish(); }, onMessage: { addListener(fn) { listener = fn; } }, onDisconnect: { addListener() {} } };
  s.context.ZP.request = async (settings, messages, signal, options) => {
    requests.push({ messages: JSON.parse(JSON.stringify(messages)), options });
    const reply = replies.shift(); if (!reply) throw new Error('No mocked reply');
    return { text: reply.text || '', calls: reply.calls || [], raw: { role: 'assistant', content: reply.text || null } };
  };
  s.ports[0](port); listener({ type: 'start', text: 'Explain Zen browser features', ...message });
  await completed; return { events, requests };
}
test('ordinary conversation works on internal pages without reading tab metadata or using page tools', async () => {
  const s = setup(); s.browser.tabs.get = async () => { throw new Error('Ordinary chat must not access tabs'); };
  const result = await conversation(s, { tabId: 1 }, [{ text: '**Zen Mods** are interface customizations.' }]);
  assert.ok(result.events.some(e => e.type === 'done')); assert.deepEqual(s.injected, []);
  assert.equal(result.requests[0].options.tools[0].function.name, 'use_browser');
  assert.ok(!JSON.stringify(result.requests[0].messages).includes('https://example.com'));
  assert.ok(!result.events.some(e => ['tool', 'browser_enabled'].includes(e.type)));
});
test('explicit pure chat exposes no browser tools and does not require a target tab', async () => {
  const s = setup();
  const result = await conversation(s, { mode: 'chat' }, [{ text: 'Hello!' }]);
  assert.equal(result.requests[0].options.tools.length, 0);
  assert.ok(result.events.some(e => e.type === 'done')); assert.deepEqual(s.injected, []);
});
test('a requested webpage task unlocks tools lazily and stays on the selected tab', async () => {
  const s = setup();
  const result = await conversation(s, { tabId: 2, text: 'Read this page' }, [
    { calls: [{ id: 'gate', name: 'use_browser', arguments: '{"reason":"User asks to read current page"}' }] },
    { calls: [{ id: 'read', name: 'inspect', arguments: '{}' }] },
    { text: 'Here is the page summary.' }
  ]);
  assert.equal(result.requests[0].options.tools.length, 1);
  assert.ok(result.requests[1].options.tools.some(t => t.function.name === 'inspect'));
  assert.deepEqual(s.injected, [2]); assert.ok(result.events.some(e => e.type === 'browser_enabled'));
});
test('hallucinated browser calls cannot bypass pure chat mode', async () => {
  const s = setup();
  const result = await conversation(s, { mode: 'chat', tabId: 1 }, [
    { calls: [{ id: 'unexpected', name: 'click', arguments: '{"target":"e1"}' }] },
    { text: 'I can explain that without accessing the page.' }
  ]);
  assert.deepEqual(s.injected, []); assert.ok(!result.events.some(e => e.type === 'browser_enabled'));
});
test('both API formats omit tools when pure chat is requested', async () => {
  for (const mode of ['chat', 'responses']) {
    const s = setup(); let body;
    s.context.fetch = async (url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => mode === 'responses' ? { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }] } : { choices: [{ message: { content: 'Hi' } }] } }; };
    const answer = await s.context.ZP.request({ mode, model: 'mock', baseUrl: 'https://example.com/v1', apiKey: '' }, [{ role: 'user', content: 'Hi' }], new AbortController().signal, { tools: [] });
    assert.equal(answer.text, 'Hi'); assert.equal(body.tools, undefined); assert.equal(body.parallel_tool_calls, undefined);
  }
});
test('image-only messages use vision content and stay in pure chat', async () => {
  const s = setup();
  const image = { name: 'test.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8HwQACfsD/Qpo2X0AAAAASUVORK5CYII=' };
  const result = await conversation(s, { mode: 'chat', text: '', attachments: [image] }, [{ text: 'This image contains one pixel.' }]);
  const message = result.requests[0].messages.at(-1);
  assert.equal(message.content[1].type, 'image_url'); assert.equal(result.requests[0].options.tools.length, 0);
  assert.deepEqual(s.injected, []); assert.ok(result.events.some(e => e.type === 'done'));
});
test('background durably saves user and assistant messages before reporting completion', async () => {
  const s = setup(), session = await s.context.ZP.sessions.create();
  const result = await conversation(s, { sessionId: session.id, mode: 'chat', text: 'My saved question' }, [{ text: 'My saved answer' }]);
  const saved = await s.context.ZP.sessions.read(session.id);
  assert.equal(saved.entries.length, 2); assert.equal(saved.entries[0].content, 'My saved question'); assert.equal(saved.entries[1].content, 'My saved answer');
  assert.equal(result.events.filter(e => e.type === 'entry').length, 2);
});
test('closing a sidebar retains its user message and records the interruption', async () => {
  const s = setup(), session = await s.context.ZP.sessions.create();
  let messageListener, disconnect, finish, entered;
  const completed = new Promise(resolve => { finish = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  s.context.ZP.request = async (settings, messages, signal) => new Promise((resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError'))); });
  const port = { name: 'zenpilot-panel', postMessage(event) { if (event.type === 'stopped') finish(); }, onMessage: { addListener(fn) { messageListener = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } } };
  s.ports[0](port); messageListener({ type: 'start', text: 'Keep this question', sessionId: session.id, mode: 'chat' });
  await started; disconnect(); await completed;
  const saved = await s.context.ZP.sessions.read(session.id);
  assert.equal(saved.entries[0].content, 'Keep this question'); assert.equal(saved.entries.at(-1).role, 'note');
});
