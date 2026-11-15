import { Icon } from "./Icon"
import { useEffect, useRef, useState } from "react"
import { SECONDS_MAX, SECONDS_MIN, type Intent, type Snapshot } from "@saladbowl/shared"
import { nameOf } from "../lib/words"
import { QrCode } from "./QrCode"
import { Stepper } from "./Stepper"

/** The host's in-game controls, in a sheet so they never crowd the play screen. */
export function HostMenu({ snap, send }: { snap: Snapshot; send: (i: Intent) => boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal?.()
    if (!open && d.open) d.close?.()
  }, [open])

  const t = snap.turn
  const act = (i: Intent) => {
    send(i)
    setOpen(false)
  }
  const players = snap.players.filter((p) => !p.kicked)

  return (
    <>
      <button type="button" className="btn btn-small btn-quiet" onClick={() => setOpen(true)}>
        Host
      </button>
      <dialog ref={ref} className="host-sheet" onClose={() => setOpen(false)} aria-label="Host controls">
        {open && (
          <div className="stack">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2>Host controls</h2>
              <button type="button" className="btn-icon" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon name="close" />
              </button>
            </div>
            {t?.phase === "playing" && (
              <button type="button" className="btn btn-ink" onClick={() => act({ type: "pause", turnId: t.id })}>
                Pause the timer
              </button>
            )}
            {t?.phase === "paused" && (
              <button type="button" className="btn btn-ink" onClick={() => act({ type: "resume", turnId: t.id })}>
                Resume the timer
              </button>
            )}
            {t?.phase === "ready" && (
              <button type="button" className="btn btn-ink" onClick={() => act({ type: "skipPlayer", turnId: t.id })}>
                Skip {nameOf(snap, t.playerId)}
              </button>
            )}
            <Stepper
              label="Seconds per turn"
              value={snap.settings.secondsPerTurn}
              min={SECONDS_MIN}
              max={SECONDS_MAX}
              step={5}
              format={(n) => `${n}s`}
              onChange={(n) => send({ type: "updateSettings", patch: { secondsPerTurn: n } })}
            />
            {snap.inviteUrl && (
              <details>
                <summary>Let someone join</summary>
                <div className="invite">
                  <QrCode text={snap.inviteUrl} size={180} />
                  <button
                    type="button"
                    className="btn btn-small btn-quiet"
                    onClick={() => {
                      if (confirm("Make a new invite link? The old QR code will stop working.")) act({ type: "resetInvite" })
                    }}
                  >
                    Make a new link
                  </button>
                </div>
              </details>
            )}
            <details>
              <summary>Remove a player</summary>
              <ul className="kick-list">
                {players
                  .filter((p) => p.id !== snap.me.playerId)
                  .map((p) => (
                    <li key={p.id}>
                      <span>{p.name}</span>
                      <button
                        type="button"
                        className="btn btn-small btn-quiet"
                        onClick={() => {
                          if (confirm(`Remove ${p.name} from the game? Their words stay in the bowl.`)) act({ type: "kickPlayer", playerId: p.id })
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
              </ul>
            </details>
            <button
              type="button"
              className="btn btn-outline btn-danger"
              onClick={() => {
                if (confirm("End the game for everyone now?")) act({ type: "endGame" })
              }}
            >
              End the game
            </button>
          </div>
        )}
      </dialog>
    </>
  )
}
