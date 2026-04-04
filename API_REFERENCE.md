# API Reference

These are the dashboard's own REST endpoints served by `api.ts` on the dashboard HTTP
server (default port 19900). They are not part of the core OpenClaw gateway API.

The dashboard UI consumes these internally — they're also usable directly for scripting
or integration.

## Overview

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/overview`                   | Full dashboard payload (agents, config, sessions, gateway status) |
| `GET`    | `/api/overview?fast=1`            | Lightweight version (no session scan, no gateway probe) |

## Agents

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/agents/:id`                 | Single agent with enriched metadata            |
| `PUT`    | `/api/agents/:id`                 | Update agent config                            |
| `POST`   | `/api/agents`                     | Create a new agent                             |
| `DELETE` | `/api/agents/:id`                 | Delete an agent and its bindings               |
| `GET`    | `/api/agents/:id/md/:file`        | Read a workspace markdown file                 |
| `PUT`    | `/api/agents/:id/md/:file`        | Write a workspace markdown file                |
| `DELETE` | `/api/agents/:id/md/:file`        | Delete a workspace markdown file               |
| `POST`   | `/api/agents/:id/md/:file/generate` | Generate markdown from notes via model       |
| `POST`   | `/api/agents/:id/generate-all`    | Generate all workspace MD files from description |

## Sessions

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/sessions`                   | List all sessions (disk + dashboard store)     |
| `GET`    | `/api/sessions/:key`              | Get session with full message history          |
| `POST`   | `/api/sessions/:key/message`      | Send a message to an agent via gateway         |
| `POST`   | `/api/sessions/spawn`             | Create a new dashboard session                 |
| `DELETE` | `/api/sessions/:key`              | Delete a session and all its files             |

## Configuration

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/config`                     | Read parsed config                             |
| `GET`    | `/api/config/raw`                 | Read raw config JSON string                    |
| `PUT`    | `/api/config`                     | Write config (parsed object or raw string)     |
| `POST`   | `/api/config/restart`             | Restart the OpenClaw gateway                   |
| `POST`   | `/api/config/validate`            | Validate config structure                      |

## Channels & Bindings

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/bindings`                   | List channel bindings                          |
| `PUT`    | `/api/bindings`                   | Replace all bindings                           |
| `PUT`    | `/api/channels/:name`             | Update a channel                               |
| `DELETE` | `/api/channels/:name`             | Remove a channel                               |

## Tasks

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/tasks`                      | List tasks and heartbeats                      |
| `POST`   | `/api/tasks`                      | Create a recurring task                        |
| `DELETE` | `/api/tasks/:id`                  | Cancel a task                                  |

## Models & Providers

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/models/status`              | Cached provider status (keys, models, billing) |
| `POST`   | `/api/models/status/refresh`      | Force re-scan all providers                    |
| `GET`    | `/api/health`                     | Live health check (gateway + all providers)    |

## Tools

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/tools/discover`             | Cached tool registry                           |
| `POST`   | `/api/tools/discover`             | Force re-scan tools                            |

## Logs

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/logs`                       | Tail log file                                  |
| `GET`    | `/api/logs/stream`                | SSE live log stream                            |

## Dashboard

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `GET`    | `/api/dashboard/icons`            | Get custom agent icons                         |
| `PUT`    | `/api/dashboard/icons`            | Set a custom agent icon                        |

## Auth

| Method   | Path                              | Description                                    |
|----------|-----------------------------------|------------------------------------------------|
| `POST`   | `/api/auth/reveal`                | Reveal full API key or OAuth token             |
| `POST`   | `/api/auth/refresh`               | Refresh an OAuth token                         |
| `DELETE` | `/api/auth/profile`               | Remove an auth profile                         |
| `POST`   | `/api/auth/envkey`                | Add or update an API key in .env               |
| `DELETE` | `/api/auth/envkey`                | Remove an API key from .env                    |
