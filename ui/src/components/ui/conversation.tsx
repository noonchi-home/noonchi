"use client"

// 21st.dev「Conversation」(id 46450, aadixc0de/conversation) 받은 코드.
// 바꾼 것: chatcn 색 변수를 공통 토큰으로 잇는다(fg → ink, fg-muted → ink-2, fg-subtle → ink-3, fg-faint → ink-4, border → line, border-strong → line-strong, card → card, fill → inset, accent → focus-ring, 스크롤바 alpha → line-strong·ink-4, 그림자 → shadow-card·shadow-sm·shadow-xs, 가리개 그라데이션 #000 → ink). 회색 단계 변수와 .dark 줄을 지웠다.
// 원래 글 크기: 없음. 받은 코드에 글 크기가 없다. 글 크기를 넣으면 npm run lint(scripts/lint-ui-type.ts)가 막는다.
// From chatcn, chat, voice and agent UI for shadcn: https://chatcn.dev

import * as React from "react"
import { cn } from "@/lib/utils"

/** chatcn theme variables and utilities this file uses, light and dark. */
const CHATCN_CSS = ":root{--chatcn-accent:var(--focus-ring);--chatcn-alpha-500:var(--line-strong);--chatcn-alpha-600:var(--ink-4);--chatcn-border:var(--line);--chatcn-border-strong:var(--line-strong);--chatcn-card:var(--card);--chatcn-ease-out:cubic-bezier(0.23, 1, 0.32, 1);--chatcn-ease-out-soft:cubic-bezier(0.25, 0.46, 0.45, 0.94);--chatcn-fg:var(--ink);--chatcn-fg-faint:var(--ink-4);--chatcn-fg-muted:var(--ink-2);--chatcn-fg-subtle:var(--ink-3);--chatcn-fill:var(--inset);--chatcn-press-scale:0.97;--chatcn-radius-md:8px;--chatcn-radius-xl:16px;--chatcn-scrollbar:var(--chatcn-alpha-500);--chatcn-scrollbar-hover:var(--chatcn-alpha-600);--chatcn-shadow-md:var(--shadow-card)}.chatcn-focus{}.chatcn-focus:focus-visible{outline: 2px solid var(--chatcn-accent); outline-offset: 2px;}.chatcn-scroll{scrollbar-width: thin; scrollbar-color: var(--chatcn-scrollbar) transparent;}.chatcn-scroll:hover{scrollbar-color: var(--chatcn-scrollbar-hover) transparent;}.chatcn-scroll::-webkit-scrollbar{width: 10px; height: 10px;}.chatcn-scroll::-webkit-scrollbar-track, .chatcn-scroll::-webkit-scrollbar-corner{background: transparent;}.chatcn-scroll::-webkit-scrollbar-thumb{background-color: var(--chatcn-scrollbar); background-clip: content-box; border: 3px solid transparent; border-radius: 9999px;}.chatcn-scroll::-webkit-scrollbar-thumb:hover{background-color: var(--chatcn-scrollbar-hover);}.chatcn-scroll-fade{}@supports (animation-timeline: scroll()){.chatcn-scroll-fade{mask-size: 100% calc(100% + 24px); mask-repeat: no-repeat; animation: chatcn-scroll-fade linear both; animation-timeline: scroll(self); animation-range: 0 48px;}}@keyframes chatcn-scroll-fade { from { mask-image: linear-gradient(to bottom, transparent, var(--ink) 24px); mask-position: 0 -24px; } to { mask-image: linear-gradient(to bottom, transparent, var(--ink) 24px); mask-position: 0 0; } }@media (prefers-reduced-motion: reduce){:root{--chatcn-press-scale:1;--chatcn-press-scale-icon:1;--chatcn-enter-scale:1}}"
if (typeof document !== "undefined" && !document.getElementById("chatcn-conversation")) {
  const style = document.createElement("style")
  style.id = "chatcn-conversation"
  style.textContent = CHATCN_CSS
  document.head.appendChild(style)
}

/** Scroll behavior for imperative calls. `smooth` falls back to instant under reduced motion. */
type ChatcnScrollBehavior = "smooth" | "instant"

/* -------------------------------------------------------------------------------------------------
 * Context
 * -----------------------------------------------------------------------------------------------*/

