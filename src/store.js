import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const fresh = () => ({
  guilds: {},
  users: {},
  channels: {},
  tasks: [],
  usage: {},
  settings: { vibe: null, attention: null }
});

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export class Store {
  constructor({ maxHistory = 24, maxMemoryNotes = 12 } = {}) {
    this.maxHistory = maxHistory;
    this.maxMemoryNotes = maxMemoryNotes;
    this.state = fresh();
    this.load();
  }

  load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) return this.save();

    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      this.state = {
        ...fresh(),
        ...parsed,
        guilds: obj(parsed.guilds),
        users: obj(parsed.users),
        channels: obj(parsed.channels),
        usage: obj(parsed.usage),
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        settings: { ...fresh().settings, ...obj(parsed.settings) }
      };
    } catch {
      fs.renameSync(STATE_FILE, `${STATE_FILE}.broken-${Date.now()}`);
      this.state = fresh();
      this.save();
    }
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }

  guild(guildId) {
    if (!guildId) return null;
    return (this.state.guilds[guildId] ||= { settings: {}, brain: "" });
  }

  getSettings(defaults, guildId = null) {
    if (!guildId) {
      return {
        vibe: this.state.settings.vibe || defaults.vibe,
        attention: this.state.settings.attention || defaults.attention
      };
    }

    const guild = this.guild(guildId);
    return {
      vibe: guild.settings?.vibe || defaults.vibe,
      attention: guild.settings?.attention || defaults.attention
    };
  }

  setSetting(key, value, guildId = null) {
    if (!guildId) this.state.settings[key] = value;
    else {
      const guild = this.guild(guildId);
      guild.settings ||= {};
      guild.settings[key] = value;
    }
    this.save();
  }

  getGuildBrain(guildId) {
    return guildId ? this.guild(guildId)?.brain || "" : "";
  }

  setGuildBrain(guildId, text) {
    if (!guildId) return;
    this.guild(guildId).brain = String(text || "").trim().slice(0, 4000);
    this.save();
  }

  pushHistory(channelId, item) {
    const channel = (this.state.channels[channelId] ||= { history: [], lastAmbientAt: 0 });
    channel.history.push(item);
    channel.history = channel.history.slice(-this.maxHistory);
    this.save();
  }

  getHistory(channelId, limit = this.maxHistory) {
    return (this.state.channels[channelId]?.history || []).slice(-limit);
  }

  getLastAmbientAt(channelId) {
    return this.state.channels[channelId]?.lastAmbientAt || 0;
  }

  setLastAmbientAt(channelId, at = Date.now()) {
    const channel = (this.state.channels[channelId] ||= { history: [], lastAmbientAt: 0 });
    channel.lastAmbientAt = at;
    this.save();
  }

  remember(userId, note) {
    const user = (this.state.users[userId] ||= { notes: [] });
    const clean = note.trim();
    if (!clean) return user.notes;

    user.notes = user.notes.filter((x) => x.toLowerCase() !== clean.toLowerCase());
    user.notes.push(clean);
    user.notes = user.notes.slice(-this.maxMemoryNotes);
    this.save();
    return user.notes;
  }

  memories(userId) {
    return this.state.users[userId]?.notes || [];
  }

  forget(userId) {
    delete this.state.users[userId];
    this.save();
  }

  recordUsage({
    guildId = "dm",
    userId = "unknown",
    provider,
    model,
    route,
    inputTokens = 0,
    outputTokens = 0,
    latencyMs = 0,
    estimatedCostUsd = 0
  }) {
    const key = guildId || "dm";
    const usage = (this.state.usage[key] ||= {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalLatencyMs: 0,
      estimatedCostUsd: 0,
      providers: {},
      models: {},
      routes: {},
      users: {}
    });

    usage.calls++;
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    usage.totalLatencyMs += latencyMs;
    usage.estimatedCostUsd += estimatedCostUsd;
    usage.providers[provider] = (usage.providers[provider] || 0) + 1;
    usage.models[model] = (usage.models[model] || 0) + 1;
    usage.routes[route] = (usage.routes[route] || 0) + 1;

    const user = (usage.users[userId] ||= {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0
    });
    user.calls++;
    user.inputTokens += inputTokens;
    user.outputTokens += outputTokens;
    user.estimatedCostUsd += estimatedCostUsd;

    this.save();
  }

  getUsage(guildId = "dm") {
    return this.state.usage[guildId || "dm"] || {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalLatencyMs: 0,
      estimatedCostUsd: 0,
      providers: {},
      models: {},
      routes: {},
      users: {}
    };
  }

  addTask({ guildId = null, channelId, userId, text, dueAt }) {
    const task = {
      id: crypto.randomBytes(3).toString("hex"),
      guildId,
      channelId,
      userId,
      text: String(text).slice(0, 1500),
      dueAt,
      createdAt: Date.now(),
      status: "pending"
    };
    this.state.tasks.push(task);
    this.state.tasks = this.state.tasks.slice(-250);
    this.save();
    return task;
  }

  listTasks(userId) {
    return this.state.tasks
      .filter((x) => x.userId === userId && x.status === "pending")
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  dueTasks(now = Date.now()) {
    return this.state.tasks.filter((x) => x.status === "pending" && x.dueAt <= now);
  }

  finishTask(id, status = "done") {
    const task = this.state.tasks.find((x) => x.id === id);
    if (!task) return false;
    task.status = status;
    task.finishedAt = Date.now();
    this.save();
    return true;
  }

  cancelTask(id, userId) {
    const task = this.state.tasks.find(
      (x) => x.id === id && x.userId === userId && x.status === "pending"
    );
    if (!task) return false;
    task.status = "cancelled";
    task.finishedAt = Date.now();
    this.save();
    return true;
  }
}
