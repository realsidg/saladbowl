# Deploying Saladbowl

Saladbowl is one container with one data folder (`/data`, a SQLite file). It needs HTTPS in front of it: the login cookie is `Secure`, and phones need HTTPS for screen wake lock and "Add to home screen".

## 1. Make the password hash

The server never stores the password itself. Make a hash once:

```sh
docker build -t saladbowl .
docker run --rm -it saladbowl node server/dist/hash-password.js
```

Type the password twice (at least 10 characters). It prints a line like `scrypt:32768:8:1:…:…`. That line is `SALADBOWL_PASSWORD_HASH`. It contains no `$`, so it is safe in `.env` files and Compose.

To change the password later, make a new hash and redeploy. Every phone is logged out.

## 2. Settings

| Variable | Value |
|---|---|
| `SALADBOWL_PASSWORD_HASH` | the line from step 1 |
| `SALADBOWL_SESSION_SECRET` | 32+ random bytes, e.g. `openssl rand -base64 48` |
| `PUBLIC_ORIGIN` | the public URL, no trailing slash, e.g. `https://saladbowl.example.com` |
| `TRUST_PROXY` | the reverse proxy's address or network (see below) |

Optional: `PORT` (default 3000), `DATA_DIR` (default `/data`).

**`TRUST_PROXY`** decides whose `X-Forwarded-For` header is believed for the real client address, which the login rate limit uses. Set it to the proxy's Docker network (for Traefik on a default Docker network, `172.16.0.0/12` works). Never publish port 3000 directly to the internet with `TRUST_PROXY` set: anyone could then fake their address and dodge the rate limit.

## 3. Dokploy (Traefik)

1. Create an **Application** from the GitHub repo `realsidg/saladbowl`, branch `main`.
2. Build type: **Dockerfile** (path `Dockerfile`).
3. **Environment**: the four variables above.
4. **Volumes**: a named volume mounted at `/data`.
5. **Domains**: add the domain, container port `3000`, HTTPS on (Let's Encrypt).
6. Deploy. `https://<domain>/healthz` should return `{"ok":true}`.

Don't add a port mapping; Traefik reaches the container over Dokploy's network.

## 4. Plain Docker Compose

Copy `docker-compose.example.yml`, fill in the values, and put it behind your own HTTPS proxy.

## Backups

Everything lives in `/data/saladbowl.db` (plus `-wal`/`-shm` files while running). Games older than a week are deleted automatically, so there is little worth backing up.

## What it needs at runtime

Nothing outside the container: no database server, no CDNs, no analytics, no error reporting service. Fonts are bundled.
