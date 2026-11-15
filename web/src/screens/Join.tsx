import { useEffect, useState } from "react"
import { api } from "../net/api"
import { navigate } from "../router"

interface Invite {
  phase: string
  alreadyIn: boolean
  takeover: { playerId: string; name: string }[]
}

const ERRORS: Record<string, string> = {
  name_taken: "Someone already has that name. Add an initial?",
  player_busy: "That player is already playing on another phone.",
  rate_limited: "Too many tries from this network. Wait a few minutes.",
}

export function Join({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null | "invalid">(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api<Invite>("GET", `/api/invite/${token}`).then((r) => {
      if (!r.ok) return setInvite("invalid")
      if (r.data.alreadyIn) return navigate("/game", true)
      setInvite(r.data)
    })
  }, [token])

  const join = async (body: object) => {
    setBusy(true)
    setError(null)
    const r = await api<{ code?: string }>("POST", `/api/invite/${token}/join`, body)
    setBusy(false)
    if (r.ok) return navigate("/game", true)
    if (r.status === 404) return setInvite("invalid")
    setError(ERRORS[r.data?.code ?? ""] ?? "That didn't work. Try again.")
  }

  if (invite === null) return <main className="screen" aria-busy="true" />
  if (invite === "invalid")
    return (
      <main className="screen screen-center">
        <h1>This invite no longer works</h1>
        <p className="muted">Ask the host to show you the QR code again.</p>
      </main>
    )

  return (
    <main className="screen screen-center">
      <h1 className="brand">Saladbowl</h1>
      <p className="muted">{invite.phase === "lobby" ? "You've been invited to a game." : "This game has already started. Jump in."}</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void join({ name: name.trim() })
        }}
      >
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            className="input"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            autoCapitalize="words"
            enterKeyHint="go"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-paper" disabled={busy || !name.trim()}>
          Join game
        </button>
      </form>
      {invite.takeover.length > 0 && (
        <section className="stack" aria-label="Rejoin">
          <h2>Are you one of these?</h2>
          <p className="muted">Pick your name if you were playing on this phone or another one.</p>
          <div className="seg-row">
            {invite.takeover.map((p) => (
              <button key={p.playerId} type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void join({ takeoverPlayerId: p.playerId })}>
                I'm {p.name}
              </button>
            ))}
          </div>
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
