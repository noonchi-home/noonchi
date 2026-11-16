// 배치 보정 도구(docs/plan.md 계약 E): 서버 안 에이전트 전용(MCP에는 내지 않는다).
// 도구는 ToolBackend.layout(배치 편집기)을 쓴다. 결과의 device는 바뀐 물건이라 화면 초점이 그 물건으로 간다.

import { z } from "zod";
import { findTypes, type TypeInfo } from "../layout/catalog.js";
import { LayoutError, type LayoutEditor, type SceneObject, type To } from "../layout/editor.js";
import { describeDevice } from "../devices/index.js";
import type { ToolBackend, ToolDef, ToolResult } from "./tools.js";

export interface LayoutTools {
  editor: LayoutEditor;
  catalog: Map<string, TypeInfo>;
}

const NO_LAYOUT: ToolResult = { ok: false, error: "배치 보정을 쓸 수 없습니다(집 데이터가 없음)." };

const objectId = z.string().min(1).describe("물건 id(find_objects 결과의 id)");
const coords = {
  to: z.enum(["here"]).optional().describe('"here" = 사용자가 들고 있는 폰 화면 가운데 조준점이 가리키는 바닥 점'),
  x: z.number().optional().describe("평면도 x(m, 오른쪽이 +)"),
  y: z.number().optional().describe("평면도 y(m, 아래쪽이 +)"),
};

function brief(o: SceneObject, editor: LayoutEditor) {
  return {
    id: o.id, label: o.name, type: o.type, room: o.room, roomLabel: editor.roomLabel(o.room),
    position: o.plan.position, facing_deg: o.plan.facing_deg, mount: o.mount,
  };
}

function target(args: Record<string, unknown>, relative: boolean): To | undefined {
  if (args.to === "here") return "here";
  if (typeof args.x === "number" && typeof args.y === "number") return { x: args.x, y: args.y };
  if (relative && (typeof args.dx === "number" || typeof args.dy === "number")) return { dx: Number(args.dx ?? 0), dy: Number(args.dy ?? 0) };
  return undefined;
}

async function guarded(backend: ToolBackend, fn: (l: LayoutTools) => ToolResult): Promise<ToolResult> {
  if (!backend.layout) return NO_LAYOUT;
  try {
    return fn(backend.layout);
  } catch (e) {
    if (e instanceof LayoutError) return { ok: false, error: e.message };
    throw e;
  }
}

