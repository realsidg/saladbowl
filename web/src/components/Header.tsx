import { useState, type ReactNode } from "react"
import { sound } from "../device/sound"

export function Header({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const [muted, setMuted] = useState(sound.muted)
  return (
    <header className="status">
      <span>{children}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {extra}
        <button
          type="button"
          className="btn-icon"
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          aria-pressed={muted}
          onClick={() => {
            sound.setMuted(!muted)
            setMuted(!muted)
          }}
        >
          {muted ? "🔇" : "🔈"}
        </button>
      </span>
    </header>
  )
}
