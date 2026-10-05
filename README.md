# chaoscord-agent

A Discord AI agent that is meant to feel like it actually lives in the server instead of waiting behind a boring `/ask` command.

## Current architecture

- Discord.js v14
- OpenAI-compatible model provider
- optional fallback model/provider
- persistent JSON memory
- recent-channel context
- ambient participation scoring
- reply/mention/DM awareness
- personality modes
- attention modes
- slash commands
- OpenAI-style tool calling
- Discord-native read tools
- optional Tavily web search
- anti-spam cooldowns

## Commands

- `/ask` — direct prompt
- `/vibe normal|chaos|chill|engineer|menace`
- `/attention quiet|smart|active`
- `/remember`
- `/memory`
- `/forgetme`
- `/summarize`
- `/status`

## Built-in agent tools

When the selected model supports OpenAI-compatible tool calling, Chaoscord can call:

- `get_server_info`
- `get_channel_info`
- `get_member_info`
- `get_recent_messages`
- `remember_user_note`
- `search_web` when Tavily is configured

The tool loop is capped to prevent runaway calls.

## Setup

Clone:

```bash
git clone https://github.com/nuldrizz1e/chaoscord-agent.git
cd chaoscord-agent
npm install
cp .env.example .env
nano .env
```

Required:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
```

Recommended while developing:

```env
DISCORD_GUILD_ID=your_test_server_id
```

Guild slash commands update almost immediately. If `DISCORD_GUILD_ID` is omitted, commands are registered globally and may take longer to propagate.

Then:

```bash
npm start
```

## Discord bot permissions / intents

In the Discord Developer Portal, enable the intents this project uses:

- Server Members Intent
- Message Content Intent

Invite the bot with permissions to:

- View Channels
- Send Messages
- Read Message History
- Add Reactions
- Use Application Commands

Do not give it Administrator unless you later add a feature that truly requires it.

## Provider fallback

Optional:

```env
AI_FALLBACK_API_KEY=
AI_FALLBACK_BASE_URL=
AI_FALLBACK_MODEL=
```

Fallback activates for timeouts, 429s, and server-side provider failures.

## Web search

Optional:

```env
TAVILY_API_KEY=
```

If absent, the web-search tool simply is not exposed to the model.

## State

Runtime memory is stored in:

```text
data/state.json
```

It is gitignored. Explicit long-term user notes survive restarts.

## Ambient participation

The agent scores ordinary channel messages and only jumps in when the score is strong enough.

- `quiet` — never enters uninvited
- `smart` — conservative
- `active` — more willing to join

Ambient replies also have a cooldown so one active server does not turn the bot into spam.

## Security notes

- never commit `.env`
- keep the Discord token private
- keep provider API keys private
- tools in this version are intentionally read-heavy
- no moderation or destructive Discord actions are included yet

## Next architecture

Planned next layers:

1. per-guild configuration
2. vector or SQLite memory instead of flat JSON
3. model router by task/cost/latency
4. permission-gated Discord actions
5. scheduled tasks and reminders
6. richer web research pipeline
7. server knowledge/indexing
8. observability and token/cost tracking
9. plugin registry
10. autonomous-but-bounded workflows

