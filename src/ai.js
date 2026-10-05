import { buildTools, executeTool } from "./tools.js";
import { routeRequest } from "./router.js";

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function estimateCost(usage, pricing) {
  if (!usage || !pricing) return 0;
  const input = usage.prompt_tokens || usage.input_tokens || 0;
  const output = usage.completion_tokens || usage.output_tokens || 0;
  return (
    (input / 1_000_000) * (pricing.inputPer1M || 0) +
    (output / 1_000_000) * (pricing.outputPer1M || 0)
  );
}

async function callProvider(provider, body, { model, label, route }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  const started = Date.now();

  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: model || provider.model, ...body }),
      signal: controller.signal
    });

    const raw = await res.text();
    if (!res.ok) {
      const err = new Error(`AI provider returned ${res.status}: ${raw.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }

    const data = JSON.parse(raw);
    data.__chaosMeta = {
      provider: label,
      model: data.model || model || provider.model,
      route,
      latencyMs: Date.now() - started,
      usage: data.usage || null,
      estimatedCostUsd: estimateCost(data.usage, provider.pricing)
    };
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function callWithFallback(primary, fallback, body, route) {
  try {
    return await callProvider(primary, body, {
      model: route.model,
      label: "primary",
      route: route.tier
    });
  } catch (err) {
    if (!fallback || (err.status && !retryable(err.status))) throw err;
    return callProvider(fallback, body, {
      model: fallback.model,
      label: "fallback",
      route: route.tier
    });
  }
}

function recordUsage(store, ctx, meta) {
  if (!store || !meta) return;
  const usage = meta.usage || {};
  store.recordUsage({
    guildId: ctx.guild?.id || "dm",
    userId: ctx.userId,
    provider: meta.provider,
    model: meta.model,
    route: meta.route,
    inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
    outputTokens: usage.completion_tokens || usage.output_tokens || 0,
    latencyMs: meta.latencyMs || 0,
    estimatedCostUsd: meta.estimatedCostUsd || 0
  });
}

export class Agent {
  constructor({ primary, fallback, tavilyApiKey }) {
    this.primary = primary;
    this.fallback = fallback;
    this.tavilyApiKey = tavilyApiKey;
  }

  async respond({ messages, system, toolContext }) {
    const route = routeRequest({
      messages,
      models: this.primary.models,
      hasWeb: Boolean(this.tavilyApiKey)
    });

    const tools = buildTools({
      tavilyEnabled: Boolean(this.tavilyApiKey),
      scope: toolContext.scope || {}
    });

    const working = [{ role: "system", content: system }, ...messages];

    for (let step = 0; step < 5; step++) {
      const data = await callWithFallback(
        this.primary,
        this.fallback,
        {
          messages: working,
          tools,
          tool_choice: "auto",
          temperature: route.temperature
        },
        route
      );

      recordUsage(toolContext.store, toolContext, data.__chaosMeta);

      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("AI provider returned no message.");

      const calls = msg.tool_calls || [];
      if (!calls.length) return (msg.content || "").trim() || "…";

      working.push(msg);

      for (const call of calls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {}

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

    return "I hit the internal tool-step limit. Try narrowing the request.";
  }
}
