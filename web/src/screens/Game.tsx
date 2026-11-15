import { Connection } from "../components/Connection"
import { useGame } from "../net/useGame"
import { End } from "./End"
import { Lobby } from "./Lobby"
import { Play } from "./Play"
import { Teams } from "./Teams"

export function Game() {
  const g = useGame()
  const s = g.snapshot
  return (
    <>
      {g.status !== "live" && (
        <div className="screen-banner">
          <Connection status={g.status} />
        </div>
      )}
      {!s ? (
        <main className="screen screen-center" aria-busy="true">
          <p className="muted center">Joining the game…</p>
        </main>
      ) : s.phase === "lobby" ? (
        <Lobby snap={s} send={g.send} />
      ) : s.phase === "teams" ? (
        <Teams snap={s} send={g.send} />
      ) : s.phase === "playing" ? (
        <Play snap={s} send={g.send} offset={g.offset} />
      ) : (
        <End snap={s} />
      )}
      {g.error && (
        <div className="toast" role="alert" onClick={g.clearError}>
          {g.error}
        </div>
      )}
    </>
  )
}
