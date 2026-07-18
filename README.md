# Threadline

Threadline is a self-hosted Human-Agent Gateway for durable work context, attention management, and decision closure across heterogeneous agent sessions.

Threadline includes a responsive Web workspace backed by the same API as its CLI, alongside a SQLite-backed Gateway and an installable Agent Skill.

## Documentation

- [MVP product and technical spec](docs/mvp-spec.md)
- [UI design brief](docs/ui-design-brief.md)
- [Agent Skill](skills/threadline-gateway/SKILL.md)
- [VPS production deployment](docs/vps-deployment.md)

## Local development

Requires Node.js 22 and npm 10 or newer.

```bash
npm ci
npm run build
npm test
```

Start the API with a local SQLite database:

```bash
THREADLINE_TOKEN=local-secret npm run dev:api
```

PowerShell:

```powershell
$env:THREADLINE_TOKEN = "local-secret"
npm run dev:api
```

Configure and call the CLI:

```bash
threadline config set-url http://127.0.0.1:3000
threadline config set-token local-secret
threadline --json status
```

During development the same command is available through:

```bash
npm run dev:cli -- --json status
```

## Install for an Agent environment

Build the repository once and link the CLI onto the host PATH:

```bash
npm ci
npm run build
npm link --workspace @threadline/cli
threadline --version
```

Install `skills/threadline-gateway/` into the Agent environment's standard Skills directory. For Codex, copy that folder to `$CODEX_HOME/skills/threadline-gateway/` (or `~/.codex/skills/threadline-gateway/` when `CODEX_HOME` is unset). Other Agent Skills-compatible environments can install the same folder without rewriting its instructions.

Configure `THREADLINE_URL`, `THREADLINE_TOKEN`, `THREADLINE_RUNTIME`, `THREADLINE_AGENT`, and `THREADLINE_SESSION_ID` in the Agent environment. The Skill itself does not run a daemon or poll the Gateway.

## Docker deployment

Create a local environment file from `.env.example`, replace the placeholder Token, then run:

```bash
docker compose up --build -d
docker compose ps
```

The complete Web workspace and API are served from `http://127.0.0.1:3000` by default. SQLite data is stored in the named `threadline-data` volume and survives container replacement.

Never commit `.env`, Tokens, or SQLite database files.

For a production VPS behind Cloudflare and Nginx, use
`compose.production.yaml` and the [VPS deployment guide](docs/vps-deployment.md).
This production Compose file binds the Gateway to `127.0.0.1` only.

## API configuration

| Variable | Required | Default |
| --- | --- | --- |
| `THREADLINE_TOKEN` | yes | none |
| `THREADLINE_HOST` | no | `127.0.0.1` locally, `0.0.0.0` in Docker |
| `THREADLINE_PORT` | no | `3000` |
| `THREADLINE_DATABASE` | no | `threadline.sqlite` locally, `/data/threadline.sqlite` in Docker |
| `THREADLINE_WEB_DIR` | no | disabled locally, `/app/public` in Docker |
| `THREADLINE_CORS_ORIGIN` | no | disabled |
| `THREADLINE_BODY_LIMIT_BYTES` | no | `262144` |
| `THREADLINE_RATE_LIMIT_MAX` | no | `120` requests per window |
| `THREADLINE_RATE_LIMIT_WINDOW_MS` | no | `60000` |
| `THREADLINE_TRUST_PROXY` | no | `false`; set `true` only behind the Cloudflare Tunnel |
| `THREADLINE_TELEGRAM_BOT_TOKEN` | no | disabled unless paired with `THREADLINE_TELEGRAM_CHAT_ID` |
| `THREADLINE_TELEGRAM_CHAT_ID` | no | disabled unless paired with `THREADLINE_TELEGRAM_BOT_TOKEN` |
| `THREADLINE_HTTP_PROXY` | no | none; use `http://127.0.0.1:7890` for local Clash |
| `THREADLINE_NOTIFICATION_RETRY_ATTEMPTS` | no | `3`, including the initial attempt |

When Telegram is configured, new Decision requests and Alert submissions are delivered as
one-way messages. Delivery is asynchronous: Telegram errors are recorded in the API log
without changing the successful creation of the underlying Threadline record.
