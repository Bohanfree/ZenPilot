(() => {
  ZP.request = async (settings, messages, signal, options = {}) => {
    const responses = settings.mode === "responses";
    const endpoint = ZP.endpoint(settings);
    const available = options.tools ?? ZP.tools;
    const tools = responses ? available.map(t => ({ type: "function", ...t.function, strict: false })) : available;
    const toolOptions = tools.length ? { tools, parallel_tool_calls: false } : {};
    const body = responses ? { model: settings.model, input: messages, ...toolOptions, store: false, include: ["reasoning.encrypted_content"] } : { model: settings.model, messages, ...toolOptions, stream: false };
    const timeout = new AbortController();
    const stop = () => timeout.abort();
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 90000);
    try {
      ZP.abort(signal);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) }, body: JSON.stringify(body), signal: timeout.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) {
        const detail = (await response.text()).split(settings.apiKey || "__no_key__").join("[已隐藏]").slice(0, 500);
        throw new Error(`API 请求失败 (${response.status})：${detail}`);
      }
      const data = await response.json();
      if (responses) {
        if (data.error || data.status === "failed" || data.status === "incomplete") throw new Error(`模型没有完成响应：${data.error?.message || data.incomplete_details?.reason || data.status}`);
        const output = data.output || [];
        const text = output.filter(x => x.type === "message").flatMap(x => x.content || []).map(x => x.text || x.refusal || "").join("\n");
        return { text, calls: output.filter(x => x.type === "function_call").map(x => ({ id: x.call_id, name: x.name, arguments: x.arguments })), raw: output };
      }
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("API 未返回聊天消息，请检查接口类型与模型。");
      if (data.choices[0].finish_reason === "length") throw new Error("模型输出被截断，请提高服务端输出上限或简化任务。");
      return { text: typeof message.content === "string" ? message.content : "", calls: (message.tool_calls || []).map(c => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })), raw: { role: "assistant", content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) } };
    } catch (error) {
      if (timeout.signal.aborted && !signal.aborted) throw new Error("模型请求超过 90 秒，请检查网络或换用更快的模型。");
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
  };
  ZP.addResult = (messages, mode, call, result) => {
    const text = result.image ? result.text : JSON.stringify(result);
    if (mode === "responses") {
      messages.push({ type: "function_call_output", call_id: call.id, output: text });
      if (result.image) messages.push({ role: "user", content: [{ type: "input_text", text: result.text }, { type: "input_image", image_url: result.image }] });
    } else {
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
      if (result.image) messages.push({ role: "user", content: [{ type: "text", text: result.text }, { type: "image_url", image_url: { url: result.image } }] });
    }
  };
})();
