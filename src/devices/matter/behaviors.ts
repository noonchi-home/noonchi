// matter.js 기본 서버가 명령을 구현하지 않는 클러스터를 위한 최소 behavior.
// 가상 가전이라 명령을 받으면 곧바로 목표 상태가 된다(실제 동작 시간 없음).

import { DoorLockServer } from "@matter/main/behaviors/door-lock";
import { KeypadInputServer } from "@matter/main/behaviors/keypad-input";
import { MediaPlaybackServer } from "@matter/main/behaviors/media-playback";
import { MicrowaveOvenControlServer } from "@matter/main/behaviors/microwave-oven-control";
import { OperationalStateServer } from "@matter/main/behaviors/operational-state";
import { RvcOperationalStateServer } from "@matter/main/behaviors/rvc-operational-state";
import { RvcRunModeServer } from "@matter/main/behaviors/rvc-run-mode";
import { ValveConfigurationAndControlServer } from "@matter/main/behaviors/valve-configuration-and-control";
import { DoorLock } from "@matter/main/clusters/door-lock";
import { KeypadInput } from "@matter/main/clusters/keypad-input";
import { MediaPlayback } from "@matter/main/clusters/media-playback";
import { MicrowaveOvenControl } from "@matter/main/clusters/microwave-oven-control";
import { ModeBase } from "@matter/main/clusters/mode-base";
import { OperationalState } from "@matter/main/clusters/operational-state";
import { RvcOperationalState } from "@matter/main/clusters/rvc-operational-state";
import { ValveConfigurationAndControl } from "@matter/main/clusters/valve-configuration-and-control";
import { MATTER_ENUMS } from "../mapping.js";

const OpState = OperationalState.OperationalStateEnum;
const OpError = OperationalState.ErrorState;

function opResult(errorStateId: number = OpError.NoError) {
  return { commandResponseState: { errorStateId } };
}

/** 식기세척기·세탁기·건조기·전자레인지: Start/Stop/Pause/Resume을 바로 반영한다. */
export class TwinOperationalStateServer extends OperationalStateServer {
  override start() {
    if (this.state.operationalState === OpState.Error) return opResult(OpError.UnableToStartOrResume);
    this.state.operationalState = OpState.Running;
    return opResult();
  }

  override stop() {
    this.state.operationalState = OpState.Stopped;
    return opResult();
  }

  override pause() {
    const s = this.state.operationalState;
    if (s !== OpState.Running && s !== OpState.Paused) return opResult(OpError.CommandInvalidInState);
    this.state.operationalState = OpState.Paused;
    return opResult();
  }

  override resume() {
    const s = this.state.operationalState;
    if (s !== OpState.Paused && s !== OpState.Running) return opResult(OpError.CommandInvalidInState);
    this.state.operationalState = OpState.Running;
    return opResult();
  }
}

const Rvc = RvcOperationalState.OperationalState;
const RUN = MATTER_ENUMS.rvcRunMode;

/** 로봇청소기 동작 상태: Pause/Resume/GoHome(바로 도킹). */
export class TwinRvcOperationalStateServer extends RvcOperationalStateServer {
  override pause() {
    const s = this.state.operationalState;
    if (s !== Rvc.Running && s !== Rvc.Paused) return opResult(OpError.CommandInvalidInState);
    this.state.operationalState = Rvc.Paused;
    return opResult();
  }

  override resume() {
    const s = this.state.operationalState;
    if (s !== Rvc.Paused && s !== Rvc.Running) return opResult(OpError.CommandInvalidInState);
    this.state.operationalState = Rvc.Running;
    this.agent.get(RvcRunModeServer).state.currentMode = RUN.cleaning;
    return opResult();
  }

  override goHome() {
    this.state.operationalState = Rvc.Docked;
    this.agent.get(RvcRunModeServer).state.currentMode = RUN.idle;
    return opResult();
  }
}

/** 로봇청소기 실행 모드: 청소 모드가 되면 Running, 대기 모드가 되면 Stopped(도킹은 GoHome). */
export class TwinRvcRunModeServer extends RvcRunModeServer {
  override async changeToMode(request: ModeBase.ChangeToModeRequest): Promise<ModeBase.ChangeToModeResponse> {
    const result = await super.changeToMode(request);
    if (result.status !== ModeBase.ModeChangeStatus.Success) return result;
    const ops = this.agent.get(RvcOperationalStateServer);
    if (request.newMode === RUN.cleaning) {
      ops.state.operationalState = Rvc.Running;
    } else if (ops.state.operationalState === Rvc.Running || ops.state.operationalState === Rvc.Paused) {
      ops.state.operationalState = Rvc.Stopped;
    }
    return result;
  }
}

const Valve = ValveConfigurationAndControl.ValveState;

/** 수전: Open/Close를 바로 반영한다. */
export class TwinValveServer extends ValveConfigurationAndControlServer {
  override open() {
    this.state.targetState = Valve.Open;
    this.state.currentState = Valve.Open;
  }

  override close() {
    this.state.targetState = Valve.Closed;
    this.state.currentState = Valve.Closed;
  }
}

/** TV(Basic Video Player)의 필수 클러스터 MediaPlayback: 재생 상태만 바꾼다. */
export class TwinMediaPlaybackServer extends MediaPlaybackServer {
  override play() {
    this.state.currentState = MediaPlayback.PlaybackState.Playing;
    return { status: MediaPlayback.Status.Success };
  }

  override pause() {
    this.state.currentState = MediaPlayback.PlaybackState.Paused;
    return { status: MediaPlayback.Status.Success };
  }

  override stop() {
    this.state.currentState = MediaPlayback.PlaybackState.NotPlaying;
    return { status: MediaPlayback.Status.Success };
  }
}

/** TV의 필수 클러스터 KeypadInput: 키 입력을 받기만 한다. */
export class TwinKeypadInputServer extends KeypadInputServer {
  override sendKey() {
    return { status: KeypadInput.Status.Success };
  }
}

/** 전자레인지 조리 설정: 시간·출력만 저장하고 startAfterSetting이면 시작한다. */
export class TwinMicrowaveOvenControlServer extends MicrowaveOvenControlServer.with("PowerAsNumber") {
  override setCookingParameters(request: MicrowaveOvenControl.SetCookingParametersRequest) {
    if (request.cookTime !== undefined) this.state.cookTime = request.cookTime;
    if (request.powerSetting !== undefined) this.state.powerSetting = request.powerSetting;
    if (request.startAfterSetting) this.agent.get(OperationalStateServer).state.operationalState = OpState.Running;
  }
}

/**
 * 도어록: PIN 기능을 켜지 않으므로 원격 잠금/해제에 PIN이 필요 없다.
 * matter.js 기본 구현은 이벤트에 패브릭 번호를 넣느라 패브릭 없는 로컬 호출(local 전송)을 거부하므로,
 * 그때만 상태를 직접 바꾼다. 네트워크(패브릭 있음) 호출은 기본 구현 그대로다.
 */
export class TwinDoorLockServer extends DoorLockServer {
  override lockDoor(request: DoorLock.LockDoorRequest) {
    if (this.context.fabric === undefined) {
      this.state.lockState = DoorLock.LockState.Locked;
      return;
    }
    return super.lockDoor(request);
  }

  override unlockDoor(request: DoorLock.UnlockDoorRequest) {
    if (this.context.fabric === undefined) {
      this.state.lockState = DoorLock.LockState.Unlocked;
      return;
    }
    return super.unlockDoor(request);
  }
}
