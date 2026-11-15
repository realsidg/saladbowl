import { useRef, type ReactNode } from "react"
import type { Intent, Snapshot } from "@saladbowl/shared"
import { Countdown } from "../components/Countdown"
import { Header } from "../components/Header"
import { HostMenu } from "../components/HostMenu"
import { useNow } from "../components/useNow"
import { useTurnSounds } from "../components/useTurnSounds"
import { useWakeLock } from "../device/wakeLock"
import { ROUND_HINTS, ROUND_NAMES, TEAM_NAMES, nameOf } from "../lib/words"
import { secondsLeft } from "../net/clock"

type Send = (i: Intent) => boolean
type Turn = NonNullable<Snapshot["turn"]>
interface Props {
  snap: Snapshot
  send: Send
  offset: number
}

const VERB = { taboo: "describing", charades: "acting", password: "giving clues" } as const

export function Play({ snap, send, offset }: Props) {
  const turn = snap.turn
  const now = useNow(turn?.phase === "playing")
  const left = secondsLeft(turn, now, offset)
  useTurnSounds(turn, left, now + offset)
  useWakeLock(true)

  const kind = snap.rounds[snap.roundIndex] ?? "taboo"
  const title = `Round ${snap.roundIndex + 1}: ${ROUND_NAMES[kind]}`
  const header = <Header extra={snap.me.isHost ? <HostMenu snap={snap} send={send} /> : null}>{title}</Header>

  if (!turn)
    return (
      <main className="screen">
        {header}
        <p className="muted center grow-center">Nobody can take a turn right now. The host can add players or end the game.</p>
      </main>
    )

  const mine = turn.playerId === snap.me.playerId
  const giverAway = !snap.players.find((p) => p.id === turn.playerId)?.connected

  if (turn.phase === "ready" && mine) return <ReadyMine turn={turn} snap={snap} send={send} header={header} kind={kind} />
  if ((turn.phase === "playing" || turn.phase === "paused") && mine)
    return <ClueGiver turn={turn} snap={snap} send={send} header={header} left={left} />
  if (turn.phase === "review" && (mine || (snap.me.isHost && giverAway) || (snap.me.isHost && !turn.playerId)) && turn.review)
    return <Review turn={turn} snap={snap} send={send} header={header} mine={mine} />
  return <Watcher turn={turn} snap={snap} header={header} left={left} kind={kind} />
}

function ReadyMine({ turn, snap, send, header, kind }: { turn: Turn; snap: Snapshot; send: Send; header: ReactNode; kind: keyof typeof ROUND_NAMES }) {
  const secs = Math.round(turn.durationMs / 1000)
  return (
    <main className="screen">
      {header}
      <div className="grow-center stack center">
        <span className={`team team-${turn.team}`}>{TEAM_NAMES[turn.team]}</span>
        <h1 className="big-title">Your turn</h1>
        <p className="round-hint">{ROUND_HINTS[kind]}</p>
        <p className="muted">
          {secs} seconds, {snap.bowlCount} {snap.bowlCount === 1 ? "word" : "words"} in the bowl
          {turn.durationMs < snap.settings.secondsPerTurn * 1000 ? ". Time left over from last round." : "."}
        </p>
      </div>
      <footer className="actions">
        <button type="button" className="btn btn-paper btn-huge" onClick={() => send({ type: "startTurn", turnId: turn.id })}>
          Start my turn
        </button>
      </footer>
    </main>
  )
}

