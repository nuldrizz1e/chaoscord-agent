function tool(name, description, properties = {}, required = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false
      }
    }
  };
}

export function buildTools({ tavilyEnabled = false, scope = {} } = {}) {
  const tools = [
    tool("get_server_info", "Read basic information about the current Discord server."),
    tool("get_channel_info", "Read information about the current Discord channel."),
    tool(
      "get_member_info",
      "Find a member in the current server by Discord ID, username, global name, or display-name fragment.",
      { query: { type: "string" } },
      ["query"]
    ),
    tool(
      "get_recent_messages",
      "Read recent messages in the current channel when conversation context is needed.",
      { limit: { type: "integer", minimum: 1, maximum: 30 } }
    ),
    tool("get_agent_usage", "Read this server's current AI usage telemetry and model/provider counts."),
    tool("list_user_memory", "Read the durable notes currently stored about the requesting user."),
    tool("list_reminders", "List the requesting user's pending reminders.")
  ];

  if (tavilyEnabled) {
    tools.push(
      tool(
        "search_web",
        "Search the public web for fresh or current information.",
        {
          query: { type: "string" },
          max_results: { type: "integer", minimum: 1, maximum: 8 }
        },
        ["query"]
      ),
      tool(
        "research_web",
        "Run multiple focused public-web searches and merge/deduplicate evidence for deeper research.",
        {
          queries: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 4
          },
          max_results_each: { type: "integer", minimum: 1, maximum: 6 }
        },
        ["queries"]
      )
    );
  }

  if (scope.remember) {
    tools.push(
      tool(
        "remember_user_note",
        "Save a durable note about the requesting user. Their current message explicitly asked you to remember something.",
        { note: { type: "string" } },
        ["note"]
      )
    );
  }

  if (scope.forgetMemory) {
    tools.push(
      tool(
        "clear_user_memory",
        "Delete all durable notes stored about the requesting user. Their current message explicitly requested forgetting/deletion."
      )
    );
  }

  if (scope.reminder) {
    tools.push(
      tool(
        "schedule_reminder",
        "Schedule a persistent reminder for the requesting user. Use delay_seconds for relative time requests.",
        {
          text: { type: "string" },
          delay_seconds: { type: "integer", minimum: 5, maximum: 31536000 }
        },
        ["text", "delay_seconds"]
      )
    );
  }

  if (scope.cancelReminder) {
    tools.push(
      tool(
        "cancel_reminder",
        "Cancel one pending reminder belonging to the requesting user.",
        { id: { type: "string" } },
        ["id"]
      )
    );
  }

  if (scope.react) {
    tools.push(
      tool(
        "react_to_message",
        "Add one Unicode emoji reaction to the user's triggering Discord message.",
        { emoji: { type: "string" } },
        ["emoji"]
      )
    );
  }

  if (scope.thread) {
    tools.push(
      tool(
        "create_thread",
        "Create a Discord thread from the user's triggering message.",
        { name: { type: "string" } },
        ["name"]
      )
    );
  }

  if (scope.serverContext) {
    tools.push(
      tool(
        "set_server_context",
        "Replace the persistent server-specific context/instructions. The requesting member has Manage Server and explicitly asked to update server context.",
        { content: { type: "string" } },
        ["content"]
      ),
      tool(
        "clear_server_context",
        "Clear the persistent server-specific context. The requesting member has Manage Server and explicitly asked to clear it."
      )
    );
  }

  return tools;
}

async function searchWeb(query, maxResults, apiKey) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults || 5,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content
  }));
}

async function researchWeb(queries, maxResultsEach, apiKey) {
  const clean = [...new Set((queries || []).map((q) => String(q).trim()).filter(Boolean))].slice(0, 4);
  const batches = await Promise.all(
    clean.map((query) =>
      searchWeb(query, maxResultsEach || 4, apiKey)
        .then((results) => ({ query, results }))
        .catch((err) => ({ query, error: err.message, results: [] }))
    )
  );

  const seen = new Set();
  const results = [];
  for (const batch of batches) {
    for (const result of batch.results) {
      if (!result.url || seen.has(result.url)) continue;
      seen.add(result.url);
      results.push({ query: batch.query, ...result });
    }
  }

  return {
    queries: clean,
    results: results.slice(0, 18),
    failures: batches.filter((x) => x.error).map((x) => ({ query: x.query, error: x.error }))
  };
}

