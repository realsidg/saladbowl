import { useEffect, useState } from "react"
import { NAME_MAX, TEAMS, type Intent, type Snapshot, type TeamId } from "@saladbowl/shared"
import { Header } from "../components/Header"
import { teamName } from "../lib/words"

type Send = (i: Intent) => boolean

export function Teams({ snap, send }: { snap: Snapshot; send: Send }) {
  const host = snap.me.isHost
  const team = (t: TeamId) => snap.players.filter((p) => p.team === t && !p.kicked).sort((a, b) => a.order - b.order)
  const empty = TEAMS.some((t) => team(t).length === 0)
  return (
    <main className="screen">
      <Header>Teams</Header>
      {host && <p className="muted">Tap a team name to rename it, or a player to move them.</p>}
      <div className="teams">
        {TEAMS.map((t) => (
          <section key={t} className={`team-col team-col-${t}`} aria-label={teamName(snap, t)}>
            <h2>
              {host ? (
                <TeamNameInput snap={snap} team={t} send={send} />
              ) : (
                <span className={`team team-${t}`}>{teamName(snap, t)}</span>
              )}
            </h2>
            <ul>
              {team(t).map((p) => (
                <li key={p.id}>
                  {host ? (
                    <button
                      type="button"
                      className="team-name"
                      aria-label={`Move ${p.name} to ${teamName(snap, t === "tangerine" ? "lagoon" : "tangerine")}`}
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

/** The host renames a team by typing over its name; it saves when they leave the box or press Enter. */
function TeamNameInput({ snap, team, send }: { snap: Snapshot; team: TeamId; send: Send }) {
  const name = teamName(snap, team)
  const other = teamName(snap, team === "tangerine" ? "lagoon" : "tangerine")
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const save = () => {
    const next = draft.trim()
    // An empty name or one that matches the other team just goes back to what it was.
    if (!next || next === name || next.toLowerCase() === other.toLowerCase()) return setDraft(name)
    const names = { ...snap.settings.teamNames, [team]: next } as Snapshot["settings"]["teamNames"]
    if (!send({ type: "updateSettings", patch: { teamNames: names } })) setDraft(name)
  }
  return (
    <input
      aria-label={`Name of team ${name}`}
      className={`team team-${team} team-input`}
      value={draft}
      maxLength={NAME_MAX}
      autoComplete="off"
      autoCapitalize="words"
      enterKeyHint="done"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}
