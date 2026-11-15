// 가전 종류 등록부 검증(src/model/kinds.ts): 틀린 조합을 까닭 목록으로 돌려준다. 서버 시작(src/server/start.ts)이 부르고, 까닭이 있으면 시작을 막는다.
// 1) confirm.command는 그 종류의 모든 실제 사양(기본 프로필, twinTypes마다 capabilities·matterDeviceType를 덮어쓴 것)에서 정규화해도 같은 이름이고 그 사양이 받는 명령이다.
// 2) 위험 켜기 종류(riskyOn)에는 confirm을 쓰지 않고 riskyReason을 둔다.
// 3) ThinQ 어댑터는 그 종류의 모든 사양이 낼 수 있는 명령을 받아야 한다. 읽기만 하는 어댑터에는 제어 없는 프로필만 붙인다.
// 4) 손 조작: 켜기·끄기는 프로필 제어가 있을 때만, 열기·닫기는 문 센서(door)가 있거나 그 종류 카메라 설비가 열림(open) 면을 볼 때만.
import type { Capability, Command, CommandType } from "../hub/types.js";
import { THINQ_ADAPTERS } from "../thinq/appliance.js";
import { CLASSES } from "../world/vocab.js";
import type { KindEntry } from "./kinds.js";
import { checkCommand, normalizeCommand } from "./mapping.js";

/** 실제 사양: 기본 프로필과 twinTypes마다 덮어쓴 것. */
function specsOf(kind: string, e: KindEntry): { name: string; capabilities: Capability[]; matterDeviceType: string }[] {
  const base = { name: `${kind} 프로필`, capabilities: [...e.profile.capabilities], matterDeviceType: e.profile.matterDeviceType };
  const over = e.twinTypes
    .filter((t) => t.capabilities || t.matterDeviceType)
    .map((t) => ({
      name: `${kind} ${(t.types ?? t.prefixes ?? []).join(",")}`,
      capabilities: [...(t.capabilities ?? e.profile.capabilities)],
      matterDeviceType: t.matterDeviceType ?? e.profile.matterDeviceType,
    }));
  return [base, ...over];
}

/** 기능마다 실제로 낼 수 있는 명령(정규화한 이름). onoff가 없을 때의 on·off는 operation이면 start·stop, valve면 valve로 바뀌어 여기 이미 있다. */
const CAPABILITY_COMMANDS: Readonly<Record<Capability, readonly CommandType[]>> = {
  onoff: ["on", "off"], level: ["level"], climate: ["climate"], fan: ["climate"], covering: ["covering"], lock: ["lock", "unlock"],
  operation: ["start", "stop", "pause"], valve: ["valve"],
};

/** 그 사양이 낼 수 있는 명령 전체: 기능마다 따로 모은다. */
function commandsOf(caps: readonly Capability[]): CommandType[] {
  return [...new Set(caps.flatMap((c) => CAPABILITY_COMMANDS[c]))];
}

/** 이름만 있는 명령의 검사용 표본: 설정값이 필요한 명령은 그 프로필에 맞는 유효한 값(모드는 프로필 modes 첫 값, 설정 온도는 setpoint 범위의 반올림하지 않은 가운데, 바람만 있으면 auto). */
function sample(type: CommandType, e: KindEntry, caps: readonly Capability[]): Command {
  switch (type) {
    case "level": return { type, percent: 50 };
    case "covering": return { type, openPercent: 50 };
    case "valve": return { type, open: true };
    case "climate": {
      const p = e.profile;
      if (!caps.includes("climate")) return { type, fan: "auto" };
      return { type, ...(p.modes?.length ? { mode: p.modes[0] } : {}), setpointC: p.setpoint ? (p.setpoint.min + p.setpoint.max) / 2 : 22 };
    }
    default: return { type } as Command;
  }
}

export function checkKinds(kinds: Readonly<Record<string, KindEntry>>): string[] {
  const out: string[] = [];
  for (const [kind, e] of Object.entries(kinds)) {
    const specs = specsOf(kind, e);
    if (e.riskyOn) {
      if (e.confirm) out.push(`${kind}: 위험 켜기 종류(riskyOn)에는 confirm을 쓰지 않고 riskyReason을 둔다`);
      if (!e.riskyReason) out.push(`${kind}: 위험 켜기 종류(riskyOn)에는 riskyReason이 있어야 한다`);
    }
    if (e.confirm) {
      const want = e.confirm.command;
      for (const s of specs) {
        const c = normalizeCommand(s, sample(want, e, s.capabilities));
        if (c.type !== want) out.push(`${kind}: confirm ${want}은(는) ${s.name}에서 ${c.type}(으)로 바뀐다(정규화로 이름이 바뀌는 명령은 confirm에 쓰지 않는다)`);
        else {
          const bad = checkCommand({ kind: kind as never, label: s.name, capabilities: s.capabilities, sensors: [] }, c);
          if (bad) out.push(`${kind}: confirm ${want}을(를) ${s.name}이(가) 받지 않는다(${bad})`);
        }
      }
    }
    if (e.thinq) {
      const adapter = THINQ_ADAPTERS[e.thinq.adapter];
      for (const s of specs) {
        if (!adapter.commands.length && (e.profile.control || commandsOf(s.capabilities).length)) {
          out.push(`${kind}: ThinQ 어댑터 ${e.thinq.adapter}는 읽기만 해서 제어가 있는 ${s.name}에는 붙이지 않는다`);
          continue;
        }
        for (const cmd of commandsOf(s.capabilities)) {
          if (adapter.commands.length && !adapter.commands.includes(cmd)) out.push(`${kind}: ThinQ 어댑터 ${e.thinq.adapter}는 ${cmd}를 받지 않는다(${s.name})`);
        }
      }
    }
    for (const act of e.hand ?? []) {
      if ((act === "켜기" || act === "끄기") && !e.profile.control) out.push(`${kind}: 손 조작 ${act}는 프로필 제어가 있어야 한다`);
      if (act === "열기" || act === "닫기") {
        const fixture = e.camera?.fixture;
        const sees = fixture ? (CLASSES[fixture].facets as readonly string[]).includes("open") : false;
        if (!e.profile.sensors.includes("door") && !sees) out.push(`${kind}: 손 조작 ${act}는 문 센서나 열림을 보는 카메라 설비가 있어야 한다`);
      }
    }
  }
  return out;
}