export interface ConversationContextValue {
  scrollRef: (element: HTMLElement | null) => void
  contentRef: (element: HTMLElement | null) => void
  spacerRef: (element: HTMLElement | null) => void
  /** Within the threshold of the bottom. */
  isAtBottom: boolean
  /** Following new content. */
  isSticky: boolean
  /** More than one viewport from the bottom. */
  isFar: boolean
  /** Messages that arrived below while the reader was scrolled up. */
  unread: number
  scrollToBottom: (options?: { behavior?: ChatcnScrollBehavior }) => void
  scrollToTurn: (element: HTMLElement, options?: { behavior?: ChatcnScrollBehavior }) => void
  /** Read text to screen readers through the conversation's polite live region. */
  announce: (text: string) => void
  /** False during the first render, so restored history does not animate in. */
  ready: boolean
}

const ConversationContext = React.createContext<ConversationContextValue | null>(null)

/** Scroll state and controls of the nearest `Conversation`. Returns null outside one. */
export function useConversation() {
  return React.useContext(ConversationContext)
}

/* -------------------------------------------------------------------------------------------------
 * ConversationContent
 * -----------------------------------------------------------------------------------------------*/

export interface ConversationContentProps extends React.ComponentProps<"div"> {
  /** Class names for the scrolling viewport. `className` styles the message column. */
  viewportClassName?: string
  /** Accessible name of the transcript. */
  label?: string
}

/**
 * The scrolling transcript. The viewport is a focusable `log` so keyboard users can scroll it;
 * the column inside is capped at 720 px with a 24 px gap between messages.
 */
export function ConversationContent({
  viewportClassName,
  label = "Conversation",
  className,
  children,
  ...props
}: ConversationContentProps) {
  const ctx = useConversation()
  if (!ctx) throw new Error("ConversationContent must be used inside Conversation.")
  return (
    <div
      ref={ctx.scrollRef}
      role="log"
      aria-label={label}
      // The log is silent: tokens are never read one by one. Finished replies are announced
      // through the conversation's live region instead.
      aria-live="off"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions must be focusable
      tabIndex={0}
      data-slot="conversation-viewport"
      className={cn(
        "chatcn-scroll chatcn-scroll-fade min-h-0 flex-1 overflow-y-auto outline-none [overflow-anchor:auto]",
        "focus-visible:outline-(color:--chatcn-accent) focus-visible:outline-2 focus-visible:-outline-offset-2",
        viewportClassName,
      )}
    >
      <div
        ref={ctx.contentRef}
        data-slot="conversation-content"
        className={cn(
          "mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-8 pb-6 sm:px-6",
          className,
        )}
        {...props}
      >
        {children}
      </div>
      <div
        ref={ctx.spacerRef}
        aria-hidden="true"
        data-slot="conversation-spacer"
        className="pointer-events-none shrink-0 [overflow-anchor:none]"
      />
    </div>
  )
}

/**
 * Stick-to-bottom scrolling for chat transcripts.
 *
 * - Follows growing content only while the reader is within `threshold` px of the bottom.
 * - Any upward wheel, touch, key or scrollbar drag releases it in the same event. It never fights.
 * - Scrolling back down into the threshold, or calling `scrollToBottom`, re-engages it.
 * - A new user turn scrolls near the top of the viewport, with a spacer below it so the reply
 *   streams into empty space instead of pushing the turn away (`anchor`).
 * - Content inserted above the viewport keeps the reading position (native `overflow-anchor`,
 *   with a manual fallback for engines without it).
 * - A ResizeObserver follows content that grows after render: images, code blocks, tool output.
 * - Follows with a critically damped chase, not a fixed-duration tween, because streamed content
 *   grows at unpredictable rates. Instant under reduced motion.
 */

/** Options for `useChatcnStickToBottom`. */
interface UseChatcnStickToBottomOptions {
  /** Distance from the bottom, in px, that still counts as at the bottom. Defaults to 64. */
  threshold?: number
  /**
   * Scroll each new user turn near the top of the viewport. `true` matches
   * `[data-slot="message"][data-role="user"]`; pass a selector to match something else, or
   * `false` to always stick to the bottom instead. Defaults to true.
   */
  anchor?: boolean | string
  /** Space kept above an anchored turn, in px. Defaults to 24. */
  anchorOffset?: number
  /** Start at the bottom on mount. Defaults to true. */
  initial?: boolean
}

/* -------------------------------------------------------------------------------------------------
 * Conversation
 * -----------------------------------------------------------------------------------------------*/

