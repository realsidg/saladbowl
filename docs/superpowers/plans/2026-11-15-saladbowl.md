# Saladbowl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Saladbowl: a self-hosted, password-protected, phone-first Fishbowl game. One Node process owns the game state and the clock, and runs the game for phones in one room.

**Architecture:** An npm-workspaces monorepo with three parts:
- `shared/` holds the message protocol, zod schemas and limits.
- `server/` is a Fastify server with WebSocket and the SQLite built into Node. A pure game engine (`applyIntent`) holds all the rules. A hub per game runs intents one at a time, owns turn timers, and sends each socket its own view.
- `web/` is a React 19 + Vite frontend in the approved "Paper slips" look.

**Tech Stack:** Node 24, TypeScript 5, Fastify 5 (`@fastify/websocket`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/static`), `node:sqlite`, zod, React 19, Vite, `qrcode`, `@fontsource/kalam`, `@fontsource/rubik`, Vitest, `playwright-cli` for end-to-end tests.

**Spec:** `docs/superpowers/specs/2026-11-15-saladbowl-design.md`. Read it before any task. The mockups are in `/home/dev/projects/fishbowl/.superpowers/mockups/`: `index.html` for layout, `style.html` section A for the look, `colours.html` Tangerine for the team colour.

## Global Constraints

- **English only.** No i18n layer. No third-party requests at runtime: no CDNs, no Google Fonts, no Sentry, no analytics.
- **Limits** (`shared/src/limits.ts`, used by both sides):
  - word 1–40 chars, name 1–20 chars, both trimmed;
  - secondsPerTurn 10–180 (default 60); wordsPerPlayer 1–10 (default 6); rounds 1–6 (default `taboo, charades, password`);
  - JSON body 16 KB; WebSocket message 4 KB; 20 WebSocket messages a second per socket.
- **Carryover:** only if more than 2000 ms are left.
- **Teams:** ids `tangerine` (`#ff8a1f`, dark text) and `lagoon` (`#7fd6cc`, dark text). Background `#14535c`. Display font Kalam, UI font Rubik, both self-hosted.
- **Cookies:**
  - `sb_host` (30 days) and `sb_player` (until the game ends + 1 day);
  - flags `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` unless `COOKIE_SECURE=false`;
  - value `<sessionId>.<hmac>`; HMAC-SHA256 with key `HMAC(SALADBOWL_SESSION_SECRET, SALADBOWL_PASSWORD_HASH)`.
- **Login limits:** 5 failures per IP in 15 minutes, then a lockout of `min(2^(failures-5), 60)` minutes. More than 50 failures across the site in a rolling hour locks login site-wide for 15 minutes. Invite lookups and redeems: 20 per IP per 15 minutes. Game creation: 10 per hour per host session.
- **Cleanup:** delete games that ended over 7 days ago, or that have been idle for more than 2 days.
- **Env:**
  - `SALADBOWL_PASSWORD_HASH`, `SALADBOWL_SESSION_SECRET` (≥32 bytes), `PUBLIC_ORIGIN` are required. **Plan decision:** `PUBLIC_ORIGIN` takes a comma-separated list, and the first entry is used for invite URLs. This lets dev allow both `https://saladbowl.gs.localhost` and `http://saladbowl.gs.localhost:1355`.
  - `TRUST_PROXY` (default `false`), `DATA_DIR` (default `/data`), `PORT` (default 3000), `COOKIE_SECURE` (default `true`).
- **Plan decision (data):** each game's full state is stored as one JSON column (`games.state_json`). Sessions get their own table. This replaces the spec's normalised table list. The spec's real requirement, that in-memory state can always be rebuilt from SQLite, still holds, and the engine stays one pure type. Flagged to the owner at handover.
- **Tests:** always `npx vitest run --maxWorkers=2` (the server has a shared memory cap). Never run suites in parallel worktrees.
- **Copy:** plain, short, sentence case, no all-caps labels.

## Review Focus

1. **A phone sleeps mid-turn and wakes 30+ seconds later.** It must show the current phase (review, or the next player's turn), not a stale countdown or a negative number. Test owner: Task 9 (`clock.test.ts` with a wrapped offset) and Task 12 (end-to-end).
2. **A double-tap on "Got it", or a tap that lands just as time runs out.** It must count at most one card, and never against the next turn. Test owner: Task 3 (stale `turnId` and a `gotIt` after `timeUp`), Task 11 (300 ms debounce).
3. **The server restarts while a turn is running.** The turn still ends at its original `endsAt`; if that time already passed, it moves to review when the server starts. Test owner: Task 8.
4. **Someone opens an old or ended game's invite, or a mangled link.** They see a clear "This invite no longer works" page and get no cookie. Test owner: Task 7.
5. **Two people join with the same name, or a name of only spaces or emoji.** Names are trimmed. Duplicates within a game are rejected with a clear message. A name of only spaces is rejected. Test owner: Task 2.

---

### Task 1: Workspace and shared protocol

**Files:**
- Create: `package.json` (workspaces `shared`, `server`, `web`; scripts `test`, `build`, `dev`, `hash-password`), `tsconfig.base.json`, `vitest.workspace.ts`, `.nvmrc` (`24`)
- Create: `shared/package.json`, `shared/src/limits.ts`, `shared/src/protocol.ts`, `shared/src/index.ts`
- Test: `shared/src/protocol.test.ts`

**Interfaces:**
- Produces:
  - `TeamId = 'tangerine' | 'lagoon'`
  - `RoundKind = 'taboo' | 'charades' | 'password'`
  - `Settings { secondsPerTurn: number; wordsPerPlayer: number; rounds: RoundKind[]; allowSkips: boolean; startingLetter: string | null; wordSource: 'players' | 'host' }` and `DEFAULT_SETTINGS`
  - `Intent`, a zod-validated discriminated union on `type`:
    - `setName{name}`
    - `addWord{word}`, `editWord{cardId, word}`, `removeWord{cardId}`
    - `setHostWordList{words: string[]}`
    - `updateSettings{patch: Partial<Settings>}`
    - `makeTeams`, `shuffleTeams`, `movePlayer{playerId, team}`, `backToLobby`, `startGame`
    - `startTurn{turnId}`, `gotIt{turnId}`, `skip{turnId}`, `undoLastGotIt{turnId}`
    - `reviewToggle{turnId, cardId}`, `confirmReview{turnId}`
    - `pause{turnId}`, `resume{turnId}`, `skipPlayer{turnId}`
    - `kickPlayer{playerId}`, `resetInvite`, `endGame`
  - `parseClientMessage(raw: string): { type: 'intent'; intent: Intent } | { type: 'ping'; t: number } | null`, which returns `null` on bad JSON, a schema failure, or more than 4096 bytes
  - `ServerMessage = { type: 'snapshot'; serverNow: number; snapshot: Snapshot } | { type: 'pong'; t: number; serverNow: number } | { type: 'error'; code: ErrorCode; message: string }`
  - `Snapshot`: the shape defined in Task 4's Interfaces block. Declare it here so both sides import it.
  - `ErrorCode`: a string union. Start with `'not_host' | 'not_your_turn' | 'stale_turn' | 'bad_phase' | 'invalid' | 'name_taken' | 'limit' | 'skips_disabled' | 'letter_mismatch'`.

- [ ] **Step 1:** Write `protocol.test.ts`:
  - `parseClientMessage('{"type":"intent","intent":{"type":"addWord","word":"  Taj  "}}')` gives the word `"Taj"`, trimmed by the schema.
  - A word of 41 chars gives `null`.
  - A name of `"   "` gives `null`.
  - `updateSettings` with `secondsPerTurn: 9` gives `null`; with `181` gives `null`.
  - `rounds: []` gives `null`.
  - An unknown `type` gives `null`.
  - A 5000-byte string gives `null`.
  - `{"type":"ping","t":1}` is parsed.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 shared`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement `limits.ts`, `protocol.ts` and `index.ts`. Limits are exported constants. Schemas use `z.string().trim().min().max()`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat: workspace scaffold and shared protocol`.

### Task 2: Engine: lobby, players, words, teams, start

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/engine/types.ts`, `server/src/engine/lobby.ts`, `server/src/engine/apply.ts`
- Test: `server/src/engine/lobby.test.ts`

**Interfaces:**
- Consumes: `Intent`, `Settings`, `TeamId`, `ErrorCode`, limits (Task 1).
- Produces:
  - `GameState`:
    ```ts
    {
      id; inviteToken; phase: 'lobby'|'teams'|'playing'|'ended';
      settings: Settings;
      players: Player[];
      cards: Card[];
      hostWordList: string[] | null;
      roundIndex: number;
      bowl: string[];        // card ids still in the bowl this round
      turns: Turn[];
      teamCursor: Record<TeamId, number>;
      nextTeam: TeamId;
      carry: { playerId: string; remainingMs: number } | null;
      createdAt; updatedAt; endedAt: number | null;
    }
    ```
  - `Player { id; name; team: TeamId | null; order: number; kicked: boolean; joinedAt: number }`
  - `Card { id; playerId: string | null; word }`
  - `Turn`: see Task 3.
  - `Actor { playerId: string | null; isHost: boolean }`
  - `Ctx { now: number; rng: () => number; newId: () => string }`
  - `createGame(ctx: Ctx, inviteToken: string): GameState`
  - `addPlayer(s: GameState, name: string, ctx: Ctx): Result<{ state: GameState; playerId: string }>`
  - `applyIntent(s: GameState, actor: Actor, intent: Intent, ctx: Ctx): Result<GameState>`, where `Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode }`. It never mutates its input.

- [ ] **Step 1:** Write `lobby.test.ts`. Use a seeded rng and a counter `newId`.
  - **Names:**
    - `addPlayer` trims names. A duplicate name, compared case-insensitively, gives `name_taken`. A blank name gives `invalid`.
    - In phase `teams` or `playing`, a new player goes onto the smaller team, with ties going to `lagoon`, and gets `order` = that team's max + 1.
  - **Words:**
    - `addWord` past `wordsPerPlayer` gives `limit`.
    - With `startingLetter: 'S'`, `addWord('taj')` gives `letter_mismatch` and `addWord('sun')` is ok.
    - `editWord` or `removeWord` on another player's card gives `invalid`.
    - Word intents outside `lobby` give `bad_phase`.
  - **Host-only intents:** `updateSettings`, `makeTeams`, `shuffleTeams`, `movePlayer`, `backToLobby`, `startGame`, `setHostWordList`, `kickPlayer`, `resetInvite` and `endGame` from a non-host give `not_host`.
  - **`makeTeams`:** splits the named players into two teams that differ in size by at most 1, and sets phase `teams`.
  - **`startGame`** gives `invalid` if:
    - there are fewer than 2 players;
    - a team is empty;
    - any player has fewer than `wordsPerPlayer` words (in `players` mode);
    - the host list is empty (in `host` mode).

    On success: phase `playing`, `roundIndex` 0, `bowl` = all card ids, and a first `Turn` with phase `ready` for the first player of `nextTeam`.
  - **Locked settings:** after start, `updateSettings` with `wordsPerPlayer` or `wordSource` gives `bad_phase`, while `secondsPerTurn` is allowed.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 server/src/engine`. Expect FAIL.
- [ ] **Step 3:** Implement `types.ts`, `lobby.ts` and the `apply.ts` dispatcher. In host mode, `setHostWordList` creates cards with `playerId: null`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(engine): lobby, words, teams, start`.

### Task 3: Engine: turns, review, rounds, host controls

**Files:**
- Create: `server/src/engine/turns.ts`, `server/src/engine/order.ts`
- Modify: `server/src/engine/apply.ts`, which dispatches turn intents and the internal `timeUp`
- Test: `server/src/engine/turns.test.ts`, `server/src/engine/order.test.ts`

**Interfaces:**
- Produces:
  - `Turn`:
    ```ts
    {
      id; playerId; team: TeamId; roundIndex;
      phase: 'ready'|'playing'|'paused'|'review'|'done';
      durationMs; endsAt: number | null; remainingMs: number | null;
      currentCardId: string | null;
      shown: { cardId: string; outcome: 'got'|'skipped'|'missed' }[];
      emptiedBowl: boolean;
    }
    ```
  - `timeUp(s: GameState, turnId: string, ctx: Ctx): GameState`, internal and called by the hub. Ignored (returns `s`) if the turn isn't `playing`.
  - `nextDeadline(s: GameState): { turnId: string; at: number } | null`
  - `nextPlayer(s: GameState): Player | null` (in `order.ts`)
  - `activeTurn(s: GameState): Turn | null`

- [ ] **Step 1:** Write `order.test.ts`:
  - With teams T = [a, b, c] and L = [x, y], `ready` turns alternate teams and each team keeps its own rotation: a, x, b, y, c, x, a.
  - Kicked players are skipped.
  - A late joiner appended to L comes up in L's next rotation.
  - If one team has nobody left, turns go only to the other team.
  - If no players are left, `nextPlayer` returns `null`.
- [ ] **Step 2:** Write `turns.test.ts`. Inject `now` values.
  - **Who can act, and on which turn:**
    - `startTurn` from anyone other than the turn's player gives `not_your_turn`.
    - A `turnId` that isn't the active turn gives `stale_turn`. This covers a `gotIt` after `timeUp`, and a second `confirmReview`.
  - **Starting:** `startTurn` sets `endsAt = now + durationMs` (60000 by default) and draws a `currentCardId` from `bowl`.
  - **`gotIt`:** records `got`, removes the card from `bowl`, and draws another card.
  - **`skip`:**
    - With `allowSkips: false`, it gives `skips_disabled`.
    - Otherwise it records `skipped` and keeps the card in `bowl`. It draws a different card when one exists; with a single card left it redraws that card.
  - **`undoLastGotIt`:** the last `got` card goes back into `bowl` and becomes `currentCardId`. The previous current card returns to `bowl`.
  - **`timeUp`:** phase `review`, `remainingMs` 0, and the current card recorded as `missed` and kept in `bowl`.
  - **Bowl empties at `now = endsAt - 20000`:** phase `review`, `emptiedBowl: true`, `remainingMs` 20000. Then `confirmReview` gives:
    - `roundIndex` 1;
    - `bowl` = all cards again;
    - `carry` = { same player, 20000 };
    - the next turn has the same `playerId` with `durationMs` 20000.
  - **Bowl empties with 1500 ms left:** after `confirmReview`, there is no carry and the next turn goes to the other team.
  - **Bowl empties, and `reviewToggle` unticks one card:** after `confirmReview`, `roundIndex` doesn't change, the card is back in `bowl`, and the next turn is the same player with `durationMs` = the frozen `remainingMs`.
  - **Last round's bowl empties:** after `confirmReview`, phase `ended` and `endedAt` is set.
  - **`reviewToggle`:**
    - Works from the turn's player or the host. Anyone else gives `not_your_turn`.
    - It flips `got` ↔ `missed` only on cards in `shown`.
    - Outside `review` it gives `bad_phase`.
  - **Pause and resume:**
    - `pause` (host) stores `remainingMs = endsAt - now` and sets `endsAt` to null.
    - `resume` sets `endsAt = now + remainingMs`.
    - While paused, `nextDeadline` is null.
  - **`skipPlayer`** (host) is only allowed in `ready`. It marks the turn `done` and creates the next `ready` turn.
  - **`kickPlayer` on the active clue-giver:**
    - mid-`playing`, it applies `timeUp`;
    - in `ready`, it moves on to the next player.
  - **`secondsPerTurn` changed mid-game:** the next turn's `durationMs` follows the new value; the current turn doesn't change.
- [ ] **Step 3:** Run `npx vitest run --maxWorkers=2 server/src/engine`. Expect FAIL.
- [ ] **Step 4:** Implement `order.ts` and `turns.ts`. Draw with `ctx.rng`. Points are not stored; they are computed from `shown` outcomes of `done` turns (Task 4).
- [ ] **Step 5:** Run the same command. Expect PASS.
- [ ] **Step 6:** Commit: `feat(engine): turns, review, carryover, host controls`.

### Task 4: Engine: scores and per-viewer snapshot

**Files:**
- Create: `server/src/engine/view.ts`, `server/src/engine/score.ts`
- Modify: `shared/src/protocol.ts`, to finalise the `Snapshot` type
- Test: `server/src/engine/view.test.ts`

**Interfaces:**
- Produces:
  - `scores(s: GameState): { byTeam: Record<TeamId, number>; byRound: Record<TeamId, number>[]; byPlayer: Record<string, number> }`
  - `snapshotFor(s: GameState, viewer: Actor, connected: Set<string>, origin: string): Snapshot`
  - `Snapshot`:
    ```ts
    {
      me: { playerId: string | null; isHost: boolean };
      phase;
      settings;
      players: { id; name; team; order; connected: boolean; kicked: boolean; wordCount: number }[];
      myWords: { id; word }[];
      roundIndex; rounds: RoundKind[]; bowlCount: number;
      scores: ReturnType<typeof scores>;
      turn: null | {
        id; playerId; team; phase; endsAt; remainingMs; durationMs;
        gotCount: number;
        card: { id; word } | null;
        review: { cardId; word; outcome }[] | null;
      };
      upNext: { playerId: string } | null;
      inviteUrl: string | null;
    }
    ```

- [ ] **Step 1:** Write `view.test.ts`:
  - **The current card's word:** while the turn is `playing`, only the clue-giver's snapshot has `turn.card`. The host and other players get `card: null`. Assert that the word string appears nowhere in `JSON.stringify` of the other snapshots.
  - **Review details:** `review` is non-null only for the clue-giver and hosts.
  - **Other players' words:** `myWords` holds only the viewer's own cards. No snapshot contains another player's words in the lobby.
  - **Invite link:** `inviteUrl` = `${origin}/join/${inviteToken}` for hosts, and `null` for everyone else.
  - **Scores:** after two `done` turns with 3 and 2 `got` cards, `byTeam` and `byPlayer` match.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 server/src/engine/view`. Expect FAIL.
- [ ] **Step 3:** Implement `score.ts` and `view.ts`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(engine): scores and per-viewer snapshots`.

### Task 5: Storage

**Files:**
- Create: `server/src/db/db.ts`, `server/src/db/migrations/001_init.sql`, `server/src/db/games.ts`, `server/src/db/sessions.ts`
- Test: `server/src/db/db.test.ts`

**Interfaces:**
- Produces:
  - `openDb(file: string | ':memory:'): DatabaseSync`. Sets WAL and `foreign_keys=ON`, and applies the numbered migrations once each (tracked in a `migrations` table).
  - `GameStore`: `{ load(id): GameState | null; loadAll(): GameState[]; save(s: GameState): void; byInvite(token): GameState | null; deleteOld(now): number }`
  - `SessionStore`: `{ create(row: { role: 'host'|'player'; gameId?: string; playerId?: string; expiresAt: number }): string; get(id, now): SessionRow | null; delete(id): void; deleteForPlayer(gameId, playerId): void; deleteExpired(now): number }`
  - Table `games(id PK, invite_token UNIQUE, phase, state_json, updated_at, ended_at)`
  - Table `sessions(id PK, role, game_id, player_id, expires_at)`

- [ ] **Step 1:** Write `db.test.ts` against `:memory:`:
  - **Games:**
    - A saved game round-trips equal (`toEqual`).
    - `byInvite` finds the game by its token.
    - `deleteOld` removes a game with `ended_at` 8 days ago and one with `updated_at` 3 days ago, and keeps one updated 1 hour ago.
  - **Sessions:**
    - `get` returns null after `expires_at`.
    - Session ids are 32 random bytes, base64url.
  - **Migrations:** re-opening the database doesn't apply migrations again.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 server/src/db`. Expect FAIL.
- [ ] **Step 3:** Implement with `node:sqlite` prepared statements and session ids from `crypto.randomBytes(32)`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(db): sqlite storage for games and sessions`.

### Task 6: Password, cookies, login limiter

**Files:**
- Create: `server/src/auth/password.ts`, `server/src/auth/cookies.ts`, `server/src/auth/limiter.ts`, `server/src/cli/hash-password.ts`
- Test: `server/src/auth/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(pw: string): Promise<string>`, giving `scrypt$N$r$p$saltB64$keyB64` with N=2^15, r=8, p=1, a 16-byte salt and a 32-byte key
  - `verifyPassword(pw: string, stored: string): Promise<boolean>`, which uses `timingSafeEqual`
  - `signSession(id, key: Buffer): string` and `verifySession(value: string, key: Buffer): string | null`
  - `sessionKey(secret: string, passwordHash: string): Buffer`
  - `class LoginLimiter { check(ip, now): { ok: true } | { ok: false; retryAfterMs: number }; fail(ip, now): void; succeed(ip): void }`
  - `npm run hash-password`: reads the password twice from the TTY without echo and prints the hash

- [ ] **Step 1:** Write `auth.test.ts`:
  - **Password hashing:** `verifyPassword` is true for the right password and false for a wrong one. Two hashes of the same password differ.
  - **Cookie signing:**
    - A tampered `verifySession` value gives null.
    - A different `sessionKey`, as after the password hash changes, gives null.
  - **Per-IP limit:**
    - Failures 1–5 from one IP stay ok.
    - After the 6th failure, `check` is refused with `retryAfterMs` 60000. After the 7th, 120000.
    - The lockout is capped at 3600000.
    - `succeed` resets that IP.
  - **Site-wide limit:** 51 failures spread across 51 IPs within an hour make `check` refuse a fresh IP for 900000 ms.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 server/src/auth`. Expect FAIL.
- [ ] **Step 3:** Implement. The limiter keeps per-IP failure timestamps in a Map, pruned on access.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(auth): password hashing, signed sessions, login limiter`.

### Task 7: HTTP app, security and routes

**Files:**
- Create: `server/src/config.ts`, `server/src/http/app.ts`, `server/src/http/security.ts`, `server/src/http/routes.ts`, `server/src/index.ts`
- Test: `server/src/http/http.test.ts`, using `app.inject`

**Interfaces:**
- Consumes: Tasks 2, 5 and 6.
- Produces:
  - `loadConfig(env): Config`. Throws, naming the variable, when a required variable is missing or the secret is under 32 bytes.
  - `buildApp(cfg: Config, deps: { db; now?: () => number }): FastifyInstance`
  - `requireHost(req)` and `playerSession(req): SessionRow | null` helpers
  - Routes:
    - `POST /api/login {password}` → 204 + `sb_host`, or 401 / 429 with `Retry-After`
    - `POST /api/logout` → 204, deletes the session
    - `GET /api/me` → `{ isHost, gameId | null }`
    - `POST /api/games {name}` (host) → `{ gameId }`. Sets `sb_player` for the host's own player.
    - `GET /api/invite/:token` → `{ phase, takeover: {playerId, name}[] }`, listing players who are not connected and not kicked. Gives 404 when the token is unknown or the game has ended.
    - `POST /api/invite/:token/join {name}` or `{takeoverPlayerId}` → 204 + `sb_player`
    - `GET /healthz`
    - static `web/dist` with a SPA fallback
  - The hub (Task 8) supplies `isConnected(gameId, playerId)` through `deps`. Use a stub in this task.

- [ ] **Step 1:** Write `http.test.ts`:
  - **Startup checks:** `loadConfig` without `SALADBOWL_PASSWORD_HASH` throws.
  - **Login:**
    - Wrong password gives 401. The 6th wrong attempt from the same `remoteAddress` gives 429 with `Retry-After: 60`.
    - The right password gives 204, and `set-cookie` contains `sb_host`, `HttpOnly`, `SameSite=Lax` and `Secure`.
  - **Origin check:**
    - A POST without an `Origin` header, or with `Origin: https://evil.example`, gives 403.
    - A POST with the configured origin is accepted.
  - **Host-only creation:** `POST /api/games` without `sb_host` gives 401.
  - **Invite errors:** `GET /api/invite/<unknown>`, and an invite for an ended game, both give 404 with body `{ code: 'invite_invalid' }` and no `set-cookie`.
  - **Joining by invite:**
    - Join with `{name:"Anu"}` gives 204 + `sb_player`.
    - Joining again with `" anu "` gives 409 `name_taken`.
    - `takeoverPlayerId` of a player the stub reports as connected gives 409.
    - `takeoverPlayerId` of a kicked player gives 409.
  - **Invite rate limit:** the 21st invite request from one IP in 15 minutes gives 429.
  - **Security headers:** every response has a `content-security-policy` containing `default-src 'self'` and `frame-ancestors 'none'`, plus `referrer-policy: no-referrer`.
  - **Errors:** an error thrown inside a handler gives 500 `{ code: 'internal' }` with no stack in the body.
  - **Proxy addresses:** with `TRUST_PROXY=false`, an `X-Forwarded-For` header doesn't change which IP is rate-limited.
  - **Player session lifetime:** an `sb_player` session for a game that ended more than 1 day ago is treated as invalid (`/api/me` gives `gameId: null`). Player sessions are created with a 30-day `expiresAt` cap.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 server/src/http`. Expect FAIL.
- [ ] **Step 3:** Implement:
  - helmet with the CSP from the spec;
  - `bodyLimit: 16384`;
  - an `onRequest` origin check on every non-GET request;
  - Fastify `trustProxy` from the config;
  - a global error handler.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(http): auth, invites, security headers, game creation`.

### Task 8: Realtime hub, clock and recovery

**Files:**
- Create: `server/src/realtime/hub.ts`, `server/src/realtime/socket.ts`
- Modify: `server/src/http/app.ts`, to register `/ws` and pass `hub.isConnected` into the routes
- Test: `server/src/realtime/realtime.test.ts`, with real `ws` clients against `app.listen({port:0})`

**Interfaces:**
- Produces:
  - `class Hub`, constructed with `(store: GameStore, opts: { now; setTimer; clearTimer; origin })`:
    - `attach(socket, actor: Actor & { gameId })`
    - `dispatch(gameId, actor, intent): Promise<Result>`, which runs through a per-game promise chain
    - `isConnected(gameId, playerId): boolean`
    - `recover(): void`, which loads every playing game and schedules `nextDeadline`
    - `close()`
  - After each accepted change the hub saves, sends every socket in that game its own `snapshotFor`, and reschedules the game's single timer from `nextDeadline`.

- [ ] **Step 1:** Write `realtime.test.ts`:
  - **Connecting:**
    - A WebSocket upgrade without a valid `sb_player` closes with code 4401.
    - A wrong `Origin` closes with code 4403.
  - **Snapshots:** on connect, the client gets a `snapshot` within 500 ms. Its `serverNow` is within 50 ms of the test clock.
  - **Card word stays with the clue-giver:** with three clients (host-player, A, B) in a started game, after A sends `startTurn` and `gotIt`, B's received frames never contain A's current card word.
  - **Turn ends with nobody connected:**
    - With a fake clock and `secondsPerTurn` 10, all clients disconnect and the clock moves 10 s.
    - The stored game's turn phase is `review`.
    - A reconnecting client gets a `review` snapshot.
  - **Restart recovery:**
    - Save a game with a `playing` turn whose `endsAt` has passed, then build a fresh `Hub` and call `recover()`. The turn is in `review` straight away.
    - With `endsAt` in the future, it moves to `review` when the timer fires.
  - **Taps can't interleave:** two `confirmReview` sent at once give exactly one turn advance. The second gets `{type:'error', code:'stale_turn'}`.
  - **Bad input:**
    - Over 20 messages in one second closes the socket with code 4429.
    - A 5000-byte frame closes it with code 1009.
  - **Clock sampling:** `{type:'ping', t:123}` gets `{type:'pong', t:123, serverNow}`.
  - **Dead sockets:** a socket that doesn't answer 2 pings 15 s apart is closed, and `isConnected` turns false.
  - **Kicking:** after `kickPlayer` on A, A's socket closes with code 4403, A's session row is gone (`deleteForPlayer`), and A's old cookie gets 4401 on reconnect.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 server/src/realtime`. Expect FAIL.
- [ ] **Step 3:** Implement:
  - one timer per game (`setTimer(at - now)`), which calls `timeUp` through `dispatch`;
  - `index.ts` registers `unhandledRejection` / `uncaughtException` handlers that log and keep running;
  - `index.ts` calls `hub.recover()` on start and runs `deleteOld` / `deleteExpired` every hour;
  - `resetInvite` is handled in the hub, because it changes `inviteToken`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(realtime): per-game hub, server clock, recovery`.

### Task 9: Web foundation: tokens, socket client, clock

**Files:**
- Create: `web/package.json`, `web/vite.config.ts` (dev proxy for `/api` and `/ws` to the server; `server.allowedHosts: ['.gs.localhost']`), `web/index.html`, `web/public/manifest.webmanifest` plus icons, `web/src/main.tsx`, `web/src/App.tsx` (routes `/`, `/join/:token`, `/game`)
- Create: `web/src/styles/tokens.css` (colours, type scale, spacing, the easings `--ease-out: cubic-bezier(.23,1,.32,1)`), `web/src/styles/base.css` (safe areas, press `scale(.97)`, reduced motion)
- Create: `web/src/net/clock.ts`, `web/src/net/socket.ts`, `web/src/net/useGame.ts`, `web/src/device/wakeLock.ts`, `web/src/device/sound.ts`, `web/src/sw.ts` (app shell cache only)
- Test: `web/src/net/clock.test.ts`, `web/src/net/socket.test.ts`

**Interfaces:**
- Produces:
  - `class ClockSync { add(sample: { sentAt; receivedAt; serverNow }): void; offset(): number }`. Uses the median of the last 7 samples, each `serverNow + rtt/2 - receivedAt`.
  - `secondsLeft(turn: Snapshot['turn'], now: number, offset: number): number`. Gives `Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000))`, or `remainingMs/1000` when paused, or `durationMs/1000` when ready.
  - `class GameSocket { constructor(url, onMessage, deps: { WebSocket; setTimeout; addEventListener }); send(intent: Intent): void; close(): void }`
    - On connect it sends 3 pings 300 ms apart, then one every 10 s.
    - Reconnect backoff: 500, 1000, 2000, 4000, 8000, then 10000 ms.
    - It reconnects at once on `visibilitychange` (when visible) and on `online`.
  - `useGame(): { snapshot: Snapshot | null; status: 'connecting'|'live'|'offline'; send(intent): void; offset: number }`
  - `useWakeLock(active: boolean)`
  - `sound.unlock()`, `sound.bell()`, `sound.tick()`, `sound.muted` (stored in localStorage, wrapped in try/catch)

- [ ] **Step 1:** Write the tests:
  - **`clock.test.ts`:**
    - Samples with a +5000 ms skew give `offset()` ≈ 5000 ± 20, even with one 2 s RTT outlier.
    - `secondsLeft` never goes below 0, and is 0 once `endsAt` has passed by 30 s.
  - **`socket.test.ts`**, with fake timers and a fake WebSocket:
    - After a close, retries happen at 500, 1000 and 2000 ms.
    - A `visibilitychange` to visible while waiting reconnects at once.
    - A message received after reconnect is delivered.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 web`. Expect FAIL.
