const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
function fixture() {
  const dom = new JSDOM('<!doctype html><main></main>', { runScripts: 'outside-only', url: 'https://extension.example/panel.html' });
  const window = dom.window; window.ZP = {};
  for (const file of ['vendor/marked.umd.js', 'vendor/purify.min.js', 'markdown.js']) window.eval(fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8'));
  const render = text => { const main = window.document.querySelector('main'); main.replaceChildren(window.ZP.renderMarkdown(text)); return main; };
  return { dom, window, render };
}
test('Chinese replies render emphasis, paragraphs and nested lists', () => {
  const { dom, render } = fixture();
  const main = render('**Zen Mods** 是界面定制。\n\n主要用途：\n- **调整界面**：修改标签栏。\n  - 侧栏\n- *精简显示*');
  assert.equal(main.querySelectorAll('strong').length, 2);
  assert.equal(main.querySelectorAll('ul ul').length, 1); assert.equal(main.querySelector('em').textContent, '精简显示');
  assert.ok(!main.textContent.includes('**Zen Mods**')); dom.window.close();
});
test('Chinese bold markers render next to CJK text and punctuation', () => {
  const { dom, render } = fixture();
  const main = render('标题为**《Mac 软件代下》**，作者提供下载服务。\n\n- **如何委托：**告知作者软件名称或提供软件链接。\n- **积分说明：**帖子标注服务价格。\n\n免费购买了 123Mac 和 ma*ked 站的会员。\n\n\`**代码示例**\`');
  assert.deepEqual([...main.querySelectorAll('strong')].map(node => node.textContent), ['《Mac 软件代下》', '如何委托：', '积分说明：']);
  assert.ok(!main.textContent.includes('**《Mac 软件代下》**'));
  assert.ok(main.textContent.includes('ma*ked'));
  assert.equal(main.querySelector('code').textContent, '**代码示例**');
  dom.window.close();
});
test('code preserves indentation, adds language and a working copy button', async () => {
  const { dom, window, render } = fixture(); let copied;
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
  const main = render('```javascript\nconst value = 1;\n  console.log(value);\n```');
  assert.equal(main.querySelector('.code-toolbar span').textContent, 'javascript');
  main.querySelector('button').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, 'const value = 1;\n  console.log(value);\n'); assert.equal(main.querySelector('button').textContent, '已复制');
  window.close();
});
test('tables use a scroll container and preserve header and cells', () => {
  const { dom, render } = fixture();
  const main = render('| 功能 | 说明 |\n| --- | --- |\n| 聊天 | 无需网页 |');
  assert.ok(main.querySelector('.table-scroll table')); assert.equal(main.querySelectorAll('th').length, 2); assert.equal(main.querySelectorAll('td').length, 2);
  dom.window.close();
});
test('raw HTML, executable links and remote images cannot become active content', () => {
  const { dom, window, render } = fixture();
  const main = render('<script>window.bad=true</script>\n\n<img src="https://tracker.example/x" onerror="alert(1)">\n\n[bad](javascript:alert%281%29)\n\n![tracking](https://tracker.example/y)\n\n[good](https://example.com)');
  assert.equal(main.querySelectorAll('script,img,iframe,svg,style').length, 0); assert.equal(window.bad, undefined);
  for (const link of main.querySelectorAll('a')) { assert.ok(!link.href.startsWith('javascript:')); assert.equal(link.rel, 'noopener noreferrer'); }
  assert.equal(main.querySelector('a[href="https://example.com"]').target, '_blank'); dom.window.close();
});
test('task checkboxes are inert text instead of form inputs', () => {
  const { dom, render } = fixture();
  const main = render('- [x] 已完成\n- [ ] 待完成');
  assert.equal(main.querySelectorAll('input').length, 0);
  assert.equal(main.querySelectorAll('.task-checkbox').length, 2);
  assert.ok(main.textContent.includes('☑')); assert.ok(main.textContent.includes('☐'));
  dom.window.close();
});
