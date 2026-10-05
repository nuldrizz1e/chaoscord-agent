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

export function buildTools({ tavilyEnabled = false } = {}) {
  const tools = [
    tool("get_server_info", "Get basic information about the current Discord server."),
    tool("get_channel_info", "Get information about the current Discord channel."),
    tool(
      "get_member_info",
      "Find a member in the current server by user ID or username fragment.",
      { query: { type: "string", description: "Discord user ID, username, or display-name fragment." } },
      ["query"]
    ),
    tool(
      "get_recent_messages",
      "Read a small number of recent messages from the current channel.",
      { limit: { type: "integer", minimum: 1, maximum: 20 } }
    ),
    tool(
      "remember_user_note",
      "Save a durable note about the current user when they explicitly ask the bot to remember something.",
      { note: { type: "string", description: "Short note to remember." } },
      ["note"]
    )
  ];

  if (tavilyEnabled) {
    tools.push(
      tool(
        "search_web",
        "Search the public web for current information.",
        {
          query: { type: "string" },
          max_results: { type: "integer", minimum: 1, maximum: 8 }
        },
        ["query"]
      )
    );
  }

  return tools;
}

async function searchWeb(query, maxResults, apiKey) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults || 5,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content
  }));
}

export async function executeTool(name, args, ctx) {
  switch (name) {
    case "get_server_info": {
      if (!ctx.guild) return { type: "dm", message: "This conversation is a DM." };
      return {
        id: ctx.guild.id,
        name: ctx.guild.name,
        memberCount: ctx.guild.memberCount,
        createdAt: ctx.guild.createdAt.toISOString(),
        ownerId: ctx.guild.ownerId
      };
    }

    case "get_channel_info": {
      return {
        id: ctx.channel.id,
        name: ctx.channel.name || "DM",
        type: ctx.channel.type,
        topic: "topic" in ctx.channel ? ctx.channel.topic : null
      };
    }

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
          const haystack = [
            m.user.username,
            m.user.globalName,
            m.displayName
          ].filter(Boolean).join(" ").toLowerCase();
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
      const limit = Math.min(Math.max(Number(args.limit || 10), 1), 20);
      if (!ctx.channel?.messages?.fetch) return { error: "Message history unavailable here." };
      const messages = await ctx.channel.messages.fetch({ limit });
      return [...messages.values()]
        .reverse()
        .map((m) => ({
          author: m.author.username,
          authorId: m.author.id,
          content: m.content.slice(0, 1000),
          createdAt: m.createdAt.toISOString()
        }));
    }

    case "remember_user_note": {
      const note = String(args.note || "").trim();
      if (!note) return { error: "Empty note." };
      ctx.store.remember(ctx.userId, note);
      return { saved: true, note };
    }

    case "search_web": {
      if (!ctx.tavilyApiKey) return { error: "Web search is not configured." };
      return searchWeb(String(args.query || ""), args.max_results, ctx.tavilyApiKey);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
