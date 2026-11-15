// Synthesised sounds (no audio files). Browsers only allow sound after a tap, so unlock() runs on the first one.
let ctx: AudioContext | null = null

const KEY = "saladbowl-muted"
function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export const sound = {
  muted: readMuted(),

  setMuted(m: boolean) {
    sound.muted = m
    try {
      localStorage.setItem(KEY, m ? "1" : "0")
    } catch {
      /* private mode: keep it in memory */
    }
  },

  unlock() {
    if (ctx) {
      // iOS reports "interrupted" after the screen locks or a call; anything but running needs a resume
      if (ctx.state !== "running") void ctx.resume().catch(() => {})
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = new AC()
    // a silent blip finishes the unlock on iOS
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    g.gain.value = 0
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.01)
  },

  tone(freq: number, start: number, length: number, volume: number) {
    if (!ctx || sound.muted) return
    const t = ctx.currentTime + start
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = "sine"
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(volume, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + length)
    o.connect(g).connect(ctx.destination)
    o.start(t)
    o.stop(t + length + 0.05)
  },

  /** Time's up. */
  bell() {
    sound.tone(880, 0, 1.2, 0.5)
    sound.tone(1320, 0, 0.9, 0.25)
    sound.tone(660, 0.25, 1.2, 0.35)
    try {
      navigator.vibrate?.([200, 100, 200])
    } catch {
      /* not supported */
    }
  },

  /** test hook */
  _ctx: () => ctx,

  /** Five seconds left. */
  tick() {
    sound.tone(1200, 0, 0.12, 0.25)
  },
}
