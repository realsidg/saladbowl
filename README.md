# Saladbowl

A self-hosted Fishbowl (salad bowl) party game for a group in one room, each on their own phone.

- **One password, for the host only.** Guests join by scanning the host's QR code. Nothing in a game is reachable without being in it.
- **The server owns the clock.** A turn ends on time even if every phone is locked. A phone that wakes up jumps straight back to the right screen.
- **Each phone shows its role:** the clue-giver sees the word on a paper slip with big buttons; everyone else sees a huge countdown, who is up, and the score.
- **One container, one SQLite file.** No third-party services at runtime.

Rebuilt from scratch using the game rules of [avimoondra/fishbowl](https://github.com/avimoondra/fishbowl) (MIT).

## Deploy

See [docs/deploy.md](docs/deploy.md).

## Develop

Needs Node 24.

```sh
npm install
cp .env.example .env
npm run hash-password            # paste the result into .env as SALADBOWL_PASSWORD_HASH
# also set SALADBOWL_SESSION_SECRET in .env (openssl rand -base64 48)

npm run dev -w server            # API + WebSocket on :3100
API_PORT=3100 portless saladbowl npm run dev -w web   # https://saladbowl.gs.localhost
```

Without portless, run `npm run dev -w web` and open http://localhost:5173 (add `http://localhost:5173` to `PUBLIC_ORIGIN`).

## Test

```sh
npx vitest run --maxWorkers=2    # engine, server, web
bash e2e/run.sh                  # full game on simulated phones (needs portless + playwright-cli)
```

## Layout

| Folder | What |
|---|---|
| `shared/` | message types, schemas and limits used by both sides |
| `server/src/engine/` | the game rules as pure functions |
| `server/src/realtime/` | WebSocket hub, turn timers, per-viewer snapshots |
| `server/src/http/` | login, invites, security headers |
| `web/` | React app ("Paper slips" design, see `docs/design-tokens.md`) |
| `docs/superpowers/` | design spec and build plan |
