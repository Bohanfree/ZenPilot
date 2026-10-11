(() => {
  const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const parser = new marked.Marked({ gfm: true, breaks: true, extensions: [{
    name: "cjkStrong", level: "inline",
    start: source => source.indexOf("**"),
    tokenizer(source) {
      const match = /^\*\*([^\n*]+?)\*\*/.exec(source);
      if (!match || !/[\u3400-\u9fff]/u.test(match[1]) || /^\s|\s$/.test(match[1])) return;
      return { type: "strong", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
    }
  }], renderer: {
    html: token => escape(token.text),
    image: token => `<span class="image-description">${escape(token.text || "图片")}</span>`,
    checkbox: token => `<span class="task-checkbox">${token.checked ? "☑" : "☐"}</span>`
  } });
  ZP.renderMarkdown = function (source) {
    const fragment = DOMPurify.sanitize(parser.parse(String(source)), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "code", "pre", "blockquote", "hr", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "span"],
      ALLOWED_ATTR: ["href", "title", "class", "start", "colspan", "rowspan"],
      ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
    });
    for (const link of fragment.querySelectorAll("a")) {
      const href = link.getAttribute("href") || "";
      try { if (!["https:", "http:", "mailto:"].includes(new URL(href).protocol)) throw new Error(); }
      catch (_) { link.removeAttribute("href"); }
      link.target = "_blank"; link.rel = "noopener noreferrer";
    }
    for (const table of fragment.querySelectorAll("table")) {
      const wrap = document.createElement("div"); wrap.className = "table-scroll"; wrap.tabIndex = 0; wrap.setAttribute("aria-label", "可横向滚动的表格");
      table.replaceWith(wrap); wrap.append(table);
    }
    for (const pre of fragment.querySelectorAll("pre")) {
      const code = pre.querySelector("code"); if (!code) continue;
      const language = [...code.classList].find(name => name.startsWith("language-"))?.slice(9) || "代码";
      const wrap = document.createElement("div"); wrap.className = "code-block";
      const bar = document.createElement("div"); bar.className = "code-toolbar";
      const label = document.createElement("span"); label.textContent = language;
      const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "复制"; copy.setAttribute("aria-label", "复制代码");
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(code.textContent); copy.textContent = "已复制"; }
        catch (_) { copy.textContent = "复制失败"; }
        setTimeout(() => { copy.textContent = "复制"; }, 1600);
      });
      bar.append(label, copy); pre.replaceWith(wrap); wrap.append(bar, pre);
    }
    return fragment;
  };
})();
