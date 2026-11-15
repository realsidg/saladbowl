import { useEffect } from "react"

type Sentinel = { release(): Promise<void>; released?: boolean }

/** Keeps the screen on while `active`, re-acquiring after the page is hidden and shown again. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }).wakeLock
    if (!active || !wl) return
    let lock: Sentinel | null = null
    let stopped = false
    const acquire = async () => {
      if (stopped || document.visibilityState !== "visible") return
      try {
        lock = await wl.request("screen")
      } catch {
        /* battery saver or unsupported: carry on without */
      }
    }
    const onVis = () => {
      if (!lock || lock.released) void acquire()
    }
    void acquire()
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stopped = true
      document.removeEventListener("visibilitychange", onVis)
      void lock?.release().catch(() => {})
    }
  }, [active])
}
