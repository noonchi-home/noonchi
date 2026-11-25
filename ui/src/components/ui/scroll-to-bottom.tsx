"use client"

// 21st.dev「Scroll To Bottom」(id 46494, aadixc0de/scroll-to-bottom) 받은 코드.
// 바꾼 것: 파일 안에 따로 있던 Conversation 문맥(ConversationContext·useConversation)을 지우고 ./conversation의 useConversation을 쓴다. chatcn 색 변수를 공통 토큰으로 잇는다(fg → ink, fg-muted → ink-2, fg-subtle → ink-3, fg-faint → ink-4, border → line, border-strong → line-strong, card → card, fill → inset, accent → focus-ring, 스크롤바 alpha → line-strong·ink-4, 그림자 → shadow-card·shadow-sm·shadow-xs, 가리개 그라데이션 #000 → ink). 회색 단계 변수와 .dark 줄을 지웠다.
// 원래 글 크기: text-[13px](13px). 받은 크기(text-[0.8125rem]) 그대로다. 더 큰 글은 npm run lint(scripts/lint-ui-type.ts)가 막는다.
// From chatcn, chat, voice and agent UI for shadcn: https://chatcn.dev

import * as React from "react"
import { forwardRef, createElement, type SVGAttributes, type ForwardRefExoticComponent, type RefAttributes } from "react"
import { cn } from "@/lib/utils"
import { useConversation } from "./conversation"

/** chatcn theme variables and utilities this file uses, light and dark. */
const CHATCN_CSS = ":root{--chatcn-accent:var(--focus-ring);--chatcn-alpha-500:var(--line-strong);--chatcn-alpha-600:var(--ink-4);--chatcn-bg:var(--surface);--chatcn-border:var(--line);--chatcn-border-strong:var(--line-strong);--chatcn-card:var(--card);--chatcn-ease-out:cubic-bezier(0.23, 1, 0.32, 1);--chatcn-ease-out-soft:cubic-bezier(0.25, 0.46, 0.45, 0.94);--chatcn-fg:var(--ink);--chatcn-fg-faint:var(--ink-4);--chatcn-fg-muted:var(--ink-2);--chatcn-fg-subtle:var(--ink-3);--chatcn-fill:var(--inset);--chatcn-press-scale:0.97;--chatcn-radius-md:8px;--chatcn-radius-xl:16px;--chatcn-scrollbar:var(--chatcn-alpha-500);--chatcn-scrollbar-hover:var(--chatcn-alpha-600);--chatcn-shadow-md:var(--shadow-card)}.chatcn-focus{}.chatcn-focus:focus-visible{outline: 2px solid var(--chatcn-accent); outline-offset: 2px;}.chatcn-scroll{scrollbar-width: thin; scrollbar-color: var(--chatcn-scrollbar) transparent;}.chatcn-scroll:hover{scrollbar-color: var(--chatcn-scrollbar-hover) transparent;}.chatcn-scroll::-webkit-scrollbar{width: 10px; height: 10px;}.chatcn-scroll::-webkit-scrollbar-track, .chatcn-scroll::-webkit-scrollbar-corner{background: transparent;}.chatcn-scroll::-webkit-scrollbar-thumb{background-color: var(--chatcn-scrollbar); background-clip: content-box; border: 3px solid transparent; border-radius: 9999px;}.chatcn-scroll::-webkit-scrollbar-thumb:hover{background-color: var(--chatcn-scrollbar-hover);}.chatcn-scroll-fade{}@supports (animation-timeline: scroll()){.chatcn-scroll-fade{mask-size: 100% calc(100% + 24px); mask-repeat: no-repeat; animation: chatcn-scroll-fade linear both; animation-timeline: scroll(self); animation-range: 0 48px;}}@keyframes chatcn-scroll-fade { from { mask-image: linear-gradient(to bottom, transparent, var(--ink) 24px); mask-position: 0 -24px; } to { mask-image: linear-gradient(to bottom, transparent, var(--ink) 24px); mask-position: 0 0; } }@media (prefers-reduced-motion: reduce){:root{--chatcn-press-scale:1;--chatcn-press-scale-icon:1;--chatcn-enter-scale:1}}"
if (typeof document !== "undefined" && !document.getElementById("chatcn-scroll-to-bottom")) {
  const style = document.createElement("style")
  style.id = "chatcn-scroll-to-bottom"
  style.textContent = CHATCN_CSS
  document.head.appendChild(style)
}