export async function executeTool(name, args, ctx) {
  switch (name) {
    case "get_server_info":
      if (!ctx.guild) return { type: "dm" };
      return {
        id: ctx.guild.id,
        name: ctx.guild.name,
        memberCount: ctx.guild.memberCount,
        ownerId: ctx.guild.ownerId,
        createdAt: ctx.guild.createdAt.toISOString()
      };

    case "get_channel_info":
      return {
        id: ctx.channel.id,
        name: ctx.channel.name || "DM",
        type: ctx.channel.type,
        topic: "topic" in ctx.channel ? ctx.channel.topic : null
      };

    case "get_member_info": {
      if (!ctx.guild) return { error: "Member lookup is unavailable in DMs." };
      const query = String(args.query || "").toLowerCase();
      let member = null;

      if (/^\d{15,22}$/.test(query)) {
        member = await ctx.guild.members.fetch(query).catch(() => null);
      }

      if (!member) {
        await ctx.guild.members.fetch({ limit: 100 }).catch(() => null);
        member = ctx.guild.members.cache.find((m) => {
          const haystack = [m.user.username, m.user.globalName, m.displayName]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        });
      }

      if (!member) return { error: "No matching member found." };
      return {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        bot: member.user.bot,
        joinedAt: member.joinedAt?.toISOString() || null,
        roles: member.roles.cache
          .filter((r) => r.id !== ctx.guild.id)
          .map((r) => r.name)
          .slice(0, 20)
      };
    }

    case "get_recent_messages": {
      const limit = Math.min(Math.max(Number(args.limit || 12), 1), 30);
      if (!ctx.channel?.messages?.fetch) return { error: "Message history unavailable here." };
      const messages = await ctx.channel.messages.fetch({ limit });
      return [...messages.values()].reverse().map((m) => ({
        author: m.author.username,
        authorId: m.author.id,
        content: m.content.slice(0, 1200),
        createdAt: m.createdAt.toISOString()
      }));
    }

    case "get_agent_usage": {
      const usage = ctx.store.getUsage(ctx.guild?.id || "dm");
      return {
        calls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        averageLatencyMs: usage.calls ? Math.round(usage.totalLatencyMs / usage.calls) : 0,
        estimatedCostUsd: usage.estimatedCostUsd,
        models: usage.models,
        providers: usage.providers,
        routes: usage.routes
      };
    }

    case "list_user_memory":
      return { notes: ctx.store.memories(ctx.userId) };

    case "remember_user_note": {
      if (!ctx.scope?.remember) return { error: "Memory write was not authorized by the current message." };
      const note = String(args.note || "").trim();
      if (!note) return { error: "Empty note." };
      ctx.store.remember(ctx.userId, note);
      return { saved: true, note };
    }

    case "clear_user_memory":
      if (!ctx.scope?.forgetMemory) return { error: "Memory deletion was not authorized by the current message." };
      ctx.store.forget(ctx.userId);
      return { deleted: true };

    case "list_reminders":
      return {
        reminders: ctx.store.listTasks(ctx.userId).slice(0, 20).map((task) => ({
          id: task.id,
          text: task.text,
          dueAt: new Date(task.dueAt).toISOString()
        }))
      };

    case "schedule_reminder": {
      if (!ctx.scope?.reminder) return { error: "Reminder creation was not authorized by the current message." };
      const delay = Number(args.delay_seconds);
      if (!Number.isFinite(delay) || delay < 5 || delay > 31536000) return { error: "Invalid reminder delay." };
      const task = ctx.store.addTask({
        guildId: ctx.guild?.id || null,
        channelId: ctx.channel.id,
        userId: ctx.userId,
        text: String(args.text || "Reminder").slice(0, 1500),
        dueAt: Date.now() + delay * 1000
      });
      return { id: task.id, dueAt: new Date(task.dueAt).toISOString(), text: task.text };
    }

    case "cancel_reminder": {
      if (!ctx.scope?.cancelReminder) return { error: "Reminder cancellation was not authorized by the current message." };
      return { cancelled: ctx.store.cancelTask(String(args.id || ""), ctx.userId) };
    }

    case "search_web":
      if (!ctx.tavilyApiKey) return { error: "Web search is not configured." };
      return searchWeb(String(args.query || ""), args.max_results, ctx.tavilyApiKey);

    case "research_web":
      if (!ctx.tavilyApiKey) return { error: "Web research is not configured." };
      return researchWeb(args.queries, args.max_results_each, ctx.tavilyApiKey);

    case "react_to_message": {
      if (!ctx.scope?.react || !ctx.triggerMessage) return { error: "Reaction was not authorized." };
      const emoji = String(args.emoji || "").trim();
      if (!emoji) return { error: "Emoji is required." };
      await ctx.triggerMessage.react(emoji);
      return { success: true, emoji };
    }

    case "create_thread": {
      if (!ctx.scope?.thread || !ctx.triggerMessage) return { error: "Thread creation was not authorized." };
      if (!ctx.guild) return { error: "Threads are unavailable in DMs." };
      if (ctx.triggerMessage.hasThread && ctx.triggerMessage.thread) {
        return { success: true, existing: true, id: ctx.triggerMessage.thread.id, name: ctx.triggerMessage.thread.name };
      }
      const thread = await ctx.triggerMessage.startThread({
        name: String(args.name || "Agent thread").trim().slice(0, 90),
        autoArchiveDuration: 60
      });
      return { success: true, id: thread.id, name: thread.name };
    }

    case "set_server_context":
      if (!ctx.scope?.serverContext || !ctx.guild) return { error: "Server-context update was not authorized." };
      ctx.store.setGuildBrain(ctx.guild.id, String(args.content || ""));
      return { success: true };

    case "clear_server_context":
      if (!ctx.scope?.serverContext || !ctx.guild) return { error: "Server-context clearing was not authorized." };
      ctx.store.setGuildBrain(ctx.guild.id, "");
      return { success: true };

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
