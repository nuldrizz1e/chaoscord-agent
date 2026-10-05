# Chaoscord Agent

A Discord AI agent that behaves like a server-native agent instead of a chatbot trapped behind `/ask`.

## This build

### Social brain
- replies to DMs, mentions, and reply chains
- ambient participation scoring
- anti-spam cooldown
- lightweight reactions
- vibes: `normal`, `chaos`, `chill`, `engineer`, `menace`
- attention: `quiet`, `smart`, `active`

### Per-server brain
Each server gets its own persistent instructions:

```text
/brain show
/brain set
/brain reset
```

Only members with **Manage Server** can modify it.

### Task-aware model router
Routes requests to:

- **fast** — normal chat
- **smart** — code, debugging, architecture, analysis
- **research** — current info, verification, web research

```env
AI_MODEL=gpt-4.1-mini
AI_FAST_MODEL=
AI_SMART_MODEL=
AI_RESEARCH_MODEL=
```

Blank route models reuse `AI_MODEL`.

### Provider fallback
Optional:

```env
AI_FALLBACK_API_KEY=
AI_FALLBACK_BASE_URL=
AI_FALLBACK_MODEL=
```

Used on timeouts, 429s, and provider-side failures.

### Web research
With `TAVILY_API_KEY` configured the agent receives:

- `search_web`
- `research_web` — multiple focused searches merged into one evidence set

### Discord tools
Read tools:
- server info
- channel info
- member lookup
- recent messages

Guarded actions:
- react to the triggering message
- create a thread from the triggering message

Action tools are only exposed when the user's message explicitly authorizes that action.

There are no ban/kick/delete/role mutation tools in this build.

### Persistent reminders
```text
/remind in:10m text:check the deploy
/tasks
/cancel-task
```

Tasks survive restarts in `data/state.json`.

### Usage telemetry
```text
/usage
```

Tracks:
- model/provider calls
- input/output tokens
- average latency
- route/model counts
- optional estimated USD cost

Set actual provider pricing if wanted:

```env
AI_INPUT_USD_PER_1M=0
AI_OUTPUT_USD_PER_1M=0
AI_FALLBACK_INPUT_USD_PER_1M=0
AI_FALLBACK_OUTPUT_USD_PER_1M=0
```

## Commands

```text
/ask
/vibe
/attention
/brain show|set|reset
/remember
/memory
/forgetme
/summarize
/remind
/tasks
/cancel-task
/usage
/status
```

## Install / update

Fresh:

```bash
git clone https://github.com/nuldrizz1e/chaoscord-agent.git
cd chaoscord-agent
npm install
cp .env.example .env
nano .env
npm start
```

Existing clone:

```bash
cd ~/chaoscord-agent
git pull
npm install
npm start
```

## Required environment

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
```

Use `DISCORD_GUILD_ID` during development so slash command changes appear quickly.

## Discord intents / permissions

Enable:
- Server Members Intent
- Message Content Intent

Permissions:
- View Channels
- Send Messages
- Read Message History
- Add Reactions
- Create Public Threads
- Send Messages in Threads
- Use Application Commands

Do **not** give Administrator unless a future feature truly requires it.

## Persistence

`data/state.json` contains:
- user memories
- per-server brain/settings
- recent channel state
- reminders
- usage counters

It is gitignored.

## Architecture

```text
Discord
  ↓
social attention layer
  ↓
server brain + user memory + recent context
  ↓
task-aware model router
  ↓
primary provider ──fallback──> secondary provider
  ↓
bounded tool loop
  ├─ Discord read tools
  ├─ guarded Discord actions
  └─ web search / multi-query research
  ↓
reply + telemetry + persistent state
```

## Next layers

- SQLite state
- semantic/vector memory
- URL reader/browser tool
- model routing by measured cost + latency
- recurring tasks
- server knowledge indexing
- structured traces/dashboard
- plugin registry
- sandboxed code execution
