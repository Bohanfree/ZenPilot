// UI preview only: the real extension uses Firefox's browser APIs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'extension');
const demoMarkdown = ['**Zen Mods** 是 Zen 浏览器的界面定制模块。普通问题可以直接回答，无需读取网页。', '', '### 主要用途', '- **调整界面**：修改标签栏与侧栏。', '- **精简显示**：隐藏不常用的按钮。', '', '| 对话方式 | 网页访问 |', '| --- | --- |', '| 自动判断 | 需要时才启用 |', '| 只聊天 | 不开放网页工具 |', '', '```javascript', 'const mode = "chat";', 'console.log(mode);', '```'].join('\n');
const mock = `
globalThis.browser={
tabs:{query:async()=>[{id:1,windowId:1,title:'示例网页 · ZenPilot 界面预览',url:'https://example.com'}],onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
storage:{local:{get:async keys=>{const data=JSON.parse(localStorage.getItem('preview-settings')||'{}');data.settings??={model:'preview-model'};if(keys===null)return data;return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,data[key]]));},set:async values=>{const data=JSON.parse(localStorage.getItem('preview-settings')||'{}');Object.assign(data,values);localStorage.setItem('preview-settings',JSON.stringify(data));}}},
runtime:{sendMessage:async message=>{try{await ZP.sessions.migrate(await browser.storage.local.get(null));const action=message.type.slice(9);const data=action==='list'?await ZP.sessions.list():action==='create'?await ZP.sessions.create():action==='read'?await ZP.sessions.read(message.id):action==='rename'?await ZP.sessions.rename(message.id,message.title):await ZP.sessions.delete(message.id);return {ok:true,data};}catch(error){return {ok:false,error:error.message}}},connect:()=>{let receive;return {onMessage:{addListener(fn){receive=fn}},onDisconnect:{addListener(){}},postMessage(message){if(message.type==='start')void(async()=>{receive({type:'start'});const user=await ZP.sessions.append(message.sessionId,{role:'user',content:message.text,attachments:message.attachments||[]});receive({type:'entry',entry:user});const reply=await ZP.sessions.append(message.sessionId,{role:'assistant',content:${JSON.stringify(demoMarkdown)}});receive({type:'entry',entry:reply});receive({type:'done',reason:'completed'});})();}}}}
};`;
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/preview.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(mock); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/panel.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    let body = fs.readFileSync(file);
    if (file.endsWith('.html')) body = body.toString().replace('</head>', '<style>body{position:relative;width:min(100%,420px);margin:auto;border-left:1px solid var(--line);border-right:1px solid var(--line)}</style></head>').replace('<script src="core.js">', '<script src="preview.js"></script><script src="core.js">').replace('<script src="chat-content.js"></script>', '<script src="chat-content.js"></script><script src="sessions.js"></script>');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(body);
  } catch (_) { res.writeHead(404); res.end(); }
}).listen(8766, '127.0.0.1', () => console.log('UI preview: http://127.0.0.1:8766 (mock browser, no model requests)'));
