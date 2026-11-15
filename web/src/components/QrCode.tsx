import QRCode from "qrcode"
import { useMemo } from "react"

/** Crisp SVG QR code, drawn from the module matrix (no canvas, no data URLs). */
export function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" })
    const n = qr.modules.size
    let d = ""
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x + 2} ${y + 2}h1v1h-1z`
    return { d, n: n + 4 }
  }, [text])
  return (
    <svg
      data-qr
      role="img"
      aria-label={`QR code for ${text}`}
      viewBox={`0 0 ${path.n} ${path.n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ background: "#fffdf6", borderRadius: 12, display: "block" }}
    >
      <path d={path.d} fill="#1d2a6b" />
    </svg>
  )
}
