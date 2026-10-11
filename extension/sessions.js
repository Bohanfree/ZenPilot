// IndexedDB keeps full transcripts and user attachments outside storage.local's small quota.
(() => {
  let database, opening;
  function open() {
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("zenpilot-conversations", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("sessions", { keyPath: "id" });
        const entries = db.createObjectStore("entries", { keyPath: "id" });
        entries.createIndex("sessionId", "sessionId");
        db.createObjectStore("meta", { keyPath: "id" });
      };
      request.onerror = () => { opening = null; reject(request.error); };
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => { database.close(); database = null; opening = null; };
        resolve(database);
      };
    });
    return opening;
  }
  async function transaction(names, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode); let result, error;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(error || tx.error || new Error("对话保存失败。"));
      tx.onerror = () => {};
      const set = value => { result = value; };
      const fail = value => { error = value; tx.abort(); };
      try { operation(tx, set, fail); } catch (err) { fail(err); }
    });
  }
  const store = {
    create(title = "新对话") {
      const session = { id: crypto.randomUUID(), title: String(title).slice(0, 80) || "新对话", createdAt: Date.now(), updatedAt: Date.now(), entryCount: 0 };
      return transaction(["sessions"], "readwrite", (tx, set) => { tx.objectStore("sessions").add(session); set(session); });
    },
    list() { return transaction(["sessions"], "readonly", (tx, set) => { tx.objectStore("sessions").getAll().onsuccess = event => set(event.target.result.sort((a, b) => b.updatedAt - a.updatedAt)); }); },
    read(id) {
      return transaction(["sessions", "entries"], "readonly", (tx, set) => {
        const result = { session: null, entries: [] }; set(result);
        tx.objectStore("sessions").get(id).onsuccess = event => { result.session = event.target.result || null; };
        tx.objectStore("entries").index("sessionId").getAll(id).onsuccess = event => { result.entries = event.target.result.sort((a, b) => a.sequence - b.sequence); };
      });
    },
    append(id, message) {
      return transaction(["sessions", "entries"], "readwrite", (tx, set, fail) => {
        const sessions = tx.objectStore("sessions");
        sessions.get(id).onsuccess = event => {
          const session = event.target.result;
          if (!session) { fail(new Error("这段对话已经不存在，请新建对话。")); return; }
          const entry = { ...message, id: crypto.randomUUID(), sessionId: id, sequence: session.entryCount++, createdAt: Date.now() };
          session.updatedAt = entry.createdAt;
          if (message.role === "user" && session.title === "新对话" && !session.manualTitle) session.title = (message.content?.trim() || message.attachments?.[0]?.name || "图片对话").replace(/\s+/g, " ").slice(0, 36);
          tx.objectStore("entries").add(entry); sessions.put(session); set(entry);
        };
      });
    },
    rename(id, title) {
      title = String(title).trim().slice(0, 80);
      if (!title) return Promise.reject(new Error("请输入对话名称。"));
      return transaction(["sessions"], "readwrite", (tx, set, fail) => {
        const sessions = tx.objectStore("sessions"); sessions.get(id).onsuccess = event => {
          const session = event.target.result; if (!session) { fail(new Error("对话不存在。")); return; }
          session.title = title; session.manualTitle = true; sessions.put(session); set(session);
        };
      });
    },
    delete(id) {
      return transaction(["sessions", "entries"], "readwrite", (tx, set) => {
        tx.objectStore("sessions").delete(id);
        const entries = tx.objectStore("entries");
        entries.index("sessionId").openKeyCursor(IDBKeyRange.only(id)).onsuccess = event => {
          const cursor = event.target.result; if (cursor) { entries.delete(cursor.primaryKey); cursor.continue(); }
        };
        set(true);
      });
    },
    async migrate(legacy) {
      const done = await transaction(["meta"], "readonly", (tx, set) => { tx.objectStore("meta").get("legacyMigration").onsuccess = event => set(!!event.target.result); });
      if (done) return;
      // One atomic import: an interrupted migration can safely be retried.
      await transaction(["meta", "sessions", "entries"], "readwrite", (tx, set) => {
        for (const [key, messages] of Object.entries(legacy)) {
          if (!/^history-\d+$/.test(key) || !Array.isArray(messages) || !messages.length) continue;
          const clean = messages.filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string");
          if (!clean.length) continue;
          const id = crypto.randomUUID(), now = Date.now();
          tx.objectStore("sessions").add({ id, title: (clean.find(m => m.role === "user")?.content || "旧版对话").slice(0, 36), createdAt: now, updatedAt: now, entryCount: clean.length });
          clean.forEach((m, sequence) => tx.objectStore("entries").add({ id: crypto.randomUUID(), sessionId: id, role: m.role, content: m.content, sequence, createdAt: now }));
        }
        tx.objectStore("meta").put({ id: "legacyMigration", completedAt: Date.now() }); set(true);
      });
    }
  };
  ZP.sessions = store;
})();