- [ ] **Step 3:** Implement. Self-host fonts with `@fontsource/kalam/700.css`, `@fontsource/rubik/500.css`, `@fontsource/rubik/700.css` and `@fontsource/rubik/900.css`.
- [ ] **Step 4:** Run the same command. Expect PASS. Also run `npm run build -w web` and expect it to succeed.
- [ ] **Step 5:** Commit: `feat(web): tokens, socket client with reconnect, clock sync`.

### Task 10: Web: login, join and lobby screens

**Files:**
- Create: `web/src/screens/Login.tsx`, `web/src/screens/Join.tsx`, `web/src/screens/Lobby.tsx`, `web/src/screens/Teams.tsx`, `web/src/components/QrCode.tsx`, `web/src/components/Settings.tsx`, `web/src/components/WordList.tsx`, `web/src/components/PlayerChips.tsx`
- Test: `web/src/screens/lobby.test.tsx` (Vitest + `@testing-library/react` + jsdom)

**Interfaces:**
- Consumes: `useGame` and `Snapshot` (Task 9), and the HTTP routes (Task 7).

- [ ] **Step 1:** Before any UI code, invoke the `frontend-design` skill. Write the token plan (4–6 named colours, type roles, layout notes) into `docs/design-tokens.md`, then check it against the mockups. **Decide the "Got it" colour here.** It must not be `#ffd23f`-like next to Tangerine; it needs to be clearly distinct from both team colours. Record the reason in that file.
- [ ] **Step 2:** Write `lobby.test.tsx`:
  - **Lobby, as host:** shows a QR `<svg>` of `inviteUrl`, the settings controls, and a "Make teams" button that stays disabled until `startGame`'s preconditions hold.
  - **Lobby, as non-host:** shows no settings controls and no QR.
  - **Join with takeover candidates:** lists "Are you one of these?" buttons plus a name field.
  - **Join with a bad token:** shows "This invite no longer works".
  - **Word entry:** with `startingLetter` set, the word field shows the letter hint, and the add button is disabled at `wordsPerPlayer`.
