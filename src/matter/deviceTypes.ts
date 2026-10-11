// DeviceSpec.matterDeviceType(matter.js 기기 export 이름) → 브리지 엔드포인트 타입과 초기 속성.
//
// matter.js 0.17.9에 표의 기기 종류 21개가 모두 있어 **기기 종류 대체는 없다**(SUBSTITUTIONS 비어 있음).
// 대신 기기 종류 정의만으로는 부족한 부분을 아래처럼 채운다(DEVICE_TYPE_INFO[*].note).
//   - 기능(feature)을 골라야 붙는 필수 클러스터: Thermostat(냉방·난방·자동), WindowCovering(Lift·PositionAwareLift),
//     FanControl(Auto), MicrowaveOvenControl(PowerAsNumber).
//   - 기본 서버가 명령을 구현하지 않는 클러스터: OperationalState, RvcRunMode/RvcOperationalState,
//     ValveConfigurationAndControl, MediaPlayback, KeypadInput → behaviors.ts의 최소 구현.
//   - 문 센서(door attr)가 있는 식기세척기·세탁기·냉장고·현관 도어록: 같은 엔드포인트에 BooleanState를 더 붙인다
//     (Contact Sensor 자식 엔드포인트 대신. 문 상태 = stateValue, true = 닫힘).

import type { Behavior, EndpointType } from "@matter/main";
import { BooleanStateServer } from "@matter/main/behaviors/boolean-state";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { FanControlServer } from "@matter/main/behaviors/fan-control";
import { MicrowaveOvenModeServer } from "@matter/main/behaviors/microwave-oven-mode";
import { ThermostatServer } from "@matter/main/behaviors/thermostat";
import { WindowCoveringServer } from "@matter/main/behaviors/window-covering";
import { DoorLock } from "@matter/main/clusters/door-lock";
import { FanControl } from "@matter/main/clusters/fan-control";
import { MediaPlayback } from "@matter/main/clusters/media-playback";
import { MicrowaveOvenMode } from "@matter/main/clusters/microwave-oven-mode";
import { OperationalState } from "@matter/main/clusters/operational-state";
import { RvcOperationalState } from "@matter/main/clusters/rvc-operational-state";
import { RvcRunMode } from "@matter/main/clusters/rvc-run-mode";
import { Thermostat } from "@matter/main/clusters/thermostat";
import { ValveConfigurationAndControl } from "@matter/main/clusters/valve-configuration-and-control";
import { WindowCovering } from "@matter/main/clusters/window-covering";
import {
  AirPurifierDevice,
  BasicVideoPlayerDevice,
  ContactSensorDevice,
  CooktopDevice,
  DimmableLightDevice,
  DishwasherDevice,
  DoorLockDevice,
  ExtractorHoodDevice,
  FanDevice,
  LaundryDryerDevice,
  LaundryWasherDevice,
  MicrowaveOvenDevice,
  OnOffLightDevice,
  OnOffPlugInUnitDevice,
  RefrigeratorDevice,
  RoboticVacuumCleanerDevice,
  RoomAirConditionerDevice,
  SpeakerDevice,
  ThermostatDevice,
  WaterValveDevice,
  WindowCoveringDevice,
} from "@matter/main/devices";
import type { DeviceSpec } from "../hub/types.js";
import { clustersFromSummary, MATTER_ENUMS, type MatterClusters, type MatterSummary } from "../model/mapping.js";
import {
  TwinDoorLockServer,
  TwinKeypadInputServer,
  TwinMediaPlaybackServer,
  TwinMicrowaveOvenControlServer,
  TwinOperationalStateServer,
  TwinRvcOperationalStateServer,
  TwinRvcRunModeServer,
  TwinValveServer,
} from "./behaviors.js";

/** 대체한 기기 종류(원래 이름 → 쓴 이름). matter.js 0.17.9에는 모두 있어 비어 있다. */
export const SUBSTITUTIONS: Record<string, string> = {};

export interface DeviceTypeInfo {
  /** Matter 기기 종류 번호(Descriptor deviceTypeList). */
  deviceType: number;
  /** 한국어 설명: 기기 종류 정의에 더 붙이거나 채운 것. */
  note: string;
}

type Config = MatterClusters;
interface Built {
  type: EndpointType;
  config: Config;
}

