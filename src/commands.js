import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Chaoscord directly.")
    .addStringOption((o) =>
      o.setName("prompt").setDescription("What do you want?").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("vibe")
    .setDescription("Change this server's agent personality.")
    .addStringOption((o) =>
      o.setName("mode").setDescription("Personality mode").setRequired(true).addChoices(
        { name: "normal", value: "normal" },
        { name: "chaos", value: "chaos" },
        { name: "chill", value: "chill" },
        { name: "engineer", value: "engineer" },
        { name: "menace", value: "menace" }
      )
    ),

  new SlashCommandBuilder()
    .setName("attention")
    .setDescription("Control this server's ambient participation.")
    .addStringOption((o) =>
      o.setName("mode").setDescription("Attention mode").setRequired(true).addChoices(
        { name: "quiet", value: "quiet" },
        { name: "smart", value: "smart" },
        { name: "active", value: "active" }
      )
    ),

  new SlashCommandBuilder()
    .setName("brain")
    .setDescription("View or configure this server's brain.")
    .addSubcommand((s) => s.setName("show").setDescription("Show the current server brain."))
    .addSubcommand((s) =>
      s.setName("set").setDescription("Set server-specific instructions.").addStringOption((o) =>
        o.setName("content").setDescription("Server brain text").setRequired(true)
      )
    )
    .addSubcommand((s) => s.setName("reset").setDescription("Clear the custom server brain.")),

  new SlashCommandBuilder()
    .setName("remember")
    .setDescription("Explicitly save a note about you.")
    .addStringOption((o) =>
      o.setName("note").setDescription("Thing to remember").setRequired(true)
    ),

  new SlashCommandBuilder().setName("memory").setDescription("Show saved notes about you."),
  new SlashCommandBuilder().setName("forgetme").setDescription("Delete your saved notes."),
  new SlashCommandBuilder().setName("summarize").setDescription("Summarize recent channel chat."),

  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Create a persistent reminder.")
    .addStringOption((o) =>
      o.setName("in").setDescription("Examples: 10m, 2h, 1d").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("text").setDescription("Reminder text").setRequired(true)
    ),

  new SlashCommandBuilder().setName("tasks").setDescription("List your pending reminders."),

  new SlashCommandBuilder()
    .setName("cancel-task")
    .setDescription("Cancel one pending task.")
    .addStringOption((o) => o.setName("id").setDescription("Task ID").setRequired(true)),

  new SlashCommandBuilder().setName("usage").setDescription("Show server usage telemetry."),
  new SlashCommandBuilder().setName("status").setDescription("Show current agent state.")
].map((c) => c.toJSON());
