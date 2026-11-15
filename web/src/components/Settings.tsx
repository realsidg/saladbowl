import { Icon } from "./Icon"
import { useEffect, useState } from "react"
import { ROUND_KINDS, ROUNDS_MAX, SECONDS_MAX, SECONDS_MIN, WORDS_PER_PLAYER_MAX, type Intent, type RoundKind, type Settings as S } from "@saladbowl/shared"
import { ROUND_NAMES } from "../lib/words"
import { Stepper } from "./Stepper"

type Send = (i: Intent) => boolean

/** Host-only game rules. `locked` hides what can't change once words are in or the game has started. */
export function Settings({ settings, send, inLobby }: { settings: S; send: Send; inLobby: boolean }) {
  const patch = (p: Partial<S>) => send({ type: "updateSettings", patch: p })
  return (
    <section className="sheet settings" aria-label="Game rules">
      <h2>Rules</h2>
      <Stepper
        label="Seconds per turn"
        value={settings.secondsPerTurn}
        min={SECONDS_MIN}
        max={SECONDS_MAX}
        step={5}
        format={(n) => `${n}s`}
        onChange={(n) => patch({ secondsPerTurn: n })}
      />
      {inLobby && (
        <>
          <div className="seg" role="radiogroup" aria-label="Where words come from">
            <span className="stepper-label">Words come from</span>
            <div className="seg-row">
              {(["players", "host"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={settings.wordSource === w}
                  className={settings.wordSource === w ? "seg-on" : ""}
                  onClick={() => patch({ wordSource: w })}
                >
                  {w === "players" ? "Everyone" : "Just me"}
                </button>
              ))}
            </div>
          </div>
          {settings.wordSource === "players" && (
            <>
              <Stepper
                label="Words each"
                value={settings.wordsPerPlayer}
                min={1}
                max={WORDS_PER_PLAYER_MAX}
                onChange={(n) => patch({ wordsPerPlayer: n })}
              />
              <LetterInput value={settings.startingLetter} onChange={(l) => patch({ startingLetter: l })} />
            </>
          )}
          <Rounds rounds={settings.rounds} onChange={(r) => patch({ rounds: r })} />
        </>
      )}
      <label className="toggle">
        <input type="checkbox" checked={settings.allowSkips} disabled={!inLobby} onChange={(e) => patch({ allowSkips: e.target.checked })} />
        <span>Allow skips</span>
      </label>
    </section>
  )
}

function LetterInput({ value, onChange }: { value: string | null; onChange: (l: string | null) => void }) {
  const [v, setV] = useState(value ?? "")
  useEffect(() => setV(value ?? ""), [value])
  return (
    <div className="field">
      <label htmlFor="letter">Every word starts with</label>
      <input
        id="letter"
        name="letter"
        autoComplete="off"
        className="input input-paper"
        inputMode="text"
        autoCapitalize="characters"
        maxLength={1}
        placeholder="Any letter"
        value={v}
        onChange={(e) => {
          const l = e.target.value.replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase()
          setV(l)
          onChange(l || null)
        }}
      />
    </div>
  )
}

function Rounds({ rounds, onChange }: { rounds: RoundKind[]; onChange: (r: RoundKind[]) => void }) {
  const move = (i: number, d: -1 | 1) => {
    const r = [...rounds]
    ;[r[i], r[i + d]] = [r[i + d]!, r[i]!]
    onChange(r)
  }
  return (
    <div className="rounds">
      <span className="stepper-label">Rounds, in order</span>
      <ol>
        {rounds.map((k, i) => (
          <li key={`${k}-${i}`}>
            <span>{ROUND_NAMES[k]}</span>
            <span>
              <button type="button" className="btn-icon" aria-label={`Move ${ROUND_NAMES[k]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" size={18} />
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Move ${ROUND_NAMES[k]} down`}
                disabled={i === rounds.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="down" size={18} />
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove ${ROUND_NAMES[k]}`}
                disabled={rounds.length <= 1}
                onClick={() => onChange(rounds.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={18} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {rounds.length < ROUNDS_MAX && (
        <div className="seg-row">
          {ROUND_KINDS.map((k) => (
            <button key={k} type="button" className="btn btn-small btn-ink" onClick={() => onChange([...rounds, k])}>
              Add {ROUND_NAMES[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