const B = BridgedDeviceBasicInformationServer;
const OpState = OperationalState.OperationalStateEnum;
const Rvc = RvcOperationalState.OperationalState;

const OPERATIONAL_STATE: Config[string] = {
  operationalStateList: [OpState.Stopped, OpState.Running, OpState.Paused, OpState.Error].map((id) => ({ operationalStateId: id })),
  operationalState: OpState.Stopped,
  phaseList: null,
  currentPhase: null,
  operationalError: { errorStateId: OperationalState.ErrorState.NoError },
};

const FAN: Config[string] = {
  fanModeSequence: FanControl.FanModeSequence.OffLowMedHighAuto,
  fanMode: FanControl.FanMode.Off,
  percentSetting: 0,
  percentCurrent: 0,
};

const FanServer = FanControlServer.with("Auto");

function withDoor(spec: DeviceSpec, ...extra: Behavior.Type[]): Behavior.Type[] {
  return spec.sensors.includes("door") ? [...extra, BooleanStateServer] : extra;
}

/** 기기 종류별 엔드포인트 타입 + 고정 설정(목록·기능·필수 속성). 상태 값은 요약에서 따로 채운다. */
const BUILDERS: Record<string, { info: DeviceTypeInfo; build: (spec: DeviceSpec) => Built }> = {
  DimmableLightDevice: {
    info: { deviceType: DimmableLightDevice.deviceType, note: "OnOff + LevelControl(밝기)" },
    build: () => ({ type: DimmableLightDevice.with(B), config: {} }),
  },
  OnOffLightDevice: {
    info: { deviceType: OnOffLightDevice.deviceType, note: "OnOff" },
    build: () => ({ type: OnOffLightDevice.with(B), config: {} }),
  },
  OnOffPlugInUnitDevice: {
    info: { deviceType: OnOffPlugInUnitDevice.deviceType, note: "OnOff" },
    build: () => ({ type: OnOffPlugInUnitDevice.with(B), config: {} }),
  },
  BasicVideoPlayerDevice: {
    info: { deviceType: BasicVideoPlayerDevice.deviceType, note: "OnOff + 필수 MediaPlayback·KeypadInput 최소 구현" },
    build: () => ({
      type: BasicVideoPlayerDevice.with(B, TwinMediaPlaybackServer, TwinKeypadInputServer),
      config: { mediaPlayback: { currentState: MediaPlayback.PlaybackState.NotPlaying } },
    }),
  },
  SpeakerDevice: {
    info: { deviceType: SpeakerDevice.deviceType, note: "OnOff + LevelControl(음량)" },
    build: () => ({ type: SpeakerDevice.with(B), config: {} }),
  },
  RoomAirConditionerDevice: {
    info: { deviceType: RoomAirConditionerDevice.deviceType, note: "OnOff + Thermostat(Cooling·Heating·AutoMode) + FanControl(Auto)" },
    build: () => ({
      type: RoomAirConditionerDevice.with(B, ThermostatServer.with("Heating", "Cooling", "AutoMode"), FanServer),
      config: {
        thermostat: { controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.CoolingAndHeating, localTemperature: 2600 },
        fanControl: { ...FAN },
      },
    }),
  },
  AirPurifierDevice: {
    info: { deviceType: AirPurifierDevice.deviceType, note: "FanControl(Auto). 전원 = fanMode ≠ Off" },
    build: () => ({ type: AirPurifierDevice.with(B, FanServer), config: { fanControl: { ...FAN } } }),
  },
  FanDevice: {
    info: { deviceType: FanDevice.deviceType, note: "FanControl(Auto). 전원 = fanMode ≠ Off" },
    build: () => ({ type: FanDevice.with(B, FanServer), config: { fanControl: { ...FAN } } }),
  },
  ExtractorHoodDevice: {
    info: { deviceType: ExtractorHoodDevice.deviceType, note: "FanControl(Auto). 전원 = fanMode ≠ Off" },
    build: () => ({ type: ExtractorHoodDevice.with(B, FanServer), config: { fanControl: { ...FAN } } }),
  },
  CooktopDevice: {
    info: { deviceType: CooktopDevice.deviceType, note: "OnOff(Cook Surface 자식 엔드포인트는 생략)" },
    build: () => ({ type: CooktopDevice.with(B), config: {} }),
  },
  MicrowaveOvenDevice: {
    info: { deviceType: MicrowaveOvenDevice.deviceType, note: "OperationalState(시작·정지 구현) + MicrowaveOvenMode(일반·해동) + MicrowaveOvenControl(PowerAsNumber)" },
    build: () => ({
      type: MicrowaveOvenDevice.with(B, TwinOperationalStateServer, MicrowaveOvenModeServer, TwinMicrowaveOvenControlServer),
      config: {
        operationalState: { ...OPERATIONAL_STATE },
        microwaveOvenMode: {
          supportedModes: [
            { label: "Normal", mode: 0, modeTags: [{ value: MicrowaveOvenMode.ModeTag.Normal }] },
            { label: "Defrost", mode: 1, modeTags: [{ value: MicrowaveOvenMode.ModeTag.Defrost }] },
          ],
          currentMode: 0,
        },
        microwaveOvenControl: { cookTime: 30, maxCookTime: 3600, powerSetting: 100 },
      },
    }),
  },
  DishwasherDevice: {
    info: { deviceType: DishwasherDevice.deviceType, note: "OperationalState(시작·정지 구현) + 문 센서 BooleanState" },
    build: (spec) => ({ type: DishwasherDevice.with(B, ...withDoor(spec, TwinOperationalStateServer)), config: { operationalState: { ...OPERATIONAL_STATE } } }),
  },
  LaundryWasherDevice: {
    info: { deviceType: LaundryWasherDevice.deviceType, note: "OperationalState(시작·정지 구현) + 문 센서 BooleanState" },
    build: (spec) => ({ type: LaundryWasherDevice.with(B, ...withDoor(spec, TwinOperationalStateServer)), config: { operationalState: { ...OPERATIONAL_STATE } } }),
  },
  LaundryDryerDevice: {
    info: { deviceType: LaundryDryerDevice.deviceType, note: "OperationalState(시작·정지 구현)" },
    build: (spec) => ({ type: LaundryDryerDevice.with(B, ...withDoor(spec, TwinOperationalStateServer)), config: { operationalState: { ...OPERATIONAL_STATE } } }),
  },
  RefrigeratorDevice: {
    info: { deviceType: RefrigeratorDevice.deviceType, note: "문 센서 BooleanState(RefrigeratorAlarm·냉장실 자식 엔드포인트는 생략)" },
    build: (spec) => ({ type: RefrigeratorDevice.with(B, ...withDoor(spec)), config: {} }),
  },
  RoboticVacuumCleanerDevice: {
    info: { deviceType: RoboticVacuumCleanerDevice.deviceType, note: "RvcRunMode(0 = 대기, 1 = 청소) + RvcOperationalState(Pause·Resume·GoHome 구현)" },
    build: () => ({
      type: RoboticVacuumCleanerDevice.with(B, TwinRvcRunModeServer, TwinRvcOperationalStateServer),
      config: {
        rvcRunMode: {
          supportedModes: [
            { label: "Idle", mode: MATTER_ENUMS.rvcRunMode.idle, modeTags: [{ value: RvcRunMode.ModeTag.Idle }] },
            { label: "Cleaning", mode: MATTER_ENUMS.rvcRunMode.cleaning, modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }] },
          ],
          currentMode: MATTER_ENUMS.rvcRunMode.idle,
        },
        rvcOperationalState: {
          operationalStateList: [Rvc.Stopped, Rvc.Running, Rvc.Paused, Rvc.Error, Rvc.SeekingCharger, Rvc.Charging, Rvc.Docked].map((id) => ({ operationalStateId: id })),
          operationalState: Rvc.Docked,
          phaseList: null,
          currentPhase: null,
          operationalError: { errorStateId: OperationalState.ErrorState.NoError },
        },
      },
    }),
  },
  WindowCoveringDevice: {
    info: { deviceType: WindowCoveringDevice.deviceType, note: "WindowCovering(Lift·PositionAwareLift). 커튼 = Drapery, 블라인드 = RollerShade" },
    build: (spec) => {
      const curtain = spec.twinType.startsWith("curtain");
      return {
        type: WindowCoveringDevice.with(B, WindowCoveringServer.with("Lift", "PositionAwareLift")),
        config: {
          windowCovering: {
            type: curtain ? WindowCovering.WindowCoveringType.Drapery : WindowCovering.WindowCoveringType.Rollershade,
            endProductType: curtain ? WindowCovering.EndProductType.CentralCurtain : WindowCovering.EndProductType.RollerShade,
          },
        },
      };
    },
  },
  DoorLockDevice: {
    info: { deviceType: DoorLockDevice.deviceType, note: "DoorLock(PIN 기능 없음 → 원격 잠금·해제에 PIN 불필요) + 문 센서 BooleanState" },
    build: (spec) => ({
      type: DoorLockDevice.with(B, ...withDoor(spec, TwinDoorLockServer)),
      config: {
        doorLock: {
          lockType: DoorLock.LockType.DeadBolt,
          actuatorEnabled: true,
          operatingMode: DoorLock.OperatingMode.Normal,
          wrongCodeEntryLimit: 5,
          userCodeTemporaryDisableTime: 10,
        },
      },
    }),
  },
  ContactSensorDevice: {
    info: { deviceType: ContactSensorDevice.deviceType, note: "BooleanState(true = 닫힘)" },
    build: () => ({ type: ContactSensorDevice.with(B), config: {} }),
  },
  WaterValveDevice: {
    info: { deviceType: WaterValveDevice.deviceType, note: "ValveConfigurationAndControl(Open·Close 구현)" },
    build: () => ({
      type: WaterValveDevice.with(B, TwinValveServer),
      config: {
        valveConfigurationAndControl: {
          openDuration: null,
          defaultOpenDuration: null,
          remainingDuration: null,
          targetState: ValveConfigurationAndControl.ValveState.Closed,
        },
      },
    }),
  },
  ThermostatDevice: {
    info: {
      deviceType: ThermostatDevice.deviceType,
      note: "Thermostat. 난방 = systemMode Heat. 매핑의 자동(auto) 모드를 Matter가 받으려면 AutoMode 기능(Cooling 필요)이 있어야 해서 " +
        "Heating·Cooling·AutoMode를 켜고 controlSequenceOfOperation = HeatingOnly로 냉방 모드는 막는다(deadband 0)",
    },
    build: () => ({
      type: ThermostatDevice.with(B, ThermostatServer.with("Heating", "Cooling", "AutoMode")),
      config: {
        thermostat: {
          controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.HeatingOnly,
          minSetpointDeadBand: 0,
          localTemperature: 2000,
        },
      },
    }),
  },
};

