# Saladbowl: design

Date: 2026-11-15. Status: draft for approval.

## Why

The owner's friend group plays Fishbowl (also called salad bowl) in the same room, each person on their own phone. They use the open-source [avimoondra/fishbowl](https://github.com/avimoondra/fishbowl). They want to self-host it on a public URL. Three things are wrong today:

1. **Anyone on the internet can use it, and worse.** An audit of the old code (summary below) found that anyone can log in as any player, including the host, in any game. Any player also has host powers.
2. **The timer keeps dropping.** Four causes: the app recreates its server connection on re-render; phones freeze WebSockets when locked and nothing re-syncs; only the active player's phone ends a turn; the clock is synced once.
3. **The UI was made for video calls on laptops,** but they play in person on phones.

Saladbowl is a rebuild from scratch in a new public repo (`realsidg/saladbowl`). It keeps the game's rules and replaces everything else.

## Goals

- A single shared **host password** guards the site. Only the host types it. Guests get in by scanning a QR invite for one game.
- The **server owns the game and the clock.** A turn ends on time even if every phone is locked. A phone that wakes up or reconnects lands on the correct screen within about a second.
- **Each phone shows its role:** the clue-giver sees the card; everyone else sees a huge timer, who is up, and the score.
- **One container to self-host,** with one data folder.
- The holes found in the audit cannot happen again. Each one becomes a test (see "Audit findings as tests").

## Non-goals

- Languages other than English. There is no i18n layer.
- Remote or video-call play, and share-to-social buttons.
- User accounts, sign-up, or more than one password.
- Running more than one server instance. SQLite and in-memory timers assume a single process.
- Migrating data from the old Postgres database.
- Third-party services at runtime: no Sentry, no Locize, no analytics, no external fonts or CDNs. Fonts are self-hosted.

## Anti-goals (it fails even if it works if…)

- A stranger who finds the URL can create games, join games, or read anything.
- A phone locking, reloading, or switching apps loses points or freezes the game for everyone.
- The clue-giver's buttons are small or easy to mis-tap.
- It looks like a generic AI-built app (see "Look and feel").

## Approaches considered

- **A. Keep the stack and fix it** (upgrade Hasura, add a password gatekeeper, add a server job to end turns, redo the screens). Rejected: the frontend libraries (React 16, CRA 3, Apollo 2, MUI 4) are so old that a new UI is nearly a rewrite anyway. It still needs four containers. It can't be run or tested on the dev server, which has no Docker.
- **B. Rebuild as one small app (chosen).** One Node server owns the game state and the clock and talks to phones over a WebSocket. SQLite stores everything. The frontend is new and mobile-first. The old rules are ported from `app/src/lib/*.ts`.
- **C. Keep Hasura, rewrite only the frontend.** Rejected: it keeps both costs, the four containers and the rewrite.

The owner picked B.

## Decided with the owner

- Same-room play on phones; English only.
- Password: **only the host types it.** Guests join by scanning a QR or opening an invite link for that game.
- Screen layout and flow: the five mockup screens (host login, lobby with QR, clue-giver, everyone else, review) are approved.
- Look: **"Paper slips"** (mockup A). The second team colour is **Tangerine** `#ff8a1f`, not coral. The other team is **Lagoon** `#7fd6cc`.
- New public repo `realsidg/saladbowl`, MIT, crediting the original author.
- **The host is a player too:** a name, a team, words in the bowl and turns, like everyone else.
- **The host does not screen words.** The old "host screens words" option is dropped.
- **People can join after the game starts** (see Game rules).
- **The host sets the rules** that the original game had: seconds per turn, words per player, rounds, skips, starting letter, and word source.

## Architecture

```
phone browser ──HTTPS──> reverse proxy (Traefik/Dokploy, TLS) ──HTTP──> saladbowl (Node 24, one process)
                                                                         ├─ serves the built frontend (static files)
                                                                         ├─ REST: login, logout, create game, redeem invite
                                                                         ├─ WebSocket /ws: game intents in, state snapshots out
                                                                         ├─ game engine (pure TS, the old rules + the server clock)
                                                                         └─ SQLite file in /data (node:sqlite, WAL mode)
```

