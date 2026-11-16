import { TEAMS, type Snapshot } from "@saladbowl/shared"
import { Header } from "../components/Header"
import { ROUND_NAMES, nameOf, teamName } from "../lib/words"
import { navigate } from "../router"

export function End({ snap }: { snap: Snapshot }) {
  const { tangerine, lagoon } = snap.scores.byTeam
  const headline = tangerine === lagoon ? "It's a tie" : `${teamName(snap, tangerine > lagoon ? "tangerine" : "lagoon")} wins`
  const top = Object.entries(snap.scores.byPlayer).sort((a, b) => b[1] - a[1])[0]
  return (
    <main className="screen">
      <Header>Game over</Header>
      <div className="stack center">
        <h1 className="big-title">{headline}</h1>
        <div className="end-score">
          <span className="ink-tangerine">{tangerine}</span>
          <span className="muted">to</span>
          <span className="ink-lagoon">{lagoon}</span>
        </div>
        {top && top[1] > 0 && <p className="muted">Most clues: {nameOf(snap, top[0])}</p>}
      </div>
      <table className="rounds-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            {TEAMS.map((t) => (
              <th scope="col" key={t} className={`ink-${t}`}>
                {teamName(snap, t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snap.scores.byRound.map((r, i) => (
            <tr key={i}>
              <th scope="row">{ROUND_NAMES[snap.rounds[i] ?? "taboo"]}</th>
              <td>{r.tangerine}</td>
              <td>{r.lagoon}</td>
            </tr>
          ))}
          <tr className="total">
            <th scope="row">Total</th>
            <td>{tangerine}</td>
            <td>{lagoon}</td>
          </tr>
        </tbody>
      </table>
      <div className="grow" />
      <footer className="actions">
        <button type="button" className="btn btn-paper" onClick={() => navigate("/")}>
          {snap.me.isHost ? "Start another game" : "Done"}
        </button>
      </footer>
    </main>
  )
}