- [ ] **Step 3:** Run `npx vitest run --maxWorkers=2 web`. Expect FAIL.
- [ ] **Step 4:** Implement the screens to the approved layout (mockup screens 1–2). Login shows the server's `Retry-After` as "Try again in N minutes".
- [ ] **Step 5:** Run the same command. Expect PASS.
- [ ] **Step 6:** Commit: `feat(web): login, join, lobby and teams screens`.

### Task 11: Web: play, review and end screens

**Files:**
- Create: `web/src/screens/Play.tsx` (chooses the view by role and phase), `web/src/screens/ClueGiver.tsx`, `web/src/screens/Watcher.tsx`, `web/src/screens/Review.tsx`, `web/src/screens/End.tsx`, `web/src/components/HostMenu.tsx` (pause/resume, skip player, kick, end game, reset invite, seconds per turn), `web/src/components/Countdown.tsx`
- Test: `web/src/screens/play.test.tsx`

- [ ] **Step 1:** Write `play.test.tsx`:
  - **Clue-giver:**
    - In `playing`, the clue-giver sees the word on the slip, plus "Got it" and "Skip" buttons each at least 56 px tall (check the inline style or class).
    - With `allowSkips: false`, there is no Skip button.
    - Two clicks on "Got it" within 300 ms send exactly one `gotIt`, and every intent carries the snapshot's `turn.id`.
  - **Everyone else:** a non-clue-giver sees the countdown, "<name> is acting for <team>", both team scores, and "Up next".
  - **Ready turn:** the next player sees a big "Start my turn" button; everyone else sees "Waiting for <name> to start".
  - **Review:**
    - Tapping a row sends `reviewToggle`.
    - "Done" sends `confirmReview`.
    - The host sees the same controls when the clue-giver is disconnected.
  - **End:** shows the winner, per-round totals, and "Most clues: <name>".
  - **Sound:** `sound.bell` is called once when `secondsLeft` crosses to 0, even if a render skips from 2 to 0.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 web`. Expect FAIL.
- [ ] **Step 3:** Implement to mockup screens 3–5 and look A:
  - the slip slides in on each new card (transform/opacity, about 200 ms, ease-out);
  - `useWakeLock(phase === 'playing')`;
  - vibrate `[200,100,200]` where supported;
  - a mute toggle in the header.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat(web): play, review and end screens`.

