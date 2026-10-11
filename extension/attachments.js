ZP.createAttachments = function ({ isBusy, onChange, report }) {
  let images = [], processing = false;
  const input = document.getElementById("image-input"), tray = document.getElementById("attachment-tray");
  function preview(image) {
    document.getElementById("image-preview").src = image.data;
    document.getElementById("image-preview").alt = image.name;
    document.getElementById("image-dialog").showModal();
  }
  document.getElementById("close-image").addEventListener("click", () => document.getElementById("image-dialog").close());
  function render() {
    tray.replaceChildren(); tray.hidden = !images.length;
    images.forEach((image, index) => {
      const item = document.createElement("div"); item.className = "attachment";
      const show = document.createElement("button"); show.type = "button"; show.title = image.name; show.setAttribute("aria-label", `预览图片 ${image.name}`);
      const thumbnail = document.createElement("img"); thumbnail.src = image.data; thumbnail.alt = image.name; show.append(thumbnail); show.addEventListener("click", () => preview(image));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-image"; remove.textContent = "×"; remove.setAttribute("aria-label", `移除图片 ${image.name}`);
      remove.addEventListener("click", () => { if (isBusy() || processing) return; images.splice(index, 1); render(); });
      item.append(show, remove); tray.append(item);
    });
    onChange?.();
  }
  async function add(files) {
    if (isBusy() || processing) return;
    processing = true; onChange?.();
    try {
      for (const file of files) {
        if (images.length >= 4) throw new Error("每条消息最多附加 4 张图片。");
        if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error("支持 PNG、JPEG、WebP 和 GIF 图片。");
        if (file.size > 20 * 1024 * 1024) throw new Error("单张原图不能超过 20 MB。");
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 60000000) throw new Error("图片尺寸过大，请先缩小图片。");
          const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext("2d"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL("image/jpeg", 0.86);
          const image = { name: file.name || "粘贴图片", data, width: canvas.width, height: canvas.height };
          ZP.validateAttachments([image]); images.push(image);
        } finally { bitmap.close(); }
      }
    } catch (error) { report(error.message); }
    finally { processing = false; input.value = ""; render(); }
  }
  document.getElementById("attach-image").addEventListener("click", () => { if (!isBusy() && !processing) input.click(); });
  input.addEventListener("change", () => void add([...input.files]));
  const composer = document.getElementById("chat-form");
  composer.addEventListener("paste", event => {
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); void add(files); }
  });
  composer.addEventListener("dragover", event => { if ([...(event.dataTransfer?.types || [])].includes("Files")) { event.preventDefault(); composer.classList.add("dragging"); } });
  composer.addEventListener("dragleave", () => composer.classList.remove("dragging"));
  composer.addEventListener("drop", event => {
    composer.classList.remove("dragging");
    if (event.dataTransfer?.files.length) { event.preventDefault(); void add([...event.dataTransfer.files]); }
  });
  return { get images() { return images; }, get processing() { return processing; }, clear() { images = []; render(); }, preview };
};
