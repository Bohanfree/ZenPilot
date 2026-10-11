(() => {
  const property = (type, description, extra = {}) => ({ type, description, ...extra });
  const specs = [
    ["inspect", "Read page text and visible interactive element IDs. Call again after navigation.", { selector: property("string", "Optional CSS scope") }],
    ["click", "Click a visible element and return observed page state. Does not imply task success.", { target: property("string", "Element ID from inspect, e.g. e3; or CSS selector") }, ["target"]],
    ["fill", "Fill an input, textarea or contenteditable. Does not submit.", { target: property("string", "Element ID or CSS selector"), text: property("string", "Text to enter") }, ["target", "text"]],
    ["select", "Select a native dropdown option by value.", { target: property("string", "Element ID or CSS selector"), value: property("string", "Option value") }, ["target", "value"]],
    ["press_key", "Send Enter, Escape or Tab to an element. Synthetic events may be ignored by some sites.", { target: property("string", "Element ID or CSS selector"), key: property("string", "Key", { enum: ["Enter", "Escape", "Tab"] }) }, ["target", "key"]],
    ["scroll", "Scroll page or element vertically.", { direction: property("string", "Direction", { enum: ["up", "down"] }), target: property("string", "Optional scrollable element") }, ["direction"]],
    ["wait_for", "Wait up to 10 seconds for a visible CSS selector or text.", { selector: property("string", "CSS selector"), text: property("string", "Page text to wait for") }],
    ["navigate", "Navigate the task-bound tab and wait for load.", { url: property("string", "HTTP(S) URL") }, ["url"]],
    ["search_web", "Search the web with the default engine DuckDuckGo in the task-bound tab. Use for general web searches unless the user explicitly requests another engine or a specific site's search.", { query: property("string", "Search terms") }, ["query"]],
    ["list_tabs", "List HTTP(S) tabs in the task window; titles and URLs only.", {}],
    ["switch_tab", "Explicitly bind task to another tab in the same window.", { tabId: property("integer", "Tab ID from list_tabs") }, ["tabId"]],
    ["open_tab", "Open URL in a background tab in the task window and bind the task to it.", { url: property("string", "HTTP(S) URL") }, ["url"]],
    ["screenshot", "Capture task tab for a vision-capable model. Image is not saved to history. On Chrome the task tab must be active; ask the user to select it if necessary.", {}]
  ];
  ZP.tools = specs.map(([name, description, properties, required = []]) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }));

  // Serialized into the task tab's isolated extension world, never the page's main world.
  ZP.page = async function (name, args) {
    const visible = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const state = globalThis.__zenpilot ??= { elements: new Map() };
    const roots = () => { const list = [document]; for (let i = 0; i < list.length; i++) for (const el of list[i].querySelectorAll("*")) if (el.shadowRoot) list.push(el.shadowRoot); return list; };
    const find = target => {
      if (!target || typeof target !== "string") throw new Error("缺少目标元素。");
      let el;
      if (/^e\d+$/.test(target)) el = state.elements.get(target);
      else for (const root of roots()) { el = root.querySelector(target); if (el) break; }
      if (!el?.isConnected) throw new Error("目标不存在或已变化，请重新 inspect。");
      if (!visible(el)) throw new Error("目标不可见。");
      if (el.disabled || el.getAttribute("aria-disabled") === "true") throw new Error("目标尚不可操作。");
      return el;
    };
    const snapshot = () => {
      const scope = args.selector ? find(args.selector) : document.body;
      if (!scope) throw new Error("页面尚未就绪。");
      state.elements.clear();
      const elements = [];
      const candidates = args.selector ? [...scope.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")] : roots().flatMap(root => [...root.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")]);
      for (const el of candidates.filter(visible).slice(0, 100)) {
        const id = `e${elements.length + 1}`;
        state.elements.set(id, el);
        const label = el.labels?.[0]?.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || el.name || "";
        elements.push({ id, tag: el.tagName.toLowerCase(), type: el.type, label: label.trim().slice(0, 160), disabled: !!el.disabled, ...(el.tagName === "SELECT" ? { options: [...el.options].map(o => ({ text: o.text, value: o.value })).slice(0, 40) } : {}) });
      }
      // innerText does not include input values (including passwords).
      return { url: location.href, title: document.title, text: (scope.innerText || scope.textContent || "").slice(0, 14000), elements, iframeCount: document.querySelectorAll("iframe").length };
    };
    if (name === "inspect") return snapshot();
    if (name === "wait_for") {
      if (!args.selector && !args.text) throw new Error("请指定等待的元素或文字。");
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        let matches = false;
        try { matches = !!args.selector && visible(find(args.selector)); } catch (_) {}
        if (args.text && document.body?.innerText.includes(args.text)) matches = true;
        if (matches) return snapshot();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error("等待超时，页面未出现预期内容。");
    }
    if (name === "scroll") {
      if (!["up", "down"].includes(args.direction)) throw new Error("滚动方向无效。");
      const el = args.target ? find(args.target) : window;
      el.scrollBy({ top: (args.direction === "up" ? -1 : 1) * innerHeight * 0.75, behavior: "instant" });
    } else {
      const el = find(args.target);
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.focus();
      if (name === "click") el.click();
      else if (name === "fill") {
        if (["password", "file", "hidden"].includes(el.type) || /cc-|password/.test(el.autocomplete || "")) throw new Error("此类敏感输入请手动填写。");
        if (typeof args.text !== "string") throw new Error("输入内容必须是文字。");
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, args.text);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (el.value !== args.text) throw new Error("输入未保留，请检查页面控件。");
        } else if (el.isContentEditable) {
          const range = document.createRange(); range.selectNodeContents(el);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          if (!document.execCommand("insertText", false, args.text)) throw new Error("编辑器不支持直接输入，请手动操作。");
        } else throw new Error("该元素不是输入框。");
      } else if (name === "select") {
        if (!(el instanceof HTMLSelectElement) || ![...el.options].some(o => o.value === args.value && !o.disabled)) throw new Error("下拉选项不存在或不可用。");
        el.value = args.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (name === "press_key") {
        if (!["Enter", "Escape", "Tab"].includes(args.key)) throw new Error("不支持此按键。");
        if (args.key === "Enter" && el.form) el.form.requestSubmit();
        else { for (const type of ["keydown", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, { key: args.key, code: args.key, bubbles: true })); }
      } else throw new Error("未知页面操作。");
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    return { action: name, observed: snapshot(), note: "已执行并读取当前页面；请根据页面内容判断结果。" };
  };
  ZP.inject = async (run, name, args) => {
    ZP.abort(run.controller.signal);
    const tab = await ZP.target(run);
    const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: ZP.page, args: [name, args] });
    if (!results?.[0] || results[0].error) throw new Error(String(results?.[0]?.error || "页面未返回结果。"));
    ZP.abort(run.controller.signal);
    return results[0].result;
  };
  ZP.waitLoad = async run => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      ZP.abort(run.controller.signal);
      // New background tabs may briefly report about:blank while starting load.
      const tab = await browser.tabs.get(run.tabId);
      if (!run.allowedTabs.has(tab.id) || tab.windowId !== run.windowId) throw new Error("标签页已不在任务范围内。");
      if (tab.status === "complete" && /^https?:/.test(tab.url || "")) return tab;
      await ZP.sleep(200, run.controller.signal);
    }
    throw new Error("页面加载超过 20 秒，请检查后重试。");
  };
  ZP.execute = async (run, name, args) => {
    ZP.abort(run.controller.signal);
    if (!ZP.tools.some(t => t.function.name === name)) throw new Error("模型调用了不存在的工具。");
    if (name === "list_tabs") return (await browser.tabs.query({ windowId: run.windowId })).filter(t => /^https?:/.test(t.url || "")).map(t => ({ id: t.id, title: t.title, url: t.url, bound: t.id === run.tabId }));
    if (name === "switch_tab") {
      const tab = await browser.tabs.get(Number(args.tabId));
      if (tab.windowId !== run.windowId) throw new Error("只能选择任务所在窗口的标签页。");
      ZP.assertUrl(tab.url); run.allowedTabs.add(tab.id); run.tabId = tab.id;
      run.emit({ type: "target", tab: { id: tab.id, title: tab.title, url: tab.url } });
      return ZP.inject(run, "inspect", {});
    }
    if (name === "navigate" || name === "open_tab" || name === "search_web") {
      let url;
      if (name === "search_web") {
        if (typeof args.query !== "string" || !args.query.trim()) throw new Error("请输入搜索关键词。");
        const search = new URL("https://duckduckgo.com/");
        search.searchParams.set("q", args.query.trim());
        url = search.href;
      } else url = ZP.assertUrl(args.url).href;
      if (name === "open_tab") { const tab = await browser.tabs.create({ windowId: run.windowId, url, active: false }); run.allowedTabs.add(tab.id); run.tabId = tab.id; }
      else { const tab = await ZP.target(run); await browser.tabs.update(tab.id, { url }); }
      const tab = await ZP.waitLoad(run);
      run.emit({ type: "target", tab: { id: tab.id, title: tab.title, url: tab.url } });
      return ZP.inject(run, "inspect", {});
    }
    if (name === "screenshot") {
      const tab = await ZP.target(run);
      let data;
      if (browser.tabs.captureTab) data = await browser.tabs.captureTab(tab.id, { format: "jpeg", quality: 65 });
      else {
        const [active] = await browser.tabs.query({ active: true, windowId: run.windowId });
        if (active?.id !== tab.id) throw new Error("Chrome 只能截取当前可见标签页，请先切换到任务网页再截图。");
        data = await browser.tabs.captureVisibleTab(run.windowId, { format: "jpeg", quality: 65 });
        const [after] = await browser.tabs.query({ active: true, windowId: run.windowId });
        const current = await ZP.target(run);
        if (after?.id !== tab.id || current.url !== tab.url) throw new Error("截图期间目标网页发生变化，已丢弃截图，请重试。");
      }
      return { image: data, text: `标签页 ${tab.id} 可见区域截图。` };
    }
    try { return await ZP.inject(run, name, args); }
    catch (err) {
      // A click or Enter can destroy its document while navigation succeeds.
      if (["click", "press_key"].includes(name) && /context|document|frame|navigation/i.test(err.message)) {
        await ZP.waitLoad(run);
        return { action: name, observed: await ZP.inject(run, "inspect", {}), note: "操作后发生导航，请检查新页面。" };
      }
      throw err;
    }
  };
})();
