ZP.createSessionUI = function ({ isBusy, getWindowId, renderEntry, clearView, report, onChange }) {
  const $ = id => document.getElementById(id);
  let activeId, items = [], loading = false, creating = false, revision = 0;
  async function request(action, fields = {}) {
    const result = await browser.runtime.sendMessage({ type: `sessions:${action}`, ...fields });
    if (!result?.ok) throw new Error(result?.error || "无法读取对话，请重新打开侧栏。");
    return result.data;
  }
  function renderList() {
    const filter = $("history-search").value.trim().toLowerCase();
    $("session-list").replaceChildren();
    for (const item of items.filter(item => item.title.toLowerCase().includes(filter))) {
      const button = document.createElement("button"); button.type = "button"; button.className = "session-item" + (item.id === activeId ? " selected" : ""); button.disabled = isBusy() || loading || creating;
      const title = document.createElement("strong"); title.textContent = item.title;
      const date = document.createElement("small"); date.textContent = `${new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${item.entryCount} 条记录`;
      button.append(title, date); button.addEventListener("click", () => void load(item.id).catch(error => report(error.message)));
      $("session-list").append(button);
    }
    const current = items.find(item => item.id === activeId);
    $("session-title").textContent = current?.title || "新对话";
    $("history-toggle").title = `历史对话 · ${current?.title || "新对话"}`;
    if (document.activeElement !== $("rename-title")) $("rename-title").value = current?.title || "";
    for (const id of ["history-new", "rename-save", "delete-session", "confirm-delete"]) $(id).disabled = isBusy() || loading || creating || !activeId;
    onChange?.();
  }
  async function refresh() { items = await request("list"); renderList(); }
  async function syncCurrent() {
    if (!activeId) return;
    const id = activeId, data = await request("read", { id });
    if (activeId !== id || !data.session) return;
    for (const entry of data.entries) renderEntry(entry);
    await refresh();
  }
  async function load(id) {
    if (isBusy() || loading) return;
    loading = true; renderList(); const current = ++revision;
    try {
      const data = await request("read", { id });
      if (!data.session) throw new Error("这段对话已被删除，请选择其他对话。");
      if (current !== revision) return;
      activeId = id; clearView(); for (const entry of data.entries) renderEntry(entry);
      await browser.storage.local.set({ [`active-session-${getWindowId()}`]: activeId });
      $("history-panel").hidden = true; $("delete-confirmation").hidden = true;
    } finally { loading = false; await refresh(); }
  }
  async function create() {
    if (isBusy() || loading || creating) return;
    creating = true; renderList();
    try { const session = await request("create"); await refresh(); await load(session.id); }
    finally { creating = false; renderList(); }
  }
  $("history-toggle").addEventListener("click", () => { $("history-panel").hidden = !$("history-panel").hidden; if (!$("history-panel").hidden) void refresh().catch(error => report(error.message)); });
  $("history-close").addEventListener("click", () => { $("history-panel").hidden = true; });
  $("history-search").addEventListener("input", renderList);
  $("history-new").addEventListener("click", () => void create().catch(error => report(error.message)));
  $("rename-form").addEventListener("submit", event => { event.preventDefault(); if (!isBusy() && activeId) void request("rename", { id: activeId, title: $("rename-title").value }).then(refresh).catch(error => report(error.message)); });
  $("delete-session").addEventListener("click", () => { if (!isBusy()) $("delete-confirmation").hidden = false; });
  $("cancel-delete").addEventListener("click", () => { $("delete-confirmation").hidden = true; });
  $("confirm-delete").addEventListener("click", async () => {
    if (isBusy() || !activeId) return;
    try { await request("delete", { id: activeId }); activeId = undefined; await refresh(); if (items.length) await load(items[0].id); else await create(); }
    catch (error) { report(error.message); }
  });
  return {
    get id() { return activeId; }, get loading() { return loading || creating; }, refresh, syncCurrent, create,
    setBusy() { renderList(); },
    async init() {
      await refresh();
      const key = `active-session-${getWindowId()}`, saved = await browser.storage.local.get(key);
      const id = items.find(item => item.id === saved[key])?.id || items[0]?.id;
      if (id) await load(id); else await create();
    }
  };
};
