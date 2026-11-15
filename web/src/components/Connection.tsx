import type { SocketStatus } from "../net/socket"

export function Connection({ status }: { status: SocketStatus }) {
  if (status === "live") return null
  const text =
    status === "gone" ? "You've been removed from this game." : status === "offline" ? "Reconnecting…" : "Connecting…"
  return (
    <div className="banner" role="status">
      {text}
    </div>
  )
}
