// 트윈 윗면(식탁·조리대·싱크대)과 상자 바닥 점 광선: 물건 자리는 광선이 그 면의 실제 사각형(배치 자리·방향·바닥 크기) 안에서 윗면 높이와 만나는 점이다.
// 가로 키 큰 컵·유리컵 v1(2026-11-18 08:30~08:33): 배치에 바닥 크기가 없어 식탁이 반지름 0.4m 원으로만 잡혔고, 식탁 가운데에서 0.4m 넘는 컵 상자 광선이
// 식탁을 지나쳐 바닥(후면 발코니)에 닿아 컵이 몇 m 뒤로 갔다. 같은 까닭으로 식탁 위 컵이 「선반 위」로 남았다(트윈 면 보정이 사각형을 몰랐다).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHome } from "../src/layout/homes.js";
import { loadLayout } from "../src/layout/load.js";
import { DEFAULT_TWIN_DIR } from "../src/layout/twin-files.js";
import { surfaceSource } from "../src/server/home/observe.js";
import { placePoint, type PlaneSurface } from "../src/world/place.js";
import { LOOK_SIZE, viewLooking } from "./helpers/camera.js";

describe("트윈 윗면 사각형", () => {
  it("배치에 바닥 크기가 없으면 카탈로그 바닥 크기로 사각형을 둔다: 한양목련 식탁은 1.438 × 0.788, 방향 0°", () => {
    const home = resolveHome(DEFAULT_TWIN_DIR, "mokryeon_180b");
    const layout = loadLayout(home, { runtimeDir: mkdtempSync(join(tmpdir(), "surf-")), log: () => {} })!;
    const table = surfaceSource(layout.editor)().find((s) => s.id === "dining_table_978b20c7")!;
    expect(table.rect).toEqual({ center: [9.9612, 3.9242], size: [1.438, 0.788], facing_deg: 0 });
    expect(table.radius).toBeCloseTo(Math.hypot(1.438, 0.788) / 2, 3);
  });

  it("광선은 면의 실제 사각형 안에서만 윗면에 닿는다: 원 반지름 안이어도 사각형 밖이면 바닥, 원 반지름 밖이어도 사각형 안이면 윗면", () => {
    // 깊이(x) 0.6 · 폭(y) 2.0 식탁, 일부러 작은 반지름 0.3
    const table: PlaneSurface = { id: "table_1", label: "식탁", kind: "table", center: [1, 0], top: 0.75, radius: 0.3, rect: { center: [1, 0], size: [2.0, 0.6], facing_deg: 0 } };
    const down = (x: number, y: number) => placePoint(viewLooking([x, 2, y], [x, 0.75, y]), [LOOK_SIZE.width / 2, LOOK_SIZE.height / 2], LOOK_SIZE, [table], () => 0);
    expect(down(1, 0.8)).toMatchObject({ surface: "table_1" });   // 폭 쪽 0.8m: 원 밖, 사각형 안
    expect(down(1, 0.8).position![1]).toBeCloseTo(0.75, 3);
    const off = down(1.4, 0);   // 깊이 쪽 0.4m: 사각형 밖
    expect(off.surface).toBeNull();
    expect(off.position![1]).toBeCloseTo(0, 3);
  });

  // 키 큰 컵 q2(2026-11-18 09:52): 싱크볼 바닥 컵의 광선이 윗면 높이에서 싱크대 앞 끝 바로 앞을 지나 싱크대 너머 바닥(1.1m 뒤)에 닿아 「바닥」이 됐다
  it("조리대·싱크대는 속이 찬 장이라 그 너머 바닥은 안 보인다: 광선이 장 바닥 사각형을 지나 바닥에 닿으면 그 장 위(싱크볼을 지나면 싱크볼 안)다. 식탁 너머 바닥은 그대로 바닥", () => {
    // 깊이(x) 0.6 · 폭(y) 2.0 장, 싱크볼 깊이 0.4 · 폭 0.7
    const sink: PlaneSurface = { id: "sink_1", label: "싱크대", kind: "sink", center: [1, 0], top: 0.9, radius: 1, rect: { center: [1, 0], size: [2.0, 0.6], facing_deg: 0 }, basin: { center: [1, 0], size: [0.7, 0.4], facing_deg: 0 } };
    const counter: PlaneSurface = { ...sink, id: "counter_1", kind: "counter", basin: undefined };
    const table: PlaneSurface = { ...counter, id: "table_1", kind: "table" };
    // 눈 (2.0, 1.15, 0), 윗면 높이에서 장 앞 끝(x 1.3) 바로 앞 x 1.35를 지나는 광선: 바닥 x 0.18(장 너머)
    const at = (s: PlaneSurface) => placePoint(viewLooking([2.0, 1.15, 0], [1.35, 0.9, 0]), [LOOK_SIZE.width / 2, LOOK_SIZE.height / 2], LOOK_SIZE, [s], () => 0);
    expect(at(sink)).toMatchObject({ surface: "sink_1", part: "basin" });
    expect(at(sink).position![1]).toBeCloseTo(0.9, 3);
    expect(at(counter)).toMatchObject({ surface: "counter_1", part: null });
    expect(at(counter).position![0]).toBeCloseTo(1.3, 1);
    expect(at(table)).toMatchObject({ surface: null });
    expect(at(table).position![1]).toBeCloseTo(0, 3);
  });
});

