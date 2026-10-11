(() => {
  const runs = new Map();
  const portRuns = new Map();
  const sessionOwners = new Map();
  let keepAlive;
  function maintainWorker() {
    if (!browser.sidePanel || typeof setInterval !== "function") return;
    if (runs.size && !keepAlive) keepAlive = setInterval(() => {
      try { void browser.runtime.getPlatformInfo?.(); } catch (_) {}
    }, 20000);
    if (!runs.size && keepAlive) { clearInterval(keepAlive); keepAlive = null; }
  }
  function attach(port, sessionId) {
    const run = sessionOwners.get(sessionId);
    if (!run) { port.postMessage({ type: "sync", running: false }); return; }
    if (portRuns.has(port) && portRuns.get(port) !== run) { port.postMessage({ type: "error", text: "请先停止当前任务。" }); return; }
    if (run.port && run.port !== port) portRuns.delete(run.port);
    run.port = port; portRuns.set(port, run);
    port.postMessage({ type: "sync", running: true, sessionId, step: run.step, max: run.settings?.maxSteps, browser: run.webEnabled, tabId: run.tabId, windowId: run.windowId });
    if (run.pending) port.postMessage(run.pending.event);
  }
  let initializing;
  function ensureSessions() {
    if (!initializing) initializing = browser.storage.local.get(null).then(data => ZP.sessions.migrate(data)).catch(error => { initializing = null; throw error; });
    return initializing;
  }
  browser.runtime.onMessage?.addListener((message, sender, sendResponse) => {
    if (!message?.type?.startsWith("sessions:")) return;
    // Callback response + true works in both Firefox and Chrome 116+.
    void (async () => {
      try {
        await ensureSessions();
        const action = message.type.slice(9); let data;
        if (action === "list") data = await ZP.sessions.list();
        else if (action === "create") data = await ZP.sessions.create();
        else if (action === "read") data = await ZP.sessions.read(message.id);
        else if (action === "rename") data = await ZP.sessions.rename(message.id, message.title);
        else if (action === "delete") {
          if (sessionOwners.has(message.id)) throw new Error("这段对话正在运行，请先停止任务再删除。");
          data = await ZP.sessions.delete(message.id);
        } else throw new Error("未知会话操作。");
        return { ok: true, data };
      } catch (error) { return { ok: false, error: error.message }; }
    })().then(sendResponse);
    return true;
  });
  if (browser.sidePanel) {
    const setupPanel = () => void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
    setupPanel();
    browser.runtime.onInstalled?.addListener(setupPanel);
  } else browser.action.onClicked.addListener(() => browser.sidebarAction.toggle());
  async function approve(run, name, args) {
    if (run.settings.auto || !ZP.mutating.has(name)) return;
    ZP.abort(run.controller.signal);
    const id = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const finish = allowed => {
        run.controller.signal.removeEventListener("abort", stop); run.pending = null;
        if (allowed) resolve(); else reject(new DOMException("操作未获确认，任务已停止", "AbortError"));
      };
      const stop = () => finish(false);
      const event = { type: "approval", id, name, args, tabId: run.tabId };
      run.pending = { id, finish, event };
      run.controller.signal.addEventListener("abort", stop, { once: true });
      run.emit(event);
    });
  }
  async function start(port, msg) {
    if (portRuns.has(port)) { port.postMessage({ type: "error", text: "请先停止当前任务。" }); return; }
    if (typeof msg.sessionId === "string" && sessionOwners.has(msg.sessionId)) { port.postMessage({ type: "error", text: "这段对话正在运行，请先停止任务。" }); return; }
    const run = { id: crypto.randomUUID(), sessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined, port, controller: new AbortController(), pending: null, step: 0, webEnabled: false };
    run.emit = event => { try { run.port?.postMessage(event); } catch (_) {} };
    const emit = run.emit;
    runs.set(run.id, run); portRuns.set(port, run);
    if (run.sessionId) sessionOwners.set(run.sessionId, run);
    maintainWorker();
    async function deliver(entry, fallback) {
      if (run.sessionId) { const saved = await ZP.sessions.append(run.sessionId, entry); emit({ type: "entry", entry: saved }); return true; }
      else if (fallback) emit(fallback);
      return false;
    }
    try {
      if (typeof msg.text !== "string" || msg.text.length > 12000) throw new Error("消息最多 12000 字。");
      const attachments = ZP.validateAttachments(msg.attachments);
      if (!msg.text.trim() && !attachments.length) throw new Error("请输入问题或附加图片。");
      let previous = Array.isArray(msg.history) ? msg.history : [];
      if (run.sessionId) {
        await ensureSessions();
        const saved = await ZP.sessions.read(run.sessionId);
        if (!saved.session) throw new Error("对话不存在，请新建对话。");
        previous = saved.entries;
        await deliver({ role: "user", content: msg.text, attachments });
      }
      const stored = await browser.storage.local.get("settings");
      ZP.abort(run.controller.signal);
      const settings = { ...ZP.defaults, ...stored.settings };
      ZP.endpoint(settings); settings.maxSteps = ZP.steps(settings.maxSteps);
      if (!settings.model.trim()) throw new Error("请先在设置中填写模型名称。");
      const mode = ["chat", "browser"].includes(msg.mode) ? msg.mode : "auto";
      Object.assign(run, { settings, webEnabled: false, allowedTabs: new Set() });
      // Do not even inspect tab metadata for ordinary chat. Browser context is lazy.
      async function enableBrowser() {
        ZP.abort(run.controller.signal);
        let tab;
        if (Number.isInteger(msg.tabId)) { try { tab = await browser.tabs.get(msg.tabId); } catch (_) {} }
        const windowId = tab?.windowId ?? msg.windowId;
        if (!Number.isInteger(windowId)) throw new Error("无法确定网页所在窗口，请重新打开侧栏再试。");
        Object.assign(run, { tabId: tab?.id, windowId, allowedTabs: new Set(tab ? [tab.id] : []), webEnabled: true });
        if (tab) emit({ type: "target", tab: { id: tab.id, title: tab.title, url: tab.url } });
        emit({ type: "browser_enabled" });
        return ZP.prompt(tab);
      }
      emit({ type: "start" });
      const history = ZP.conversationContext(previous, settings.mode);
      const messages = [{ role: "system", content: mode === "browser" ? await enableBrowser() : ZP.chatPrompt + (mode === "chat" ? "\nBrowser tools are disabled for this conversation. Answer normally; if live webpage access is essential, explain that the user can choose auto or browser mode." : "") }, ...history, ZP.userMessage(msg.text, attachments, settings.mode)];
      let consecutiveErrors = 0;
      for (let step = 1; step <= settings.maxSteps; step++) {
        ZP.abort(run.controller.signal);
        run.step = step;
        emit({ type: "progress", step, max: settings.maxSteps, browser: run.webEnabled });
        const tools = run.webEnabled ? ZP.tools : mode === "chat" ? [] : ZP.browserGate;
        const answer = await ZP.request(settings, messages, run.controller.signal, { tools });
        ZP.abort(run.controller.signal);
        if (answer.text) await deliver({ role: "assistant", content: answer.text }, { type: "assistant", text: answer.text });
        if (!answer.calls.length) {
          if (!answer.text) throw new Error("模型返回了空响应，请检查模型是否支持当前接口。");
          emit({ type: "done", reason: "completed" }); return;
        }
        if (settings.mode === "responses") messages.push(...answer.raw); else messages.push(answer.raw);
        for (const call of answer.calls) {
          ZP.abort(run.controller.signal);
          let result;
          try {
            const args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
            if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数格式不正确。");
            if (!tools.some(t => t.function.name === call.name)) throw new Error("模型请求了本轮未开放的工具。");
            if (!run.webEnabled) {
              if (mode === "chat" || call.name !== "use_browser" || typeof args.reason !== "string" || !args.reason.trim()) throw new Error("当前对话尚未启用网页工具。");
              const browserPrompt = await enableBrowser();
              messages[0] = { role: "system", content: browserPrompt };
              ZP.addResult(messages, settings.mode, call, { enabled: true, note: "Browser tools are now available. Inspect the page before acting." });
              continue;
            }
            // Check tool identity before displaying an approval.
            if (!ZP.tools.some(t => t.function.name === call.name)) throw new Error("未知工具。");
            await approve(run, call.name, args);
            ZP.abort(run.controller.signal);
            emit({ type: "tool", name: call.name, args, status: "running" });
            result = await ZP.execute(run, call.name, args);
            ZP.abort(run.controller.signal);
            consecutiveErrors = 0;
            const summary = result.image ? result.text : JSON.stringify(result).slice(0, 1800);
            await deliver({ role: "tool", name: call.name, callId: call.id, status: "ok", content: summary }, { type: "tool", name: call.name, status: "ok", summary });
          } catch (error) {
            if (error.name === "AbortError" || run.controller.signal.aborted) throw error;
            result = { error: error.message };
            consecutiveErrors++;
            await deliver({ role: "tool", name: call.name, callId: call.id, status: "error", content: error.message }, { type: "tool", name: call.name, status: "error", summary: error.message });
          }
          ZP.addResult(messages, settings.mode, call, result);
          if (consecutiveErrors >= 3) throw new Error("连续三次操作失败，已停止。请检查网页状态或缩小任务范围。");
        }
        if (JSON.stringify(messages).length > 12000000) throw new Error("本次任务上下文过大，已停止。请把任务拆成更小的步骤。");
      }
      const text = "已达到本次任务步数上限，请检查结果后继续。";
      await deliver({ role: "note", content: text });
      emit({ type: "done", reason: "limit", ...(run.sessionId ? {} : { text }) });
    } catch (error) {
      const type = error.name === "AbortError" || run.controller.signal.aborted ? "stopped" : "error";
      const text = type === "stopped" ? "任务已停止。" : error.message;
      let saved = false;
      try { saved = await deliver({ role: type === "error" ? "error" : "note", content: text }); } catch (_) {}
      emit({ type, ...(saved ? {} : { text }) });
    } finally {
      runs.delete(run.id);
      if (run.port && portRuns.get(run.port) === run) portRuns.delete(run.port);
      if (sessionOwners.get(run.sessionId) === run) sessionOwners.delete(run.sessionId);
      maintainWorker();
    }
  }
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== "zenpilot-panel") return;
    port.onMessage.addListener(msg => {
      // Port traffic keeps Chrome's worker alive during requests and approvals.
      if (msg.type === "ping") { try { port.postMessage({ type: "pong" }); } catch (_) {} return; }
      if (msg.type === "attach" && typeof msg.sessionId === "string") attach(port, msg.sessionId);
      if (msg.type === "start") void start(port, msg);
      if (msg.type === "stop") portRuns.get(port)?.controller.abort();
      if (msg.type === "approve") { const run = portRuns.get(port); if (run?.pending?.id === msg.id) run.pending.finish(msg.allow === true); }
    });
    port.onDisconnect.addListener(() => {
      const run = portRuns.get(port);
      if (run) { run.port = null; portRuns.delete(port); }
    });
  });
})();
