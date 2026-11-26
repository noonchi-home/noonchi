// @vitest-environment node
// 가로 영상(1280×720, 16:9)은 대시보드 미니맵(카메라 칸)을 빈 띠나 잘림 없이 꼭 채운다: 칸 비율이 영상 비율과 같고(높이 상한에 걸리지 않음),
// 영상 모드 폰이 보내는 대시보드 프레임(긴 변 780, 780×439)처럼 반올림으로 흔들린 크기도 칸을 16:9 그대로 둔다.
import { describe, expect, it } from "vitest";
import { MINIMAP_ASPECT, nextAspect, pageLayout } from "../../src/dashboard/layout";
import { MASCOT } from "../../src/lib/mascot-image";

describe("가로 영상이 미니맵에 꼭 맞는다", () => {
  it.each([[1280, 800], [1280, 720], [1440, 900], [1920, 1080], [1522, 722]])("%i×%i 화면: 1280×720 영상과 780×439 대시보드 프레임은 칸 비율 16:9 그대로", (width, height) => {
    for (const frame of [{ width: 1280, height: 720 }, { width: 780, height: 439 }, { width: 640, height: 360 }]) {
      const aspect = nextAspect(MINIMAP_ASPECT, frame);
      expect(aspect).toBe(16 / 9);
      const { video } = pageLayout({ width, height }, MASCOT);
      expect(video.width).toBeGreaterThan(0);
      expect(Math.abs(video.width / video.height - 1280 / 720)).toBeLessThan(1e-9);
    }
  });
});