### Task 12: End-to-end run and design polish

**Files:**
- Create: `e2e/run.sh`. It starts the server under `portless saladbowl` with test env (`COOKIE_SECURE=false`, `PUBLIC_ORIGIN=http://saladbowl.gs.localhost:1355,https://saladbowl.gs.localhost`, `secondsPerTurn` set to 10 via settings), then drives `playwright-cli`.
- Create: `e2e/README.md`, which explains how to run it.
- Modify: any web files the critique flags

- [ ] **Step 1:** Write `e2e/run.sh`. It uses four `playwright-cli -s=<name>` sessions (host, a, b, c) at a 390×844 viewport, against `http://saladbowl.gs.localhost:1355/`. It does this:
  1. The host logs in.
  2. The host creates a game.
  3. The script reads the invite URL from the page.
  4. a, b and c join; everyone adds words; the host makes teams and starts.
  5. Each player takes one turn with 2 "Got it" taps.
  6. On b's turn, session b is closed mid-turn. After 10 s, the others show review; the host confirms on b's behalf.
  7. b reopens the invite, picks their own name, and lands on the live screen.
  8. A late player d joins mid-game and appears on the smaller team.
  9. Play runs until the end screen.

  The script exits non-zero on any failed expectation.
- [ ] **Step 2:** Run `bash e2e/run.sh`. Expect `E2E PASS`. Close every session with `playwright-cli close`.
- [ ] **Step 3:** Take screenshots at 390 px of all screens. Run the `impeccable` critique on them (follow its "Launcher unavailable" path, since its scripts aren't installed), then `emil-design-eng` for press and motion details, then the `web-design-guidelines` skill. Fix every high and medium finding.
- [ ] **Step 4:** Re-run `bash e2e/run.sh` and `npx vitest run --maxWorkers=2`. Expect both to pass.
- [ ] **Step 5:** Commit: `test: end-to-end phone run; design polish`.

### Task 13: Container, deploy notes, README

**Files:**
- Create: `Dockerfile` (multi-stage: `node:24-slim` build of web and server, then a runtime stage with `USER node`, `VOLUME /data`, `EXPOSE 3000`, and a `HEALTHCHECK` on `/healthz`), `.dockerignore`, `docker-compose.example.yml`, `docs/deploy.md` (Dokploy + Traefik: env vars, the `TRUST_PROXY` value for Traefik's network, the volume, running `hash-password` with `docker run --rm -it <image> npm run hash-password`)
- Modify: `README.md` (what it is, quick start for dev with portless, how to run tests, credit to avimoondra/fishbowl)

- [ ] **Step 1:** `npm run build` at the root. Expect `web/dist` and `server/dist` to exist.
- [ ] **Step 2:** Run the built server directly: `node server/dist/index.js` with test env, under `portless saladbowl`. Check that `curl -s -o /dev/null -w '%{http_code}' -H 'Host: saladbowl.gs.localhost' http://127.0.0.1:1355/healthz` prints `200`. There's no Docker here, so the image itself is built by the owner on Dokploy. Say so in `docs/deploy.md`.
- [ ] **Step 3:** Commit: `chore: Dockerfile, deploy notes, README`.
