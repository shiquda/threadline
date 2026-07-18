# Threadline VPS Deployment

This is the production path for one private Threadline instance on the
established VPS platform: Cloudflare proxies the public hostname, Nginx
terminates HTTPS on the VPS, and Docker exposes the Gateway to loopback only.

## Architecture

```text
Browser or Agent CLI -> Cloudflare -> Nginx :443 -> 127.0.0.1:3000 -> gateway container
```

The Gateway is not reachable through the VPS public IP on port 3000. Nginx is
the only process that can reach the loopback-bound Docker port. Cloudflare
Tunnel is not required for this deployment mode.

## Platform Convention

The existing platform convention is:

- Public service hostname: `https://<service-name>.shiquda.link`.
- A Cloudflare-proxied A record points to the current VPS IPv4, `209.50.255.97`.
- Nginx uses a Let's Encrypt certificate and proxies to `127.0.0.1:<port>`.

Use `threadline.shiquda.link` only after confirming it is the intended new
hostname. Do not reuse `xui.shiquda.link`; it belongs to the existing XUI
service.

## Before Deployment

1. Confirm the final Threadline hostname and create its Cloudflare-proxied A
   record using the VPS platform's established DNS workflow.
2. Provision or renew the Nginx Let's Encrypt certificate for that hostname.
   Cloudflare SSL mode should be **Full (strict)** once the origin certificate
   is valid.
3. Keep the VPS firewall rules under review. Existing platform services already
   require public `80/443`; do not blindly replace firewall rules. The Gateway
   itself must never publish port 3000 beyond loopback.
4. Cloudflare Access is optional for the Web hostname. Do not turn Access on
   for the same hostname used by the current CLI until the CLI supports
   Cloudflare service-token headers. Apply a Cloudflare WAF/rate-limit rule to
   `/api/v1/*` in addition to the Gateway's own Bearer Token and rate limit.

## VPS Commands

Run as the deployment user. Until the pull request is merged, use the feature
branch shown below.

```bash
git clone https://github.com/shiquda/threadline.git /opt/threadline
cd /opt/threadline
git checkout agent/mvp-core
umask 077
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -base64 48
```

Set the generated value as `THREADLINE_TOKEN`. Set
`THREADLINE_CORS_ORIGIN=https://<confirmed-threadline-hostname>`. Do not
commit `.env.production` or place Tokens in shell history.

Validate and start the loopback-only stack:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up --build -d
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml exec -T gateway \
  node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(console.log)"
ss -ltnp | grep -F ':3000'
```

The final command must show `127.0.0.1:3000`, never `0.0.0.0:3000` or the VPS
public IPv4.

Install a hostname-specific Nginx configuration. The repository provides
`deploy/nginx/threadline.conf.template`; replace `__THREADLINE_HOST__` with the
confirmed hostname after its certificate exists, enable the site, then validate
and reload:

```bash
nginx -t
systemctl reload nginx
```

Verify the public hostname through Cloudflare. The Web workspace and API are
served by the same origin. Configure Agent CLI with the HTTPS hostname and the
Gateway Bearer Token.

## Operations

- Update: pull the reviewed commit, then rerun `docker compose ... up --build -d`.
- Back up SQLite daily with SQLite's online backup API, not a raw copy of only
  the `.sqlite` file while the service is running. Store encrypted backups
  outside the VPS and test a restore periodically.
- Monitor Docker health, VPS disk usage, Nginx certificate renewal, and
  Cloudflare DNS/proxy status. Gateway logs can contain work titles and IDs.
- Rotate `THREADLINE_TOKEN` and Telegram credentials when a trusted machine or
  Agent environment may have been exposed.
