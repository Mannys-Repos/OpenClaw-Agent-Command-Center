# Setup & Configuration

## Installation

```bash
# Link for development
openclaw plugins install -l ./path/to/openclaw-agent-command-center

# Copy-install for production
openclaw plugins install ./path/to/openclaw-agent-command-center
```

## Configuration

Add the plugin to your `~/.openclaw/openclaw.json`:

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

Restart the gateway, then open **http://localhost:19900**.

### Options

| Option           | Default                   | Description                                                                 |
|------------------|---------------------------|-----------------------------------------------------------------------------|
| `port`           | `19900`                   | HTTP port for the dashboard server                                          |
| `title`          | `OpenClaw Command Center` | Page title and PWA name                                                     |
| `allowedOrigins` | `[]`                      | Extra origins allowed to call the API (e.g. `["http://your-server:19900"]`) |
| `bind`           | `0.0.0.0`                 | Bind address (`127.0.0.1` to restrict to local only)                        |

## Security

On first load you'll be prompted to create a username and password. Credentials are
stored hashed with scrypt in `~/.openclaw/extensions/openclaw-agent-dashboard/.credentials`.

All subsequent visits and API calls require authentication via session cookie or
`Authorization: Bearer <token>`.

Cross-origin requests are blocked unless the origin is in `allowedOrigins`.

To reset credentials:

```bash
rm ~/.openclaw/extensions/openclaw-agent-dashboard/.credentials
```

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm run dev        # watch mode
npm test           # run vitest
```

CSS and client JS (`src/assets/dashboard.css`, `src/assets/dashboard.js.txt`) are served
from `src/assets/` at runtime — changes don't require a rebuild, just a browser refresh.
Only `*.ts` changes need `tsc`.

## Project Structure

```
src/
  server/              Server-side code
    index.ts           Plugin entry point
    api.ts             API route handler
    auth.ts            Authentication (scrypt hashing, session tokens)
    dashboard.ts       Dashboard HTML builder
    resolve-asset.ts   Asset path resolver
  orchestrator/        Task Flow Orchestrator logic
    types.ts           Shared type definitions
    utils.ts           Validation, sorting, tool ID helpers
    codegen.ts         Code generation (.flow.ts files, AGENTS.md snippets)
    codegen.test.ts    Tests for codegen
    utils.test.ts      Tests for utils
  assets/              Static assets served at runtime
    dashboard.css      Dashboard stylesheet
    dashboard.js.txt   Client-side JavaScript (served inline in HTML)
    favicon.png        Favicon
    ios_icon.png       iOS home screen icon
    logo.png           Logo
  __tests__/           Integration tests
Tasks/                 Task Flow definitions
scripts/               Deployment and operations scripts
docs/                  Documentation and screenshots
```
