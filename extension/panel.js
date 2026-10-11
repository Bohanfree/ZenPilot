(() => {
  const $ = id => document.getElementById(id);
  let port, busy = false, boundTab, pending, lastTool, heartbeat, reconnectTimer, reconnecting = false;
  const rendered = new Set();
  const messages = $("conversation");
  const follower = ZP.createTabFollower({ onChange: target, isBusy: () => busy });
  const attachments = ZP.createAttachments({ isBusy: () => busy, onChange: updateSend, report: text => { $("status").textContent = text; } });
  const sessions = ZP.createSessionUI({ isBusy: () => busy || attachments.processing, getWindowId: () => boundTab?.windowId ?? "unknown", renderEntry, clearView, report: text => write(text, "error"), onChange: updateSend });
  const labels = { inspect: "读取页面", click: "点击元素", fill: "填写内容", select: "选择选项", press_key: "按键操作", scroll: "滚动页面", wait_for: "等待页面", navigate: "打开网址", search_web: "DuckDuckGo 搜索", list_tabs: "查看标签页", switch_tab: "绑定标签页", open_tab: "新建标签页", screenshot: "查看截图" };
  function write(text, kind = "assistant", images = []) {
    $("welcome").hidden = true; const el = document.createElement("div"); el.className = `message ${kind}`;
    if (kind === "assistant") { el.classList.add("markdown-body"); el.append(ZP.renderMarkdown(text)); } else el.textContent = text;
    if (images.length) {
      const tray = document.createElement("div"); tray.className = "user-images";
      for (const image of ZP.validateAttachments(images)) {
        const button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-label", `查看图片 ${image.name}`);
        const img = document.createElement("img"); img.src = image.data; img.alt = image.name; button.append(img); button.addEventListener("click", () => attachments.preview(image)); tray.append(button);
      }
      el.append(tray);
    }
    messages.append(el); messages.scrollTop = messages.scrollHeight; return el;
  }
  function clearView() { for (const el of messages.querySelectorAll(".message,.tool")) el.remove(); rendered.clear(); lastTool = null; $("welcome").hidden = false; messages.scrollTop = 0; $("prompt").value = ""; attachments.clear(); $("status").textContent = "准备就绪"; }
  function renderEntry(entry) {
    if (entry.id && rendered.has(entry.id)) return;
    if (entry.id) rendered.add(entry.id);
    if (entry.role !== "tool") { write(entry.content || "", entry.role, entry.attachments || []); return; }
    if (!lastTool || lastTool.dataset.finished) { lastTool = document.createElement("details"); lastTool.className = "tool"; lastTool.append(document.createElement("summary"), document.createElement("pre")); messages.append(lastTool); }
    lastTool.querySelector("summary").textContent = `${labels[entry.name] || entry.name} · ${entry.status === "ok" ? "已返回结果" : "失败"}`;
    lastTool.querySelector("pre").textContent = entry.content; lastTool.dataset.finished = "true";
    if (entry.status === "error") lastTool.classList.add("error");
    messages.scrollTop = messages.scrollHeight;
  }
  function updateSend() { const waiting = busy || attachments.processing || sessions.loading; $("send").disabled = waiting || !sessions.id; $("attach-image").disabled = waiting; $("clear").disabled = waiting; document.querySelector(".footnote").hidden = !attachments.images.length; }
  function setBusy(value) { busy = value; document.body.classList.toggle("task-active", value); $("stop").hidden = !value; $("clear").disabled = value; $("conversation-mode").disabled = value; if (!value) document.querySelector(".target").hidden = true; sessions.setBusy(); updateSend(); if (!value) { $("approval").hidden = true; pending = null; } }
  function target(tab) { boundTab = tab; $("target-title").textContent = tab.title || tab.url || "请选择普通网页"; $("target-title").title = tab.url || ""; }
  function connect() {
    if (port) return;
    port = browser.runtime.connect({ name: "zenpilot-panel" });
    const connection = port;
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (busy && port) { try { port.postMessage({ type: "ping" }); } catch (_) {} } }, 20000);
    port.onMessage.addListener(event => {
      if (event.type === "sync") {
        if (event.running) {
          setBusy(true);
          $("status").textContent = event.browser ? `网页任务 · ${event.step || 1} / ${event.max || "?"} 轮` : "正在思考…";
          document.querySelector(".target").hidden = !event.browser;
          if (event.browser) $("target-label").textContent = "网页任务 · 目标已固定";
          if (Number.isInteger(event.tabId)) void browser.tabs.get(event.tabId).then(target).catch(() => {});
        } else {
          setBusy(false);
          if (reconnecting) $("status").textContent = "后台任务已中断，请检查对话记录";
        }
        reconnecting = false;
        void sessions.syncCurrent().catch(() => {});
      }
      if (event.type === "start") { if (event.tab) target(event.tab); $("status").textContent = "正在思考…"; }
      if (event.type === "browser_enabled") { document.querySelector(".target").hidden = false; $("target-label").textContent = "网页任务 · 目标已固定"; $("status").textContent = "正在处理网页任务"; }
      if (event.type === "target") target(event.tab);
      if (event.type === "progress") { if (event.browser) document.querySelector(".target").hidden = false; $("status").textContent = event.browser ? `网页任务 · ${event.step} / ${event.max} 轮` : "正在思考…"; }
      if (event.type === "entry") { renderEntry(event.entry); void sessions.refresh().catch(() => {}); }
      if (event.type === "assistant") write(event.text);
      if (event.type === "tool") {
        if (event.status === "running") {
          lastTool = document.createElement("details"); lastTool.className = "tool";
          const summary = document.createElement("summary"); summary.textContent = `${labels[event.name] || event.name} · 执行中`;
          const pre = document.createElement("pre"); pre.textContent = JSON.stringify(event.args, null, 2);
          lastTool.append(summary, pre); messages.append(lastTool);
        } else {
          if (!lastTool || lastTool.dataset.finished) { lastTool = document.createElement("details"); lastTool.className = "tool"; lastTool.append(document.createElement("summary"), document.createElement("pre")); messages.append(lastTool); }
          lastTool.querySelector("summary").textContent = `${labels[event.name] || event.name} · ${event.status === "ok" ? "已返回结果" : "失败"}`;
          lastTool.querySelector("pre").textContent = event.summary; lastTool.dataset.finished = "true";
          if (event.status === "error") lastTool.classList.add("error");
        }
        messages.scrollTop = messages.scrollHeight;
      }
      if (event.type === "approval") { pending = event.id; $("approval-detail").textContent = `${labels[event.name] || event.name} · 标签页 ${event.tabId}\n${JSON.stringify(event.args, null, 2)}`; $("approval").hidden = false; $("status").textContent = "等待你确认操作"; }
      if (["done", "stopped", "error"].includes(event.type)) {
        if (event.text) write(event.text, event.type === "error" ? "error" : "note");
        $("status").textContent = event.type === "done" ? (event.reason === "completed" ? "本轮已结束" : "达到步数上限") : event.type === "stopped" ? "已停止" : "需要检查";
        setBusy(false); void sessions.refresh().catch(() => {}); void follower.refresh().catch(() => {});
      }
    });
    port.onDisconnect.addListener(() => {
      if (port !== connection) return;
      clearInterval(heartbeat);
      reconnecting = busy;
      $("status").textContent = "正在重新连接后台任务…";
      port = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { try { connect(); } catch (_) { $("status").textContent = "后台连接失败，请重新打开侧栏"; } }, 1000);
    });
    if (sessions.id) port.postMessage({ type: "attach", sessionId: sessions.id });
  }
  $("conversation-mode").addEventListener("change", () => void browser.storage.local.set({ conversationMode: $("conversation-mode").value }));
  $("settings-toggle").addEventListener("click", () => { $("settings").hidden = !$("settings").hidden; });
  $("settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const settings = { mode: $("api-mode").value, baseUrl: $("base-url").value.trim(), apiKey: $("api-key").value.trim(), model: $("model").value.trim(), maxSteps: ZP.steps($("max-steps").value), auto: $("auto").checked };
      ZP.endpoint(settings);
      await browser.storage.local.set({ settings }); $("settings-status").textContent = "已保存"; $("conversation-mode").title = settings.auto ? "网页操作会自动执行" : "网页操作需要逐步确认";
    } catch (error) { $("settings-status").textContent = error.message; }
  });
  $("chat-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    if (attachments.processing || sessions.loading || !sessions.id) return;
    const text = $("prompt").value.trim(), images = attachments.images.slice(); if (!text && !images.length) return;
    setBusy(true);
    try {
      // Resolve at submission too, even if an activation notification was delayed.
      const tab = await follower.refresh(true).catch(() => boundTab);
      if (!port) connect();
      port.postMessage({ type: "start", text, attachments: images, sessionId: sessions.id, tabId: tab?.id, windowId: tab?.windowId, mode: $("conversation-mode").value });
      $("prompt").value = ""; attachments.clear();
    } catch (error) { setBusy(false); write(error.message, "error"); }
  });
  $("prompt").addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("chat-form").requestSubmit(); } });
  $("stop").addEventListener("click", () => { port?.postMessage({ type: "stop" }); $("status").textContent = "正在停止…"; });
  for (const [id, allow] of [["allow", true], ["deny", false]]) $(id).addEventListener("click", () => { if (pending) port?.postMessage({ type: "approve", id: pending, allow }); pending = null; $("approval").hidden = true; });
  $("clear").addEventListener("click", () => void sessions.create().then(updateSend).catch(error => write(error.message, "error")));
  for (const button of document.querySelectorAll("[data-prompt]")) button.addEventListener("click", () => { $("prompt").value = button.dataset.prompt; $("prompt").focus(); });
  async function init() {
    await follower.refresh().catch(() => {});
    const data = await browser.storage.local.get(["settings", "conversationMode"]);
    const settings = { ...ZP.defaults, ...data.settings };
    $("api-mode").value = settings.mode; $("base-url").value = settings.baseUrl; $("api-key").value = settings.apiKey; $("model").value = settings.model; $("max-steps").value = settings.maxSteps; $("auto").checked = settings.auto;
    $("conversation-mode").title = settings.auto ? "网页操作会自动执行" : "网页操作需要逐步确认";
    $("conversation-mode").value = ["auto", "chat", "browser"].includes(data.conversationMode) ? data.conversationMode : "auto";
    await sessions.init(); updateSend();
    if (!settings.model) $("settings").hidden = false;
    connect();
  }
  void init().catch(error => write(error.message, "error"));
})();
