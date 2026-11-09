// 화면 글 규칙: 사용자가 할 일과 지금 상태만. 걸리면 생각 과정·구현 설명이 들어간 것이다.
// npm run lint(scripts/lint-ui-copy.ts)가 화면 코드에, 에이전트 계획 검사(src/agent/planTools.ts)가 모델이 쓴 단계 글에 같은 규칙을 쓴다.

export const MAX_COPY = 60;

// 화면 글은 사용자가 할 일과 지금 상태만. 아래는 생각 과정·구현 설명이 들어갔다는 표시다. 오류 글에 고치는 법을 적는다.
export const COPY_RULES: { name: string; hit: (text: string) => boolean; fix: string }[] = [
  { name: "흐름 나열", hit: (t) => /→|⇒|->|=>/.test(t), fix: "화살표로 단계·흐름을 늘어놓지 마세요. 단계는 단계 표시(#steps) 하나로 보여요." },
  // 「(으)로」 같은 조사 겹쳐 쓰기는 설명이 아니다
  { name: "괄호 설명", hit: (t) => [...t.matchAll(/\(([^)]*)\)/g)].some((m) => /[가-힣a-z]/i.test(m[1]!) && !/^(으|이|은|는|을|를|과|와|가|아|야)$/.test(m[1]!)), fix: "괄호로 덧붙인 설명을 빼세요. 꼭 필요한 말이면 본문에 바로 쓰세요." },
  { name: "긴 설명", hit: (t) => t.replace(/<[^>]+>/g, "").length > MAX_COPY, fix: `한 덩어리는 ${MAX_COPY}자까지예요. 할 일·지금 상태만 남기고 이유·동작 원리는 docs/로 옮기세요.` },
  { name: "구현 이름", hit: (t) => /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[\w-]+\.(json|ts|mjs|onnx)\b|twin-studio|SSOT|엔진/.test(t), fix: "환경변수·파일·저장소 이름, 엔진 같은 내부 말을 화면에 쓰지 마세요. 서버 로그나 README에 두세요." },
];

/** 화면 글 한 덩어리 검사. 걸린 규칙 이름(없으면 빈 배열). */
export function copyRules(text: string): string[] {
  return COPY_RULES.filter((r) => r.hit(text)).map((r) => r.name);
}
