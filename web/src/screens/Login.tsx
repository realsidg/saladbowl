import type { Me } from "../net/api"
export function Login(_: { me: Me; onChange: (m: Me) => void }) {
  return <main className="screen">Login</main>
}
