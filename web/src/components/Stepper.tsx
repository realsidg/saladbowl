import { Icon } from "./Icon"
import { useEffect, useRef, useState } from "react"

export function Stepper(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (n: number) => string
  onChange: (n: number) => void
}) {
  const step = props.step ?? 1
  // Show each tap at once and build on it, so quick taps aren't lost while the server's update is on its way.
  const [local, setLocal] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (local !== null && props.value === local) setLocal(null)
  }, [props.value, local])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const value = local ?? props.value
  const set = (n: number) => {
    const v = Math.min(props.max, Math.max(props.min, n))
    if (v === value) return
    setLocal(v)
    props.onChange(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setLocal(null), 4000) // if the server never confirms, fall back to its value
  }
  return (
    <div role="group" aria-label={props.label} className="stepper">
      <span className="stepper-label">{props.label}</span>
      <div className="stepper-row">
        <button type="button" className="btn-icon" aria-label={`Less ${props.label.toLowerCase()}`} disabled={value <= props.min} onClick={() => set(value - step)}>
          <Icon name="minus" size={18} />
        </button>
        <output aria-live="polite">{props.format ? props.format(value) : value}</output>
        <button type="button" className="btn-icon" aria-label={`More ${props.label.toLowerCase()}`} disabled={value >= props.max} onClick={() => set(value + step)}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  )
}
