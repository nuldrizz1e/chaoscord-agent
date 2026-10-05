const questionWords = /\b(why|how|what|who|where|when|should|could|can|is|are|does|do)\b/i;
const directBotWords = /\b(bot|ai|agent|chaoscord)\b/i;
const urgencyWords = /\b(help|broken|error|wtf|stuck|issue|problem|fails?|failing)\b/i;

export function ambientScore(message, history = []) {
  const text = message.content.trim();
  if (!text || text.length < 3) return 0;

  let score = 0;
  if (text.endsWith("?") || questionWords.test(text)) score += 0.35;
  if (directBotWords.test(text)) score += 0.25;
  if (urgencyWords.test(text)) score += 0.25;
  if (text.length > 100) score += 0.1;

  const recentBot = history.slice(-5).some((m) => m.role === "assistant");
  if (recentBot) score -= 0.15;

  return Math.max(0, Math.min(1, score));
}

export function shouldAmbientReply({ attention, score, lastAmbientAt, cooldownMs }) {
  if (attention === "quiet") return false;
  if (Date.now() - lastAmbientAt < cooldownMs) return false;

  const threshold = attention === "active" ? 0.34 : 0.62;
  return score >= threshold;
}

export function maybeReaction(content) {
  const text = content.toLowerCase();

  if (/\b(lmao|lol|bro|wtf|insane|crazy)\b/.test(text) && Math.random() < 0.08) return "💀";
  if (/\b(wait|look|watch|check this)\b/.test(text) && Math.random() < 0.08) return "👀";
  if (/\b(done|fixed|works|working|shipped)\b/.test(text) && Math.random() < 0.06) return "🔥";

  return null;
}
