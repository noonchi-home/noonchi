"use client"

// 21st.dev「Trace Group」(id 46377, aadixc0de/trace-group) 받은 코드.
// 바꾼 것: 같은 부품 데모의 TraceStep(한 단계 줄)을 함께 내보낸다. 다시 하기 단추(onRetry·Button)와 재시도 차례(attempt)는 뺐다. chatcn 색 변수를 공통 토큰으로 잇는다(fg → ink, fg-muted → ink-2, fg-subtle → ink-3, fg-faint → ink-4, border → line, border-strong → line-strong, card → card, fill → inset, accent → focus-ring, 스크롤바 alpha → line-strong·ink-4, 그림자 → shadow-card·shadow-sm·shadow-xs, 가리개 그라데이션 #000 → ink, blue → info-vivid, red → error, amber → warn, fill-hover → hover). 회색 단계·primary 변수와 .dark 줄을 지웠다.
// 원래 글 크기: text-sm(14px). 받은 크기(Trace 기본 text-[0.875rem], compact text-[0.8125rem]) 그대로다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
// From chatcn, chat, voice and agent UI for shadcn: https://chatcn.dev

import * as React from "react"
import { forwardRef, createElement, type SVGAttributes, type ForwardRefExoticComponent, type RefAttributes } from "react"
import { cn } from "@/lib/utils"
import { Collapsible } from "@base-ui/react/collapsible"

/** chatcn theme variables and utilities this file uses, light and dark. */
const CHATCN_CSS = ":root{--chatcn-accent:var(--focus-ring);--chatcn-alpha-500:var(--line-strong);--chatcn-alpha-600:var(--ink-4);--chatcn-amber:var(--warn);--chatcn-bg:var(--surface);--chatcn-blue:var(--info-vivid);--chatcn-border:var(--line);--chatcn-border-strong:var(--line-strong);--chatcn-card:var(--card);--chatcn-ease-out:cubic-bezier(0.23, 1, 0.32, 1);--chatcn-ease-standard:ease;--chatcn-fg:var(--ink);--chatcn-fg-faint:var(--ink-4);--chatcn-fg-muted:var(--ink-2);--chatcn-fg-subtle:var(--ink-3);--chatcn-fill:var(--inset);--chatcn-fill-hover:var(--hover);--chatcn-press-scale:0.97;--chatcn-press-scale-icon:0.94;--chatcn-radius-lg:12px;--chatcn-radius-md:8px;--chatcn-radius-sm:6px;--chatcn-red:var(--error);--chatcn-scrollbar:var(--chatcn-alpha-500);--chatcn-scrollbar-hover:var(--chatcn-alpha-600);--chatcn-shadow-sm:var(--shadow-sm);--chatcn-shadow-xs:var(--shadow-xs)}.chatcn-focus{}.chatcn-focus:focus-visible{outline: 2px solid var(--chatcn-accent); outline-offset: 2px;}.chatcn-spin{animation: chatcn-spin 0.8s linear infinite;}.chatcn-scroll{scrollbar-width: thin; scrollbar-color: var(--chatcn-scrollbar) transparent;}.chatcn-scroll:hover{scrollbar-color: var(--chatcn-scrollbar-hover) transparent;}.chatcn-scroll::-webkit-scrollbar{width: 10px; height: 10px;}.chatcn-scroll::-webkit-scrollbar-track, .chatcn-scroll::-webkit-scrollbar-corner{background: transparent;}.chatcn-scroll::-webkit-scrollbar-thumb{background-color: var(--chatcn-scrollbar); background-clip: content-box; border: 3px solid transparent; border-radius: 9999px;}.chatcn-scroll::-webkit-scrollbar-thumb:hover{background-color: var(--chatcn-scrollbar-hover);}@keyframes chatcn-spin { to { transform: rotate(360deg); } }@keyframes chatcn-swap { from { opacity: 0; scale: 0.8; filter: blur(2px); } to { opacity: 1; scale: 1; filter: blur(0); } }@media (prefers-reduced-motion: reduce){:root{--chatcn-press-scale:1;--chatcn-press-scale-icon:1;--chatcn-enter-scale:1}}"
if (typeof document !== "undefined" && !document.getElementById("chatcn-trace-group")) {
  const style = document.createElement("style")
  style.id = "chatcn-trace-group"
  style.textContent = CHATCN_CSS
  document.head.appendChild(style)
}

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

