import { useEffect, useRef } from "react"
import type { Snapshot } from "@saladbowl/shared"
import { sound } from "../device/sound"

/** Bell once per turn when time runs out (even if the countdown jumped past 1), tick once at 5 s. */
export function useTurnSounds(turn: Snapshot["turn"], left: number) {
  const last = useRef<{ id: string | null; left: number; phase: string | null; rang: boolean; ticked: boolean }>({
    id: null,
    left: Infinity,
    phase: null,
    rang: false,
    ticked: false,
  })
  useEffect(() => {
    const l = last.current
    if (!turn) return
    if (turn.id !== l.id) Object.assign(l, { id: turn.id, left: Infinity, phase: null, rang: false, ticked: false })
    const timedOut =
      (turn.phase === "playing" && left === 0 && l.left > 0) ||
      (turn.phase === "review" && l.phase === "playing" && (turn.remainingMs ?? 0) === 0)
    if (timedOut && !l.rang) {
      l.rang = true
      sound.bell()
    }
    if (turn.phase === "playing" && left <= 5 && left > 0 && l.left > 5 && !l.ticked) {
      l.ticked = true
      sound.tick()
    }
    l.left = left
    l.phase = turn.phase
  }, [turn, left])
}