/** 브리지가 만들 수 있는 matter.js 기기 종류 이름. */
export const SUPPORTED_DEVICE_TYPES: string[] = Object.keys(BUILDERS);

/** 기기 종류 이름 → 번호·설명. */
export const DEVICE_TYPE_INFO: Record<string, DeviceTypeInfo> = Object.fromEntries(
  Object.entries(BUILDERS).map(([name, b]) => [name, b.info]),
);

function builderFor(spec: DeviceSpec) {
  const name = SUBSTITUTIONS[spec.matterDeviceType] ?? spec.matterDeviceType;
  if (name === "none") return undefined;
  const b = BUILDERS[name];
  if (!b) throw new Error(`지원하지 않는 Matter 기기 종류입니다: ${spec.matterDeviceType} (${spec.id})`);
  return b;
}

/** 기기 spec → 브리지 엔드포인트 타입(BridgedDeviceBasicInformation 포함). Matter 기기가 아니면 undefined. */
export function endpointTypeFor(spec: DeviceSpec): EndpointType | undefined {
  return builderFor(spec)?.build(spec).type;
}

function merge(a: Config, b: Config): Config {
  const out: Config = { ...a };
  for (const [cluster, values] of Object.entries(b)) out[cluster] = { ...out[cluster], ...values };
  return out;
}

/** 엔드포인트 생성 옵션의 클러스터 부분: 고정 설정 + 요약(초기 상태)에서 만든 속성 값. */
export function endpointClustersFor(spec: DeviceSpec, summary: MatterSummary): Config {
  const b = builderFor(spec);
  if (!b) return {};
  const state = clustersFromSummary(spec, summary);
  // 밸브는 목표 상태도 현재 상태와 같게 시작한다
  const valve = state.valveConfigurationAndControl;
  if (valve && valve.currentState !== undefined) valve.targetState = valve.currentState;
  return merge(b.build(spec).config, state);
}
