import {
  Client,
  GatewayIntentBits,
  Partials,
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

function currentSettings() {
  return store.getSettings({
    vibe: config.defaultVibe,
    attention: config.defaultAttention
  });
}

function normalizeHistory(history) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: `${m.author || "user"}: ${m.content}`
  }));
}

function contextFor(messageOrInteraction) {
  return {
    guildName: messageOrInteraction.guild?.name || null,
    channelName: messageOrInteraction.channel?.name || null,
    userName:
      messageOrInteraction.member?.displayName ||
      messageOrInteraction.user?.username ||
      messageOrInteraction.author?.username ||
      "unknown"
  };
}

async function generateForMessage(message, extraInstruction = null) {
  const settings = currentSettings();
  const history = store.getHistory(message.channel.id);
  const memories = store.memories(message.author.id);

  const prompt = systemPrompt({
    ...settings,
    memories,
    context: contextFor(message)
  });

  const messages = normalizeHistory(history);
  if (extraInstruction) messages.push({ role: "user", content: extraInstruction });

  return agent.respond({
    system: prompt,
    messages,
    toolContext: {
      guild: message.guild,
      channel: message.channel,
      userId: message.author.id,
      store
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

client.once("ready", async () => {
  console.log(`Chaoscord online as ${client.user.tag}`);
  await registerCommands().catch((err) =>
    console.error("Slash command registration failed:", err)
  );
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

  const settings = currentSettings();
  const isDM = !message.guild;
  const mentioned = message.mentions.users.has(client.user.id);
  const repliedToBot =
    message.reference?.messageId &&
    (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))
      ?.author?.id === client.user.id;

  const history = store.getHistory(message.channel.id);
  const score = ambientScore(message, history);

  const ambient = shouldAmbientReply({
    attention: settings.attention,
    score,
    lastAmbientAt: store.getLastAmbientAt(message.channel.id),
    cooldownMs: config.ambientCooldownMs
  });

  const shouldReply = isDM || mentioned || repliedToBot || ambient;

  const reaction = maybeReaction(message.content);
  if (reaction && !shouldReply) {
    await message.react(reaction).catch(() => null);
  }

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

  const settings = currentSettings();

  if (interaction.commandName === "vibe") {
    const mode = interaction.options.getString("mode", true);
    store.setSetting("vibe", mode);
    return interaction.reply(`Vibe switched to **${mode}**.`);
  }

  if (interaction.commandName === "attention") {
    const mode = interaction.options.getString("mode", true);
    store.setSetting("attention", mode);
    return interaction.reply(`Attention switched to **${mode}**.`);
  }

  if (interaction.commandName === "remember") {
    const note = interaction.options.getString("note", true);
    store.remember(interaction.user.id, note);
    return interaction.reply({ content: "Saved.", ephemeral: true });
  }

  if (interaction.commandName === "memory") {
    const notes = store.memories(interaction.user.id);
    return interaction.reply({
      content: notes.length
        ? notes.map((n, i) => `${i + 1}. ${n}`).join("\n")
        : "I don't have any saved notes about you.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "forgetme") {
    store.forget(interaction.user.id);
    return interaction.reply({
      content: "Your saved long-term notes are gone.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "status") {
    return interaction.reply({
      content: [
        `**vibe:** ${settings.vibe}`,
        `**attention:** ${settings.attention}`,
        `**primary model:** ${config.ai.model}`,
        `**fallback:** ${config.fallback?.model || "off"}`,
        `**web search:** ${config.tavilyApiKey ? "on" : "off"}`
      ].join("\n"),
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const history = store.getHistory(interaction.channel.id);
    const memories = store.memories(interaction.user.id);
    const prompt = systemPrompt({
      ...settings,
      memories,
      context: contextFor(interaction)
    });

    let instruction;
    if (interaction.commandName === "ask") {
      instruction = interaction.options.getString("prompt", true);
    } else if (interaction.commandName === "summarize") {
      instruction =
        "Summarize the recent conversation in this channel. Keep it compact, note decisions, unresolved issues, and concrete next actions.";
    } else {
      return interaction.editReply("Unknown command.");
    }

    const answer = await agent.respond({
      system: prompt,
      messages: [
        ...normalizeHistory(history),
        { role: "user", content: instruction }
      ],
      toolContext: {
        guild: interaction.guild,
        channel: interaction.channel,
        userId: interaction.user.id,
        store
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