- **Stack (builder's call, stated here):** Node 24 + TypeScript. Fastify for HTTP, with `@fastify/websocket`, `@fastify/cookie`, `@fastify/rate-limit` and `@fastify/helmet`. Built-in `node:sqlite`, so there are no native dependencies. React 19 + Vite + TypeScript frontend with plain CSS (custom properties), no component library. Vitest for tests.
- **One shared package of types** for the messages between client and server, so both sides agree at compile time.
- **The game engine is pure functions:** `(state, intent, now) -> new state | error`. All game rules live here and are unit-tested without a network.
- **The server checks every intent:** who sent it, their role (host or player), whose turn it is, and the current phase. The client never decides anything the server trusts.

## Security

### Who can do what

| Who | How they prove it | Can |
|---|---|---|
| Host | `sb_host` cookie, issued after the correct password | Create games; host-only actions in any game. In a game they also play, they hold a player session for it like everyone else |
| Player | `sb_player` cookie scoped to one game, issued by redeeming that game's invite | Join that game, add words, play their turn, see that game's state |
| Anyone else | nothing | See the login page and the invite-redeem page. Nothing else. |

### Password

- The password is never stored in plain text. The deployment sets `SALADBOWL_PASSWORD_HASH`, a scrypt hash made with `npm run hash-password` (Node's built-in `crypto.scrypt`, a random salt, and parameters stored in the hash string). The server refuses to start without it.
- The check runs in constant time (`crypto.timingSafeEqual` on the derived key).
- **Changing the password logs out every phone.** Session cookies are signed with a key derived from `SALADBOWL_SESSION_SECRET` plus the password hash. A new hash means every old signature fails.

### Brute-force defence

- **Per network address:** 5 failed logins in 15 minutes. After that, each attempt is refused with an increasing delay (1 min, 2, 4, … up to 1 hour). A success resets the count.
- **Site-wide:** more than 50 failures in an hour from all addresses together locks the login form for 15 minutes. An attacker could use this to block new logins, but a host already logged in keeps their cookie and can still play. That trade-off is accepted.
- **Invite redemption** is rate-limited per address too (20 per 15 minutes), so invite tokens can't be guessed. They are 128-bit random anyway.
- **The real client address** comes from `X-Forwarded-For` only when the request comes from a configured trusted proxy (`TRUST_PROXY` setting). Otherwise it is the socket address.
- Rate-limit counters live in memory. A restart resets them, which is acceptable for one process.

### Sessions and cookies

- **Cookie flags:** `HttpOnly`, `Secure` (except on plain-HTTP localhost in dev), `SameSite=Lax`, `Path=/`.
- **Contents:** an opaque random session id. The `sessions` table holds the role, game and expiry. A row can be deleted to revoke that session.
- **Host identity (my call):** any valid host session counts as host of every game. There is one password, so there is one group of hosts. If the host's phone loses its login, they type the password again and still control the running game. When a host creates a game, they also get a player session for it, so they play like everyone else.
- **Lifetimes:** the host session lasts 30 days. A player session lasts until its game ends, plus 1 day.
- **Logout** deletes the session row.

### Invites

- **One invite token per game, made when the game is created.** The host's lobby shows it as a QR code and a copyable link: `/join/<token>`.
- **Anyone with the link can join that one game while it is open.** It's one invite shared by the room, not one per person. The invite stops working when the game ends.
- **The host can reset the invite.** That makes a new token, and the old link stops working. Players who already joined are not affected.
- **Nothing about a game can be reached without a session for it.** Join codes are not guessable entry points. A 4-letter code, if kept for display, is never accepted on its own.

### Other protections

- **Forged requests from other sites:** `SameSite=Lax` cookies, plus an `Origin` check on every state-changing POST and on the WebSocket upgrade. The `Origin` must equal the configured `PUBLIC_ORIGIN`.
- **Security headers** (helmet):
  - a strict CSP: `default-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `connect-src 'self'` (the WebSocket uses the same origin);
  - `Referrer-Policy: no-referrer`, so invite tokens don't leak through the Referer header;
  - `X-Content-Type-Options`;
  - HSTS, sent when serving over HTTPS.
- **Input limits:**
  - JSON body limit of 16 KB; WebSocket message limit of 4 KB;
  - each socket may send 20 messages per second, and is closed if it keeps going over;
  - word length 1–40 characters, name length 1–20 characters, all trimmed;
  - turn length 10–180 seconds; 1–10 words per player; 1–6 rounds.
  - Every intent is checked against a schema (zod) before it reaches the engine.
- **No dynamic `require`** and no routes built from user input.
- **Error responses** never include stack traces or internals.
- **Game creation** is host-only and rate-limited (10 per hour). Old games are cleaned up: games that ended over 7 days ago, or were idle for 2 days, are deleted.

## Game rules (ported from the old app)

- **Settings,** chosen by the host in the lobby:
  - seconds per turn (default 60);
  - words per player (default 6);
  - rounds: an ordered list (default Taboo, Charades, Password; host can add, remove, reorder; at least 1);
  - allow skips (default on);
  - optional starting letter;
  - word source: players submit words (default), or the host pastes a list in the lobby (words per player then doesn't apply).
- **Settings can be changed in the lobby.** Seconds per turn can also be changed between turns. It applies from the next turn. Words per player and word source lock when the game starts.
- **No word screening.** Every word a player submits goes into the bowl. A player can edit or remove their own words until the game starts.
- **Teams:** two teams, Tangerine and Lagoon, randomly split; the host can move players before starting. Each team needs at least 1 player and the game needs at least 2 players in total. The original said "at least 4"; we only require 2 per game and 1 per team.
- **Turn order** alternates teams. Within a team it rotates through players in order. A player who left is skipped.
- **A round ends when the bowl is empty.** If the bowl empties mid-turn, the same player starts the next round with the seconds they had left. This is the old `seconds_per_turn_override` rule, fixed so the value can never be 0 or negative. If 2 or fewer seconds are left, the turn passes instead.
  - **How this fits with review (my call).** When the bowl empties, the turn goes to review and the leftover time is frozen. After review is confirmed:
    - If the bowl is still empty, the round ends, and the same player starts the next round with the frozen time.
    - If unticking put cards back, the same player carries on in the same round with the frozen time.
- **Late joiners (decided with the owner).** After the game starts, opening the invite still lets new people in.
  - A new player joins the team with fewer players (ties go to Lagoon).
  - They are added to the end of that team's turn order and play from their next turn.
  - They don't add words, because the bowl is already in play.
  - They must enter a name before they are placed on a team. A phone that never enters a name never gets a turn.
- **Cards are drawn at random by the server** from the cards not yet guessed this round. Skipped cards go back into the bowl. Only the clue-giver's connection receives the current card's word. Nobody else's phone ever sees it, which also stops cheating through devtools.
- **Review:** after time runs out, the clue-giver (or the host on their behalf) can untick cards marked "Got it" by mistake, then confirm. Points = confirmed cards. The draft review is kept on the server, so a reload doesn't lose it.
- **Score** is one point per card guessed, summed per team across rounds. The end screen shows totals per round, the winner, and who gave the most clues.

## Server-owned clock and reconnection

- **Each turn stores `endsAt`, an absolute server time.** A server timer fires at `endsAt` and moves the turn to review.
- **After a restart, timers are rebuilt from the database.** A turn whose `endsAt` has already passed goes straight to review.
- **The host can pause and resume.** Pausing stores the remaining milliseconds; resuming sets a new `endsAt`.
- **Every message from the server carries `serverNow`.** The client keeps a running estimate of the clock offset, using the median of recent samples adjusted by round-trip time. The countdown is drawn from `endsAt - (Date.now() + offset)`, so a phone's wrong clock doesn't matter.
- **The connection is kept alive with pings.** The server pings every 15 seconds and drops a socket that misses 2.
- **The client reconnects at once** when the page becomes visible or the network comes back (`visibilitychange`, `online`). Otherwise it retries with backoff (0.5 s, 1 s, 2 s, up to 10 s).
- **Every (re)connect gets a full snapshot** of the game, so there is no need to replay missed messages.
- **Server messages:** a full `snapshot` for that player's view of the game, sent on connect and on every change. The state is small, so there are no diffs.
- **Client intents:** `setName`, `addWord`, `editWord`, `removeWord`, `setHostWordList`, `updateSettings`, `setTeams`, `startGame`, `startTurn`, `gotIt`, `skip`, `reviewToggle`, `confirmReview`, `pause`, `resume`, `skipPlayer`, `undoLastGotIt`, `endGame`, `kickPlayer`.
  - `startTurn` is sent only by the player whose turn is next.
  - `gotIt`, `skip` and `undoLastGotIt` are sent by the clue-giver while playing. Undo goes back one card.
  - `reviewToggle` and `confirmReview` can come from the clue-giver or the host.
  - `pause`, `resume`, `skipPlayer`, `endGame` and `kickPlayer` are host only.
- **Each intent that changes a turn carries the `turnId`** it was meant for. The server rejects intents for a stale turn, which fixes the Skip/End-turn race.
- **The server applies intents one at a time per game,** in a single in-process queue. Two taps can't interleave.

## Phone features

- **Screen Wake Lock** keeps the screen on during play on every phone. It is re-acquired when the page becomes visible again. Browsers without it silently do without.
- **At 0:00 every phone vibrates** where the browser supports it (iOS Safari doesn't) **and plays a short bell.** There is a soft tick at 5 seconds left.
  - Browsers need a tap before playing sound, so the first tap anywhere in the game unlocks audio.
  - There's a mute toggle.
- **Installable on the home screen:** a manifest and icons. A service worker caches only the app shell (code, fonts, icons), never game data, and never serves stale game state.
- **Rejoin:** a phone with a valid `sb_player` cookie goes straight back in. If the cookie is lost, opening the invite again shows "Are you one of these?" with the names of players who are currently disconnected. Picking one takes over that player. A connected player can't be taken over. The host can kick a player (my call): the player is removed from the turn order, their name can't be taken over, and their words stay in the bowl. If that empties a team, the next player to join goes there; until then, turns keep going to the team that still has players.
- **Layout:**
  - big touch targets, at least 56 px high for game actions;
  - "Got it" and "Skip" sit in the thumb zone at the bottom;
  - the layout respects safe areas (`env(safe-area-inset-*)`);
  - no hover-only actions;
  - the clue-giver's buttons ignore a second tap within 300 ms, so a double-tap can't count twice.
- **No keyboard shortcuts during play.** This removes the old review-shortcut bugs.

## Look and feel

- **"Paper slips":**
  - deep teal "bowl water" background `#14535c`;
  - the word shown on a lined paper slip in a handwriting display face (Kalam, self-hosted);
  - UI text in Rubik (self-hosted);
  - teams are Tangerine `#ff8a1f` (dark text on it) and Lagoon `#7fd6cc` (dark text on it).
- **Builder's call: the "Got it" button colour.** The mockup's yellow `#ffd23f` sits close to Tangerine. Pick a "Got it" treatment that can't be confused with the Tangerine team chip, and check it on a phone.
- **Motion** follows `emil-design-eng`:
  - only `transform` and `opacity` animate;
  - presses scale to 0.97;
  - one deliberate moment per screen, for example the slip sliding in on each new card;
  - `prefers-reduced-motion` is respected.
- **Process:** use the `frontend-design` skill for the token plan, `impeccable` critique and polish before release, and Vercel's `web-design-guidelines` as the final check.
- **The approved mockups are the reference:** `/home/dev/projects/fishbowl/.superpowers/mockups/index.html` for layout and `style.html` (look A) / `colours.html` (Tangerine) for style. Copy them into this repo under `docs/mockups/` at the start of the build.

## Data (SQLite)

- **Tables:**
  - `games`: id, invite_token, state, settings JSON, host_session_id, created_at, ended_at;
  - `players`: id, game_id, name, team, order, connected flag (in memory only);
  - `cards`: id, game_id, player_id, word;
  - `rounds`: game_id, index, kind;
  - `turns`: id, game_id, round_index, player_id, started_at, ends_at, paused_remaining_ms, phase, review JSON;
  - `turn_cards`: turn_id, card_id, outcome;
  - `sessions`: id, role, game_id, player_id, expires_at.
- **Migrations** are numbered `.sql` files, applied in order at startup.
- **Writes are synchronous** through `node:sqlite` inside the per-game queue. The game state in memory is a cache that can always be rebuilt from SQLite.

## Configuration

| Variable | Meaning |
|---|---|
| `SALADBOWL_PASSWORD_HASH` | required; output of `npm run hash-password` |
| `SALADBOWL_SESSION_SECRET` | required; 32+ random bytes |
| `PUBLIC_ORIGIN` | required; e.g. `https://saladbowl.example.com` |
| `TRUST_PROXY` | IP/CIDR of the reverse proxy, or `false` |
| `DATA_DIR` | default `/data` |
| `PORT` | default 3000 |

## Deployment

- **The repo ships a multi-stage `Dockerfile`:** build the frontend and server, then run as a non-root user with `/data` as a volume. It also ships a `docker-compose.yml` example.
- **The owner deploys it with Dokploy** on their server behind Traefik with HTTPS. The builder writes the deploy notes. The owner does the deploy, since this dev account has no Docker access.
- **Dev on this server:**
  - run with `portless saladbowl npm run dev`, which gives `https://saladbowl.gs.localhost` from the Mac;
  - set `PUBLIC_ORIGIN` to match;
  - the dev server listens on `$PORT`.

## Testing

- **Engine unit tests (Vitest):**
  - turn order across uneven teams;
  - bowl-empties-mid-turn carryover;
  - skip rules;
  - review edits;
  - scoring;
  - round advance;
  - game end.
- **Server integration tests:**
  - real HTTP plus several WebSocket clients against an in-memory SQLite;
  - login and rate limits;
  - invite redeem and reset;
  - role checks for every intent;
  - stale `turnId` rejection;
  - turn ending with no clients connected;
  - recovery after a restart;
  - reconnect snapshots;
  - the card word only ever reaching the clue-giver.
- **End-to-end tests** with `playwright-cli`: three or four browser contexts acting as phones (mobile viewport) play a full short game, including locking one phone (closing its socket) mid-turn.
- **How to run them:** `vitest run --maxWorkers=2`. This server has a shared memory cap.

## Audit findings as tests

Each item below was found in the old code. Each needs a test showing it can't happen.

| # | Old bug | Saladbowl rule that prevents it |
|---|---|---|
| 1 | Anyone can get a token for any player or host | No anonymous reads; sessions are opaque and server-issued; invites are per game |
| 2 | A player moves turns into another game | Intents are scoped to the session's game; no client-supplied game ids |
| 3 | A reload mid-turn loses the turn | Turn progress and review draft live on the server |
| 4 | Host Skip vs player End-turn race wipes points | Per-game queue + `turnId` check |
| 5 | Nameless "ghost" players get turns | Players without a name can't be put on a team, before or after start; start requires everyone named or removed |
| 6 | A bonus turn that ends instantly (override of -1 or 0) | Carryover only when more than 2 s are left; turn length validated 10–180 s |
| 7 | Requests hang or crash the server | Every route returns a response; global error handler; process-level handlers log and keep running |
| 8 | A bad `?client_uuid=` breaks a browser forever | No identity in URLs except the invite token; a bad token shows a clear error |
| 9 | Dynamic `require` path traversal | Static routes only |
| 10 | Any player has host powers | Host-only intents are checked on the server |
| 11 | An empty team crashes play | Start requires ≥1 player per team; the turn picker handles a team emptied mid-game (kick/leave) |
| 12 | Game creation can be spammed to exhaust codes | Host-only, rate-limited, invite tokens are 128-bit |
| 13 | Keyboard shortcuts change results in review | No shortcuts; review is its own phase |
| 14 | Deleting every round blocks the start | At least 1 round enforced |
| 15 | Turn length of 0 or negative | Validated 10–180 s |
| — | Players inserting unlimited cards | Word count per player enforced; words only in the lobby |
| — | Turkish-locale join-code bug | No case-folded codes are used for lookup |

## Left to the builder

- Library versions, folder layout, and how intents are named in code.
- The exact copy on each screen (plain, short, sentence case).
- The "Got it" button treatment (see Look and feel).
- Whether a 4-letter code is shown for display.
- The look of the end-game summary, within the "Paper slips" style.
