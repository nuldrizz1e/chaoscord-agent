import {
  SlashCommandBuilder
} from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Chaoscord directly.")
    .addStringOption((o) =>
      o.setName("prompt").setDescription("What do you want?").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("vibe")
    .setDescription("Change the agent personality.")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Personality mode")
        .setRequired(true)
        .addChoices(
          { name: "normal", value: "normal" },
          { name: "chaos", value: "chaos" },
          { name: "chill", value: "chill" },
          { name: "engineer", value: "engineer" },
          { name: "menace", value: "menace" }
        )
    ),

  new SlashCommandBuilder()
    .setName("attention")
    .setDescription("Control ambient participation.")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Attention mode")
        .setRequired(true)
        .addChoices(
          { name: "quiet", value: "quiet" },
          { name: "smart", value: "smart" },
          { name: "active", value: "active" }
        )
    ),

  new SlashCommandBuilder()
    .setName("remember")
    .setDescription("Explicitly save a note about you.")
    .addStringOption((o) =>
      o.setName("note").setDescription("Thing to remember").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("memory")
    .setDescription("Show what the bot remembers about you."),

  new SlashCommandBuilder()
    .setName("forgetme")
    .setDescription("Delete your saved long-term notes."),

  new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize recent channel conversation."),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show the current agent state.")
].map((c) => c.toJSON());
