// 옮긴 논문 프롬프트(src/brain/pam/prompts)가 source_map 해시와 같고, 논문 설정이 그대로이고, 노닌치 바꾸기가 맞는지 본다.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAM_DIR, PROMPT_IDS, loadPaperConfig, loadPrompt } from "../src/brain/pam/paper.js";
import { adaptPrompt, loadScenario } from "../src/brain/pam/scenario.js";

const map = JSON.parse(readFileSync(join(PAM_DIR, "prompts", "source_map.json"), "utf8")) as { prompts: Record<string, { file: string; sha256: string }> };
const SCENARIO = loadScenario(join(PAM_DIR, "scenarios", "noonchi", "scenario.json"));
const adapted = (id: string) => adaptPrompt(loadPrompt(id).text, SCENARIO);
const REFERENCE = "Treat the memory as a REFERENCE, not as a strict matcher.";
const STRICT = "Fire a memory rule only when EVERY condition in its trigger holds in the latest observations";

describe("논문 프롬프트", () => {
  it("프롬프트 파일 일곱 개의 sha256이 source_map.json과 같다(프롬프트를 바꾸면 source_map 해시도 같이 고친다)", () => {
    expect(Object.keys(map.prompts).sort()).toEqual([...PROMPT_IDS].sort());
    for (const [id, s] of Object.entries(map.prompts)) {
      expect(createHash("sha256").update(readFileSync(join(PAM_DIR, s.file))).digest("hex"), id).toBe(s.sha256);
    }
  });

  it("해시 검사로 읽는다. 한 바이트라도 다르면 읽기가 실패한다", () => {
    for (const id of PROMPT_IDS) expect(loadPrompt(id).source.id).toBe(id);
    const dir = mkdtempSync(join(tmpdir(), "pam-"));
    cpSync(join(PAM_DIR, "prompts"), join(dir, "prompts"), { recursive: true });
    const f = join(dir, map.prompts.predictor_fsm!.file);
    writeFileSync(f, readFileSync(f, "utf8") + " ");
    expect(() => loadPrompt("predictor_fsm", dir)).toThrow("Paper prompt hash mismatch: predictor_fsm");
    expect(() => loadPrompt("predictor_x")).toThrow("Unknown paper prompt: predictor_x");
  });

  it("프롬프트 파일은 LF만 쓰고, .gitattributes가 줄끝을 고정한다", () => {
    const files = readdirSync(join(PAM_DIR, "prompts", "paper"));
    expect(files).toHaveLength(7);
    for (const n of files) expect(readFileSync(join(PAM_DIR, "prompts", "paper", n)).includes(13), n).toBe(false);
    const lines = readFileSync(".gitattributes", "utf8").split(/\r?\n/);
    expect(lines).toContain("src/brain/pam/prompts/** -text");
    expect(lines).toContain("src/brain/pam/prompts/paper/*.txt text eol=lf");
  });

  it("논문 설정이 그대로다", () => {
    const c = loadPaperConfig();
    expect(c.model).toBe("Qwen3.5-27B");
    expect(c.predictor).toMatchObject({ temperature: 0.3, enable_thinking: false });
    expect(c.reflector).toMatchObject({ temperature: 0.3, enable_thinking: true });
  });

  it("논문 원문 판단 프롬프트에는 REFERENCE 문장이 있다. 노닌치 바꾸기만 그 문장을 STRICT로 바꾼다", () => {
    for (const id of ["predictor_fsm", "predictor_list"]) {
      expect(loadPrompt(id).text, id).toContain(REFERENCE);
      expect(loadPrompt(id).text, id).not.toContain(STRICT);
      const t = adapted(id).text;
      expect(t, id).not.toContain(REFERENCE);
      expect(t, id).not.toContain("you may fire it even when the trigger phrasing");
      expect(t, id).toContain(STRICT);
      expect(t, id).toContain("a rule whose trigger says the user left does not fire while the person is visible");
      expect(t, id).toContain("(짐작)");
    }
  });

  it("노닌치 판단 지시문: 보관 자리(싱크대·냉장고)와 가전 목표 줄", () => {
    const t = adapted("predictor_fsm").text;
    expect(t).toContain("- The designated storage area: the kitchen sink, where used cups, bottles and bowls are put. Drinks such as water and cola are kept in the fridge.");
    expect(t).not.toContain("corner of the desk");
    expect(t).toContain("- operating home appliances the person habitually operates by hand, such as turning on the living-room air conditioner when they sit down to watch TV.");
    expect(t).toContain("- etc. –- any helpful action that is grounded in observed behavior.");
  });

  it("노닌치 반성 지시문: 우리 행동 이름을 쓰고 손으로 다룬 가전도 다시 적는다", () => {
    const t = adapted("reflector_fsm_update").text;
    expect(t).not.toContain("Pick up <object>");
    expect(t).not.toContain("RE-STATE the pick-and-place actions");
    expect(t).toContain("appliance operations");
    expect(t).toContain("- action: exactly one of these task names, copied character for character: ");
    expect(t).toContain("Never add, move, rewrite or remove rules for them.");
  });

  it("새 바꾸기 다섯은 반성 지시문에서 한 번씩 맞고, 옛 바꾸기는 지금처럼 맞는다", () => {
    const { adaptation } = adapted("reflector_fsm_update");
    const applied = new Map(adaptation.applied.map((c) => [c.old, c.occurrences]));
    for (const c of SCENARIO.prompt_replacements.slice(0, 5)) expect(applied.get(c.old), c.reason).toBe(1);
    const before = adaptPrompt(loadPrompt("reflector_fsm_update").text, { ...SCENARIO, prompt_replacements: SCENARIO.prompt_replacements.slice(5) });
    for (const c of before.adaptation.applied) expect(applied.has(c.old), c.reason).toBe(true);
  });
});
