import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isCode, literalSpec, parseCode, walk } from "../scripts/domain-ast.js";
import { TOPICS } from "../src/bus/index.js";

function sendSites(file: string, source: string): string[] {
  const bad: string[] = [];
  if (!/toPhone|answers|\/act\/phone_(command|changes)/.test(source)) return bad;
  walk(parseCode(file, source), (n) => {
    if (n.type !== "CallExpression") return;
    const c = n.callee;
    const key = c.property?.name ?? literalSpec(c.property);
    const parent = c.object?.property?.name ?? literalSpec(c.object?.property);
    const topic = literalSpec(n.arguments[0]);
    const props = n.arguments[1]?.properties;
    const notice = props?.length === 1 && ["status", "plan"].includes(props[0].key?.name) && !props[0].computed;
    if (key === "toPhone" || c.name === "toPhone" || (parent === "answers" && key === "send") ||
      (["push", "publish", "envelope"].includes(key) && (topic === "/act/phone_command" || (topic === "/act/phone_changes" && !notice)))) {
      bad.push(file + ":" + source.slice(0, n.start).split("\n").length);
    }
  });
  return bad;
}

describe("실제 폰에 내는 명령은 로봇의 명령 줄 하나를 거친다", () => {
  it("다른 실행 단위가 직접 전송하거나 같은 토픽에 따로 내는 경우를 잡는다", () => {
    expect(sendSites("test.ts", 'core.answers.send(c); o["toPhone"](c); out.push("/act/phone_command", b);')).toHaveLength(3);
    expect(sendSites("test.ts", 'out.push("/act/phone_changes", { cmd });')).toHaveLength(1);
    expect(sendSites("test.ts", 'phone.reply("알겠어요");')).toEqual([]);
  });
  it("실행 경로 전체에서 로봇 명령 줄만 전송한다", () => {
    const root = resolve(import.meta.dirname, "../src");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(isCode);
    const hits = files.filter((f) => f.replaceAll("\\", "/") !== "act/robot/phone.ts")
      .flatMap((f) => sendSites(f, readFileSync(resolve(root, f), "utf8")));
    expect(hits).toEqual([]);
    expect(TOPICS["/act/phone_command"].from).toEqual(["act"]);
  });
});
