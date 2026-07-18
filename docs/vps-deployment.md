# Threadline VPS Deployment

This is the production deployment path for one private Threadline instance.
It uses Cloudflare Tunnel so the VPS has no public Threadline port. Cloudflare
Access protects the Web hostname; the Agent CLI uses a separate API hostname
and the Gateway's Bearer Token.

## Architecture

```text
Web browser -> Cloudflare Access -> Cloudflare Tunnel -> gateway container
Agent CLI   -> Cloudflare WAF    -> Cloudflare Tunnel -> gateway container
```

Both public hostnames terminate in the same gateway container. The Docker
Compose file deliberately has no `ports` section, so the Gateway cannot be
reached through the VPS public IP. The gateway still has outbound network
access for Telegram when configured.

## Before deployment

1. Use a supported Linux VPS with Docker Engine and Docker Compose Plugin.
2. Restrict the VPS firewall to SSH only. Use SSH keys, disable password login,
   and restrict SSH source addresses or use Tailscale for administration.
3. Create a Cloudflare Tunnel in Zero Trust. Add both public hostnames and map
   each to `http://gateway:3000`:
   - `threadline.example.com` for the Web workspace.
   - `api.threadline.example.com` for the CLI and Agent Skills.
4. Create a Cloudflare Access self-hosted application for
   `threadline.example.com/*`. Allow only the intended identity or IdP group
   and require MFA.
5. Keep `api.threadline.example.com` outside Access for this version because
   the current CLI authenticates with the Gateway Bearer Token, not a
   Cloudflare Access service token. Apply a Cloudflare WAF rate rule to
   `api.threadline.example.com/api/v1/*`, for example 120 requests per minute
   per source IP with a one-minute block. Do not create an Access bypass for
   the Web hostname.

The API hostname remains protected by Cloudflare's edge, the tunnel-only
origin, the Gateway's constant-time Bearer Token validation, application rate
limits, and strict CORS. Generate a long unique Gateway Token and keep it only
in trusted Agent environments.

## VPS commands

Run the following as the deployment user. Until the pull request is merged,
use the feature branch shown below.

```bash
git clone https://github.com/shiquda/threadline.git
cd threadline
git checkout agent/mvp-core
umask 077
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production` and set the two mandatory values:

```bash
openssl rand -base64 48
# Paste the result into THREADLINE_TOKEN.
# Paste the Cloudflare dashboard tunnel token into CLOUDFLARE_TUNNEL_TOKEN.
```

Set `THREADLINE_CORS_ORIGIN` to the exact Web hostname. Telegram values are
optional. Do not commit `.env.production`, and do not place it in shell history
or a ticket.

Validate and start the stack:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up --build -d
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 gateway cloudflared
docker compose --env-file .env.production -f compose.production.yaml exec -T gateway \
  node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(console.log)"
```

To validate the checked-in template before creating the real environment file:

```bash
THREADLINE_ENV_FILE=.env.production.example \
  docker compose --env-file .env.production.example -f compose.production.yaml config --quiet
```

Confirm `ss -ltnp` on the VPS does not show a listener on port 3000. Then open
the Web hostname in a browser: Cloudflare Access should require your identity,
and the workspace should load after entering the Gateway Token locally in the
browser. Configure each Agent CLI with `https://api.threadline.example.com`
and the same Gateway Token.

## Operations

- Update: pull the reviewed commit, rerun the two `docker compose ... up --build -d`
  commands, and inspect `ps` plus the Gateway health check.
- Backup daily with SQLite's online backup API, not a raw copy of only the
  `.sqlite` file while the service is running. Store encrypted backups outside
  the VPS and test a restore periodically.
- Monitor Docker health, VPS disk usage, and Cloudflare Tunnel status. Retain
  Gateway logs only as long as required; they may contain work titles and IDs.
- Rotate `THREADLINE_TOKEN`, Telegram credentials, and the Tunnel Token when a
  trusted machine, Agent environment, or deployment file may have been exposed.

## Security boundaries

Cloudflare Access protects the human Web entry point. The API hostname is
token-authenticated for CLI compatibility, so it must remain a private-use
endpoint with a high-entropy Token and Cloudflare WAF/rate limits. Adding
Cloudflare Access service-token headers to the CLI is the next defense-in-depth
improvement if Agents will run from untrusted networks.
