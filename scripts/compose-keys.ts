// compose 서비스마다 받는 키. 키(이름이 KEY·TOKEN·SECRET로 끝남)는 그 키를 쓰는 서비스만 받는다.
// tests/deploy-files.test.ts가 compose.yaml과, scripts/container-smoke.ts가 docker compose config 결과와 견준다.

/** 키 → 그 키를 받는 서비스. */
export const KEY_OWNERS: Record<string, readonly string[]> = {
  OPENAI_API_KEY: ["noonchi", "pam"],
  ANTHROPIC_API_KEY: ["noonchi"],
  VLM_API_KEY: ["noonchi"],
  THINQ_TOKEN: ["noonchi"],
  THINQ_API_KEY: ["noonchi"],
  PLAN_TOKEN: ["noonchi"],
  OPENROUTER_API_KEY: ["pam"],
  PAM_LLM_API_KEY: ["pam"],
  // vLLM 서버 키: 서버(vllm-*)가 요구하고, noonchi(live VLM)·pam(live PAM LLM)이 붙인다
  VLLM_API_KEY: ["noonchi", "pam", "vllm-pam", "vllm-vlm"],
  HF_TOKEN: ["vllm-pam", "vllm-vlm"],
};

export const isKeyName = (name: string) => /(KEY|TOKEN|SECRET)$/.test(name);