export interface ConversationProps extends React.ComponentProps<"div">, UseChatcnStickToBottomOptions {}

/** Return value of `useChatcnStickToBottom`. */
interface ChatcnStickToBottom {
  /** Attach to the scrolling element. */
  scrollRef: (element: HTMLElement | null) => void
  /** Attach to the element that wraps the messages (its size is observed). */
  contentRef: (element: HTMLElement | null) => void
  /** Attach to an empty element placed after the content, inside the scroller. */
  spacerRef: (element: HTMLElement | null) => void
  /** Within `threshold` px of the bottom. */
  isAtBottom: boolean
  /** Following new content. False from the first upward scroll until the reader returns. */
  isSticky: boolean
  /** More than one viewport away from the bottom. */
  isFar: boolean
  /** Messages that arrived below while the reader was scrolled up. Resets at the bottom. */
  unread: number
  /** Scroll to the bottom and stick again. */
  scrollToBottom: (options?: { behavior?: ChatcnScrollBehavior }) => void
  /** Scroll an element near the top of the viewport, keeping room below it for a reply. */
  scrollToTurn: (element: HTMLElement, options?: { behavior?: ChatcnScrollBehavior }) => void
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** True when a nested element between `target` and `root` can still scroll in `dy`'s direction. */
function nestedCanScroll(target: EventTarget | null, root: HTMLElement, dy: number) {
  let node = target instanceof Element ? target : null
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight) {
      const overflow = getComputedStyle(node).overflowY
      if (overflow === "auto" || overflow === "scroll") {
        if (dy < 0 && node.scrollTop > 0) return true
        if (dy > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true
      }
    }
    node = node.parentElement
  }
  return false
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  )
}

const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"])

const USER_TURN = '[data-slot="message"][data-role="user"]'

const MESSAGE = '[data-slot="message"]'

