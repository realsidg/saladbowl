import { useEffect, useState } from "react"
import { api, type Me } from "./net/api"
import { navigate, usePath } from "./router"
import { Game } from "./screens/Game"
import { Join } from "./screens/Join"
import { Login } from "./screens/Login"

export function App() {
  const path = usePath()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    void api<Me>("GET", "/api/me").then((r) => setMe(r.ok ? r.data : { isHost: false, gameId: null }))
  }, [path])

  const join = path.match(/^\/join\/([A-Za-z0-9_-]{1,64})$/)
  if (join) return <Join token={join[1]!} />
  if (!me) return null
  if (path === "/game") {
    if (!me.gameId) {
      navigate("/", true)
      return null
    }
    return <Game />
  }
  return <Login me={me} onChange={setMe} />
}