export interface ScrollToBottomProps extends Omit<React.ComponentProps<"button">, "children"> {
  /**
   * When the pill shows. `far` waits until the reader is more than one viewport up, or until a
   * new message lands below them. `away` shows as soon as they leave the bottom. Defaults to `far`.
   */
  when?: "far" | "away"
  /** Show the unread count next to the arrow. Defaults to true. */
  showUnread?: boolean
  /** Force the pill on or off, for example to keep it hidden while a dialog is open. */
  visible?: boolean
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

type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

/** Shape elements an icon may contain. */
type IconElement = "path" | "circle" | "rect" | "ellipse" | "line" | "polyline" | "polygon"

/** An icon's drawing: a flat list of [element, attributes] pairs, lucide compatible. */
type IconNode = ReadonlyArray<readonly [IconElement, Readonly<Record<string, string>>]>

const toPascal = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")

/**
 * Builds a React icon component from an icon node.
 * `name` is the kebab-case icon name, used for the class `chatcn-icon-<name>` and displayName.
 */
function createIcon(name: string, iconNode: IconNode): Icon {
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
  ["path", {"d":"m5.5 12.5 4.73 4.73a2.5 2.5 0 0 0 3.54 0l4.73-4.73"}],
  ["path", {"d":"M12 5v9"}],
]

const ArrowDownIcon: Icon = /* @__PURE__ */ createIcon("arrow-down", iconNode)

/**
 * Jump-to-latest pill. Floats at the bottom center of the nearest `Conversation`, fades in with
 * 4 px of travel over 150 ms, and re-engages stick-to-bottom when pressed. When messages land
 * below the reader, the round arrow opens sideways into "3 new" and closes again once read.
 */
export function ScrollToBottom({
  when = "far",
  showUnread = true,
  visible,
  className,
  onClick,
  ...props
}: ScrollToBottomProps) {
  const ctx = useConversation()
  if (!ctx) throw new Error("ScrollToBottom must be used inside Conversation.")
  const { isAtBottom, isFar, unread, scrollToBottom } = ctx
  const show = visible ?? (when === "away" ? !isAtBottom : isFar || (!isAtBottom && unread > 0))
  const count = showUnread && unread > 0 ? unread : 0
  // Keep the last count while the label closes, so it never collapses around an empty string.
  const [shown, setShown] = React.useState(count)
  if (count > 0 && count !== shown) setShown(count)
  const label = count
    ? `${count} new ${count === 1 ? "message" : "messages"}, scroll to latest`
    : "Scroll to latest"

  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={show ? undefined : true}
      tabIndex={show ? undefined : -1}
      data-slot="scroll-to-bottom"
      data-visible={show ? "" : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) scrollToBottom({ behavior: "smooth" })
      }}
      className={cn(
        "chatcn-focus absolute inset-x-0 bottom-4 z-10 mx-auto flex h-8 w-fit items-center rounded-full px-2",
        "bg-(color:--chatcn-card) text-(color:--chatcn-fg-muted) shadow-(--chatcn-shadow-md) text-[0.8125rem]/[1.25rem] font-medium tabular-nums select-none",
        "hover:text-(color:--chatcn-fg) active:scale-(--chatcn-press-scale) [&_svg]:size-4 [&_svg]:shrink-0",
        // Exit is 0.75x the enter. Under reduced motion the travel goes and only the fade remains.
        "ease-(--chatcn-ease-out) transition-[opacity,translate,color,scale] duration-150",
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']",
        show
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-1 opacity-0 duration-110",
        "motion-reduce:translate-y-0 motion-reduce:transition-opacity",
        className,
      )}
      {...props}
    >
      <ArrowDownIcon aria-hidden="true" />
      {/* 0fr to 1fr: the pill widens from its center as the label opens, and nothing reflows. */}
      <span
        aria-hidden="true"
        data-slot="scroll-to-bottom-count"
        data-open={count ? "" : undefined}
        className={cn(
          "grid grid-cols-[0fr] opacity-0 data-[open]:grid-cols-[1fr] data-[open]:opacity-100",
          "ease-(--chatcn-ease-out) transition-[grid-template-columns,opacity] duration-200",
          "motion-reduce:transition-opacity",
        )}
      >
        <span className="overflow-hidden whitespace-nowrap">
          <span className="ps-1.5 pe-1">{shown > 99 ? "99+" : shown} new</span>
        </span>
      </span>
    </button>
  )
}

export default ScrollToBottom
