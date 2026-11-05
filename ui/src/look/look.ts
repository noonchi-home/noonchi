import { createContext, useContext } from "react";

/** 대시보드 모양: parts는 밝은 카드(21st.dev 부품 그대로), glass는 Liquid Glass 유리. 구조는 같다. */
export type Look = "parts" | "glass";

/** 주소의 ?look=. glass만 유리 모양, 없거나 모르는 값은 부품 모양. */
export function lookOf(search: string): Look {
  return new URLSearchParams(search).get("look") === "glass" ? "glass" : "parts";
}

export const LookContext = createContext<Look>("parts");
export const useLook = () => useContext(LookContext);
