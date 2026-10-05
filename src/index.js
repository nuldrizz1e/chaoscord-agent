import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes
} from "discord.js";

import { config } from "./config.js";
import { Store } from "./store.js";
import { Agent } from "./ai.js";
import { systemPrompt } from "./prompts.js";
import { commands } from "./commands.js";
import { ambientScore, maybeReaction, shouldAmbientReply } from "./social.js";

const store = new Store({
  maxHistory: config.maxHistory,
  maxMemoryNotes: config.maxMemoryNotes
});

const agent = new Agent({
  primary: config.ai,
  fallback: config.fallback,
  tavilyApiKey: config.tavilyApiKey
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

function settings(guildId = null) {
  return store.getSettings(
    { vibe: config.defaultVibe, attention: config.defaultAttention },
    guildId
  );
}

function normalizeHistory(history) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: `${m.author || "user"}: ${m.content}`
  }));
}

function contextFor(source) {
  return {
    guildName: source.guild?.name || null,
    channelName: source.channel?.name || null,
    userName:
      source.member?.displayName ||
      source.user?.username ||
      source.author?.username ||
      "unknown"
  };
}

function actionScope(text) {
  const value = String(text || "");
  return {
    react: /\b(react|reaction)\b/i.test(value),
    thread: /\b(create|start|open)\s+(?:a\s+)?thread\b/i.test(value)
  };
}

function parseDuration(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const multipliers = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000
  };

  const ms = amount * multipliers[match[2].toLowerCase()];
  if (!Number.isFinite(ms) || ms < 5000 || ms > 365 * 86_400_000) return null;
  return ms;
}

function buildSystem({ guildId, userId, source }) {
  return systemPrompt({
    ...settings(guildId),
    memories: store.memories(userId),
    context: contextFor(source),
    guildBrain: store.getGuildBrain(guildId)
  });
}

