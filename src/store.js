import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const blankState = () => ({
  guilds: {},
  users: {},
  channels: {},
  settings: {
    vibe: null,
    attention: null
  }
});

export class Store {
  constructor({ maxHistory = 24, maxMemoryNotes = 12 } = {}) {
    this.maxHistory = maxHistory;
    this.maxMemoryNotes = maxMemoryNotes;
    this.state = blankState();
    this.load();
  }

  load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) return this.save();

    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      this.state = { ...blankState(), ...parsed };
    } catch {
      const broken = `${STATE_FILE}.broken-${Date.now()}`;
      fs.renameSync(STATE_FILE, broken);
      this.state = blankState();
      this.save();
    }
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }

  getSettings(defaults) {
    return {
      vibe: this.state.settings.vibe || defaults.vibe,
      attention: this.state.settings.attention || defaults.attention
    };
  }

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.save();
  }

  pushHistory(channelId, item) {
    const channel = this.state.channels[channelId] ||= { history: [], lastAmbientAt: 0 };
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
    const channel = this.state.channels[channelId] ||= { history: [], lastAmbientAt: 0 };
    channel.lastAmbientAt = at;
    this.save();
  }

  remember(userId, note) {
    const user = this.state.users[userId] ||= { notes: [] };
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
}