/** Every state an agent step can be in. A superset of tool states, for any kind of step. */
export type TraceStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "approval-requested"
  | "approval-responded"
  | "denied"
  | "cancelled"
  | "retrying"
  | "skipped"

export interface TraceGroupProps extends Omit<React.ComponentProps<"li">, "title"> {
  status: TraceStatus
  /** Summary once finished, for example "Read 6 files". */
  title: React.ReactNode
  /** Label while running, for example "Reading files". Defaults to `title`. */
  activeTitle?: React.ReactNode
  /**
   * The "doing now" line while running: the file being read, the site being searched. Swaps in
   * place without animation, so a group that moves through 300 steps stays still.
   */
  current?: React.ReactNode
  /** Shown in place of `current` once finished, for example "4 KB" or "2 failed". */
  summary?: React.ReactNode
  /** Glyph at rest. Defaults to a list tree. */
  icon?: React.ReactNode
  durationMs?: number
  startedAt?: number
  /** Cap for the expanded list before it scrolls. Defaults to 22 rem. */
  maxHeight?: string
  /** The grouped steps, usually `TraceStep` elements. Mounted only while expanded. */
  children?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

const ACTIVE: TraceStatus[] = ["running", "approval-responded", "retrying"]

/** True while the step is doing work, so timers tick and spinners spin. */
function isTraceActive(status: TraceStatus) {
  return ACTIVE.includes(status)
}

/** The rail segment between this item's glyph and the next one. Hidden on the last item. */
export function TraceConnector({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="trace-connector"
      className={cn(
        "bg-(color:--chatcn-border) pointer-events-none absolute start-[15.5px] w-px",
        "top-[calc(var(--trace-row)/2+12px)] bottom-[calc(12px-var(--trace-row)/2)]",
        "group-last/trace-item:hidden",
        // Compact rows sit inside a group, beside the parent rail: dots alone read cleaner.
        "in-data-[density=compact]:hidden",
        // An open inline tool call draws its own line through its details.
        "group-has-[[data-slot=tool-call][data-variant=inline][data-open]]/trace-item:hidden",
        className,
      )}
    />
  )
}

/* -------------------------------------------------------------------------------------------------
 * Status glyph
 * -----------------------------------------------------------------------------------------------*/

interface TraceStatusGlyphProps {
  status: TraceStatus
  /** Shown at rest (done), for example the tool icon. Defaults to a check. */
  icon?: React.ReactNode
  className?: string
}

type TraceDensity = "default" | "compact"

export const TraceContext = React.createContext<{ density: TraceDensity }>({ density: "default" })

/**
 * Remembers whether a value has changed since mount. The status glyph only plays its swap after a
 * real change, so a trace of 300 finished steps mounts perfectly still.
 */
function useChangedSinceMount<T>(value: T) {
  const first = React.useRef(value)
  const changed = React.useRef(false)
  if (!Object.is(value, first.current)) changed.current = true
  return changed.current
}

/** The kit's one spinner. 0.8 s per turn, slowed to 1.2 s under reduced motion. */
function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-slot="spinner"
      className={cn("chatcn-spin size-3.5 shrink-0", className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <path
        d="M8 1.75A6.25 6.25 0 0 1 14.25 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

interface IconProps extends SVGAttributes<SVGSVGElement> {
  /** Width and height. Number means px. Default 24. */
  size?: number | string
  /** Stroke width in viewBox units (24 grid). Default 1.5. */
  strokeWidth?: number | string
  /** Keep the rendered stroke at `strokeWidth` px at any size. */
  absoluteStrokeWidth?: boolean
  /** Stroke color. Default currentColor. */
  color?: string
  /** Accessible name. Renders <title> and sets role="img"; without it the icon is aria-hidden. */
  title?: string
}

export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

/** Shape elements an icon may contain. */
type IconElement = "path" | "circle" | "rect" | "ellipse" | "line" | "polyline" | "polygon"

/** An icon's drawing: a flat list of [element, attributes] pairs, lucide compatible. */
export type IconNode = ReadonlyArray<readonly [IconElement, Readonly<Record<string, string>>]>

const toPascal = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")

/**
 * Builds a React icon component from an icon node.
 * `name` is the kebab-case icon name, used for the class `chatcn-icon-<name>` and displayName.
 */
export function createIcon(name: string, iconNode: IconNode): Icon {
  // biome-ignore lint/correctness/noComponentHookFactories: runs once per icon at module load
  const Component = forwardRef<SVGSVGElement, IconProps>(function ChatcnIcon(
    {
      size = 24,
      strokeWidth = 1.5,
      absoluteStrokeWidth = false,
      color = "currentColor",
      title,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const stroke = absoluteStrokeWidth
      ? (Number(strokeWidth) * 24) / Number.parseFloat(String(size))
      : strokeWidth
    const labelled = Boolean(title || rest["aria-label"] || rest["aria-labelledby"])
    return createElement(
      "svg",
      {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: color,
        strokeWidth: stroke,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "data-slot": "icon",
        className: className
          ? `chatcn-icon chatcn-icon-${name} ${className}`
          : `chatcn-icon chatcn-icon-${name}`,
        ...(labelled ? { role: "img" } : { "aria-hidden": true }),
        ...rest,
      },
      title ? createElement("title", null, title) : null,
      ...iconNode.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
      children,
    )
  })
  Component.displayName = `${toPascal(name)}Icon`
  return Component
}

const iconNode: IconNode = [
  ["path", {"d":"M18.51 17.46a8.5 8.5 0 1 1-1.05-11.97"}],
  ["path", {"d":"m15.79 8.65 2.94-.26a2 2 0 0 0 1.82-2.16l-.26-2.94"}],
]

const RotateCwIcon: Icon = /* @__PURE__ */ createIcon("rotate-cw", iconNode)

const iconNode2: IconNode = [
  ["path", {"d":"M6.25 14.5V8.25A1.75 1.75 0 0 1 8 6.5a1.75 1.75 0 0 1 1.75 1.75v3.25"}],
  ["path", {"d":"M9.75 11V6a1.75 1.75 0 0 1 1.75-1.75A1.75 1.75 0 0 1 13.25 6v5"}],
  ["path", {"d":"M13.25 11V7A1.75 1.75 0 0 1 15 5.25 1.75 1.75 0 0 1 16.75 7v4.5"}],
  ["path", {"d":"M16.75 12v-2a1.75 1.75 0 0 1 1.75-1.75A1.75 1.75 0 0 1 20.25 10v6.75a4.5 4.5 0 0 1-4.5 4.5H10.1a3 3 0 0 1-2.25-1.01l-4.32-4.89a1.25 1.25 0 0 1-.2-1.33l.02-.06a1.25 1.25 0 0 1 1.91-.48l.99.77"}],
]

const HandIcon: Icon = /* @__PURE__ */ createIcon("hand", iconNode2)

const iconNode3: IconNode = [
  ["path", {"d":"M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0"}],
  ["path", {"d":"m9 9 6 6"}],
  ["path", {"d":"m15 9-6 6"}],
]

const CircleXIcon: Icon = /* @__PURE__ */ createIcon("circle-x", iconNode3)

const iconNode4: IconNode = [
  ["path", {"d":"M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0"}],
  ["path", {"d":"m7.76 7.76 8.48 8.48"}],
]

const BanIcon: Icon = /* @__PURE__ */ createIcon("ban", iconNode4)

const iconNode5: IconNode = [
  ["path", {"d":"M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0"}],
  ["path", {"d":"M10.75 8.75h2.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-2.5a2 2 0 0 1-2-2v-2.5a2 2 0 0 1 2-2"}],
]

const CircleStopIcon: Icon = /* @__PURE__ */ createIcon("circle-stop", iconNode5)

const iconNode6: IconNode = [
  ["path", {"d":"M5 12h14"}],
]

const MinusIcon: Icon = /* @__PURE__ */ createIcon("minus", iconNode6)

const iconNode7: IconNode = [
  ["path", {"d":"m4.5 12.75 3.23 3.23a2.5 2.5 0 0 0 3.54 0l8.48-8.48"}],
]

export const CheckIcon: Icon = /* @__PURE__ */ createIcon("check", iconNode7)

/**
 * The status glyph on the rail. Swaps with the chatcn-swap blur crossfade so a running step turning
 * done reads as one object changing, not two icons trading places.
 */
export function TraceStatusGlyph({ status, icon, className }: TraceStatusGlyphProps) {
  const { density } = React.useContext(TraceContext)
  const animate = useChangedSinceMount(status)
  let glyph: React.ReactNode
  let tone = "text-(color:--chatcn-fg-subtle)"

  switch (status) {
    case "running":
    case "approval-responded":
      // Status hues match ToolCall and RunStatus: blue is running, amber needs the user.
      glyph = <Spinner />
      tone = "text-(color:--chatcn-blue)"
      break
    case "retrying":
      glyph = <RotateCwIcon />
      tone = "text-(color:--chatcn-blue)"
      break
    case "approval-requested":
      glyph = <HandIcon />
      tone = "text-(color:--chatcn-amber)"
      break
    case "error":
      glyph = <CircleXIcon />
      tone = "text-(color:--chatcn-red)"
      break
    case "denied":
      glyph = <BanIcon />
      break
    case "cancelled":
      glyph = <CircleStopIcon />
      break
    case "skipped":
      glyph = <MinusIcon />
      tone = "text-(color:--chatcn-fg-faint)"
      break
    case "pending":
      // A hollow ring, smaller than an icon: a place in the queue, not a thing yet.
      glyph = (
        <span className="size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--chatcn-border-strong)]" />
      )
      break
    default:
      glyph =
        icon ??
        (density === "compact" ? (
          <span className="bg-(color:--chatcn-fg-faint) size-1.5 rounded-full" />
        ) : (
          <CheckIcon />
        ))
  }

  return (
    <span
      data-slot="trace-status"
      aria-hidden="true"
      className={cn(
        "relative grid size-4 shrink-0 place-items-center",
        density === "compact" ? "[&_svg]:size-3.5" : "[&_svg]:size-4",
        tone,
        className,
      )}
    >
      <span
        key={status === "done" ? "done" : status}
        className={cn(
          "grid place-items-center",
          animate && "motion-safe:animate-[chatcn-swap_150ms_var(--chatcn-ease-out)]",
        )}
      >
        {glyph}
      </span>
    </span>
  )
}

const iconNode8: IconNode = [
  ["path", {"d":"M4 3.5v6A2.5 2.5 0 0 0 6.5 12h3"}],
  ["path", {"d":"M4 12v3.5A2.5 2.5 0 0 0 6.5 18h3"}],
  ["path", {"d":"M9 6h11.5"}],
  ["path", {"d":"M13.5 12h7"}],
  ["path", {"d":"M13.5 18h7"}],
]

const ListTreeIcon: Icon = /* @__PURE__ */ createIcon("list-tree", iconNode8)

interface StepTimerProps extends Omit<React.ComponentProps<"span">, "children" | "prefix"> {
  /** True while the step runs. The counter ticks once per second, in whole seconds. */
  running?: boolean
  /** Epoch ms when the step started. Measured from the first running render when omitted. */
  startedAt?: number
  /** Final duration. Shown once `running` is false. */
  durationMs?: number
  /**
   * Hide the live counter until this much time has passed, so quick steps never flash a timer.
   * Defaults to 1000 ms.
   */
  showAfter?: number
  /** Shown while running before `showAfter`, for example "Running". Nothing by default. */
  placeholder?: React.ReactNode
  /** Format for the final duration: `precise` keeps decimals under 10 s. Defaults to true. */
  precise?: boolean
  /** Text before the time, for example "Thought for". */
  prefix?: React.ReactNode
}

interface UseChatcnElapsedOptions {
  /** True while the timed work is happening. */
  running: boolean
  /** Epoch ms when the work started. Measured from the first `running` render when omitted. */
  startedAt?: number
  /** Final duration from the runtime. Wins over the measured one once `running` is false. */
  durationMs?: number
}

interface UseChatcnElapsedResult {
  /** Live elapsed ms while running, the final duration afterwards, `undefined` when unknown. */
  ms: number | undefined
  running: boolean
}

/**
 * Elapsed time for a step, a run or a reasoning block.
 *
 * Ticks once per second, aligned to the start time so the counter turns over exactly at 1 s,
 * 2 s and so on, never at random offsets. A counter that changes faster only adds noise.
 */
function useChatcnElapsed({
  running,
  startedAt,
  durationMs,
}: UseChatcnElapsedOptions): UseChatcnElapsedResult {
  const [autoStart, setAutoStart] = React.useState<number>()
  const [measured, setMeasured] = React.useState<number>()
  // Starts empty and reads the clock after mount: a render must not read it (Next.js prerender).
  const [now, setNow] = React.useState<number | null>(null)
  const start = startedAt ?? autoStart

  // Record our own start when the caller gives none. A new run (running again) starts over.
  React.useEffect(() => {
    if (!running) return
    if (startedAt === undefined) setAutoStart((prev) => prev ?? Date.now())
    setMeasured(undefined)
    setNow(Date.now())
  }, [running, startedAt])

  // Freeze the measured duration when the work stops.
  const wasRunning = React.useRef(running)
  React.useEffect(() => {
    if (wasRunning.current && !running && start !== undefined) {
      setMeasured(Date.now() - start)
      setAutoStart(undefined)
    }
    wasRunning.current = running
  }, [running, start])

  React.useEffect(() => {
    if (!running || start === undefined) return
    let id: number
    const schedule = () => {
      const elapsed = Date.now() - start
      // Next whole-second boundary, plus a few ms so rounding never shows the old second.
      const wait = 1000 - (((elapsed % 1000) + 1000) % 1000) + 8
      id = window.setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, wait)
    }
    schedule()
    return () => window.clearTimeout(id)
  }, [running, start])

  if (running)
    return { ms: start === undefined ? undefined : Math.max(0, (now ?? start) - start), running }
  return { ms: durationMs ?? measured, running }
}

const NBSP = " "

/**
 * Formats a duration the chatcn way: numerals, a non-breaking space before the unit.
 * `precise` (the default) keeps a decimal under 10 s and milliseconds under 1 s, for finished
 * steps. Turn it off for live counters and "Thought for 12 s", which read in whole seconds.
 */
function formatChatcnDuration(ms: number, { precise = true }: { precise?: boolean } = {}) {
  const safe = Math.max(0, ms)
  if (precise && safe < 1000) return `${Math.max(1, Math.round(safe))}${NBSP}ms`
  const s = safe / 1000
  if (precise && s < 10) return `${s.toFixed(1)}${NBSP}s`
  if (s < 60) return `${precise ? Math.round(s) : Math.floor(s)}${NBSP}s`
  const totalS = Math.floor(s)
  const h = Math.floor(totalS / 3600)
  const m = Math.floor((totalS % 3600) / 60)
  const rest = totalS % 60
  if (h > 0) return `${h}${NBSP}h ${m}${NBSP}m`
  return `${m}${NBSP}m ${rest}${NBSP}s`
}

function isoDuration(ms: number) {
  return `PT${Math.max(0, Math.round(ms / 100) / 10)}S`
}

/**
 * Elapsed and final duration for a step, set in tabular figures so the width never jitters.
 * Not a live region: a timer that speaks every second is noise. Announce completion elsewhere.
 */
export function StepTimer({
  running = false,
  startedAt,
  durationMs,
  showAfter = 1000,
  placeholder = null,
  precise = true,
  prefix,
  className,
  ...props
}: StepTimerProps) {
  const { ms } = useChatcnElapsed({ running, startedAt, durationMs })

  let time: string | null = null
  if (running && ms !== undefined && ms >= showAfter)
    time = formatChatcnDuration(ms, { precise: false })
  else if (!running && ms !== undefined) time = formatChatcnDuration(ms, { precise })
  const content = time ?? (running ? placeholder : null)

  if (content === null || content === undefined) return null

  return (
    <span
      data-slot="step-timer"
      data-running={running ? "" : undefined}
      role={running ? "timer" : undefined}
      className={cn("text-[0.75rem]/[1rem] text-(color:--chatcn-fg-subtle) tabular-nums", className)}
      {...props}
    >
      {/* The placeholder stands alone; a prefix only reads well in front of a time. */}
      {prefix && time !== null ? <>{prefix} </> : null}
      {time !== null && ms !== undefined ? <time dateTime={isoDuration(ms)}>{time}</time> : content}
    </span>
  )
}

const iconNode9: IconNode = [
  ["path", {"d":"m6 9.25 4.23 4.23a2.5 2.5 0 0 0 3.54 0L18 9.25"}],
]

export const ChevronDownIcon: Icon = /* @__PURE__ */ createIcon("chevron-down", iconNode9)

/* -------------------------------------------------------------------------------------------------
 * TraceStep (from the Trace Group demo)
 * -----------------------------------------------------------------------------------------------*/

export interface TraceStepProps extends Omit<React.ComponentProps<"li">, "title"> {
  status: TraceStatus
  /** What the step does, for example "Read". Set in medium weight. */
  label?: React.ReactNode
  /** Context in mono: a path, a query, a command. Truncates. */
  detail?: React.ReactNode
  /** Glyph at rest (done). Defaults to a check, or a dot in compact traces. */
  icon?: React.ReactNode
  /** Replaces the status text and timer at the end of the row. */
  meta?: React.ReactNode
  /** Final duration in ms, shown when done. */
  durationMs?: number
  /** Epoch ms when the step started. Drives the live timer while running. */
  startedAt?: number
  /** Expandable content. Without children the row is static, which keeps long traces light. */
  children?: React.ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

const QUIET: TraceStatus[] = ["pending", "skipped", "cancelled", "denied"]

const STATUS_TEXT: Record<TraceStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  error: "Failed",
  "approval-requested": "Needs approval",
  "approval-responded": "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
  retrying: "Retrying",
  skipped: "Skipped",
}

function TraceStepMeta({
  status,
  meta,
  durationMs,
  startedAt,
}: Pick<TraceStepProps, "status" | "meta" | "durationMs" | "startedAt">) {
  const { density } = React.useContext(TraceContext)
  if (meta !== undefined)
    return <span className="text-[0.75rem]/[1rem] text-(color:--chatcn-fg-subtle)">{meta}</span>
  if (status === "running" || status === "approval-responded" || status === "done") {
    // One StepTimer across running and done, so it can measure the step when no duration is given.
    const label = status === "approval-responded" ? "Approved" : "Running"
    return (
      <StepTimer
        running={status !== "done"}
        startedAt={startedAt}
        durationMs={durationMs}
        // Compact rows are usually quick reads: no label flashing for a few hundred ms.
        placeholder={density === "compact" ? null : label}
      />
    )
  }
  if (status === "pending") return null
  return (
    <span
      className={cn(
        "text-[0.75rem]/[1rem] tabular-nums",
        status === "error" ? "text-(color:--chatcn-red)" : "text-(color:--chatcn-fg-subtle)",
      )}
    >
      {STATUS_TEXT[status]}
    </span>
  )
}

const rowBase = cn(
  "flex h-(--trace-row) w-full min-w-0 items-center gap-2.5 px-2 text-start",
  "rounded-(--chatcn-radius-md) select-none",
)

/**
 * One agent step on the rail: status glyph, label, mono detail, duration. Steps with children
 * expand to show them; the rest render as plain rows with no disclosure machinery.
 */
export function TraceStep({
  status,
  label,
  detail,
  icon,
  meta,
  durationMs,
  startedAt,
  children,
  open,
  defaultOpen,
  onOpenChange,
  className,
  ...props
}: TraceStepProps) {
  const { density } = React.useContext(TraceContext)
  const quiet = QUIET.includes(status)
  const hasContent = children !== undefined && children !== null && children !== false
  // The panel opens by the status it mounts with (an error opens it); later status changes do not
  // fight an uncontrolled panel. It mounts again whenever content returns.
  const initialOpen = React.useRef<boolean | undefined>(undefined)
  if (!hasContent) initialOpen.current = undefined
  else if (initialOpen.current === undefined)
    initialOpen.current = defaultOpen ?? (status === "error" || status === "approval-requested")

  const body = (
    <>
      <TraceStatusGlyph status={status} icon={icon} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="sr-only">{STATUS_TEXT[status]}: </span>
        {label ? (
          <span
            className={cn(
              "shrink-0",
              density === "compact" ? "font-normal" : "font-medium",
              quiet ? "text-(color:--chatcn-fg-subtle)" : "text-(color:--chatcn-fg)",
            )}
          >
            {label}
          </span>
        ) : null}
        {detail ? (
          <span
            className={cn(
              "truncate font-mono",
              label
                ? "text-[0.75rem]/[1rem] text-(color:--chatcn-fg-subtle)"
                : "text-[0.75rem]/[1rem] text-(color:--chatcn-fg-muted)",
              quiet && "text-(color:--chatcn-fg-subtle)",
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
      <span className="shrink-0">
        <TraceStepMeta status={status} meta={meta} durationMs={durationMs} startedAt={startedAt} />
      </span>
    </>
  )

  return (
    <li
      data-slot="trace-step"
      data-trace-status={status}
      className={cn("group/trace-item relative min-w-0", className)}
      {...props}
    >
      <TraceConnector />
      {hasContent ? (
        <Collapsible.Root
          open={open}
          defaultOpen={initialOpen.current}
          onOpenChange={onOpenChange}
          render={<div />}
          className="group/trace-step"
        >
          <Collapsible.Trigger
            className={cn(
              rowBase,
              "ease-(--chatcn-ease-standard) transition-colors duration-150 outline-none",
              "hover:bg-(color:--chatcn-fill-hover) focus-visible:outline-(color:--chatcn-accent) focus-visible:outline-2 focus-visible:-outline-offset-2",
            )}
          >
            {body}
            <ChevronDownIcon
              aria-hidden="true"
              data-trace-chevron=""
              className={cn(
                "text-(color:--chatcn-fg-subtle) ease-(--chatcn-ease-out) size-4 shrink-0 transition-[rotate,opacity] duration-200",
                "group-data-[open]/trace-step:rotate-180 motion-reduce:transition-none",
                // The chevron appears on hover so a long trace is not a column of arrows.
                "opacity-0 group-focus-within/trace-step:opacity-100 group-hover/trace-step:opacity-100",
                "group-data-[open]/trace-step:opacity-100 pointer-coarse:opacity-100",
              )}
            />
          </Collapsible.Trigger>
          <Collapsible.Panel
            className={cn(
              "h-(--collapsible-panel-height) overflow-hidden",
              "ease-(--chatcn-ease-out) transition-[height,opacity] duration-200 motion-reduce:transition-none",
              "data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150",
              "data-[starting-style]:h-0 data-[starting-style]:opacity-0",
            )}
          >
            <div
              data-slot="trace-step-content"
              className="border-(color:--chatcn-border) text-[0.8125rem]/[1.25rem] text-(color:--chatcn-fg-muted) ms-[15.5px] mt-1 mb-2 border-s ps-[17.5px] pt-0.5"
            >
              {children}
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      ) : (
        <div className={rowBase}>
          {body}
          {/* Holds the chevron's slot when any row in the trace has one, so durations line up. */}
          <span
            aria-hidden="true"
            className="hidden size-4 shrink-0 group-has-[[data-trace-chevron]]/trace:block"
          />
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Trace
 * -----------------------------------------------------------------------------------------------*/

interface TraceProps extends React.ComponentProps<"ol"> {
  /** `compact` tightens rows to 28 px and uses dots for finished steps. Used inside groups. */
  density?: TraceDensity
}

/**
 * The list that holds agent steps. Each item draws its own rail segment, from just under its glyph
 * to just above the next one, so steps of any height line up on one vertical line.
 */
export function Trace({ density = "default", className, ...props }: TraceProps) {
  const value = React.useMemo(() => ({ density }), [density])
  return (
    <TraceContext.Provider value={value}>
      <ol
        data-slot="trace"
        data-density={density}
        className={cn(
          "group/trace flex min-w-0 flex-col",
          // Row height drives the rail geometry, so nested traces can use their own density.
          density === "compact"
            ? "text-[0.8125rem]/[1.25rem] [--trace-row:1.75rem]"
            : "text-[0.875rem]/[1.25rem] tracking-[-0.003em] [--trace-row:2rem]",
          className,
        )}
        {...props}
      />
    </TraceContext.Provider>
  )
}

/**
 * Groups consecutive steps of one kind behind a single line: "Read 6 files", "Searched 4 sites".
 * While running, the line doubles as a heads-up display of what the agent is doing right now.
 * Collapsed by default; expanding mounts the children in a compact nested trace.
 */
export function TraceGroup({
  status,
  title,
  activeTitle,
  current,
  summary,
  icon,
  durationMs,
  startedAt,
  maxHeight = "22rem",
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  style,
  ...props
}: TraceGroupProps) {
  const active = isTraceActive(status)
  const finished = status === "done"
  const detail = active ? current : summary
  const label = active ? (activeTitle ?? title) : title
  const triggerId = React.useId()

  return (
    <li
      data-slot="trace-group"
      data-trace-status={status}
      className={cn("group/trace-item relative min-w-0", className)}
      style={style}
      {...props}
    >
      <TraceConnector />
      <Collapsible.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        render={<div />}
        className="group/trace-group"
      >
        <Collapsible.Trigger
          id={triggerId}
          className={cn(
            "rounded-(--chatcn-radius-md) flex h-(--trace-row) w-full min-w-0 items-center gap-2.5 px-2 text-start outline-none select-none",
            "ease-(--chatcn-ease-standard) transition-colors duration-150",
            "hover:bg-(color:--chatcn-fill-hover) focus-visible:outline-(color:--chatcn-accent) focus-visible:outline-2 focus-visible:-outline-offset-2",
          )}
        >
          <TraceStatusGlyph status={status} icon={icon ?? <ListTreeIcon />} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                status === "cancelled" || status === "skipped"
                  ? "text-(color:--chatcn-fg-subtle)"
                  : "text-(color:--chatcn-fg)",
              )}
            >
              {label}
            </span>
            {detail ? (
              <span
                data-slot="trace-group-current"
                className="text-[0.75rem]/[1rem] text-(color:--chatcn-fg-subtle) truncate font-mono"
              >
                {detail}
              </span>
            ) : null}
          </span>
          <span className="shrink-0">
            {active ? (
              <StepTimer running startedAt={startedAt} />
            ) : finished ? (
              <StepTimer durationMs={durationMs} />
            ) : status === "error" ? (
              <span className="text-[0.75rem]/[1rem] text-(color:--chatcn-red)">Failed</span>
            ) : null}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            data-trace-chevron=""
            className={cn(
              "text-(color:--chatcn-fg-subtle) ease-(--chatcn-ease-out) size-4 shrink-0 transition-[rotate] duration-200",
              "group-data-[open]/trace-group:rotate-180 motion-reduce:transition-none",
            )}
          />
        </Collapsible.Trigger>
        <Collapsible.Panel
          className={cn(
            "h-(--collapsible-panel-height) overflow-hidden",
            "ease-(--chatcn-ease-out) transition-[height,opacity] duration-200 motion-reduce:transition-none",
            "data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150",
            "data-[starting-style]:h-0 data-[starting-style]:opacity-0",
          )}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: a labelled scroll region, not a form fieldset */}
          <div
            data-slot="trace-group-content"
            // Scrolls past maxHeight, so it takes focus (named by the trigger) for keyboard scrolling.
            role="group"
            aria-labelledby={triggerId}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions must be reachable by keyboard
            tabIndex={0}
            // The bottom fade hints at more rows; the padding keeps the last row out of it.
            className={cn(
              "chatcn-scroll overflow-y-auto mask-b-from-[calc(100%-1rem)] ps-[26px] pb-4",
              "rounded-(--chatcn-radius-md) focus-visible:outline-(color:--chatcn-accent) outline-none focus-visible:outline-2 focus-visible:-outline-offset-2",
            )}
            style={{ maxHeight }}
          >
            <Trace density="compact">{children}</Trace>
          </div>
        </Collapsible.Panel>
      </Collapsible.Root>
      {/* Announce the finished summary once, never the moving "doing now" line. */}
      <span aria-live="polite" className="sr-only">
        {finished ? title : ""}
      </span>
    </li>
  )
}

export default TraceGroup
