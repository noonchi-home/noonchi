// 서버 묶음(src/server/start.ts, 처음 불러오면 수 초)을 불러오기 전에 해 보는 시작 검사: 들을 주소와 가전 종류 등록부.
// 서버 입구(src/server/boot.ts)가 먼저 부르고, startServer도 맨 앞에서 부른다(서버 묶음을 바로 가져다 쓰는 시험·스크립트).
import { checkKinds } from "../devices/index.js";
import { KINDS } from "../devices/kinds.js";
import { lanBindingError } from "./loopback.js";

/** 틀린 설정이면 까닭과 함께 던진다. */
export function preflight(env: Record<string, string | undefined>): void {
  const lanBinding = lanBindingError(env);
  if (lanBinding) throw new Error(lanBinding);
  // 가전 종류 등록부가 틀린 조합이면(승인·ThinQ 어댑터·손 조작) 까닭과 함께 시작을 막는다
  const kindProblems = checkKinds(KINDS);
  if (kindProblems.length) throw new Error(`가전 종류 등록부가 틀렸어요(src/devices/kinds.ts): ${kindProblems.join(" / ")}`);
}
