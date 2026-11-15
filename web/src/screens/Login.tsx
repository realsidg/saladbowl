import { useState } from "react"
import { api, type Me } from "../net/api"
import { navigate } from "../router"

export function Login({ me, onChange }: { me: Me; onChange: (m: Me) => void }) {
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const login = async () => {
    setBusy(true)
    setError(null)
    const r = await api("POST", "/api/login", { password })
    setBusy(false)
    if (r.ok) {
      setPassword("")
      return onChange({ ...me, isHost: true })
    }
    if (r.status === 429) {
      const mins = Math.max(1, Math.ceil((r.retryAfterSeconds ?? 60) / 60))
      return setError(`Too many tries. Try again in ${mins} ${mins === 1 ? "minute" : "minutes"}.`)
    }
    setError(r.status === 401 ? "That password isn't right." : "Couldn't reach the server. Check your connection.")
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    const r = await api<{ gameId?: string; code?: string }>("POST", "/api/games", { name: name.trim() })
    setBusy(false)
    if (r.ok) return navigate("/game")
    if (r.status === 401) return onChange({ ...me, isHost: false })
    setError(r.status === 429 ? "That's a lot of games. Wait a bit and try again." : "Couldn't start a game. Try again.")
  }

  const logout = async () => {
    await api("POST", "/api/logout", {})
    onChange({ isHost: false, gameId: null })
  }

  return (
    <main className="screen screen-center">
      <h1 className="brand" translate="no">
        Saladbowl
      </h1>
      {me.gameId && (
        <section className="stack">
          <p>You're in a game.</p>
          <button type="button" className="btn btn-paper" onClick={() => navigate("/game")}>
            Back to the game
          </button>
        </section>
      )}

      {me.isHost ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void create()
          }}
        >
          <div className="field">
            <label htmlFor="host-name">Your name</label>
            <input
              id="host-name"
              name="nickname"
              className="input"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              autoCapitalize="words"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className={`btn ${me.gameId ? "btn-outline" : "btn-paper"}`} disabled={busy || !name.trim()}>
            Start a new game
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void logout()}>
            Log out
          </button>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void login()
          }}
        >
          <p className="muted">Hosts sign in here. Got an invite? Scan the host's QR code instead.</p>
          <div className="field">
            <label htmlFor="password">Host password</label>
            <input
              id="password"
              name="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-paper" disabled={busy || !password}>
            Sign in
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
