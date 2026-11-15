import { TEAMS, type Intent, type Snapshot, type TeamId } from "@saladbowl/shared"
import { Header } from "../components/Header"
import { TEAM_NAMES } from "../lib/words"

type Send = (i: Intent) => boolean

export function Teams({ snap, send }: { snap: Snapshot; send: Send }) {
  const host = snap.me.isHost
  const team = (t: TeamId) => snap.players.filter((p) => p.team === t && !p.kicked).sort((a, b) => a.order - b.order)
  const empty = TEAMS.some((t) => team(t).length === 0)
  return (
    <main className="screen">
      <Header>Teams</Header>
      {host && <p className="muted">Tap a name to move them to the other team.</p>}
      <div className="teams">
        {TEAMS.map((t) => (
          <section key={t} className={`team-col team-col-${t}`} aria-label={TEAM_NAMES[t]}>
            <h2>
              <span className={`team team-${t}`}>{TEAM_NAMES[t]}</span>
            </h2>
            <ul>
              {team(t).map((p) => (
                <li key={p.id}>
                  {host ? (
                    <button
                      type="button"
                      className="team-name"
                      aria-label={`Move ${p.name} to ${TEAM_NAMES[t === "tangerine" ? "lagoon" : "tangerine"]}`}
                      onClick={() => send({ type: "movePlayer", playerId: p.id, team: t === "tangerine" ? "lagoon" : "tangerine" })}
                    >
                      {p.name}
                    </button>
                  ) : (
                    <span className={`team-name${p.id === snap.me.playerId ? " team-me" : ""}`}>{p.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="grow" />
      <footer className="actions">
        {host ? (
          <>
            {empty && <p className="muted center">Each team needs at least one player</p>}
            <button type="button" className="btn btn-paper" disabled={empty} onClick={() => send({ type: "startGame" })}>
              Start game
            </button>
            <div className="row">
              <button type="button" className="btn btn-quiet" onClick={() => send({ type: "shuffleTeams" })}>
                Shuffle
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => send({ type: "backToLobby" })}>
                Back to lobby
              </button>
            </div>
          </>
        ) : (
          <p className="muted center">Waiting for the host to start</p>
        )}
      </footer>
    </main>
  )
}
