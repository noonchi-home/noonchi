// 서버·에이전트·MCP 테스트가 함께 쓰는 작은 집(실제 twin-studio 데이터와 같은 id·이름).
import { Policy } from "../../src/agent/policy.js";
import { MemoryHub } from "../../src/hub/memory.js";
import type { DeviceSpec, RoomSpec } from "../../src/hub/types.js";
import { describeDevice } from "../../src/model/mapping.js";

export const ROOMS: RoomSpec[] = [
  { id: "kitchen_dining", label: "주방·식당" },
  { id: "living_room", label: "거실" },
  { id: "entrance", label: "현관" },
  { id: "bathroom", label: "공용 욕실" },
  { id: "bedroom_2", label: "작은방" },
  { id: "bedroom", label: "안방" },
  { id: "bathroom_master", label: "안방 욕실" },
  { id: "bedroom_3", label: "서재" },
  { id: "balcony", label: "다용도실(발코니)" },
  { id: "shelter", label: "대피공간" },
];

const P = { power: ["off", "on"] };
const DOOR = { door: ["closed", "open"] };

const ITEMS: [string, string, string, string, Record<string, unknown[]>][] = [
  ["induction_1", "인덕션", "kitchen_dining", "induction_counter", P],
  ["microwave_1", "전자레인지", "kitchen_dining", "microwave", P],
  ["sink_1", "싱크대", "kitchen_dining", "sink_counter", { faucet: ["off", "on"] }],
  ["fridge_1", "냉장고", "kitchen_dining", "fridge", DOOR],
  ["light_kitchen", "주방 천장등", "kitchen_dining", "ceiling_light", P],
  ["tv_living", "거실 TV", "living_room", "tv", P],
  ["speaker_living", "AI 스피커", "living_room", "speaker", P],
  ["ac_living", "스탠드 에어컨", "living_room", "stand_ac", P],
  ["lamp_living", "플로어 스탠드", "living_room", "floor_lamp", P],
  ["robot_vacuum_1", "로봇청소기", "living_room", "robot_vacuum", { running: [true, false] }],
  ["vacuum_dock_1", "로봇청소기 충전대", "living_room", "vacuum_dock", { charging: ["off", "on"] }],
  ["curtain_living", "거실 커튼", "living_room", "curtain_290", { curtain: ["open", "closed"] }],
  ["light_living", "거실 천장등", "living_room", "ceiling_light", P],
  ["ac_bed2", "작은방 에어컨", "bedroom_2", "wall_ac", P],
  ["light_bed2", "작은방 천장등", "bedroom_2", "ceiling_light", P],
  ["lamp_master_1", "안방 수면등 1", "bedroom", "bedside_lamp", P],
  ["ac_master", "안방 에어컨", "bedroom", "wall_ac", P],
  ["curtain_master", "안방 커튼", "bedroom", "curtain_250", { curtain: ["open", "closed"] }],
  ["light_master", "안방 천장등", "bedroom", "ceiling_light", P],
  ["light_ensuite", "안방 욕실 등", "bathroom_master", "downlight", P],
  ["light_bath", "공용 욕실 등", "bathroom", "downlight", P],
  ["light_entrance", "현관 센서등", "entrance", "downlight", P],
  ["washer_1", "세탁기", "balcony", "washer", { running: [true, false], door: ["closed", "open"] }],
  ["boiler_1", "보일러", "balcony", "boiler", { heating: ["off", "on"] }],
  ["door_main", "현관문", "entrance", "door_main", { door: ["closed", "open"], lock: ["locked", "unlocked"] }],
  ["door_bed2", "작은방 문", "bedroom_2", "door_room_r", DOOR],
  ["door_balcony", "다용도실(발코니) 문", "kitchen_dining", "door_glass_l", DOOR],
];

export function homeDevices(): DeviceSpec[] {
  const label = new Map(ROOMS.map((r) => [r.id, r.label]));
  return ITEMS.map(([id, name, room, twinType, twinAttrs]) => {
    const d = describeDevice(twinType, twinAttrs);
    if (!d) throw new Error(`테스트 기기 매핑 없음: ${twinType}`);
    return { id, label: name, room, roomLabel: label.get(room) ?? room, twinType, twinAttrs, ...d };
  });
}

export function makeHome() {
  const devices = homeDevices();
  const hub = new MemoryHub(devices);
  const policy = new Policy();
  return { devices, rooms: ROOMS, hub, policy };
}

export function twin(hub: MemoryHub, id: string): Record<string, unknown> {
  const s = hub.get(id);
  if (!s) throw new Error(`기기 없음: ${id}`);
  return s.twin;
}