function ClueGiver({ turn, snap, send, header, left }: { turn: Turn; snap: Snapshot; send: Send; header: ReactNode; left: number }) {
  const lastTap = useRef(0)
  const tap = (intent: Intent) => {
    const t = Date.now()
    if (t - lastTap.current < 300) return
    lastTap.current = t
    send(intent)
  }
  const paused = turn.phase === "paused"
  return (
    <main className="screen screen-play">
      {header}
      <div className="giver-top">
        <span className={`team team-${turn.team}`}>Your turn</span>
        <Countdown seconds={left} total={turn.durationMs / 1000} />
      </div>
      <div className="slip-stage">
        {paused ? (
          <div className="slip slip-paused">
            <span>Paused</span>
          </div>
        ) : turn.card ? (
          <div className="slip" key={turn.card.id}>
            <span>{turn.card.word}</span>
          </div>
        ) : null}
      </div>
      <p className="muted center">
        {turn.gotCount} got, {snap.bowlCount} left in the bowl
      </p>
      <footer className="actions">
        <button type="button" className="btn btn-paper btn-huge" disabled={paused} onClick={() => tap({ type: "gotIt", turnId: turn.id, cardId: turn.card?.id })}>
          Got it
        </button>
        {snap.settings.allowSkips && (
          <button type="button" className="btn btn-outline" disabled={paused} onClick={() => tap({ type: "skip", turnId: turn.id, cardId: turn.card?.id })}>
            Skip
          </button>
        )}
        {turn.gotCount > 0 && !paused && (
          <button type="button" className="btn btn-quiet btn-small undo" onClick={() => tap({ type: "undoLastGotIt", turnId: turn.id })}>
            Undo last “Got it”
          </button>
        )}
      </footer>
    </main>
  )
}

function Watcher({ turn, snap, header, left, kind }: { turn: Turn; snap: Snapshot; header: ReactNode; left: number; kind: keyof typeof VERB }) {
  const giver = nameOf(snap, turn.playerId)
  const team = TEAM_NAMES[turn.team]
  const next = snap.upNext ? nameOf(snap, snap.upNext.playerId) : null
  const line =
    turn.phase === "ready"
      ? `Waiting for ${giver} to start`
      : turn.phase === "review"
        ? `${giver} is checking their cards`
        : turn.phase === "paused"
          ? "Paused"
          : null
  return (
    <main className="screen">
      {header}
      <div className="grow-center stack center">
        {line ? (
          <p className="watch-line">{line}</p>
        ) : (
          <p className="watch-line">
            {giver} is {VERB[kind]} for <span className={`ink-${turn.team}`}>{team}</span>
          </p>
        )}
        <Countdown seconds={left} total={turn.durationMs / 1000} big />
        {turn.phase !== "ready" && (
          <p className="muted">
            {team} got {turn.gotCount} this turn
          </p>
        )}
      </div>
      <Scoreboard snap={snap} />
      {next && <p className="muted center">Up next: {next}</p>}
    </main>
  )
}

export function Scoreboard({ snap }: { snap: Snapshot }) {
  return (
    <div className="scoreboard" aria-label="Score">
      <div className="score score-tangerine">
        <span className="score-name">Tangerine</span>
        <span className="score-num">{snap.scores.byTeam.tangerine}</span>
      </div>
      <div className="score score-lagoon">
        <span className="score-name">Lagoon</span>
        <span className="score-num">{snap.scores.byTeam.lagoon}</span>
      </div>
    </div>
  )
}

function Review({ turn, snap, send, header, mine }: { turn: Turn; snap: Snapshot; send: Send; header: ReactNode; mine: boolean }) {
  const items = turn.review ?? []
  const got = items.filter((i) => i.outcome === "got").length
  return (
    <main className="screen">
      {header}
      <h1>{turn.remainingMs ? "Bowl's empty" : "Time's up"}</h1>
      <p className="muted">{mine ? "Untick anything you got by mistake." : `Checking ${nameOf(snap, turn.playerId)}'s cards for them.`}</p>
      <ul className="review-list">
        {items.map((i) => (
          <li key={i.cardId}>
            <label className={`review-row review-${i.outcome}`}>
              <input
                type="checkbox"
                aria-label={i.word}
                checked={i.outcome === "got"}
                disabled={i.outcome === "skipped"}
                onChange={() => send({ type: "reviewToggle", turnId: turn.id, cardId: i.cardId })}
              />
              <span className="review-word">{i.word}</span>
              <span className="review-tag">{i.outcome === "got" ? "Got it" : i.outcome === "skipped" ? "Skipped" : "Not guessed"}</span>
            </label>
          </li>
        ))}
        {items.length === 0 && <li className="muted">No cards this turn.</li>}
      </ul>
      <div className="grow" />
      <footer className="actions">
        <p className="center review-total">
          +{got} for {TEAM_NAMES[turn.team]}
        </p>
        <button type="button" className="btn btn-paper" onClick={() => send({ type: "confirmReview", turnId: turn.id })}>
          Done
        </button>
      </footer>
    </main>
  )
}
