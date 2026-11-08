// @vitest-environment node
// 기본 보기에서 세우는 벽(안쪽 면이 카메라를 향한 바깥벽)이 굽기 때 빛을 막은 벽과 같다. 다르면 구운 그림자가 화면과 맞지 않는다.
import { describe, expect, it } from "vitest";
import manifest from "../../../twin/homes/mokryeon_180b/bake/manifest.json";
import scene from "../../../twin/homes/mokryeon_180b/scene.json";
import { raisedWalls, viewHeading } from "../../src/twin3d/cutaway";
import { MOKRYEON_MAP_CAMERA } from "../../src/twin3d/projection";

describe("기본 보기 벽", () => {
  it("카메라 수평 방향은 [0.7071, 0.7071]이다", () => {
    expect(viewHeading(MOKRYEON_MAP_CAMERA).map((v) => Number(v.toFixed(4)))).toEqual([0.7071, 0.7071]);
  });
  it("세우는 벽 = 굽기 가리개 벽", () => {
    expect(raisedWalls(scene.plan.walls, viewHeading(MOKRYEON_MAP_CAMERA))).toEqual([...manifest.light.occluders.walls].sort());
  });
});
