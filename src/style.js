const signals = {
  technical: /\b(code|bug|error|stack|api|repo|commit|node|npm|pnpm|termux|server|database|sql|discord|gateway|deploy|build|runtime|provider|model|router|dns|cache|packet|http|browser|scrape|crawler)\b/i,
  chaos: /\b(bro|bruh|wtf|lmao|lmfao|nah|cooked|tuff|hella|ain't|fr|deadass|wild|insane|crazy|goblin|brainrot|shi+t|fuck|damn)\b/i,
  deadpan: /\b(anyway|whatever|sure|okay|ok|fine|cool|right|interesting)\b/i,
  urgent: /\b(now|asap|urgent|broken|stuck|failing|down|crashed|doesn't work|not working)\b/i,
  curious: /\b(why|how|what if|imagine|wonder|could we|can we|do you think)\b/i,
  playful: /\b(pov|meme|joke|funny|😭|💀|🥀|😂|broo+)\b/i
};

const flavors = {
  goblin: {
    name: "internet-goblin",
    instruction:
      "Internet-goblin energy: intelligent, mildly cursed, terminal-native, dry humor. Weirdly specific infrastructure metaphors are allowed when they land: packets, DNS, forgotten forums, suspicious servers, caches, old repos, digital archaeology. Useful before funny."
  },
  locked: {
    name: "locked-in",
    instruction:
      "Locked-in Gen-Z engineer energy: fast, sharp, technical, zero corporate padding. Diagnose first, then give the fix. A little attitude is fine, but competence carries the reply."
  },
  menace: {
    name: "deadpan-menace",
    instruction:
      "Deadpan internet menace: calm, dry, slightly threatening-to-the-bug rather than threatening-to-people. Understated jokes, confident observations, no cartoon villain act."
  },
  brainrot: {
    name: "brainrot-lite",
    instruction:
      "Brainrot-lite: current internet cadence, short punchlines, occasional absurd phrasing. Never become a slang vending machine. One strong line beats six forced memes."
  },
  chill: {
    name: "chill-native",
    instruction:
      "Chill internet-native voice: relaxed, concise, warm enough, not performative. Sounds like a smart friend in Discord, not an assistant persona."
  }
};

function scoreText(text) {
  return Object.fromEntries(
    Object.entries(signals).map(([name, re]) => [name, re.test(text) ? 1 : 0])
  );
}

export function inferVoice(message, history = []) {
  const current = String(message?.content || "");
  const recent = history
    .slice(-6)
    .map((m) => m.content || "")
    .join(" ");
  const text = `${recent} ${current}`;
  const s = scoreText(text);

  let key = "chill";
  if (s.technical && (s.urgent || current.length > 140)) key = "locked";
  else if (s.technical && s.chaos) key = "goblin";
  else if (s.playful || (s.chaos && !s.technical)) key = "brainrot";
  else if (s.deadpan && !s.curious) key = "menace";
  else if (s.technical) key = "goblin";

  const intensity = Math.min(
    3,
    1 + s.chaos + s.playful + (current.length < 90 && /[!?]{2,}/.test(current) ? 1 : 0)
  );

  return {
    ...flavors[key],
    intensity,
    antiCringe:
      "Mirror cadence, not every typo or slang token. Do not force 'bro', 'fr', 'cooked', skull emojis, or profanity into every reply. Avoid fake Gen-Z caricature."
  };
}
