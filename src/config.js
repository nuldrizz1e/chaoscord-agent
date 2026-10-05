import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function num(name, fallback = 0) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

const baseModel = process.env.AI_MODEL || "gpt-4.1-mini";

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || null,

  ai: {
    apiKey: required("AI_API_KEY"),
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: baseModel,
    models: {
      fast: process.env.AI_FAST_MODEL?.trim() || baseModel,
      smart: process.env.AI_SMART_MODEL?.trim() || baseModel,
      research:
        process.env.AI_RESEARCH_MODEL?.trim() ||
        process.env.AI_SMART_MODEL?.trim() ||
        baseModel
    },
    pricing: {
      inputPer1M: num("AI_INPUT_USD_PER_1M"),
      outputPer1M: num("AI_OUTPUT_USD_PER_1M")
    }
  },

  fallback: process.env.AI_FALLBACK_API_KEY
    ? {
        apiKey: process.env.AI_FALLBACK_API_KEY,
        baseUrl: (process.env.AI_FALLBACK_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
        model: process.env.AI_FALLBACK_MODEL || baseModel,
        pricing: {
          inputPer1M: num("AI_FALLBACK_INPUT_USD_PER_1M"),
          outputPer1M: num("AI_FALLBACK_OUTPUT_USD_PER_1M")
        }
      }
    : null,

  tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || null,
  defaultVibe: process.env.DEFAULT_VIBE || "normal",
  defaultAttention: process.env.DEFAULT_ATTENTION || "smart",
  ambientCooldownMs: num("AMBIENT_COOLDOWN_MS", 120000),
  maxHistory: num("MAX_HISTORY", 24),
  maxMemoryNotes: num("MAX_MEMORY_NOTES", 12),
  taskPollMs: Math.max(num("TASK_POLL_MS", 15000), 5000)
};