/** Stick-to-bottom scroll state and refs for a chat transcript. */
function useChatcnStickToBottom({
  threshold = 64,
  anchor = true,
  anchorOffset = 24,
  initial = true,
}: UseChatcnStickToBottomOptions = {}): ChatcnStickToBottom {
  const [scroller, setScroller] = React.useState<HTMLElement | null>(null)
  const [content, setContent] = React.useState<HTMLElement | null>(null)
  const spacer = React.useRef<HTMLElement | null>(null)

  const [isAtBottom, setAtBottom] = React.useState(true)
  const [isSticky, setSticky] = React.useState(true)
  const [isFar, setFar] = React.useState(false)
  const [unread, setUnread] = React.useState(0)

  // Mutable engine state. Lives in a ref so scroll handlers never re-render to read it.
  const s = React.useRef({
    sticky: true,
    /** Last scrollTop we wrote. Scroll events that land on it are ours, not the reader's. */
    written: -1,
    lastTop: 0,
    lastHeight: 0,
    raf: 0,
    target: null as null | (() => number),
    anchorEl: null as HTMLElement | null,
    mounted: false,
    unread: 0,
    touchY: 0,
    /** Manual scroll anchoring for engines without `overflow-anchor`. */
    keep: null as null | { node: Element; top: number },
  }).current

  const options = React.useRef({ threshold, anchor, anchorOffset })
  options.current = { threshold, anchor, anchorOffset }

  // Imperative helpers are created once per scroller and kept in a ref so the public functions
  // stay referentially stable.
  const api = React.useRef<{
    toBottom: (behavior?: ChatcnScrollBehavior) => void
    toTurn: (el: HTMLElement, behavior?: ChatcnScrollBehavior) => void
  } | null>(null)

  React.useEffect(() => {
    const el = scroller
    if (!el) return
    const nativeAnchoring =
      typeof CSS !== "undefined" && CSS.supports?.("overflow-anchor", "auto") === true

    const maxTop = () => Math.max(0, el.scrollHeight - el.clientHeight)
    const distance = () => maxTop() - el.scrollTop

    const write = (top: number) => {
      el.scrollTop = top
      s.written = el.scrollTop
      s.lastTop = el.scrollTop
    }

    const sync = () => {
      const d = distance()
      const atBottom = d <= options.current.threshold
      if (atBottom && s.unread) {
        s.unread = 0
        setUnread(0)
      }
      setAtBottom(atBottom)
      setFar(d > el.clientHeight)
      setSticky(s.sticky)
    }

    const stop = () => {
      if (s.raf) cancelAnimationFrame(s.raf)
      s.raf = 0
      s.target = null
    }

    const release = () => {
      stop()
      if (!s.sticky) return
      s.sticky = false
      setSticky(false)
    }

    /** Chase a moving target with exponential smoothing: fast, settles without overshoot. */
    const chase = (target: () => number, behavior: ChatcnScrollBehavior) => {
      s.target = target
      if (behavior === "instant" || prefersReducedMotion()) {
        stop()
        write(Math.min(target(), maxTop()))
        sync()
        return
      }
      if (s.raf) return
      let last = performance.now()
      const step = (now: number) => {
        const goal = s.target
        if (!goal) return
        const dt = Math.min(64, now - last)
        last = now
        const to = Math.min(goal(), maxTop())
        const from = el.scrollTop
        const gap = to - from
        if (Math.abs(gap) < 1) {
          write(to)
          s.raf = 0
          s.target = null
          sync()
          return
        }
        // Time constant of 70 ms: about 200 ms to cover most of any distance. scrollTop snaps to
        // whole pixels, so every frame moves at least one pixel or the chase would stall.
        const move = gap * (1 - Math.exp(-dt / 70))
        write(from + (Math.abs(move) < 1 ? Math.sign(gap) : move))
        s.raf = requestAnimationFrame(step)
      }
      s.raf = requestAnimationFrame(step)
    }

    const turnTop = (turn: HTMLElement) =>
      turn.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop -
      options.current.anchorOffset

    /** Size the spacer so the anchored turn can reach the top while its reply is short. */
    const fitSpacer = () => {
      const pad = spacer.current
      if (!pad) return
      const turn = s.anchorEl
      if (!turn?.isConnected || !content) {
        s.anchorEl = null
        if (pad.style.height !== "0px") pad.style.height = "0px"
        return
      }
      const box = el.getBoundingClientRect()
      const contentBottom = content.getBoundingClientRect().bottom - box.top + el.scrollTop
      const need = Math.max(0, Math.ceil(turnTop(turn) + el.clientHeight - contentBottom))
      pad.style.height = `${need}px`
      // Once the reply fills the viewport the spacer is no longer needed.
      if (need === 0) s.anchorEl = null
    }

    const remember = () => {
      if (nativeAnchoring || !content) return
      const top = el.getBoundingClientRect().top
      for (const child of Array.from(content.children)) {
        const r = child.getBoundingClientRect()
        if (r.bottom > top) {
          s.keep = { node: child, top: r.top - top }
          return
        }
      }
      s.keep = null
    }

    const toBottom = (behavior: ChatcnScrollBehavior = "smooth") => {
      s.sticky = true
      setSticky(true)
      chase(maxTop, behavior)
    }

    const toTurn = (turn: HTMLElement, behavior: ChatcnScrollBehavior = "smooth") => {
      s.anchorEl = turn
      fitSpacer()
      s.sticky = true
      setSticky(true)
      chase(() => turnTop(turn), behavior)
    }

    api.current = { toBottom, toTurn }

    const onScroll = () => {
      const top = el.scrollTop
      const height = el.scrollHeight
      const ours = Math.abs(top - s.written) < 1.5
      if (!ours) {
        const movedUp = top < s.lastTop - 0.5
        // Content that shrinks clamps scrollTop upward; that is not the reader scrolling.
        const clamped = distance() < 1 && height < s.lastHeight
        if (movedUp && !clamped) release()
        else if (!movedUp && distance() <= options.current.threshold && !s.sticky) {
          s.sticky = true
        }
        s.written = -1
      }
      s.lastTop = top
      s.lastHeight = height
      remember()
      sync()
    }

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && el.scrollTop > 0 && !nestedCanScroll(event.target, el, -1)) release()
    }
    const onTouchStart = (event: TouchEvent) => {
      s.touchY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0
      // Finger moving down scrolls the content up.
      if (y - s.touchY > 4 && !nestedCanScroll(event.target, el, -1)) release()
      s.touchY = y
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return
      if (UP_KEYS.has(event.key) || (event.key === " " && event.shiftKey)) release()
    }

    const onResize = () => {
      fitSpacer()
      if (!nativeAnchoring && !s.sticky && s.keep?.node.isConnected) {
        const now = s.keep.node.getBoundingClientRect().top - el.getBoundingClientRect().top
        const delta = now - s.keep.top
        if (Math.abs(delta) > 0.5) write(el.scrollTop + delta)
      }
      // Streamed growth is a few lines at a time and glides. A jump of more than a viewport is
      // a history load or a layout change, so it lands instantly instead of scrolling past.
      if (s.sticky && !s.target) {
        chase(maxTop, s.mounted && distance() <= el.clientHeight ? "smooth" : "instant")
      }
      // Record growth only. On a shrink the browser clamps scrollTop and fires a scroll event;
      // onScroll needs the old, larger height to recognise that clamp and keep following.
      if (el.scrollHeight > s.lastHeight) s.lastHeight = el.scrollHeight
      remember()
      sync()
    }

    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    if (content) ro.observe(content)

    const mo = new MutationObserver((records) => {
      if (!content) return
      const selector =
        options.current.anchor === false
          ? null
          : typeof options.current.anchor === "string"
            ? options.current.anchor
            : USER_TURN
      let turn: HTMLElement | null = null
      let added = 0
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue
          const isMessage = node.matches(MESSAGE) || node.querySelector(MESSAGE)
          if (isMessage) added++
          if (!selector) continue
          const match = node.matches(selector)
            ? node
            : (node.querySelector<HTMLElement>(selector) ?? null)
          if (match) turn = match
        }
      }
      if (!s.mounted) return
      // Only a freshly sent turn anchors. A batch of many messages is history being restored,
      // and an older turn is history being prepended: neither moves the reader.
      if (turn && selector && added <= 2) {
        const all = content.querySelectorAll<HTMLElement>(selector)
        if (all[all.length - 1] === turn) {
          toTurn(turn)
          return
        }
      }
      if (added && !s.sticky) {
        s.unread += added
        setUnread(s.unread)
      }
    })
    if (content) mo.observe(content, { childList: true, subtree: true })

    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: true })
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: true })
    el.addEventListener("keydown", onKeyDown)

    if (!s.mounted) {
      if (initial) write(maxTop())
      // Starting elsewhere means following only once the reader reaches the bottom.
      else s.sticky = distance() <= options.current.threshold
    }
    s.lastHeight = el.scrollHeight
    remember()
    sync()
    // Messages present at mount never anchor and never count as unread.
    const ready = requestAnimationFrame(() => {
      s.mounted = true
    })

    return () => {
      cancelAnimationFrame(ready)
      stop()
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("keydown", onKeyDown)
    }
  }, [scroller, content, initial, s])

  const scrollToBottom = React.useCallback(
    (opts?: { behavior?: ChatcnScrollBehavior }) => api.current?.toBottom(opts?.behavior),
    [],
  )
  const scrollToTurn = React.useCallback(
    (element: HTMLElement, opts?: { behavior?: ChatcnScrollBehavior }) =>
      api.current?.toTurn(element, opts?.behavior),
    [],
  )
  const spacerRef = React.useCallback((element: HTMLElement | null) => {
    spacer.current = element
  }, [])

  return {
    scrollRef: setScroller,
    contentRef: setContent,
    spacerRef,
    isAtBottom,
    isSticky,
    isFar,
    unread,
    scrollToBottom,
    scrollToTurn,
  }
}

/**
 * The thread. Owns stick-to-bottom scrolling, the reply anchor and the live region.
 * Give it a height (or put it in a flex column) and place `ConversationContent` and
 * `ScrollToBottom` inside.
 */
export function Conversation({
  threshold,
  anchor,
  anchorOffset,
  initial,
  className,
  children,
  ...props
}: ConversationProps) {
  const stick = useChatcnStickToBottom({ threshold, anchor, anchorOffset, initial })
  const [message, setMessage] = React.useState("")
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => setReady(true), [])

  const announce = React.useCallback((text: string) => {
    // Clearing first makes repeated identical text announce again.
    setMessage("")
    requestAnimationFrame(() => setMessage(text))
  }, [])

  const value = React.useMemo<ConversationContextValue>(
    () => ({ ...stick, announce, ready }),
    [stick, announce, ready],
  )

  return (
    <ConversationContext.Provider value={value}>
      <div
        data-slot="conversation"
        data-at-bottom={stick.isAtBottom ? "" : undefined}
        className={cn("relative flex min-h-0 flex-col overflow-hidden", className)}
        {...props}
      >
        {children}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {message}
        </div>
      </div>
    </ConversationContext.Provider>
  )
}

export default Conversation