async function generateForMessage(message) {
  return agent.respond({
    system: buildSystem({
      guildId: message.guild?.id || null,
      userId: message.author.id,
      source: message
    }),
    messages: normalizeHistory(store.getHistory(message.channel.id)),
    toolContext: {
      guild: message.guild,
      channel: message.channel,
      userId: message.author.id,
      store,
      triggerMessage: message,
      actionScope: actionScope(message.content)
    }
  });
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands
    });
    console.log(`Registered guild commands for ${config.guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log("Registered global commands");
  }
}

async function runDueTasks() {
  for (const task of store.dueTasks()) {
    try {
      const channel = await client.channels.fetch(task.channelId);
      if (!channel?.isTextBased()) throw new Error("Task channel unavailable.");

      await channel.send({
        content: `<@${task.userId}> reminder: ${task.text}`,
        allowedMentions: { users: [task.userId] }
      });

      store.finishTask(task.id, "done");
    } catch (err) {
      console.error(`Task ${task.id} failed:`, err);
      store.finishTask(task.id, "failed");
    }
  }
}

client.once("ready", async () => {
  console.log(`Chaoscord online as ${client.user.tag}`);
  await registerCommands().catch((err) =>
    console.error("Slash command registration failed:", err)
  );

  await runDueTasks();
  const timer = setInterval(runDueTasks, config.taskPollMs);
  timer.unref?.();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  store.pushHistory(message.channel.id, {
    role: "user",
    author: message.member?.displayName || message.author.username,
    userId: message.author.id,
    content: message.content.slice(0, 3000),
    at: Date.now()
  });

  const current = settings(message.guild?.id || null);
  const isDM = !message.guild;
  const mentioned = message.mentions.users.has(client.user.id);

  let repliedToBot = false;
  if (message.reference?.messageId) {
    const replied = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);
    repliedToBot = replied?.author?.id === client.user.id;
  }

  const history = store.getHistory(message.channel.id);
  const score = ambientScore(message, history);

  const ambient = shouldAmbientReply({
    attention: current.attention,
    score,
    lastAmbientAt: store.getLastAmbientAt(message.channel.id),
    cooldownMs: config.ambientCooldownMs
  });

  const shouldReply = isDM || mentioned || repliedToBot || ambient;

  const reaction = maybeReaction(message.content);
  if (reaction && !shouldReply) await message.react(reaction).catch(() => null);

  if (!shouldReply) return;
  if (ambient) store.setLastAmbientAt(message.channel.id);

  await message.channel.sendTyping().catch(() => null);

  try {
    const answer = await generateForMessage(message);
    const chunks = answer.match(/[\s\S]{1,1900}/g) || ["…"];

    for (const chunk of chunks) {
      const sent = await message.reply({
        content: chunk,
        allowedMentions: { repliedUser: false }
      });

      store.pushHistory(message.channel.id, {
        role: "assistant",
        author: client.user.username,
        userId: client.user.id,
        content: sent.content,
        at: Date.now()
      });
    }
  } catch (err) {
    console.error(err);
    await message.reply({
      content: `Agent error: ${err.message.slice(0, 700)}`,
      allowedMentions: { repliedUser: false }
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guild?.id || null;
  const current = settings(guildId);

  if (interaction.commandName === "vibe") {
    const mode = interaction.options.getString("mode", true);
    store.setSetting("vibe", mode, guildId);
    return interaction.reply(`Vibe switched to **${mode}**.`);
  }

  if (interaction.commandName === "attention") {
    const mode = interaction.options.getString("mode", true);
    store.setSetting("attention", mode, guildId);
    return interaction.reply(`Attention switched to **${mode}**.`);
  }

  if (interaction.commandName === "brain") {
    if (!guildId) {
      return interaction.reply({ content: "Server brain only works in a server.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "show") {
      return interaction.reply({
        content: store.getGuildBrain(guildId) || "No custom server brain configured.",
        ephemeral: true
      });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "You need **Manage Server** to change the server brain.",
        ephemeral: true
      });
    }

    if (sub === "set") {
      store.setGuildBrain(guildId, interaction.options.getString("content", true));
      return interaction.reply({ content: "Server brain updated.", ephemeral: true });
    }

    store.setGuildBrain(guildId, "");
    return interaction.reply({ content: "Server brain cleared.", ephemeral: true });
  }

  if (interaction.commandName === "remember") {
    store.remember(interaction.user.id, interaction.options.getString("note", true));
    return interaction.reply({ content: "Saved.", ephemeral: true });
  }

  if (interaction.commandName === "memory") {
    const notes = store.memories(interaction.user.id);
    return interaction.reply({
      content: notes.length
        ? notes.map((n, i) => `${i + 1}. ${n}`).join("\n")
        : "I don't have saved notes about you.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "forgetme") {
    store.forget(interaction.user.id);
    return interaction.reply({ content: "Your saved notes are gone.", ephemeral: true });
  }

  if (interaction.commandName === "remind") {
    const ms = parseDuration(interaction.options.getString("in", true));
    if (!ms) {
      return interaction.reply({
        content: "Use a duration like `10m`, `2h`, `1d`, or `1w`.",
        ephemeral: true
      });
    }

    const task = store.addTask({
      guildId,
      channelId: interaction.channel.id,
      userId: interaction.user.id,
      text: interaction.options.getString("text", true),
      dueAt: Date.now() + ms
    });

    return interaction.reply({
      content: `Task **${task.id}** scheduled <t:${Math.floor(task.dueAt / 1000)}:R>.`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "tasks") {
    const tasks = store.listTasks(interaction.user.id);
    return interaction.reply({
      content: tasks.length
        ? tasks.slice(0, 15).map((task) =>
            `**${task.id}** · <t:${Math.floor(task.dueAt / 1000)}:R> · ${task.text}`
          ).join("\n")
        : "No pending tasks.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "cancel-task") {
    const id = interaction.options.getString("id", true);
    return interaction.reply({
      content: store.cancelTask(id, interaction.user.id)
        ? `Cancelled **${id}**.`
        : "Task not found.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "usage") {
    const usage = store.getUsage(guildId || "dm");
    const totalTokens = usage.inputTokens + usage.outputTokens;
    const avgLatency = usage.calls ? Math.round(usage.totalLatencyMs / usage.calls) : 0;
    const models = Object.entries(usage.models)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, calls]) => `• ${model}: ${calls} calls`)
      .join("\n");

    return interaction.reply({
      content: [
        `**Calls:** ${usage.calls}`,
        `**Tokens:** ${totalTokens.toLocaleString()} (${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out)`,
        `**Avg latency:** ${avgLatency} ms`,
        `**Estimated cost:** $${usage.estimatedCostUsd.toFixed(4)}`,
        models ? `**Models:**\n${models}` : "**Models:** none yet"
      ].join("\n"),
      ephemeral: true
    });
  }

  if (interaction.commandName === "status") {
    return interaction.reply({
      content: [
        `**vibe:** ${current.vibe}`,
        `**attention:** ${current.attention}`,
        `**fast model:** ${config.ai.models.fast}`,
        `**smart model:** ${config.ai.models.smart}`,
        `**research model:** ${config.ai.models.research}`,
        `**fallback:** ${config.fallback?.model || "off"}`,
        `**web research:** ${config.tavilyApiKey ? "on" : "off"}`,
        `**server brain:** ${guildId && store.getGuildBrain(guildId) ? "configured" : "default"}`
      ].join("\n"),
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const history = store.getHistory(interaction.channel.id);
    let instruction;

    if (interaction.commandName === "ask") {
      instruction = interaction.options.getString("prompt", true);
    } else if (interaction.commandName === "summarize") {
      instruction =
        "Summarize the recent conversation. Note decisions, unresolved issues, and next actions.";
    } else {
      return interaction.editReply("Unknown command.");
    }

    const answer = await agent.respond({
      system: buildSystem({
        guildId,
        userId: interaction.user.id,
        source: interaction
      }),
      messages: [
        ...normalizeHistory(history),
        { role: "user", content: instruction }
      ],
      toolContext: {
        guild: interaction.guild,
        channel: interaction.channel,
        userId: interaction.user.id,
        store,
        triggerMessage: null,
        actionScope: {}
      }
    });

    await interaction.editReply(answer.slice(0, 1900));
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Agent error: ${err.message.slice(0, 700)}`);
  }
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));

client.login(config.discordToken);
