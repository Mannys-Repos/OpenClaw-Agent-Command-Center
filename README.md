```
                                  ╔═══════════════════════════════════╗
                                  ║                                   ║
   ___                    ___ _   ║   OpenClaw Agent Dashboard v1.0   ║
  / _ \ _ __   ___ _ __  / __| |  ║   ─────────────────────────────   ║
 | | | | '_ \ / _ \ '_ \| |  | | ║   Single-pane-of-glass for your   ║
 | |_| | |_) |  __/ | | | |__| | ║   entire AI agent ecosystem       ║
  \___/| .__/ \___|_| |_|\____|_| ║                                   ║
       |_| law                    ╚═══════════════════════════════════╝
```

A standalone dashboard plugin for [OpenClaw](https://github.com/openclaw) that gives you
full visibility and control over your agents, sessions, provider keys, channels, tasks,
and configuration — all from a single browser tab.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (SPA)                              │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌───────┐ │
│  │  Agent    │  │ Session  │  │ Models & │  │  Tasks  │  │ Logs  │ │
│  │  Graph    │  │  Chat    │  │ API Keys │  │  View   │  │ Tail  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  └───┬───┘ │
│       │              │             │              │           │     │
│       └──────────────┴─────────────┴──────────────┴───────────┘     │
│                              │  fetch /api/*                        │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Dashboard HTTP Server (:19900)                     │
│                         src/index.ts                                 │
│                                                                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │  Static Assets │  │  HTML Builder  │  │     API Router         │  │
│  │  CSS, PNG, PWA │  │  dashboard.ts  │  │     api.ts             │  │
│  └────────────────┘  └────────────────┘  └──────────┬─────────────┘  │
│                                                      │               │
│                          ┌───────────────────────────┼────────┐      │
│                          │                           │        │      │
│                          ▼                           ▼        ▼      │
│                   ┌─────────────┐          ┌──────────┐ ┌─────────┐  │
│                   │  OpenClaw   │          │ Provider │ │  Disk   │  │
│                   │  Gateway    │          │   APIs   │ │  I/O    │  │
│                   │  :18789     │          │ (probes) │ │         │  │
│                   └─────────────┘          └──────────┘ └─────────┘  │
│                          │                      │            │       │
└──────────────────────────┼──────────────────────┼────────────┼───────┘
                           │                      │            │
                           ▼                      ▼            ▼
                  ┌─────────────────┐   ┌──────────────┐  ┌────────────────────┐
                  │ OpenClaw Gateway│   │  Anthropic   │  │ ~/.openclaw/       │
                  │ /v1/chat/...   │   │  OpenAI      │  │   openclaw.json    │
                  │ /v1/models     │   │  Google      │  │   .env             │
                  │                │   │  Groq        │  │   agents/          │
                  └─────────────────┘   │  Mistral     │  │   credentials/     │
                                        │  OpenRouter  │  │   extensions/      │
                                        └──────────────┘  └────────────────────┘
```


## Source Layout

```
src/
├── index.ts              Entry point — HTTP server, static asset serving, plugin registration
├── api.ts                All /api/* route handlers (agents, sessions, config, auth, health)
├── dashboard.ts          HTML builder — assembles the single-page app shell
├── dashboard.js.txt      Client-side JS (vanilla, no framework) — inlined into the HTML
├── dashboard.css         All styles — dark theme, responsive, mobile-first
├── resolve-asset.ts      Shared asset path resolver (works under jiti, tsc, and raw node)
├── index.test.ts         Vitest unit tests for plugin registration
├── favicon.png           Browser tab icon
├── logo.png              Dashboard header logo
└── ios_icon.png          PWA / iOS home screen icon
```

---

## Features

### Agent Management
Create, edit, and delete agents. Each agent gets its own workspace with markdown files
(SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, BOOTSTRAP.md) that you can edit in-browser
or auto-generate from a description using any configured model.

### Relationship Graph
Interactive SVG canvas showing agent delegation chains, A2A peer connections, and channel
bindings. Supports pan, zoom, pinch-to-zoom on mobile, and click-to-inspect.

### Session Management
View all sessions across agents (from CLI, gateway, and disk). Spawn new sessions, send
messages through the gateway's chat completions API, and view full conversation history.

### Models & API Status
Live probe of every configured provider — API keys from `.env`, OAuth tokens from
auth-profiles, and custom providers from `models.providers`. Shows key validity,
rate limits, remaining credits, available models, and billing where supported.

### Channels & Bindings
View and manage messaging channels (Discord, Telegram, Slack, WhatsApp, etc.) and their
agent bindings. Add, remove, or toggle channels directly from the dashboard.

### Tasks & Heartbeats
View user-defined recurring tasks and per-agent heartbeat schedules. Create, toggle,
and cancel tasks. Heartbeats are shown separately for clarity.

### Configuration Editor
Full raw JSON editor for `openclaw.json` with validation (structural checks + optional
`openclaw config check` CLI integration). Includes a repair mode for broken configs.

### Live Logs
Tail the gateway log file in real-time via SSE, with journald fallback for systemd
deployments.

### Health Checks
Background health monitor that probes the gateway and all configured providers, surfacing
invalid keys, expired OAuth tokens, and rate limit hits as dismissable banners.

### PWA Support
Add-to-home-screen on iOS and Android. Standalone display, portrait lock, themed status
bar, and proper icons.

---

## API Reference

All routes are under `/api/`. The dashboard UI consumes these — they're also usable
directly for scripting or integration.

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/overview`                   | Full dashboard payload (agents, config, sessions, gateway status) |
| `GET`    | `/api/overview?fast=1`            | Lightweight version (no session scan, no gateway probe) |
| `GET`    | `/api/agents/:id`                 | Single agent with enriched metadata            |
| `PUT`    | `/api/agents/:id`                 | Update agent config                            |
| `POST`   | `/api/agents`                     | Create a new agent                             |
| `DELETE` | `/api/agents/:id`                 | Delete an agent and its bindings               |
| `GET`    | `/api/agents/:id/md/:file`        | Read a workspace markdown file                 |
| `PUT`    | `/api/agents/:id/md/:file`        | Write a workspace markdown file                |
| `DELETE` | `/api/agents/:id/md/:file`        | Delete a workspace markdown file               |
| `POST`   | `/api/agents/:id/md/:file/generate` | Generate markdown from notes via model       |
| `POST`   | `/api/agents/:id/generate-all`    | Generate all workspace MD files from description |
| `GET`    | `/api/sessions`                   | List all sessions (disk + dashboard store)     |
| `GET`    | `/api/sessions/:key`              | Get session with full message history          |
| `POST`   | `/api/sessions/:key/message`      | Send a message to an agent via gateway         |
| `POST`   | `/api/sessions/spawn`             | Create a new dashboard session                 |
| `DELETE` | `/api/sessions/:key`              | Delete a session and all its files             |
| `GET`    | `/api/config`                     | Read parsed config                             |
| `GET`    | `/api/config/raw`                 | Read raw config JSON string                    |
| `PUT`    | `/api/config`                     | Write config (parsed object or raw string)     |
| `POST`   | `/api/config/restart`             | Restart the OpenClaw gateway                   |
| `POST`   | `/api/config/validate`            | Validate config structure                      |
| `GET`    | `/api/bindings`                   | List channel bindings                          |
| `PUT`    | `/api/bindings`                   | Replace all bindings                           |
| `PUT`    | `/api/channels/:name`             | Update a channel                               |
| `DELETE` | `/api/channels/:name`             | Remove a channel                               |
| `GET`    | `/api/tasks`                      | List tasks and heartbeats                      |
| `POST`   | `/api/tasks`                      | Create a recurring task                        |
| `DELETE` | `/api/tasks/:id`                  | Cancel a task                                  |
| `GET`    | `/api/models/status`              | Cached provider status (keys, models, billing) |
| `POST`   | `/api/models/status/refresh`      | Force re-scan all providers                    |
| `GET`    | `/api/health`                     | Live health check (gateway + all providers)    |
| `GET`    | `/api/tools/discover`             | Cached tool registry                           |
| `POST`   | `/api/tools/discover`             | Force re-scan tools                            |
| `GET`    | `/api/logs`                       | Tail log file                                  |
| `GET`    | `/api/logs/stream`                | SSE live log stream                            |
| `GET`    | `/api/dashboard/icons`            | Get custom agent icons                         |
| `PUT`    | `/api/dashboard/icons`            | Set a custom agent icon                        |
| `POST`   | `/api/auth/reveal`                | Reveal full API key or OAuth token             |
| `POST`   | `/api/auth/refresh`               | Refresh an OAuth token                         |
| `DELETE` | `/api/auth/profile`               | Remove an auth profile                         |
| `POST`   | `/api/auth/envkey`                | Add or update an API key in .env               |
| `DELETE` | `/api/auth/envkey`                | Remove an API key from .env                    |

---

## Installation

```bash
# Link for local development
openclaw plugins install -l ./path/to/openclaw-agent-dashboard

# Or copy-install
openclaw plugins install ./path/to/openclaw-agent-dashboard
```

## Configuration

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "agent-dashboard": {
        "enabled": true,
        "config": {
          "port": 19900,
          "title": "OpenClaw Command Center"
        }
      }
    }
  }
}
```

| Option  | Default                    | Description                          |
|---------|----------------------------|--------------------------------------|
| `port`  | `19900`                    | HTTP port for the dashboard server   |
| `title` | `OpenClaw Command Center`  | Page title and PWA name              |

Restart the gateway, then open: **http://localhost:19900**

---

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm run dev        # watch mode
npm test           # run vitest
```

The dashboard serves `dashboard.js.txt` and `dashboard.css` from the `src/` directory
at runtime, so CSS and client JS changes don't require a rebuild — just refresh the
browser. Only changes to `*.ts` files need a `tsc` rebuild.

### Deploy

A `deploy.py` script (gitignored) handles SCP upload to the server and gateway restart.
Keep credentials out of version control.

---

## License

MIT
