import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || null,

  ai: {
    apiKey: required("AI_API_KEY"),
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.AI_MODEL || "gpt-4.1-mini"
  },

  fallback: process.env.AI_FALLBACK_API_KEY
    ? {
        apiKey: process.env.AI_FALLBACK_API_KEY,
        baseUrl: (process.env.AI_FALLBACK_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
        model: process.env.AI_FALLBACK_MODEL || process.env.AI_MODEL || "gpt-4.1-mini"
      }
    : null,

  tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || null,
  defaultVibe: process.env.DEFAULT_VIBE || "normal",
  defaultAttention: process.env.DEFAULT_ATTENTION || "smart",
  ambientCooldownMs: Number(process.env.AMBIENT_COOLDOWN_MS || 120000),
  maxHistory: Number(process.env.MAX_HISTORY || 24),
  maxMemoryNotes: Number(process.env.MAX_MEMORY_NOTES || 12)
};
