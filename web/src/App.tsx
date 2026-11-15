import { useEffect, useState } from "react"
import { api, type Me } from "./net/api"
import { navigate, usePath } from "./router"
import { Game } from "./screens/Game"
import { Join } from "./screens/Join"
import { Login } from "./screens/Login"

export function App() {
  const path = usePath()
  // `me` is only trusted for the path it was fetched on, so a stale "not in a game" can't bounce /game back to /.
  const [me, setMe] = useState<{ path: string; value: Me } | null>(null)

  useEffect(() => {
    let live = true
    void api<Me>("GET", "/api/me").then((r) => {
      if (live) setMe({ path, value: r.ok ? r.data : { isHost: false, gameId: null } })
    })
    return () => {
      live = false
    }
  }, [path])

  const join = path.match(/^\/join\/([A-Za-z0-9_-]{1,64})$/)
  if (join) return <Join token={join[1]!} />
  if (!me || me.path !== path) return null
  if (path === "/game") {
    if (!me.value.gameId) {
      navigate("/", true)
      return null
    }
    return <Game />
  }
  return <Login me={me.value} onChange={(value) => setMe({ path, value })} />
}
