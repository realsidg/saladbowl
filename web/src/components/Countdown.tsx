export function Countdown({ seconds, total, big }: { seconds: number; total: number; big?: boolean }) {
  const frac = total > 0 ? Math.min(1, Math.max(0, seconds / total)) : 0
  if (!big)
    return (
      <div className={`countdown-small${seconds <= 5 ? " countdown-low" : ""}`} aria-label={`${seconds} seconds left`}>
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </div>
    )
  return (
    <div className="countdown-ring" style={{ ["--frac" as string]: frac }} role="timer" aria-label={`${seconds} seconds left`}>
      <div className={`countdown-num${seconds <= 5 ? " countdown-low" : ""}`}>{seconds}</div>
    </div>
  )
}
