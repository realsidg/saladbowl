import { Icon } from "./Icon"
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
  const set = (n: number) => props.onChange(Math.min(props.max, Math.max(props.min, n)))
  return (
    <div role="group" aria-label={props.label} className="stepper">
      <span className="stepper-label">{props.label}</span>
      <div className="stepper-row">
        <button type="button" className="btn-icon" aria-label={`Less ${props.label.toLowerCase()}`} disabled={props.value <= props.min} onClick={() => set(props.value - step)}>
          <Icon name="minus" size={18} />
        </button>
        <output aria-live="polite">{props.format ? props.format(props.value) : props.value}</output>
        <button type="button" className="btn-icon" aria-label={`More ${props.label.toLowerCase()}`} disabled={props.value >= props.max} onClick={() => set(props.value + step)}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  )
}
