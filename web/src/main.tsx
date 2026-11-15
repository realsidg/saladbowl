import "@fontsource/kalam/700.css"
import "@fontsource/rubik/500.css"
import "@fontsource/rubik/700.css"
import "@fontsource/rubik/900.css"
import "./styles/tokens.css"
import "./styles/base.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { sound } from "./device/sound"

// Sound needs one tap before it can play.
window.addEventListener("pointerdown", () => sound.unlock(), { capture: true })

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}))
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
