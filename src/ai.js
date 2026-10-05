import { buildTools, executeTool } from "./tools.js";

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function callProvider(provider, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: provider.model, ...body }),
      signal: controller.signal
    });

    const raw = await res.text();
    if (!res.ok) {
      const err = new Error(`AI provider returned ${res.status}: ${raw.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }

    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}

async function callWithFallback(primary, fallback, body) {
  try {
    return await callProvider(primary, body);
  } catch (err) {
    if (!fallback || (err.status && !retryable(err.status))) throw err;
    return callProvider(fallback, body);
  }
}

export class Agent {
  constructor({ primary, fallback, tavilyApiKey }) {
    this.primary = primary;
    this.fallback = fallback;
    this.tavilyApiKey = tavilyApiKey;
  }

  async respond({ messages, system, toolContext }) {
    const tools = buildTools({ tavilyEnabled: Boolean(this.tavilyApiKey) });
    const working = [{ role: "system", content: system }, ...messages];

    for (let step = 0; step < 4; step++) {
      const data = await callWithFallback(this.primary, this.fallback, {
        messages: working,
        tools,
        tool_choice: "auto",
        temperature: 0.8
      });

      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("AI provider returned no message.");

      const toolCalls = msg.tool_calls || [];
      if (!toolCalls.length) return (msg.content || "").trim() || "…";

      working.push(msg);

      for (const call of toolCalls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }

        let result;
        try {
          result = await executeTool(name, args, {
            ...toolContext,
            tavilyApiKey: this.tavilyApiKey
          });
        } catch (err) {
          result = { error: err.message };
        }

        working.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
    }

    return "Tool loop hit its step limit. Try the request again with a narrower target.";
  }
}
