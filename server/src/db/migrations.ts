/** Numbered schema migrations, applied in order once each. Kept in code so the bundled server needs no data files. */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_init.sql",
    sql: `
      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        invite_token TEXT NOT NULL UNIQUE,
        phase TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('host', 'player')),
        game_id TEXT,
        player_id TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_player ON sessions (game_id, player_id);
    `,
  },
]
