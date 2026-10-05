const RESEARCH =
  /\b(latest|today|current|recent|news|search|look up|web|internet|source|sources|research|verify|price|release|update)\b/i;

const SMART =
  /\b(debug|architecture|refactor|implement|code|stack trace|error|database|security|design|analyze|compare|plan|reason|algorithm)\b/i;

export function routeRequest({ messages, models, hasWeb = false }) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = String(last?.content || "");

  if (hasWeb && RESEARCH.test(text)) {
    return { tier: "research", model: models.research, temperature: 0.45 };
  }

  if (text.length > 700 || SMART.test(text)) {
    return { tier: "smart", model: models.smart, temperature: 0.55 };
  }

  return { tier: "fast", model: models.fast, temperature: 0.8 };
}
