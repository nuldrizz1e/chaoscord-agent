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
import { ambientScore, maybeReaction, shouldAmbientReply } from "./social.js";
import { inferVoice } from "./style.js";

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
    userName: source.member?.displayName || source.author?.username || "unknown"
  };
}

function explicitScope(message) {
  const text = message.content || "";
  const canManageServer = Boolean(
    message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)
  );

  return {
    remember: /\b(remember|save|keep in mind)\b/i.test(text),
    forgetMemory: /\b(forget|delete|clear|erase)\b[\s\S]{0,40}\b(memory|memories|what you remember|everything about me)\b/i.test(text),
    reminder: /\b(remind me|set (?:a )?reminder|reminder for me)\b/i.test(text),
    cancelReminder: /\b(cancel|delete|remove)\b[\s\S]{0,30}\b(reminder|task)\b/i.test(text),
    react: /\b(react|reaction)\b/i.test(text),
    thread: /\b(create|start|open|make)\s+(?:a\s+)?thread\b/i.test(text),
    serverContext:
      canManageServer &&
      /\b(server context|server brain|server rule|remember for (?:this|the) server|clear server context|reset server context)\b/i.test(text)
  };
}

function buildSystem(message, history) {
  return systemPrompt({
    memories: store.memories(message.author.id),
    context: contextFor(message),
    guildBrain: store.getGuildBrain(message.guild?.id || null),
    voice: inferVoice(message, history)
  });
}

async function registerNoSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  // This bot is intentionally natural-language first. Clear old slash command clutter.
  await rest.put(Routes.applicationCommands(config.clientId), { body: [] }).catch(() => null);
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] }).catch(() => null);
  }
}

async function runDueTasks() {
  for (const task of store.dueTasks()) {
    try {
      const channel = await client.channels.fetch(task.channelId);
      if (!channel?.isTextBased()) throw new Error("Task channel unavailable.");

      await channel.send({
        content: `<@${task.userId}> ${task.text}`,
        allowedMentions: { users: [task.userId] }
      });
      store.finishTask(task.id, "done");
    } catch (err) {
      console.error(`Task ${task.id} failed:`, err);
      store.finishTask(task.id, "failed");
    }
  }
}

async function askAgent(message) {
  const scope = explicitScope(message);
  const history = store.getHistory(message.channel.id);
  return agent.respond({
    system: buildSystem(message, history),
    messages: normalizeHistory(history),
    toolContext: {
      guild: message.guild,
      channel: message.channel,
      userId: message.author.id,
      store,
      triggerMessage: message,
      scope
    }
  });
}

client.once("ready", async () => {
  console.log(`Chaoscord online as ${client.user.tag}`);
  await registerNoSlashCommands();
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

  const isDM = !message.guild;
  const mentioned = message.mentions.users.has(client.user.id);

  let repliedToBot = false;
  if (message.reference?.messageId) {
    const replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    repliedToBot = replied?.author?.id === client.user.id;
  }

  const history = store.getHistory(message.channel.id);
  const settings = store.getSettings(
    { vibe: config.defaultVibe, attention: config.defaultAttention },
    message.guild?.id || null
  );

  const score = ambientScore(message, history);
  const ambient = shouldAmbientReply({
    attention: settings.attention,
    score,
    lastAmbientAt: store.getLastAmbientAt(message.channel.id),
    cooldownMs: config.ambientCooldownMs
  });

  const shouldReply = isDM || mentioned || repliedToBot || ambient;

  if (!shouldReply) {
    const reaction = maybeReaction(message.content);
    if (reaction) await message.react(reaction).catch(() => null);
    return;
  }

  if (ambient) store.setLastAmbientAt(message.channel.id);
  await message.channel.sendTyping().catch(() => null);

  try {
    const answer = await askAgent(message);
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

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err));

client.login(config.discordToken);
