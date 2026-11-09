// 키 없는 컨테이너 확인(scripts/container-smoke.ts)이 여는 호스트 포트는 CHECK_HUB_PORT·CHECK_PHONE_PORT·CHECK_PAM_PORT로 바꾼다.
// 기본은 8500~8540 안이고, 화면 캡처 서버 자리 8520~8529와 겹치지 않는다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_PORT_DEFAULTS, checkPorts } from "../scripts/check-ports.js";

const read = (f: string) => readFileSync(f, "utf8");

describe("키 없는 컨테이너 확인 포트", () => {
  it("기본은 허브 8500·폰 8510·pam 8530: 8500~8540 안, 8520~8529 밖", () => {
    expect(checkPorts({})).toEqual({ hub: 8500, phone: 8510, pam: 8530 });
    for (const p of Object.values(CHECK_PORT_DEFAULTS)) {
      expect(p).toBeGreaterThanOrEqual(8500);
      expect(p).toBeLessThanOrEqual(8540);
      expect(p >= 8520 && p <= 8529).toBe(false);
    }
  });

  it("CHECK_HUB_PORT·CHECK_PHONE_PORT·CHECK_PAM_PORT로 바꾼다", () => {
    expect(checkPorts({ CHECK_PAM_PORT: "8535" })).toEqual({ hub: 8500, phone: 8510, pam: 8535 });
    expect(checkPorts({ CHECK_HUB_PORT: " 8501 ", CHECK_PHONE_PORT: "8511", CHECK_PAM_PORT: "8531" })).toEqual({ hub: 8501, phone: 8511, pam: 8531 });
    expect(checkPorts({ CHECK_PAM_PORT: "" })).toEqual({ hub: 8500, phone: 8510, pam: 8530 });
  });

  it("포트가 아닌 값이나 겹치는 포트는 띄우기 전에 멈춘다", () => {
    for (const bad of ["abc", "0", "70000", "85.5"]) expect(() => checkPorts({ CHECK_PAM_PORT: bad })).toThrow(`CHECK_PAM_PORT는 1~65535 정수여야 해요(${bad})`);
    expect(() => checkPorts({ CHECK_PAM_PORT: "8510" })).toThrow("허브·폰·pam 포트가 겹쳐요(8500, 8510, 8510)");
  });

  it("container-smoke.ts는 고정 포트 없이 checkPorts로 띄우고 그 포트를 기다린다", () => {
    const s = read("scripts/container-smoke.ts");
    expect(s).toContain("checkPorts(process.env)");
    expect(s).toContain("NOONCHI_PORT: String(PORTS.hub), NOONCHI_PHONE_PORT: String(PORTS.phone), PAM_HOST_PORT: String(PORTS.pam)");
    expect(s).toContain("closedPorts([PORTS.hub, PORTS.phone, PORTS.pam]");
    expect(s).not.toMatch(/127\.0\.0\.1:\d/);
    expect(s).not.toContain("8520");
  });

  it("배포 문서 7절이 포트 바꾸는 법과 기본값을 적는다", () => {
    const d = read("docs/deploy.md");
    for (const k of ["CHECK_HUB_PORT", "CHECK_PHONE_PORT", "CHECK_PAM_PORT", "`8530`"]) expect(d).toContain(k);
    expect(d).not.toContain("pam `8520`");
  });
});
