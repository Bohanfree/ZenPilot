// Idle sidebar follows its own window. A running task keeps its existing target.
ZP.createTabFollower = function ({ onChange, isBusy }) {
  let windowId, tabId, revision = 0;
  async function refresh(force = false) {
    if (isBusy() && !force) return;
    const request = ++revision;
    const [tab] = await browser.tabs.query({ active: true, ...(windowId === undefined ? { currentWindow: true } : { windowId }) });
    if (request !== revision || (isBusy() && !force)) return;
    if (tab) { windowId = tab.windowId; tabId = tab.id; onChange(tab); }
    return tab;
  }
  function activated(info) { if (info.windowId === windowId && !isBusy()) void refresh().catch(() => {}); }
  function updated(id, changes) { if (id === tabId && !isBusy() && (changes.url !== undefined || changes.title !== undefined || changes.status === "complete")) void refresh().catch(() => {}); }
  function removed(id) { if (id === tabId && !isBusy()) void refresh().catch(() => {}); }
  browser.tabs.onActivated.addListener(activated);
  browser.tabs.onUpdated.addListener(updated);
  browser.tabs.onRemoved.addListener(removed);
  return { refresh };
};
