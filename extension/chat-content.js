(() => {
  ZP.validateAttachments = function (value = []) {
    if (!Array.isArray(value) || value.length > 4) throw new Error("每条消息最多附加 4 张图片。");
    return value.map(image => {
      if (!image || typeof image.data !== "string" || image.data.length > 2100000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("图片无效或过大，请重新选择。");
      return { name: String(image.name || "图片").slice(0, 160), data: image.data, width: image.width, height: image.height };
    });
  };
  ZP.userMessage = function (text, attachments, mode) {
    const content = text || "请分析上传的图片。";
    if (!attachments?.length) return { role: "user", content };
    const blocks = [{ type: mode === "responses" ? "input_text" : "text", text: content }];
    for (const image of attachments) blocks.push(mode === "responses" ? { type: "input_image", image_url: image.data } : { type: "image_url", image_url: { url: image.data } });
    return { role: "user", content: blocks };
  };
  ZP.conversationContext = function (entries, mode) {
    // Full transcripts remain stored; only a bounded recent context goes to the model.
    const recent = entries.filter(e => ["user", "assistant"].includes(e.role)).slice(-20);
    let characters = 0, imageBudget = 4200000;
    const result = [];
    for (let i = recent.length - 1; i >= 0; i--) {
      const entry = recent[i], text = String(entry.content || "").slice(0, 24000);
      if (characters + text.length > 96000) break;
      characters += text.length;
      const images = [];
      for (const image of entry.attachments || []) {
        if (image.data.length <= imageBudget) { images.push(image); imageBudget -= image.data.length; }
      }
      if (entry.role === "user") result.unshift(ZP.userMessage(text + (images.length < (entry.attachments?.length || 0) ? "\n[较早图片未在本轮重新发送；需要时请重新上传。]" : ""), images, mode));
      else if (text) result.unshift({ role: "assistant", content: text });
    }
    return result;
  };
})();
