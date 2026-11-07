import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { radius, shadow, type } from "../../../src/design/tokens.json";

/** 디자인 토큰 글 크기(text-label·text-far 등)·그림자·모서리 이름을 tailwind-merge에 알린다. 모르면 text-label을 글자색으로 보고 text-primary-foreground 같은 색 class를 지운다. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: Object.keys(type),
      shadow: Object.keys(shadow).map((n) => n.replace(/^shadow-/, "")),
      radius: Object.keys(radius).map((n) => n.replace(/^radius-/, "")),
    },
  },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