export const LAYOUT_TOOLS: ToolDef[] = [
  {
    name: "find_objects", title: "물건 찾기", readOnly: true,
    description: "집 안 가구·가전·소품을 한국어 이름이나 방으로 찾습니다(배치 보정용). 예: '냉장고', '방 TV', '침대'.",
    schema: z.object({ query: z.string().min(1).describe("찾을 말") }),
    run: (backend, args) => guarded(backend, ({ editor }) => {
      const found = editor.find(String(args.query));
      return { ok: true, data: found.map((o) => brief(o, editor)), message: found.length ? undefined : `'${args.query}'에 맞는 물건이 없습니다.` };
    }),
  },
  {
    name: "move_object", title: "물건 옮기기",
    description: "물건을 옮기거나 돌립니다. to=\"here\"면 폰 조준점 자리로(사용자가 '위치 여기로 맞춰줘', '여기 있어', '여기로 옮겨줘'라고 할 때). x·y는 평면도 좌표, dx·dy는 지금 자리에서 상대 이동(m). facing_deg는 정면 방향(0 오른쪽, 90 아래, 180 왼쪽, 270 위), turn_deg는 지금 방향에서 더 돌릴 각도. 벽걸이는 가장 가까운 벽에 붙고, 받침 위 물건을 옮기면 받침째 옮깁니다.",
    schema: z.object({
      object_id: objectId, ...coords,
      dx: z.number().optional().describe("오른쪽(+)·왼쪽(-)으로 m"),
      dy: z.number().optional().describe("아래쪽(+)·위쪽(-)으로 m"),
      facing_deg: z.number().optional(), turn_deg: z.number().optional(),
    }),
    run: (backend, args) => guarded(backend, ({ editor }) => {
      const to = target(args, true);
      const facing = typeof args.facing_deg === "number" ? args.facing_deg : undefined;
      const turn = typeof args.turn_deg === "number" ? args.turn_deg : undefined;
      if (to === undefined && facing === undefined && turn === undefined) return { ok: false, error: "옮길 자리(to·x·y·dx·dy)나 방향(facing_deg·turn_deg)을 주세요." };
      const r = editor.move(String(args.object_id), to, { facing_deg: facing, turn_deg: turn });
      return { ok: true, device: { id: r.object.id, label: r.object.name }, message: r.message, data: { ...brief(r.object, editor), changed: r.changed } };
    }),
  },
  {
    name: "add_object", title: "물건 더하기",
    description: "집에 있는데 트윈에 없는 가구·가전을 더합니다. type은 find_object_types로 찾은 종류 id. to=\"here\"면 폰 조준점 자리. 다른 물건 위에 올리는 종류(TV·전자레인지 등)는 아직 못 더합니다. 더한 가전은 저장·반영·재시작 뒤에 켜고 끌 수 있습니다.",
    schema: z.object({
      type: z.string().min(1).describe("카탈로그 종류 id(예: wall_ac)"),
      label: z.string().optional().describe("이름(없으면 카탈로그 이름)"),
      ...coords, facing_deg: z.number().optional(),
    }),
    run: (backend, args) => guarded(backend, ({ editor }) => {
      const to = target(args, false);
      if (!to) return { ok: false, error: "더할 자리(to=\"here\" 또는 x·y)를 주세요." };
      const r = editor.add(String(args.type), to, { label: typeof args.label === "string" ? args.label : undefined, facing_deg: typeof args.facing_deg === "number" ? args.facing_deg : undefined });
      return { ok: true, device: { id: r.object.id, label: r.object.name }, message: r.message, data: brief(r.object, editor) };
    }),
  },
  {
    name: "remove_object", title: "물건 빼기",
    description: "집에 실제로 없는 물건을 트윈에서 뺍니다. 받침을 빼면 위에 놓인 물건도 같이 빠집니다.",
    schema: z.object({ object_id: objectId }),
    run: (backend, args) => guarded(backend, ({ editor }) => {
      const r = editor.remove(String(args.object_id));
      return { ok: true, device: { id: r.object.id, label: r.object.name }, message: r.message, data: { changed: r.changed } };
    }),
  },
  {
    name: "find_object_types", title: "종류 찾기", readOnly: true,
    description: "더할 수 있는 가구·가전 종류를 한국어 이름으로 찾습니다. matter가 true면 저장·반영 뒤 채팅으로 제어할 수 있는 가전입니다.",
    schema: z.object({ query: z.string().min(1).describe("찾을 말(예: 에어컨, 공기청정기)") }),
    run: (backend, args) => guarded(backend, ({ catalog }) => {
      const types = findTypes(catalog, String(args.query)).slice(0, 12);
      return {
        ok: true,
        data: types.map((t) => ({ type: t.type, label: t.label, mount: t.mount, addable: t.mount !== "surface", matter: !!describeDevice(t.type, t.attrs as Record<string, unknown[]>) })),
        message: types.length ? undefined : `'${args.query}'에 맞는 종류가 없습니다.`,
      };
    }),
  },
  {
    name: "save_layout", title: "배치 저장",
    description: "지금까지의 배치 보정을 수정본 파일로 저장합니다(사용자가 '저장해', '확정'이라고 할 때).",
    schema: z.object({}),
    run: (backend) => guarded(backend, ({ editor }) => {
      const r = editor.save();
      return {
        ok: true, data: r,
        message: r.count === 0 ? "저장할 보정이 없어요." : `배치 보정 ${r.count}건을 저장했어요. twin-studio에서 python -m studio apply-edits --home ${editor.homeId} "${r.path}"로 반영하고 다시 빌드하면 확정돼요.`,
      };
    }),
  },
];
