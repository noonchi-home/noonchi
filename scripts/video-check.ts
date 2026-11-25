// npx tsx scripts/video-check.ts --clip cup-demo.mp4 [--step <종류>:<낱말>:<영상.mp4> ...] [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200]
//   [--done-after 3] [--out runtime/videos/cup-demo.<시각>.timeline.md] [--expect-after 36.3] [--record <폴더>] [--record-view <top|minimap>] [--record-fps 10] [--fake]
//   [--say <초>:<글> ...] [--start-at <cup|tv|microwave|kitchen>] [--home mokryeon_180b] [--tail 30] [--max 1800] [--approve <초>] [--done-on <초>:<명령 글> ...]
//   [--fov <도>] [--pitch <도>] [--h <m>] [--rate 1] [--scenario scenario1 --left [<영상.mp4>:]<초>]
// --left: 시나리오 1에서 시청자가 실제로 떠난 때(필수). 그 영상(없으면 --clip 첫 영상) 안의 초다. 폰 페이지가 그 영상을 튼 영상 시각에 더해
//   서버 시각으로 옮기고, TV 끄기 5초를 그때부터 잰다(scripts/scenario1-judge.ts left, leftServerAt).
// --rate: 영상 빠르기(0.25~2, 기본 1). 1이 아니면 폰 주소에 rate=로 붙고 폰 페이지가 첫 영상·단계 영상을 그 빠르기로 튼다(영상 시각은 원본 시각 그대로).
//   서버 시각 ↔ 영상 시각 옮기기(videoClock·serverClock)는 짝 밖을 그 빠르기로 세고, 지금 영상이 너무 오래 도는지는 영상 길이 ÷ 빠르기로 본다.
//   판정 줄 아래 반응 줄(reactionLine): 사람이 떠난 때(기록의 사람 사라짐) → 그 뒤 첫 명령을 서버 시각으로 세어 빠르기와 상관없이 같은 초다.
// --fov·--pitch·--h: 영상 모드 카메라(세로 시야각 20~120, 숙인 각 -89~89, 높이 0.2~3). 준 것만 폰 주소에 fov=·pitch=·h=로 붙고, 없으면 폰 페이지 기본값(가로 영상 40°, -10°, 1.15m, video-ar.js CAMERA).
// --say: 영상 시각(서버 시계를 폰 페이지 짝으로 옮긴 값)이 그 초가 되면 폰 페이지 안의 폰 소켓(/phone/events)으로 {type: "say", text, at}를 보낸다
// (CDP로 그 소켓을 찾아 보냄). 시각표에 「말」 줄: 보낸 서버 시각을 두었다가 끝에서 같은 짝으로 옮긴다.
//   at은 폰 페이지가 화면이 바뀔 때마다 실제 폰 말과 같은 heardAtOf로 남긴 기록(__noonchiVideo.at) 그대로다(없으면 none).
// --start-at: 폰 페이지를 열기 전에 그 장면 시작 위치(scripts/demo-start.ts)를 서버에 넣는다. 서버의 지금 집이 --home이 아니면 판정을 시작하지 않는다.
// --approve: 단계 id가 :approve·:hand로 끝나는 질문에만 그 초 뒤 「승인」, --done-on: 위 줄이 그 글과 같은 명령에만 그 초 뒤 「완료」를 누른다.
// --answer <초>:<답 단추 글>(여러 번): 위 줄이 「?」로 끝나는 질문(승인·켜기 질문 빼고, 남은 음료 질문 등)에 그 초 뒤 그 글 답 단추를 누른다(없으면 누르지 않는다).
//   누를 때 지금 명령의 계획 id·단계 id·위 줄이 예약한 것과 모두 같을 때만 누른다. 누른 것은 시각표에 「누름」 줄.
// 끝내기(judgeState): 계획이 닫혔고 누를 답이 없고 끄기 추적(hot·끄기 안내, GET /api/plan의 같은 답)이 남지 않으면 끝, 영상이 멈춘(첫 영상 끝·단계 영상 마지막 장면 붙잡기) 뒤 --tail초,
// 지금 영상 길이 + 60초, 판 전체 --max초. 끄기 안내가 남은 채 끝나면 「끝까지 돌지 않음」에 남긴다.
// 계획이 끝남(done)이면 폰 명령 줄의 완료 문장(done:<계획 id>, src/act/done-step.ts)이 보인 뒤 DONE_TAIL_MS(2초)까지 더 보고 끝낸다(8초 안에 안 오면 그냥 끝).
// 미니맵 판 기록(run.json)에 그 완료 문장 영상 시각(doneMs)과 빠르기(rate)를 남긴다: scripts/minimap-cut.ts가 마지막 조각 끝에서 완료 문장 + 2초까지 남긴다.
// 영상 모드 판정: 헤드리스 크롬 하나(가로 폰 844×390)로 폰 페이지 <phone>/phone/?clip=<clip>을 열고 「카메라 켜기」를 눌러 영상을 끝까지 튼다.
// 영상은 가로만 튼다: 폰 페이지가 세로 영상(높이 > 폭)을 열지 않고 「가로로 찍은 영상을 골라 주세요.」를 띄우면 기다리지 않고 오류로 끝낸다(landscapeRefusal).
// 폰 페이지 자기 자원(<phone>/assets/…)을 못 받았으면 「카메라 켜기」 전에 페이지를 한 번 다시 읽고 판정 줄 위에 적는다(이 PC는 127.0.0.1 연결이 가끔 실패한다).
// --step(여러 번, 종류 go·pick·place·do, 낱말 a-z·_)은 폰 주소에 step=으로 하나씩 붙는다. 폰 페이지는 종류가 같고 대상 id에 낱말이 든 명령이 오면
// 그 단계 영상으로 바꿔 튼다(영상 시각은 이어 셈). --step·--approve·--done-on이 있으면 --done-after 기본은 0이다(고른 명령 밖에는 단추를 누르지 않고 비전·폰 위치로 단계가 넘어가는지 본다).
// 판마다 서버를 새로 띄운다. 앞 판 계획이 끝나지 않았거나 엔진 프레임을 이미 받은 서버(World State가 남음)면 크롬을 띄우기 전에 멈춘다.
// 1초마다 window.__noonchiVideo(t0·받은 명령·바꾼 단계 영상의 영상 시각·끝)와 GET /api/world(눈 자리·컵)를 읽는다(World State를 못 받으면 넘어감).
// 새 명령이 오면 --done-after초 뒤 엄지 자리 첫 답 단추(승인·완료)를 누른다(0이면 안 누름). 끄기 안내(off:)와 계획이 끝난 뒤 충전 자리 명령(dock:)은 누르지 않는다:
// 충전 자리 명령은 단계 영상이 없어도 폰 페이지가 그쪽으로 걷기만 하고, 판정은 계획이 끝나면 끝난다.
// 영상이 끝나도 계획이 열려 있으면 최대 30초 더 보고, 남은 답과 그 뒤 온 명령을 누른다. 단계 영상이 새로 시작되면 끝 시각을 지우고 다시 끝날 때까지 본다.
// t0는 폰 페이지가 서버 시계로 고친 마지막 값을 쓴다. 서버 기록·트윈 줄·누름은 폰 페이지가 남긴 [서버 시각, 영상 시각] 짝(__noonchiVideo.sync)으로
// 영상 시각에 옮긴다(videoClock): 영상이 멈칫하면 영상 시각이 서버 시계보다 늦게 가 t0 하나로는 폰 명령과 어긋난다. 짝이 없는 옛 기록은 t0를 뺀다.
// 트윈 컵 줄은 면 이름, 면이 없으면 장면(GET /api/scene)의 방 이름을 쓴다.
// 끝나면 서버 기록(GET /api/history: 사람·물건 등장·사라짐, PAM 판단, 계획·단계, 실행, 관찰 모드가 고른 것(가까이 보기), 미리 세운 목표(목표 줄)), 폰 명령, 바꾼 단계 영상(영상 줄), 트윈 줄(눈 방이 바뀌거나
// 마지막 눈 줄에서 0.5m 넘게 옮김, 컵 상태·놓인 곳·면·방이 바뀜)을 영상 시각(at_ms − t0)순 표 하나로 합쳐 찍고 --out에 markdown으로 쓴다.
// 같은 출처의 같은 글이 이어지면 한 줄로 묶고 번 수를 붙인다. 표 밑에 판정 줄(첫 명령 시각, --expect-after초 전 명령, 첫 명령의 계획이 끝났는지),
// --step이 있으면 단계 판정 줄(첫 명령 계획의 끝난 단계 수, 누른 단추 수, 마지막 트윈 눈 방·컵 놓인 곳), 이번 판 비용 줄(GET /api/brain: VLM, 가까이 보기 횟수·모델,
// 관찰 모드 호출과 비용(가격표에 없는 모델이면 비용 모름), PAM·계획 비용 빠짐).
// 끝까지 돌지 않았으면(시간 넘김·중단) 판정 줄 위에 적고 끝 코드 1.
// --step이 있으면 단계 자리 판정(stepPlaces: --step 자리와 실제 명령 대상, 끝에 치운 컵이 싱크대 안)을 시각표 위에 적고, 틀리면 끝 코드 1.
// 끝에 같은 크롬 새 탭(1280×800)으로 대시보드 <api>/를 열어 8초 뒤 사진을 runtime/videos/<영상>.<시각 또는 fake>.twin.png에 남기고 markdown에 넣는다.
// 사진을 못 남기면 판정 줄 위에 적기만 한다.
// --record <폴더>: 폰 페이지를 연 뒤 같은 크롬 새 창(1280×800)으로 대시보드를 판정 내내 띄우고, 트윈이 다 뜬 뒤(waitTwinReady) 대시보드 한 화면
// (--record-phone이면 폰 탭도)을 CDP screencast로 초당 약 10장 받아 끝(30초 더 보기 포함)까지 녹화한다(scripts/video-record.ts). 「카메라 켜기」는 그 뒤에 누른다.
// 녹화하는 동안 대시보드 그림 간격을 재 적는다. 끝 사진은 그 창으로 바로 찍는다. 크롬을 끈 뒤 ffmpeg로 대시보드(폰도 받았으면 나란히) mp4 하나
// (H.264, yuv420p, 10fps, 실제 시간 길이)를 <폴더>/<시각표 이름 줄기>.demo.mp4로 만든다. --chrome은 크롬 그리기 방식(기본 headless-gpu)이다.
// ffmpeg가 없거나 실패하면 <폴더>/<줄기>.frames 프레임 폴더를 남기고 판정 줄 위에 적는다.
// --record-view minimap: 녹화 대시보드를 <api>/?view=minimap(비전 미니맵만, 3D 트윈 없음)으로 1280×720 창에 열고 mp4도 1280×720이다. 기본 top(대시보드 전체). 끝 사진도 그 창이다.
// --record-fps: 녹화 초당 장 수(1~30, 기본 10). ack 간격(1000/fps)과 mp4 fps가 그 값이다.
// minimap 보기는 mp4를 만든 뒤에도 <줄기>.frames 장면 폴더를 두고 판 기록 run.json(녹화 시작 시각·장면·폰 페이지 짝·단계 영상·첫 영상 길이)을 남긴다.
// 미니맵은 장면을 마스크 지연만큼 늦게 보이므로(ui/src/dashboard/scene-sync.ts) 보인 장면의 촬영 시각 기록(scenes)도 남기고, 완료 문장 2초는 미니맵에 보인 때부터 센다.
// scripts/minimap-cut.ts가 그것으로 붙잡기를 뺀 이은 영상(<줄기>.minimap.mp4)을 만든다.
// 영상은 소리 없이 「카메라 켜기」 누름에서 튼다. launchChrome은 자동 재생 플래그를 받지 않지만 소리 없는 재생은 크롬 기본값으로 된다.
// 오늘 기억: 영상을 틀기 전에 GET /api/memory/day/<오늘>의 uses.memory를 본다(memoryGate). 마시는 중에서 떠나는 배운 컵 치우기 화살표가 없으면(seed·옛 모양)
// 크롬을 띄우지 않고 끝 코드 1과 판정 줄(서버를 끄고 demo-setup learned로 넣으라는 글). 있으면 시각표 머리에 「기억 <v>판 · <source>」 한 줄.
// --fake: 실제 모델 없이 같은 프로세스에서 스스로 시험한다. 본 서버(HUB=memory, 한양목련, 새 RUNTIME_DIR, 영상·단계 영상은 공용 runtime/videos에서 바로 읽음, BRAIN=1, PAM 1초마다)와
// 가짜 OpenAI(VLM: 컵 식탁 위, 계획: 컵 치우기 네 단계), 가짜 PAM(컵이 있고 사람이 안 보이면 컵 치우기), 대본 YOLO(첫 프레임부터 30초 사람+컵, 그 뒤 컵만)를 띄운다.
// 식탁 1.5m 앞 시작 자리와 컵 치우기 승인, 임시 runtime의 배운 뒤 기억(scripts/learned-memory.ts saveLearned, 오늘 판본)을 미리 둔다. 기본 --expect-after는 대본 사람 시간(30초), 기본 --out은 <clip>.fake.timeline.md다.
// 사람 사라짐, PAM 컵 치우기, 사람 사라짐 뒤 첫 명령, 네 단계 끝, 계획 끝, 영상 끝, 트윈 눈·컵 줄 중 하나라도 없으면 끝 코드 1. ui/dist 빌드가 있어야 한다.
// 스스로 시험은 계획이 닫혀도 첫 영상이 멈출(끝·붙잡기) 때까지 본다(영상 끝 줄을 보려고). 기본 --expect-after는 대본 사람 시간(서버 시계)을 영상 시각으로 옮긴 값이다.
// 잠금: npm run heavy -- 로 부르면 그 잠금(TWIN3D_HEAVY_PID) 안에서 돌고 크롬 pid를 그 잠금에 더한다. 혼자 부르면 withHeavy로 잡는다.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Detection } from "../src/contract/observe.js";
import { LiveScenario, SCENARIO_KINDS } from "./scenario1-live.js";
import type { StationMap } from "../src/contract/stations.js";
import type { HistoryRow } from "../src/contract/history.js";
import type { WorldObject, WorldView } from "../src/contract/world.js";
import { EXEC_TEXT } from "../src/act/labels.js";
import { ANY_STATE, isOldFsm } from "../src/brain/decision.js";
import { HistoryDb, historyTzMinutes } from "../src/brain/history/db.js";
import { saveLearned } from "./learned-memory.js";
import { CLASSES, STATES } from "../src/world/vocab.js";
import { KINDS, type DeviceKind } from "../src/devices/kinds.js";
import { withTimeout } from "./twin3d/capture-lib.js";
import { CHROME_GPU, chromePath, closeChrome, devtoolsPort, launchChrome, openPage, openTab, openWindow, type Chrome, type ChromeGpu, type Page } from "./twin3d/cdp.js";
import { heldLock, withHeavy, type Lock } from "./twin3d/heavy.js";
import { CUT_RUN_FILE, demoFile, encodeDemo, RECORD_FPS, startRecording, type CutRun, type Recorded, type Recording } from "./video-record.js";
import { det } from "../tests/helpers/detectors.js";
import type { SceneJson } from "../src/contract/layout.js";
import type { OffTrack } from "../src/contract/plan.js";
import { isDockStep } from "../src/act/dock-step.js";
import { isDoneStep } from "../src/act/done-step.js";
import { isOffStep } from "../src/act/off-step.js";
import { resolveTwinStudioDir } from "../src/layout/twin-files.js";
import { resolveHome } from "../src/layout/homes.js";
import { loadScene } from "../src/layout/scene.js";
import { DEMO_STARTS, startFor, type DemoScene } from "./demo-start.js";
import { LANDSCAPE_ONLY } from "../ui/src/phone/core/video-ar.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIP_NAME = /^[A-Za-z0-9_-]{1,64}\.(?:mp4|webm)$/;
/** --step 값: 종류:대상 낱말:단계 영상 */
const STEP_ARG = /^(?:go|pick|place|do):[a-z_]+:[A-Za-z0-9_-]{1,64}\.(?:mp4|webm)$/;
/** 폰 탭 크기: 가로로 든 폰(가로 영상이 화면을 채운다). */
const SIZE: [number, number] = [844, 390];
/** 대시보드 사진 탭 크기와 열고 기다리는 시간 */
const DASH_SIZE: [number, number] = [1280, 800];
/** 비전 미니맵만 보기(?view=minimap) 창 크기: 16:9 미니맵 칸이 창을 채운다. */
const MINIMAP_SIZE: [number, number] = [1280, 720];
const DASH_WAIT_MS = 8_000;
/** 마지막 눈 줄에서 이만큼(m) 옮기면 눈 줄을 다시 쓴다 */
const EYE_MOVE_M = 0.5;
/** 시각표(timeline)가 줄로 만드는 서버 기록 종류. GET /api/history의 kinds로 가져온다. */
export const FETCH_KINDS: readonly string[] = ["detection", "decision", "plan", "execution", "look", "goal", "planner", "person", "robot", "safety", "manager"];
/** 영상이 끝난 뒤 남은 답 누르기·계획 끝을 더 기다리는 시간 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 표

export type Kind = "사람" | "로봇" | "안전" | "관리" | "사람 등장" | "사람 사라짐" | "물건 등장" | "물건 사라짐" | "PAM 판단" | "목표" | "계획" | "단계" | "명령" | "영상" | "트윈" | "가까이 보기" | "계획 모드" | "말" | "누름" | "끝";
/** 표 한 줄. ms는 영상 시각, n은 묶은 줄 수. */
export interface Row { ms: number; kind: Kind; text: string; n: number }
/** 폰 페이지가 남긴 명령(window.__noonchiVideo.commands). */
/** 폰 페이지가 받은 명령 기록. kind·target은 명령의 단계 종류와 대상(단계 자리 판정 stepPlaces). 옛 기록에는 없다. */
export interface VideoCommand { video_ms: number; id: string; step: string; text: string; kind?: string; target?: { id: string; label: string } | null }
/** 폰 페이지가 바꿔 튼 단계 영상(window.__noonchiVideo.clips): 바꾼 영상 시각과 이름, 그 영상 길이(있으면). */
export interface VideoClip { video_ms: number; clip: string; duration_ms?: number }

const DETECTION_KIND: Record<string, Kind> = { person_appeared: "사람 등장", person_gone: "사람 사라짐", appeared: "물건 등장", gone: "물건 사라짐" };
const STEP_TEXT: Record<string, string> = { active: "시작", done: "끝남", failed: "실패", skipped: "건너뜀" };
const PLAN_END = new Set(["done", "cancelled", "failed"]);
const EXEC_END = new Set(["done", "failed"]);
// 실행 줄 중 상태 이름뿐인 글은 PAM 판단·계획 줄과 같아 뺀다. 남는 것은 까닭(같은 행동을 진행 중·새 판단으로 바뀜·계획을 만들 수 없음…)이다
const EXEC_PLAIN = new Set<string>([EXEC_TEXT.decided, EXEC_TEXT.planned, EXEC_TEXT.running, EXEC_TEXT.verifying, EXEC_TEXT.done, EXEC_TEXT.wait, EXEC_TEXT.decisionFailed]);
type PlanData = { status?: string; steps?: { id: string; label: string; status: string; kind?: string }[] };

/** 서버 기록·폰 명령·바꾼 단계 영상·트윈 줄(영상 시각으로 고친 것) → 영상 시각순 표. 같은 출처(기록 종류·명령·트윈)의 같은 글이 이어지면 한 줄로 묶는다.
 *  endMs가 있으면 「영상 끝」. */
/** 판정 루프를 바로 멈춰야 하는가: sync_full 짝 넘침(그 뒤 영상 시각을 믿을 수 없어 말·누름을 더 보내지 않는다). */
export function mustStop(record: { syncFull?: boolean } | null): "sync_full" | null {
  return record?.syncFull ? "sync_full" : null;
}

/** 짝 넘침(폰 페이지가 짝 상한에 닿아 더 쌓지 않음)이면 시각표 위에 적을 글. 그 뒤 서버 사건의 영상 시각이 틀릴 수 있어 시각표·판정을 만들지 않고 실패로 한다. */
export function syncWarning(record: { syncFull?: boolean } | null): string | null {
  return record?.syncFull ? "짝 넘침: 폰 페이지의 [서버 시각, 영상 시각] 짝이 상한에 닿아 더 쌓지 않았어요. 그 뒤 서버 사건의 영상 시각이 틀릴 수 있어 판정을 실패로 해요." : null;
}

/** 서버 시각 → 영상 시각. sync는 폰 페이지가 남긴 [서버 시각, 영상 시각] 짝(시각순): 짝 사이는 잇고(멈칫한 구간은 그 두 프레임 사이에 몰린다),
 *  첫 짝 앞과 마지막 짝 뒤는 1:1로 센다. 짝이 없으면(옛 기록) at − t0. */
export function videoClock(t0: number, sync: readonly (readonly [number, number])[], rate = 1): (atMs: number) => number {
  if (!sync.length) return (at) => (at - t0) * rate;
  return (at) => {
    const [a0, v0] = sync[0]!;
    if (at <= a0) return v0 - (a0 - at) * rate;
    for (let i = 1; i < sync.length; i++) {
      const [a1, v1] = sync[i]!;
      if (at > a1) continue;
      const [a, v] = sync[i - 1]!;
      return a1 === a ? v1 : v + ((at - a) * (v1 - v)) / (a1 - a);
    }
    const [an, vn] = sync.at(-1)!;
    return vn + (at - an) * rate;
  };
}

/** 시나리오 1에서 시청자가 떠난 때: 영상 이름과 그 영상 안의 ms. */
export interface LeftAt { clip: string; ms: number }

/** 떠난 때 → 서버 시각. 첫 영상(--clip)은 영상 시각 0에서, 단계 영상은 폰 페이지가 그 영상을 튼 영상 시각(clips의 첫 기록)에서 시작한다.
 *  아직 틀지 않은 영상이거나, 영상 길이(단계 영상은 clips의 duration_ms, 첫 영상은 firstDurationMs)를 모르거나 넘으면 null:
 *  넘은 시각은 붙잡은 끝 장면이나 다음 영상 시각이 된다. 영상 시각과 sync는 같은 폰 페이지 시계라 끝 장면을 붙잡은 시간이 섞여도 어긋나지 않는다. */
export function leftServerAt(left: LeftAt, firstClip: string, record: { t0: number; sync: readonly (readonly [number, number])[]; clips: readonly VideoClip[] }, rate = 1, firstDurationMs?: number | null): number | null {
  const clip = left.clip === firstClip ? { video_ms: 0, duration_ms: firstDurationMs ?? undefined } : record.clips.find((c) => c.clip === left.clip);
  if (!clip || clip.duration_ms == null || left.ms > clip.duration_ms) return null;
  return serverClock(record.t0, record.sync, rate)(clip.video_ms + left.ms);
}

/** 중간 판정에서 더 볼 것 없이 실패로 끝난 결과인가: 늦은 끄기·다른 기기·다른 컵·직접 끈 TV 켜기, 그리고 대기 자리에 도착한 뒤의
 *  대기 전 끔→켬 실패(early_tv, 그 묶음은 더 채워지지 않는다), 기록 DB에서 빠진 집 사진(photo_gap, 다시 받을 수 없다). 아직 오지 않은 단계(missing)와 기록이 늦게 닿아 잠깐 생길 수 있는
 *  순서 어긋남(unexpected·unconfirmed)은 계속 본다. */
export function scenarioSettled(r: { passed: boolean; firstMismatch: string | null; events?: readonly { kind: string }[] }): boolean {
  const m = r.firstMismatch ?? "";
  return !r.passed && (/^(late:|wrong_|manual_off_then_on$|photo_gap$)/.test(m) || (m.startsWith("early_tv:") && !!r.events?.some((e) => e.kind === "standby")));
}

/** 영상 시각 → 서버 시각(videoClock을 거꾸로): 짝 사이는 잇고, 멈춘 구간(영상 시각이 그대로)이면 그 영상 시각에 처음 닿은 서버 시각, 짝 밖은 빠르기(rate)로 센다. */
export function serverClock(t0: number, sync: readonly (readonly [number, number])[], rate = 1): (videoMs: number) => number {
  if (!sync.length) return (v) => t0 + v / rate;
  return (v) => {
    const [a0, v0] = sync[0]!;
    if (v <= v0) return a0 - (v0 - v) / rate;
    for (let i = 1; i < sync.length; i++) {
      const [a1, v1] = sync[i]!;
      if (v > v1) continue;
      const [a, w] = sync[i - 1]!;
      return v1 === w ? a : a + ((v - w) * (a1 - a)) / (v1 - w);
    }
    const [an, vn] = sync.at(-1)!;
    return an + (v - vn) / rate;
  };
}

/** 반응 줄: 사람이 떠난 때(기록의 「사람 사라짐」 detection person_gone, 서버 시각) 뒤 첫 명령까지를 서버 시각으로 센 초(빠르기를 바꿔 튼 판도 같은 초다).
 *  첫 사람 사라짐 뒤 처음 나간 명령을 보고, 그 명령 바로 앞에 떠난 때부터 잰다. 사람 사라짐이 없거나 그 뒤 명령이 없으면 null. */
export function reactionLine(history: readonly HistoryRow[], commands: readonly VideoCommand[], t0: number, sync: readonly (readonly [number, number])[], rate = 1): string | null {
  const gones = history.filter((h) => h.kind === "detection" && (h.data as { kind?: string } | null)?.kind === "person_gone").map((h) => h.at_ms).sort((a, b) => a - b);
  if (!gones.length) return null;
  const toServer = serverClock(t0, sync, rate);
  const first = commands.map((c) => toServer(c.video_ms)).find((at) => at >= gones[0]!);
  if (first === undefined) return null;
  const left = gones.filter((g) => g <= first).at(-1)!;
  return `반응: ${clock(videoClock(t0, sync, rate)(left))}에 사람이 떠난 뒤 첫 명령까지 서버 시각 ${((first - left) / 1000).toFixed(1)}초`;
}

/** 판 끝 시각표: 서버 시각으로 둔 것(기록·트윈 줄 ms·말 at·누름 at)을 폰 페이지 짝(sync)으로 영상 시각에 옮겨 폰 명령·바꾼 영상(영상 시각)과 합친다. */
export function runTimeline(o: {
  t0: number; sync: readonly (readonly [number, number])[]; history: HistoryRow[]; commands: VideoCommand[]; endMs: number | null; clips: VideoClip[];
  twin: Row[]; says: { at: number; text: string }[]; clicks: { at: number; label: string; text: string }[]; rate?: number;
}): Row[] {
  const toVideo = videoClock(o.t0, o.sync, o.rate);
  return timeline(toVideo, o.history, o.commands, o.endMs, {
    clips: o.clips, twin: o.twin.map((r) => ({ ...r, ms: toVideo(r.ms) })),
    says: o.says.map((s) => ({ atMs: toVideo(s.at), text: s.text })), clicks: o.clicks.map((c) => ({ ms: toVideo(c.at), label: c.label, text: c.text })),
  });
}

/** 영상 끝(영상 시각): 붙잡는 중이면 붙잡기를 시작한 영상 시각(첫 영상·단계 영상 모두), 첫 영상이 끝났는데 아직 붙잡기 전이면 지금 영상 시작 + 길이,
 *  기록이 없으면 영상 끝 여부로 같은 셈. 도는 중이면 null. */
export function clipEnd(seen: { record: Seen["record"]; time: number | null; duration: number | null; ended: boolean }, clipStartMs: number, duration: number | null): number | null {
  if (seen.record?.hold) return seen.record.hold.since;
  const ended = seen.record ? seen.record.ended : seen.ended;
  return ended ? clipStartMs + (duration ?? seen.time ?? 0) * 1000 : null;
}

export function timeline(t0: number | ((atMs: number) => number), history: HistoryRow[], commands: VideoCommand[], endMs: number | null = null,
  more: { clips?: VideoClip[]; twin?: Row[]; says?: { atMs: number; text: string }[]; clicks?: { ms: number; label: string; text: string }[] } = {}): Row[] {
  const raw: (Row & { from: string })[] = [];
  const plans = new Map<string, { status: string; steps: Map<string, string> }>();
  for (const h of [...history].sort((a, b) => a.at_ms - b.at_ms || a.id - b.id)) {
    const ms = typeof t0 === "number" ? h.at_ms - t0 : t0(h.at_ms);
    if (h.kind === "detection") {
      const kind = DETECTION_KIND[(h.data as { kind?: string } | null)?.kind ?? ""];
      if (kind) raw.push({ ms, kind, text: h.text, n: 1, from: "detection" });
    } else if (h.kind === "decision") {
      raw.push({ ms, kind: "PAM 판단", text: h.text, n: 1, from: "decision" });
    } else if (h.kind === "look") {
      raw.push({ ms, kind: "가까이 보기", text: h.text, n: 1, from: "look" });
    } else if (h.kind === "goal") {
      // 미리 세운 목표의 전환(세움·계획 준비됨·사람 떠남·씀·버림, 서버 goalRecorder)
      raw.push({ ms, kind: "목표", text: h.text, n: 1, from: `goal:${h.subject ?? ""}` });
    } else if (h.kind === "person" || h.kind === "robot" || h.kind === "safety" || h.kind === "manager") {
      const names = { person: "사람", robot: "로봇", safety: "안전", manager: "관리" } as const;
      raw.push({ ms, kind: names[h.kind], text: h.text, n: 1, from: h.kind });
    } else if (h.kind === "planner") {
      raw.push({ ms, kind: "계획 모드", text: h.text, n: 1, from: "planner" });
    } else if (h.kind === "execution") {
      const state = (h.data as { state?: string } | null)?.state ?? "";
      if (!EXEC_PLAIN.has(h.text)) raw.push({ ms, kind: EXEC_END.has(state) ? "끝" : "계획", text: h.text, n: 1, from: "execution" });
    } else if (h.kind === "plan") {
      // 계획 줄은 바뀐 것만: 처음·계획 상태가 바뀜 → 계획(끝난 상태면 끝, 단계 줄 뒤), 단계 상태가 바뀜 → 단계
      const d = (h.data ?? {}) as PlanData;
      const id = h.subject ?? "";
      const prev = plans.get(id);
      const now = { status: d.status ?? "", steps: new Map((d.steps ?? []).map((s) => [s.id, s.status])) };
      plans.set(id, now);
      const end = PLAN_END.has(now.status);
      const plan = !prev || prev.status !== now.status ? { ms, kind: end ? "끝" as const : "계획" as const, text: h.text, n: 1, from: `plan:${id}` } : null;
      if (plan && !end) raw.push(plan);
      for (const s of d.steps ?? []) {
        if ((prev?.steps.get(s.id) ?? "pending") === s.status || !STEP_TEXT[s.status]) continue;
        raw.push({ ms, kind: "단계", text: `${s.label} ${STEP_TEXT[s.status]}`, n: 1, from: `step:${id}:${s.id}` });
      }
      if (plan && end) raw.push(plan);
    }
  }
  for (const c of commands) raw.push({ ms: c.video_ms, kind: "명령", text: c.text, n: 1, from: "command" });
  for (const c of more.clips ?? []) raw.push({ ms: c.video_ms, kind: "영상", text: `단계 영상 ${c.clip.split("/").pop()}`, n: 1, from: "clip" });
  for (const r of more.twin ?? []) raw.push({ ms: r.ms, kind: r.kind, text: r.text, n: 1, from: "twin" });
  for (const x of more.says ?? []) raw.push({ ms: x.atMs, kind: "말", text: x.text, n: 1, from: "say" });
  for (const x of more.clicks ?? []) raw.push({ ms: x.ms, kind: "누름", text: `${x.label} · ${x.text}`, n: 1, from: "click" });
  if (endMs !== null) raw.push({ ms: endMs, kind: "끝", text: "영상 끝", n: 1, from: "video" });
  raw.sort((a, b) => a.ms - b.ms);
  const rows: Row[] = [];
  const last = new Map<string, Row>();
  for (const { from, ...r } of raw) {
    const prev = last.get(from);
    if (prev && prev.text === r.text && from !== "command") { prev.n += 1; continue; }
    rows.push(r);
    last.set(from, r);
  }
  return rows;
}

/** 영상 시각 mm:ss.s. 0.1초로 먼저 반올림해 59.96초가 01:00.0이 된다. */
export function clock(ms: number): string {
  const t = Math.round(Math.max(0, ms) / 100);
  return `${String(Math.floor(t / 600)).padStart(2, "0")}:${((t % 600) / 10).toFixed(1).padStart(4, "0")}`;
}
const rowText = (r: Row) => (r.n > 1 ? `${r.text} ×${r.n}` : r.text);

/** 트윈 줄을 가르는 앞 값: 마지막 눈 줄의 방·자리, 컵마다 마지막 줄의 상태·놓인 곳(place 사실)·면 이름·방. */
export interface TwinSeen {
  eye: { room: string | null; position: [number, number] } | null;
  cups: Record<string, CupSeen>;
}
interface CupSeen { status: WorldObject["status"]; place: string | null; surface_label: string | null; room: string | null }

const placeLabel = (v: string | null | undefined): string | null => (v ? ((STATES as Record<string, { label: string }>)[v]?.label ?? v) : null);
const cupSeen = (o: WorldObject): CupSeen => ({ status: o.status, place: o.facts.place?.value ?? null, surface_label: o.surface_label, room: o.room });
const CUP_STATUS: Record<WorldObject["status"], string> = { present: "", out_of_view: " · 시야 밖", gone: " · 사라짐" };

/** 장면(GET /api/scene 답)의 방 목록 → 방 id → 이름 표. 이름이 없는(빈) 방은 넣지 않는다(컵 줄은 「방 모름」). 장면을 모르면 빈 표. */
export function roomLabels(scene: { scene?: { plan?: { rooms?: { id: string; label?: string }[] } } } | null): Map<string, string> {
  return new Map((scene?.scene?.plan?.rooms ?? []).flatMap((r) => (r.label?.trim() ? [[r.id, r.label.trim()] as [string, string]] : [])));
}

/** 주소 → origin(기본 포트 빼고 소문자). 주소가 아니면 null. */
const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** 폰 페이지 자기 자원(base와 같은 origin의 /assets/…)을 받지 못한 오류의 자원 주소들(크롬 「Failed to load resource」 로그 줄).
 *  주소는 정규화한 origin으로 견준다: 기본 포트를 적은 --phone(https://…:443)·끝 슬래시·대소문자가 달라도 같은 곳이다. */
export function ownAssetFailures(errors: readonly string[], base: string): string[] {
  const home = originOf(base);
  if (!home) return [];
  return errors.flatMap((e) => {
    const m = /^log: Failed to load resource: .*?(\S+)\s*$/.exec(e);
    if (!m) return [];
    let u: URL;
    try {
      u = new URL(m[1]!);
    } catch {
      return [];
    }
    return u.origin === home && u.pathname.startsWith("/assets/") ? [m[1]!] : [];
  });
}

/** World State 하나 → 트윈 줄(ms = world.at_ms − t0). 눈: 처음, 방이 바뀜, 마지막 눈 줄에서 EYE_MOVE_M 넘게 옮김.
 *  컵(cls cup): 처음, 상태·놓인 곳·면 이름·방이 바뀜. 목록에서 빠진 컵은 앞 값을 남긴다. 면이 없으면 방 이름(rooms, roomLabels)을 쓰고 모르면 「방 모름」. */
export function twinRows(prev: TwinSeen | null, world: WorldView, t0: number, rooms: ReadonlyMap<string, string> = new Map()): { rows: Row[]; seen: TwinSeen } {
  const ms = world.at_ms - t0;
  const rows: Row[] = [];
  let eye = prev?.eye ?? null;
  const e = world.eye;
  if (e && (!eye || eye.room !== e.room || Math.hypot(e.position[0] - eye.position[0], e.position[1] - eye.position[1]) >= EYE_MOVE_M)) {
    rows.push({ ms, kind: "트윈", text: `눈 ${e.room_label ?? "방 모름"} (${e.position[0].toFixed(1)}, ${e.position[1].toFixed(1)})`, n: 1 });
    eye = { room: e.room, position: [e.position[0], e.position[1]] };
  }
  const cups = { ...prev?.cups };
  for (const o of world.objects) {
    if (o.cls !== "cup") continue;
    const now = cupSeen(o);
    const was = cups[o.id];
    if (was && was.status === now.status && was.place === now.place && was.surface_label === now.surface_label && was.room === now.room) continue;
    cups[o.id] = now;
    const where = now.surface_label ?? (now.room ? rooms.get(now.room) ?? "방 모름" : "자리 모름");
    rows.push({ ms, kind: "트윈", text: `컵 ${o.id} ${where} · ${placeLabel(now.place) ?? "놓인 곳 모름"}${CUP_STATUS[now.status]}`, n: 1 });
  }
  return { rows, seen: { eye, cups } };
}

const CUP_RANK: Record<WorldObject["status"], number> = { present: 0, out_of_view: 1, gone: 2 };

/** --step 판의 단계 판정 줄: 첫 명령 계획의 끝난 단계 수, 누른 단추 수, 마지막 World State의 눈 방과 컵(보이는 것 먼저, 그다음 마지막에 본 것) 놓인 곳. */
/** 판정 기준 계획(2026-11-18 wide-glass q2: 첫 명령이 찾기라 끝난 컵 치우기 계획을 「안 끝남 · 0/0개」로 봤다): 명령을 낸 계획(plan:) 가운데
 *  기록의 목표가 컵 치우기인 마지막 계획(wide-mug g1: 마지막으로 실행된 것), 없으면 마지막 계획. 찾기(find:)·충전 자리(dock:)·끄기 안내(off:)·
 *  계획 밖 가까이 보기(peek:)는 계획이 아니다. 계획 명령이 하나도 없으면 기록의 마지막 컵 치우기 계획(wide-glass c1: 명령 없이 실패한 계획), 그것도 없으면 null. */
export function mainPlan(commands: readonly VideoCommand[], history: readonly HistoryRow[]): string | null {
  const ids = [...new Set(commands.map((c) => c.id).filter((id) => id.startsWith("plan:")))];
  const cupPlan = (h: HistoryRow) => h.kind === "plan" && h.text.startsWith("컵 치우기");
  const cup = ids.filter((id) => history.some((h) => cupPlan(h) && h.subject === id));
  return cup.at(-1) ?? ids.at(-1) ?? [...history].sort((a, b) => a.at_ms - b.at_ms || a.id - b.id).filter(cupPlan).at(-1)?.subject ?? null;
}

/** 판정 기준 계획의 상태: 계획 줄이나 실행 줄 가운데 한 번이라도 끝남이면 done, 아니면 마지막 실패·취소, 그것도 없으면 마지막 상태. 계획이 없으면 null. */
export function planState(plan: string | null, history: readonly HistoryRow[]): string | null {
  if (!plan) return null;
  const states = [...history].sort((a, b) => a.at_ms - b.at_ms || a.id - b.id).filter((h) => h.subject === plan && (h.kind === "plan" || h.kind === "execution"))
    .map((h) => h.kind === "plan" ? (h.data as PlanData | null)?.status : (h.data as { state?: string } | null)?.state).filter((x): x is string => !!x);
  return states.includes("done") ? "done" : states.findLast((x) => x === "failed" || x === "cancelled") ?? states.at(-1) ?? "planned";
}

export function stepVerdict(history: HistoryRow[], commands: VideoCommand[], clicks: number, world: WorldView | null): string {
  // 명령을 낸 계획만(명령 없이 기록에만 있는 계획은 「명령 없음」)
  const first = commands.some((c) => c.id.startsWith("plan:")) ? mainPlan(commands, history) : null;
  const plan = first ? [...history].sort((a, b) => a.at_ms - b.at_ms || a.id - b.id).filter((h) => h.kind === "plan" && h.subject === first).at(-1) : undefined;
  const steps = (plan?.data as PlanData | null | undefined)?.steps ?? [];
  const stepText = first ? `${steps.filter((s) => s.status === "done").length}/${steps.length}개 끝남` : "명령 없음";
  const eye = world?.eye ? world.eye.room_label ?? "방 모름" : "모름";
  const cup = (world?.objects ?? []).filter((o) => o.cls === "cup").sort((a, b) => CUP_RANK[a.status] - CUP_RANK[b.status] || b.last_seen_ms - a.last_seen_ms)[0];
  return `단계: ${stepText} · 누른 단추 ${clicks}번 · 트윈 눈 ${eye} · 컵 ${cup ? `${cup.id} ${placeLabel(cup.facts.place?.value) ?? "놓인 곳 모름"}` : "없음"}`;
}

/** --step 낱말 → 단계 자리 이름(판정 줄): World 낱말 표(CLASSES, 그 종류이거나 「_<낱말>」로 끝나는 종류: table → 식탁)나 가전 종류 등록부(KINDS)의 이름. 없으면 낱말 그대로. */
/** 끝남이 아닌 판정 기준 계획 상태 → 판정 줄 낱말(그 밖의 상태는 「계획 안 끝남」). */
const PLAN_FAIL: Record<string, string> = { none: "계획 없음", failed: "계획 실패", cancelled: "계획 취소" };

function placeName(word: string): string {
  const cls = Object.entries(CLASSES).find(([k]) => k === word || k.endsWith(`_${word}`));
  return cls?.[1].label ?? (Object.hasOwn(KINDS, word) ? KINDS[word as DeviceKind].label : word);
}

/**
 * 단계 자리 판정(2026-11-18: tall q1에서 첫 명령이 「세탁기로 가 주세요」였는데 단계 영상이 차례로 돌아 「계획 끝남 · 4/4」로 거짓 통과했다).
 * 판정 기준 계획의 사람 단계(planSteps: 기록의 계획 단계 가운데 가기·손 단계, 없으면 그 계획의 명령)를 차례로 본다:
 *   그 단계 명령이 없으면 「단계 명령 없음: <단계 이름>」. 있으면 아직 안 쓴 --step(<종류>:<낱말>:<영상>) 가운데 같은 종류에서 대상 id에 낱말이 드는 것을 찾아 맞음으로 세고,
 *   같은 종류가 있는데 낱말이 맞는 것이 없으면 「단계 자리 틀림: 세탁기 ≠ 식탁」(첫 같은 종류 --step을 쓴다). 같은 종류 --step이 없으면 볼 수 없어 세지 않는다.
 *   계획에 없는 --step(찾기가 생길 때만 쓰는 go:cup 등)은 선택이라 세지 않는다(wide-tall q3 거짓 실패).
 * 계획 밖 명령(충전 자리 dock:·끄기 안내 off:·내용물 보기 peek:·찾기 find:와 계획 줄의 찾기 :find:)과 질문(:approve·:hand·:again)은 세지 않고, 단계마다 마지막 명령으로 맞춘다.
 * 단계 명령이 하나도 없으면 「단계 명령 없음」, 판정 기준 계획 상태(planStatus)를 주면 끝남이 아닐 때 맨 앞에 「계획 없음·실패·취소·안 끝남」으로 실패다
 * (wide-glass c1: 명령 0개로 「컵 치우기 실패」, wide-tall m1: 「계획됨」뒤 명령 없음이 「0/0 맞음」으로 거짓 통과했다).
 * 컵 치우기 판(cupClear)이면 끝에 집은 컵이 싱크대 안이어야 한다: 집기 명령의 대상 컵에서 옮김 표시(followed_by)만 따라간 마지막 물건으로 보고,
 * 상관없는 다른 컵으로 대신하지 않는다(Codex 2705c21). 다른 판(라면·전자레인지)은 단계 자리만 본다.
 */
export function stepPlaces(steps: readonly string[], commands: readonly VideoCommand[], world: WorldView | null,
  o: { plan?: string | null; cupClear?: boolean; planSteps?: readonly { id: string; label: string; kind: string }[]; planStatus?: string | null } = {}): { ok: boolean; text: string; problems: string[] } {
  const plan = o.plan === undefined ? mainPlan(commands, []) : o.plan;
  // 그 계획의 단계 명령만, 단계마다 마지막 명령(찾기 앞뒤로 같은 단계가 다시 나간다). 계획 줄의 찾기(:find:)·질문·끄기 안내·충전 자리는 뺀다(wide-mug g1)
  const last = new Map<string, VideoCommand>();
  for (const c of commands) {
    if (c.id !== plan || !c.kind || c.step.includes(":find:") || /:(approve|hand|again)$/.test(c.step) || isOffStep(c.step) || isDockStep(c.step)) continue;
    last.set(c.step, c);
  }
  const pool = [...last.values()];
  const required = o.planSteps
    ? o.planSteps.filter((x) => x.kind === "move" || x.kind === "act").map((x) => ({ id: x.id, label: x.label }))
    : pool.map((c) => ({ id: c.step, label: c.text }));
  const args = steps.map((raw) => { const [kind = "", word = ""] = raw.split(":"); return { kind, word }; });
  const problems: string[] = [];
  let next = 0;
  let right = 0;
  let checked = 0;
  let picked: string | null = null;
  const status = o.planStatus === undefined || o.planStatus === "done" ? null : PLAN_FAIL[o.planStatus ?? "none"] ?? "계획 안 끝남";
  if (!pool.length) problems.push("단계 명령 없음");
  for (const r of pool.length ? required : []) {
    const c = pool.find((x) => x.step === r.id);
    if (!c) { problems.push(`단계 명령 없음: ${r.label}`); continue; }
    if (c.kind === "pick" && c.target?.id) picked = c.target.id;
    const same = args.map((a, i) => ({ a, i })).filter(({ a, i }) => i >= next && a.kind === c.kind);
    if (!same.length) continue;
    checked++;
    const hit = same.find(({ a }) => !!a.word && !!c.target?.id.includes(a.word));
    if (hit) { right++; next = hit.i + 1; continue; }
    problems.push(`단계 자리 틀림: ${c.target?.label ?? "대상 없음"} ≠ ${placeName(same[0]!.a.word)}`);
    next = same[0]!.i + 1;
  }
  const head = `단계 자리: ${right}/${checked} 맞음`;
  if (status) problems.unshift(status);
  const line = (rest: readonly string[]) => (status ? [status, head, ...rest.slice(1)] : [head, ...rest]).join(" · ");
  if (!o.cupClear) return { ok: problems.length === 0, text: line(problems), problems };
  // 집은 컵: 옮김 표시(followed_by)만 따라간다(사라진 컵을 상관없는 다른 컵으로 대신하지 않는다)
  const byId = new Map((world?.objects ?? []).map((x) => [x.id, x] as const));
  let cup = picked ? byId.get(picked) : undefined;
  for (const visited = new Set<string>(); cup?.followed_by && byId.has(cup.followed_by) && !visited.has(cup.id); ) {
    visited.add(cup.id);
    cup = byId.get(cup.followed_by);
  }
  const sunk = !!cup && (cup.facts.place?.value === "in_sink" || cup.surface_part === "basin");
  const cupLine = sunk ? "치운 컵 싱크대 안" : `치운 컵이 싱크대 안이 아님: ${cup ? placeLabel(cup.facts.place?.value) ?? "놓인 곳 모름" : "컵 모름"}`;
  return { ok: problems.length === 0 && sunk, text: line([...problems, cupLine]), problems: sunk ? problems : [...problems, cupLine] };
}

/** 판정 줄: 첫 명령 시각, expectMs 전 명령 수, 첫 명령의 계획이 끝났는지. */
export function verdict(rows: Row[], commands: VideoCommand[], history: HistoryRow[], expectMs: number): { text: string; early: number; firstMs: number | null; done: boolean } {
  const first = commands[0];
  const early = commands.filter((c) => c.video_ms < expectMs).length;
  // 계획 끝남은 판정 기준 계획(컵 치우기, mainPlan) 하나로 본다: 앞에 찾기·뒤에 충전 자리 명령이 끼어도
  const plan = mainPlan(commands, history);
  const done = planState(plan, history) === "done";
  const at = (expectMs / 1000).toFixed(1);
  const text = first
    ? `판정: 첫 명령 ${clock(first.video_ms)} 「${first.text}」 · ${at}초 전 명령 ${early ? `${early}개 있음` : "없음"} · 계획 ${done ? "끝남" : "안 끝남"}`
    : `판정: 명령 없음 · 표 ${rows.length}줄`;
  return { text, early, firstMs: first?.video_ms ?? null, done };
}

/** markdown 문서. warnings(짝 넘침)는 시각표 위에, notes(끝까지 돌지 않음·페이지 오류·사진 못 남김)는 판정 줄 위에, extra(단계 판정 줄)는 판정 줄 뒤에, image(대시보드 사진 경로)는 끝에 쓴다. */
/** 배운 뒤 기억인가: 새 모양(상태 안 rules가 아님)이고 마시는 중에서 떠나는(to "*") 컵 치우기 화살표가 있다. */
export function hasLearnedClear(memory: unknown): boolean {
  if (!memory || typeof memory !== "object" || isOldFsm(memory)) return false;
  const states = (memory as { states?: unknown }).states;
  if (!Array.isArray(states)) return false;
  const drinking = states.find((s) => (s as { id?: unknown })?.id === "drinking") as { next?: unknown } | undefined;
  return Array.isArray(drinking?.next) && drinking.next.some((e) => (e as { to?: unknown; action?: unknown })?.to === ANY_STATE && (e as { action?: unknown }).action === "컵 치우기");
}

/** 영상 전 오늘 기억 확인: GET /api/memory/day/<오늘> 답의 uses.memory가 배운 뒤 기억이면 시각표 머리 줄, 아니면 판정 줄(runtimeDir: 서버 RUNTIME_DIR 글). */
export function memoryGate(answer: unknown, runtimeDir: string): { ok: true; line: string } | { ok: false; why: string } {
  const uses = (answer as { uses?: { version?: unknown; source?: unknown; memory?: unknown } | null } | null)?.uses;
  if (uses && hasLearnedClear(uses.memory)) return { ok: true, line: `기억 ${String(uses.version)}판 · ${String(uses.source)}` };
  return { ok: false, why: `오늘 기억에 배운 컵 치우기가 없어요. 서버를 끄고 npx tsx scripts/demo-setup.ts learned --dir ${runtimeDir}로 넣은 뒤 다시 켜 주세요` };
}

export function markdown(o: { clip: string; mode: string; ranAt: string; memory?: string; rows: Row[]; notes: string[]; verdict: string; extra?: string[]; cost: string; image?: string; warnings?: string[] }): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `# 영상 판정 · ${o.clip}`, "", `${o.ranAt} · ${o.mode}`, "", ...(o.memory ? [o.memory, ""] : []), ...(o.warnings ?? []).flatMap((w) => [w, ""]),
    "| 영상 시각 | 종류 | 글 |", "|---|---|---|",
    ...o.rows.map((r) => `| ${clock(r.ms)} | ${r.kind} | ${cell(rowText(r))} |`),
    "", ...o.notes.flatMap((n) => [n, ""]), o.verdict, "", ...(o.extra ?? []).flatMap((n) => [n, ""]), o.cost, "",
    ...(o.image ? [`![트윈 대시보드](${o.image})`, ""] : []),
  ].join("\n");
}

// 서버 상태

type PlanNow = { status?: string; goal?: string } | null;
/** GET /api/plan 답(계획과 끄기 추적 요약). */
type PlanAnswer = { plan: PlanNow; off?: OffTrack | null } | null;

/** 끝낼지 볼 값을 GET /api/plan 한 답에서 함께 읽는다: 계획 상태와 끄기 추적(hot·끄기 안내)이 남았는지. 따로 읽으면 계획이 막 닫힌 순간 생긴 끄기 안내를 놓친다. */
export function judgeInput(a: PlanAnswer): { planStatus: string | undefined; offOpen: boolean } {
  return { planStatus: a?.plan?.status, offOpen: !!a?.off && (a.off.hot.length > 0 || a.off.notices.length > 0) };
}
type BrainNow = {
  frames?: number; vlm?: { sent?: number; costUsd?: number }; closer?: { looks?: number; model?: string }; look?: { calls?: number; costUsd?: number | null } | null;
} | null;
const PLAN_OPEN = new Set(["planned", "running"]);

/** 앞 판이 남긴 서버인지: 끝나지 않은 계획, 이미 받은 엔진 프레임(World State가 남음). 그렇면 까닭, 새 서버면 null. */
export function usedServer(plan: PlanNow, brain: BrainNow): string | null {
  if (plan && PLAN_OPEN.has(plan.status ?? "")) return `끝나지 않은 계획이 있어요: ${plan.goal ?? ""}. 서버를 다시 띄우세요`;
  const frames = brain?.frames ?? 0;
  if (frames > 0) return `엔진 프레임 ${frames}장을 이미 받은 서버예요(앞 판 World State가 남음). 서버를 다시 띄우세요`;
  return null;
}

/** 이번 판 비용 줄: VLM 장 수·비용, 가까이 보기 횟수와 그 VLM 모델(있을 때), 관찰 모드 호출 수·비용(모르면 비용 모름), 엔진 프레임 수. PAM·계획 비용은 세지 않는다. */
export function costLine(brain: BrainNow): string {
  if (!brain?.vlm) return "VLM 비용 모름(/api/brain 없음)";
  const usd = (v: number) => "$" + v.toFixed(4);
  const closer = brain.closer ? ` · 가까이 보기 ${brain.closer.looks ?? 0}번${brain.closer.model ? ` ${brain.closer.model}` : ""}` : "";
  const lookCost = typeof brain.look?.costUsd === "number" ? ` ${usd(brain.look.costUsd)}` : " · 관찰 모드 비용 모름";
  const look = brain.look ? ` · 관찰 모드 ${brain.look.calls ?? 0}번${lookCost}` : "";
  return `VLM ${brain.vlm.sent ?? 0}장 · ${usd(brain.vlm.costUsd ?? 0)}${closer}${look} · 엔진 프레임 ${brain.frames ?? 0}장 · PAM·계획 비용 빠짐`;
}

/** 계획을 마친 완료 문장이 폰 명령 줄에 보인 뒤 더 보는(녹화하는) 시간 ms. */
export const DONE_TAIL_MS = 2000;
/** 계획이 끝난 뒤 완료 문장을 기다리는 가장 긴 시간 ms(그 안에 안 오면 그냥 끝낸다). */
const DONE_WAIT_MS = 8000;

/** 끝내기: watch 더 본다, done 계획이 명시적으로 닫혔고(done·failed·cancelled) 누를 답이 없고 끄기 추적(hot·끄기 안내)이 남지 않음,
 *  끝남(done)이면 완료 문장(doneNotice)이 보인 뒤 DONE_TAIL_MS가 지났거나 끝난 뒤 DONE_WAIT_MS 안에 오지 않음,
 *  tail_over 영상이 멈춘 뒤 tailMs가 지남(끄기 안내가 남았으면 계획이 닫혀도 여기까지 본다: 카메라가 꺼짐 확인을 이어 가게 폰을 닫지 않는다),
 *  clip_over 지금 영상이 그 길이 + 60초를 넘게 도는 중, max_over 판 전체가 maxMs를 넘음. */
export function judgeState(o: {
  /** 영상이 멈춘 지(첫 영상 끝 __noonchiVideo.ended, 또는 붙잡는 중 __noonchiVideo.hold) ms. 도는 중이면 null. */
  stillForMs: number | null;
  /** 스스로 시험: 계획이 닫혀도 영상이 멈출(첫 영상 끝·붙잡기) 때까지 본다. */
  untilEnd?: boolean;
  /** 지금 도는 영상(첫 영상이나 바꾼 단계 영상)이 시작된 뒤 ms와 그 영상 길이 ms. */
  clipPlayedMs: number; clipDurationMs: number | null;
  due: number; planStatus: string | undefined; tailMs: number; totalMs: number; maxMs: number;
  /** 끄기 추적(지금 계획 hot·끄기 안내)이 남아 있는가(judgeInput, GET /api/plan off). */
  offOpen: boolean;
  /** 완료 문장: 폰 명령 줄에 보인 지 ms(아직이면 null), 계획이 끝난 것을 본 지 ms. 없으면 기다리지 않는다. */
  doneNotice?: { shownForMs: number | null; waitedMs: number };
}): "watch" | "done" | "tail_over" | "clip_over" | "max_over" {
  if (o.totalMs > o.maxMs) return "max_over";
  const n = o.doneNotice;
  const noticeOk = o.planStatus !== "done" || !n || (n.shownForMs !== null ? n.shownForMs >= DONE_TAIL_MS : n.waitedMs > DONE_WAIT_MS);
  if (o.due === 0 && PLAN_END.has(o.planStatus ?? "") && !o.offOpen && (!o.untilEnd || o.stillForMs !== null) && noticeOk) return "done";
  // 계획을 만드는 중이거나 조회가 실패한(undefined) 때는 닫힌 계획으로 보지 않는다: 영상이 멈춰도 tail까지 본다
  if (o.stillForMs !== null) return o.stillForMs > o.tailMs ? "tail_over" : "watch";
  if (o.clipDurationMs !== null && o.clipPlayedMs > o.clipDurationMs + 60_000) return "clip_over";
  return "watch";
}

/** 누르기 규칙: --approve(승인 질문), --done-on(그 글 명령), --answer(질문의 그 글 답 단추), --done-after(모든 새 명령의 첫 단추). 0이면 안 누름. */
export interface ClickRule { approveAfterMs: number; doneOn: { afterMs: number; text: string }[]; doneAfterMs: number; answers: { afterMs: number; label: string }[] }
/** 새 명령 하나에 예약할 누르기(없으면 빈 목록). 단추 글로 고른다: 승인 질문이면 「승인」, done-on 글이면 「완료」, done-after면 첫 단추(지금 동작). */
export interface PlannedClick { at: number; label: string | null; id: string; step: string; text: string }
export function plannedClicks(cmd: VideoCommand, rule: ClickRule, now: number): PlannedClick[] {
  const at = (ms: number, label: string | null): PlannedClick => ({ at: now + ms, label, id: cmd.id, step: cmd.step, text: cmd.text });
  const out: PlannedClick[] = [];
  // 닫힌 계획의 끄기 안내·부탁(src/act/off-step.ts)에는 어떤 누르기도 예약하지 않는다(같은 글의 라면 12번 명령과 가른다)
  // 계획이 끝난 뒤 충전 자리 명령(src/act/dock-step.ts)도 누르지 않는다: 판정은 계획이 끝나면 끝나고, 폰 페이지는 단계 영상 없이 그쪽으로 걷기만 한다
  // 계획을 마친 완료 문장(src/act/done-step.ts)에는 단추가 없다
  if (isOffStep(cmd.step) || isDockStep(cmd.step) || isDoneStep(cmd.step)) return out;
  if (rule.approveAfterMs > 0 && /:(approve|hand)$/.test(cmd.step)) out.push(at(rule.approveAfterMs, "승인"));
  for (const d of rule.doneOn) if (d.text === cmd.text) out.push(at(d.afterMs, "완료"));
  if (/\?$/.test(cmd.text.trim()) && !/:(approve|hand)$/.test(cmd.step)) for (const a of rule.answers) out.push(at(a.afterMs, a.label));
  if (!out.length && rule.doneAfterMs > 0) out.push(at(rule.doneAfterMs, null));
  return out;
}

/** 장면 시작 위치를 서버에 넣는다(폰 페이지를 열기 전). 지금 집이 home이 아니거나 넣지 못하면 까닭 글, 넣었으면 null. */
export async function sendStartPose(api: string, scene: DemoScene, home: string,
  sceneOf: () => SceneJson | null = () => loadScene(resolveHome(resolveTwinStudioDir(process.env.TWIN_STUDIO_DIR), home))): Promise<string | null> {
  const homes = await fetch(`${api}/api/homes`).then((r) => (r.ok ? (r.json() as Promise<{ current: string | null }>) : null)).catch(() => null);
  if (!homes) return `서버에 닿지 못함: ${api}/api/homes`;
  if (homes.current !== home) return `서버의 지금 집이 ${homes.current ?? "없음"}이에요(--home ${home})`;
  const s = sceneOf();
  if (!s) return `${home} 장면이 없어요`;
  let pose: { position: [number, number]; yaw_deg: number };
  try {
    pose = startFor(s, DEMO_STARTS[scene].target, DEMO_STARTS[scene].distanceM);
  } catch (e) {
    return (e as Error).message;
  }
  const r = await fetch(`${api}/api/phone/start-pose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ home, ...pose }) }).catch(() => null);
  return r?.ok ? null : `시작 위치를 넣지 못함: HTTP ${r?.status ?? "연결 실패"}`;
}

/** 페이지 안에서 부르는 식(this: 열린 WebSocket 목록): 폰 소켓(/phone/events, 영상 모드면 ?video=<영상>, 열린 것 중 마지막)으로
 *  {type: "say", text, at}를 보낸다. at은 페이지의 at 기록(__noonchiVideo.at, 없으면 none) 그대로다. 보냈으면 true. */
export const SEND_SAY = `function (text) {
  const ws = this.filter((w) => w.readyState === 1 && /\\/phone\\/events(\\?|$)/.test(w.url)).at(-1);
  if (!ws) return false;
  const at = window.__noonchiVideo?.at ?? { kind: "none", pending: [] };
  ws.send(JSON.stringify({ type: "say", text, at }));
  return true;
}`;

/** 폰 페이지 안의 폰 소켓으로 말을 보낸다(SEND_SAY). 보냈으면 true. */
async function sendSay(page: Page, text: string): Promise<boolean> {
  const proto = await page.send("Runtime.evaluate", { expression: "WebSocket.prototype" });
  const protoId = (proto.result?.result as { objectId?: string } | undefined)?.objectId;
  if (!protoId) return false;
  const found = await page.send("Runtime.queryObjects", { prototypeObjectId: protoId });
  const listId = ((found.result as { objects?: { objectId?: string } } | undefined)?.objects)?.objectId;
  if (!listId) return false;
  const sent = await page.send("Runtime.callFunctionOn", {
    objectId: listId, returnByValue: true, arguments: [{ value: text }],
    functionDeclaration: SEND_SAY,
  });
  return sent.result?.result?.value === true;
}

const getJson = async <T>(url: string): Promise<T | null> => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

// 크롬에서 돌리는 식

/** 「카메라 켜기」 단추를 누를 수 있으면 누른다. */
const CLICK_START = `(() => {
  const b = document.querySelector("button[data-phone-action='start-camera']");
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;
/** 지금 기록·영상·화면. */
const READ = `(() => {
  const r = window.__noonchiVideo ?? null;
  const v = document.querySelector("video[data-phone-video]");
  return {
    record: r && { t0: r.t0, ended: r.ended, hold: r.hold ?? null, commands: r.commands, clips: r.clips ?? [], sync: r.sync ?? [], syncFull: r.syncFull === true },
    time: v ? v.currentTime : null, duration: v && Number.isFinite(v.duration) ? v.duration : null, ended: v ? v.ended : false,
    top: document.querySelector("[data-phone-zone=top] [data-phone-text]")?.textContent ?? null,
    buttons: [...document.querySelectorAll("[data-phone-zone=thumb] button")].map((b) => b.textContent.trim()),
    support: document.querySelector("[data-support]")?.textContent ?? null,
  };
})()`;
type Seen = {
  record: { t0: number | null; ended: boolean; hold: { clip: string; since: number } | null; commands: VideoCommand[]; clips: VideoClip[]; sync: [number, number][]; syncFull: boolean } | null;
  time: number | null; duration: number | null; ended: boolean; top: string | null; buttons: string[]; support: string | null;
};
/** 페이지의 지금 명령(__noonchiVideo.commands 마지막)의 계획 id·단계 id와 위 줄 글이 모두 c와 같을 때만 label 글의 엄지 자리 단추(null이면 첫 단추)를 누르고 그 글을 돌려준다. */
export const clickChoice = (c: Pick<PlannedClick, "id" | "step" | "text" | "label">) => `(() => {
  const last = window.__noonchiVideo?.commands?.at(-1) ?? null;
  const top = document.querySelector("[data-phone-zone=top] [data-phone-text]")?.textContent ?? null;
  if (!last || last.id !== ${JSON.stringify(c.id)} || last.step !== ${JSON.stringify(c.step)} || top !== ${JSON.stringify(c.text)}) return null;
  const all = [...document.querySelectorAll("[data-phone-zone=thumb] button")];
  const label = ${JSON.stringify(c.label)};
  const b = label === null ? all[0] : all.find((x) => x.textContent.trim() === label);
  if (!b) return null;
  b.click();
  return b.textContent.trim();
})()`;

// 가짜 서버(--fake)

const FAKE_PERSON_MS = 30_000;
const HOME = "mokryeon_180b";
// tests/video-mode-e2e.test.ts와 같은 시작 자리: 식탁 가운데([9.9612, 3.9242])에서 1.5m 떨어진 거실, 시작 방향 0°(+x)로 식탁을 본다
const START: [number, number] = [9.9612 - 1.5, 3.9242];
// 가로 영상의 엔진 프레임 480×270(core/pipeline.js frameWidth), 폰 페이지 기본 카메라(40°, -10°, 1.15m, video-ar.js CAMERA).
// 컵 상자 아래 가운데(240, 167)가 1.5m 앞 식탁 윗면(0.75m) 가운데, 사람 상자는 식탁 건너편 2.4m(발 아래 가운데 240, 239·머리 1.25m 높이 y 45)
const CUP: Detection = det("cup", 0.9, [220, 147, 40, 20], 41);
const PERSON: Detection = det("person", 0.9, [205, 45, 70, 194], 0);

/** personUntil: 대본 YOLO가 사람을 내지 않기 시작하는 서버 시각(첫 엔진 프레임 전이면 null). runtimeDir: 임시 RUNTIME_DIR. */
interface Fake { api: string; phone: string; runtimeDir: string; logs: string[]; personUntil(): number | null; close(): Promise<void> }

async function startFake(clip: string, steps: string[]): Promise<Fake> {
  const [{ startFakeOpenAI }, { startFakePamLlm, pamLlmEnv }, { ScriptedDetector }, { CUP_SCRIPTS, plannerRespond }, { startServer }] = await Promise.all([
    import("./fake-openai.js"), import("../tests/helpers/pam.js"), import("../tests/helpers/detectors.js"), import("../tests/helpers/planner.js"), import("../src/server/start.js"),
  ]);
  const names = [...new Set([clip, ...steps.map((s) => s.split(":")[2]!)])];
  const missing = names.find((n) => !existsSync(join(ROOT, "runtime", "videos", n)));
  if (missing) throw new Error(`영상이 없어요: runtime/videos/${missing}`);
  // 영상은 폰 서버가 공용 runtime/videos에서 바로 읽는다(src/server/home/phone.ts phoneVideoDir)
  const runtimeDir = mkdtempSync(join(tmpdir(), "video-check-"));
  mkdirSync(join(runtimeDir, "homes", HOME), { recursive: true });
  writeFileSync(join(runtimeDir, "homes", HOME, "approvals.json"), JSON.stringify({ always: { "task:컵 치우기": "2026-11-11T00:00:00.000Z" }, never: {} }));
  // 치우기를 보는 판정은 배운 뒤 기억(오늘 판본)으로 돈다. seed 기억이면 떠날 때 묻는다
  const db = HistoryDb.open(join(runtimeDir, "noonchi.db"), historyTzMinutes(process.env));
  try { saveLearned(db, db.dayOf(Date.now())); } finally { db.close(); }
  const logs: string[] = [];
  const closers: (() => Promise<unknown>)[] = [];
  const close = async () => {
    for (const c of closers.reverse()) await c().catch(() => {});
    for (let i = 0; i < 10; i++) { try { rmSync(runtimeDir, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  };
  try {
    const fake = await startFakeOpenAI({
      reply: (body) => {
        if (body?.response_format?.json_schema?.name !== "scene_observation") return null;
        const parts = (body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "user").flatMap((m) => (Array.isArray(m.content) ? m.content : [{ text: m.content }]));
        const text = parts.map((p: { text?: unknown }) => (typeof p.text === "string" ? p.text : "")).join("\n");
        const dets = JSON.parse(/Detections: (\[.*\])/.exec(text)?.[1] ?? "[]") as { id: string; class: string }[];
        return JSON.stringify({ scene: "kitchen", observations: dets.filter((d) => d.class === "cup").map((d) => ({ object_id: d.id, state: "on_table" })), summary: "컵" });
      },
      respond: plannerRespond(CUP_SCRIPTS),
    });
    closers.push(() => fake.close());
    // 실제 PAM처럼 사람이 떠난 뒤 컵이 남았을 때 컵 치우기를 고른다(tests/video-mode-e2e.test.ts와 같은 조건). 사람이 보이면 대기
    const pam = await startFakePamLlm({ predict: (b) => {
      const text = String(b.observation_text);
      const i = (b.tasks as string[]).indexOf("컵 치우기");
      return i >= 0 && /컵 cup_\d/.test(text) && /^\[지속\] 사람 안 보임/m.test(text)
        ? { observation: "사람이 떠나고 빈 컵이 식탁에 남음", reasoning: "컵을 치운다", task_index: i }
        : { observation: "사람이 식탁에 있음", reasoning: "기다린다", task_index: -1 };
    } });
    closers.push(() => pam.close());
    let first: number | null = null;
    const srv = await startServer({
      env: {
        HUB: "memory", PORT: "0", HOST: "127.0.0.1", HOME_ID: HOME, RUNTIME_DIR: runtimeDir, PHONE_PORT: "0", PHONE_HOST: "127.0.0.1",
        BRAIN: "1", VLM_BASE_URL: `${fake.url}/v1`, OPENAI_BASE_URL: `${fake.url}/v1`, OPENAI_API_KEY: "fake-key", ...pamLlmEnv(pam),
        PAM_PERIOD_MS: "1000", PAM_MIN_GAP_MS: "0",
      },
      // 첫 엔진 프레임부터 30초는 사람+컵, 그 뒤 컵만
      brain: { detector: new ScriptedDetector(() => {
        const now = Date.now();
        first ??= now;
        return now - first < FAKE_PERSON_MS ? [CUP, PERSON] : [CUP];
      }) },
      log: (line) => { logs.push(line); if (logs.length > 300) logs.shift(); },
    });
    closers.push(() => srv.close());
    const saved = await fetch(`${srv.url}/api/phone/start-pose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: START, yaw_deg: 0 }) });
    if (!saved.ok) throw new Error(`시작 자리 저장 실패: HTTP ${saved.status} ${await saved.text()}`);
    return { api: srv.url, phone: new URL(srv.phoneUrls[0]!).origin, runtimeDir, logs, personUntil: () => (first === null ? null : first + FAKE_PERSON_MS), close };
  } catch (e) {
    await close();
    throw e;
  }
}

// 돌리기

const USAGE = "쓰는 법: npx tsx scripts/video-check.ts --clip <이름.mp4> [--step <종류>:<낱말>:<영상.mp4> ...] [--phone http://127.0.0.1:8210] [--api http://127.0.0.1:8200] [--done-after 3] [--out <파일.md>] [--expect-after 36.3] [--record <폴더>] [--record-view <top|minimap>] [--record-fps 10] [--fake]"
  + " [--scenario scenario1 --left [<영상.mp4>:]<초>] [--say <초>:<글> ...] [--start-at <cup|tv|microwave|kitchen>] [--home mokryeon_180b] [--tail 30] [--max 1800] [--approve <초>] [--done-on <초>:<명령 글> ...]"
  + " [--fov <도>] [--pitch <도>] [--h <m>] [--rate 1] [--answer <초>:<답 단추 글> ...]";

/** 영상 모드 카메라(폰 주소 fov·pitch·h): 준 값만 있다. 없는 값은 폰 페이지 기본값(가로 영상 세로 시야각 40°, pitch −10°, 높이 1.15m). */
export interface Camera { fov?: number; pitch?: number; h?: number }
/** 카메라 값 범위: 폰 페이지(ui/src/phone/core/video-ar.js)가 받는 범위와 같다. */
const CAMERA_RANGE: Record<keyof Camera, [number, number]> = { fov: [20, 120], pitch: [-89, 89], h: [0.2, 3] };

export interface Args {
  /** expectSet: --expect-after를 적었는가(아니면 스스로 시험은 대본 사람 시간을 영상 시각으로 옮겨 쓴다). */
  scenario?: "scenario1";
  /** --left: 시나리오 1에서 시청자가 떠난 때(그 영상 안의 ms). 시나리오 1이면 반드시 있다. */
  left?: LeftAt;
  clip: string; fake: boolean; steps: string[]; doneAfterMs: number; expectMs: number; expectSet: boolean; phone: string; api: string; out: string | undefined; record: string | undefined;
  says: { atMs: number; text: string }[]; startAt: DemoScene | null; home: string; tailMs: number; maxMs: number; approveAfterMs: number; doneOn: { afterMs: number; text: string }[];
  /** --answer: 질문에 누를 답 단추 글과 기다릴 시간. */
  answers: { afterMs: number; label: string }[];
  camera: Camera;
  /** --record-phone: 녹화에 폰 화면도 붙인다(기본은 대시보드만). --chrome: 크롬 그리기 방식(기본 headless-gpu). */
  recordPhone: boolean; chrome: ChromeGpu;
  /** --record-view: 녹화 대시보드 보기(top 대시보드 전체, minimap 비전 미니맵만). --record-fps: 녹화 초당 장 수. */
  recordView: DashView; recordFps: number;
  /** --rate: 영상 빠르기(폰 주소 rate=, 기본 1). */
  rate: number;
}

/** 대시보드 보기: top 대시보드 전체, minimap 비전 미니맵만(주소 ?view=minimap). */
export type DashView = "top" | "minimap";

/** 인자(process.argv.slice(2)) → 판 설정, 틀리면 까닭 글. --step은 여러 번 받고, 있으면 --done-after 기본이 0이다. --record는 시연 영상 폴더. */
export function parseArgs(argv: string[]): Args | string {
  const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const clip = arg("clip") ?? "";
  if (!CLIP_NAME.test(clip)) return USAGE;
  const scenario = arg("scenario");
  if (argv.includes("--scenario") && scenario !== "scenario1") return "--scenario scenario1을 지정해 주세요.";
  if (scenario && (argv.includes("--fake") || argv.includes("--approve") || argv.includes("--done-on") || argv.includes("--answer") || Number(arg("done-after")??0)!==0)) return "시나리오 1은 실제 입력과 자동 도착으로 판정합니다."
  const leftArg = /^(?:([^:]+):)?(\d+(?:\.\d+)?)$/.exec(arg("left") ?? "");
  const left: LeftAt | null = leftArg && (leftArg[1] === undefined || CLIP_NAME.test(leftArg[1])) ? { clip: leftArg[1] ?? clip, ms: Number(leftArg[2]) * 1000 } : null;
  if (scenario && !left) return "시나리오 1은 시청자가 떠난 때를 --left [<영상.mp4>:]<초>로 주세요(영상을 빼면 --clip 첫 영상).";
  if (scenario && left!.clip !== clip && !argv.some((a, i) => argv[i - 1] === "--step" && a.split(":")[2] === left!.clip))
    return `--left의 영상 ${left!.clip}이 --clip·--step에 없어요.`;;
  const steps = argv.flatMap((a, i) => (a === "--step" ? [argv[i + 1] ?? ""] : []));
  const bad = steps.find((s) => !STEP_ARG.test(s));
  if (bad !== undefined) return `--step은 <go|pick|place|do>:<낱말 a-z·_>:<영상.mp4|webm>예요: 「${bad}」`;
  const record = arg("record");
  if (argv.includes("--record") && (!record || record.startsWith("--"))) return "--record 뒤에 시연 영상을 남길 폴더를 주세요: --record <폴더>";
  const fake = argv.includes("--fake");
  // --step·--approve·--done-on이 있으면 --done-after 기본은 0이다(고른 명령에만 누른다)
  const doneAfterMs = Number(arg("done-after") ?? (scenario || steps.length || argv.includes("--approve") || argv.includes("--done-on") || argv.includes("--answer") ? "0" : "3")) * 1000;
  const expectMs = Number(arg("expect-after") ?? (fake ? String(FAKE_PERSON_MS / 1000) : "36.3")) * 1000;
  if (!Number.isFinite(doneAfterMs) || doneAfterMs < 0 || !Number.isFinite(expectMs)) return "--done-after·--expect-after는 0 이상 숫자(초)예요";
  // <초>:<글>: 초는 0 이상 숫자, 글은 비지 않고 60자까지
  const timed = (flag: string, max: number) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : [])).map((v) => {
    const m = /^(\d+(?:\.\d+)?):(.*)$/s.exec(v);
    const text = m?.[2]?.trim() ?? "";
    return m && text && text.length <= max ? { ms: Number(m[1]) * 1000, text } : null;
  });
  const says = timed("--say", 60);
  if (says.includes(null)) return `--say는 <초>:<글(60자까지)>예요. ${USAGE}`;
  const doneOn = timed("--done-on", 200);
  if (doneOn.includes(null)) return `--done-on은 <초>:<명령 글>이에요. ${USAGE}`;
  const answers = timed("--answer", 20);
  if (answers.includes(null)) return `--answer는 <초>:<답 단추 글>이에요. ${USAGE}`;
  const startAt = arg("start-at") ?? null;
  if (startAt !== null && !Object.hasOwn(DEMO_STARTS, startAt)) return `--start-at은 ${Object.keys(DEMO_STARTS).join("·")} 가운데 하나예요. ${USAGE}`;
  const sec = (k: string, fallback: number, lo: number, hi: number) => {
    const v = Number(arg(k) ?? fallback);
    return Number.isFinite(v) && v >= lo && v <= hi ? v * 1000 : null;
  };
  const tailMs = sec("tail", 30, 10, 900);
  const maxMs = sec("max", 1800, 60, 3600);
  const approveAfterMs = sec("approve", 0, 0, 3600);
  if (tailMs === null || maxMs === null || approveAfterMs === null) return `--tail은 10~900초, --max는 60~3600초, --approve는 0 이상 초예요. ${USAGE}`;
  const camera: Camera = {};
  for (const k of Object.keys(CAMERA_RANGE) as (keyof Camera)[]) {
    if (!argv.includes(`--${k}`)) continue;
    const raw = arg(k);
    const v = Number(raw);
    const [lo, hi] = CAMERA_RANGE[k];
    if (!raw?.trim() || raw.startsWith("--") || !Number.isFinite(v) || v < lo || v > hi) return `--fov는 20~120(도), --pitch는 -89~89(도), --h는 0.2~3(m) 숫자예요. ${USAGE}`;
    camera[k] = v;
  }
  const recordView = argv.includes("--record-view") ? arg("record-view") : "top";
  if (recordView !== "top" && recordView !== "minimap") return `--record-view는 top·minimap 가운데 하나예요. ${USAGE}`;
  const recordFps = argv.includes("--record-fps") ? Number(arg("record-fps")) : RECORD_FPS;
  if (!Number.isInteger(recordFps) || recordFps < 1 || recordFps > 30) return `--record-fps는 1~30 정수(초당 장 수)예요. ${USAGE}`;
  const chrome = (arg("chrome") ?? "headless-gpu") as ChromeGpu;
  if (!CHROME_GPU.includes(chrome)) return `--chrome은 ${CHROME_GPU.join("·")} 가운데 하나예요. ${USAGE}`;
  const rawRate = argv.includes("--rate") ? arg("rate") : "1";
  const rate = Number(rawRate);
  if (!rawRate?.trim() || rawRate.startsWith("--") || !Number.isFinite(rate) || rate < 0.25 || rate > 2) return `--rate는 0.25~2 숫자(영상 빠르기)예요. ${USAGE}`;
  return {
    ...(scenario==="scenario1"?{scenario,left:left!}:{}), recordPhone: argv.includes("--record-phone"), chrome, recordView, recordFps, rate,
    clip, fake, steps, doneAfterMs, expectMs, expectSet: arg("expect-after") !== undefined, phone: arg("phone") ?? "http://127.0.0.1:8210", api: arg("api") ?? "http://127.0.0.1:8200", out: arg("out"), record,
    says: says.map((x) => ({ atMs: x!.ms, text: x!.text })), startAt: startAt as DemoScene | null, home: arg("home") ?? HOME, tailMs, maxMs, approveAfterMs,
    doneOn: doneOn.map((x) => ({ afterMs: x!.ms, text: x!.text })), answers: answers.map((x) => ({ afterMs: x!.ms, label: x!.text })), camera,
  };
}

/** 폰 영상 모드 주소: clip 하나, step을 하나씩, 준 카메라 값(fov·pitch·h)만, 빠르기가 1이 아니면 rate. */
export function phoneUrl(phone: string, clip: string, steps: string[], camera: Camera = {}, rate = 1): string {
  const cam = (Object.keys(CAMERA_RANGE) as (keyof Camera)[]).flatMap((k) => (camera[k] === undefined ? [] : [`&${k}=${camera[k]}`])).join("");
  return `${phone.replace(/\/+$/, "")}/phone/?clip=${encodeURIComponent(clip)}${steps.map((s) => `&step=${encodeURIComponent(s)}`).join("")}${cam}${rate === 1 ? "" : `&rate=${rate}`}`;
}

/** 옮긴 문서가 다 불러와질 때까지(주소가 url의 origin이고 readyState complete) 기다린다. Page.navigate 답은 새 문서가 들어서기(commit) 전에 오므로,
 *  바로 Page.startScreencast를 보내면 「Not attached to an active page」로 실패한다(about:blank → http 주소는 렌더러가 바뀐다).
 *  옛 빈 문서(origin "null")·붙지 못한 답·답 없음은 아직으로 본다. 확인 한 번도 남은 대기 시간 안에서만 기다리고, waitMs 안에 안 되면 던진다. */
export async function waitLoaded(tab: Pick<Page, "send">, url: string, o: { what: string; waitMs?: number; everyMs?: number }): Promise<void> {
  const origin = new URL(url).origin;
  const waitMs = o.waitMs ?? 30_000;
  for (const end = Date.now() + waitMs; Date.now() < end; await sleep(o.everyMs ?? 100)) {
    const left = Math.max(1, end - Date.now());
    const r = await withTimeout(tab.send("Runtime.evaluate", { expression: "[location.origin, document.readyState]", returnByValue: true }), left, o.what).catch(() => null);
    const v = r?.result?.result?.value as [string, string] | undefined;
    if (Array.isArray(v) && v[0] === origin && v[1] === "complete") return;
  }
  throw new Error(`${o.what}를 ${Math.round(waitMs / 1000)}초 안에 다 불러오지 못했어요`);
}

/** 대시보드 창 크기: minimap 1280×720, top 1280×800. */
const dashSizeOf = (view: DashView): [number, number] => (view === "minimap" ? MINIMAP_SIZE : DASH_SIZE);

/** 녹화 모양: 대시보드 창 크기(dashSizeOf), ack 간격(1000/fps), mp4 fps, mp4 높이(폰도 녹화하면 기본 높이에 맞춰 붙이므로 없음, 아니면 창 높이),
 *  폰 탭 크기(폰도 녹화할 때만, 가로 SIZE). */
export function recordSetup(a: Pick<Args, "recordView" | "recordFps" | "recordPhone">): { size: [number, number]; intervalMs: number; fps: number; height: number | undefined; phoneSize: [number, number] | undefined } {
  const size = dashSizeOf(a.recordView);
  return { size, intervalMs: 1000 / a.recordFps, fps: a.recordFps, height: a.recordPhone ? undefined : size[1], phoneSize: a.recordPhone ? SIZE : undefined };
}

/** 폰 지원 줄이 세로 영상 알림(video-ar.js LANDSCAPE_ONLY)이면 판정을 끝낼 오류 글, 아니면 null. */
export function landscapeRefusal(support: string | null, clip: string): string | null {
  return support === LANDSCAPE_ONLY ? `세로 영상이라 열지 않았어요(${clip}): ${LANDSCAPE_ONLY}` : null;
}

/** 대시보드 탭·창: 크기를 보기 창 크기(모바일 아님, dashSizeOf)로 맞추고 대시보드 <api>/(view minimap이면 <api>/?view=minimap)로 옮긴 뒤 그 문서가 다 불러와질 때까지 기다린다(waitLoaded). */
export async function openDashboard(tab: Pick<Page, "send">, api: string, o: { waitMs?: number; everyMs?: number; view?: DashView } = {}): Promise<void> {
  const view = o.view ?? "top";
  const url = `${api}/${view === "minimap" ? "?view=minimap" : ""}`;
  const [width, height] = dashSizeOf(view);
  await withTimeout(tab.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }), 10_000, "대시보드 탭 크기");
  await withTimeout(tab.send("Page.navigate", { url }), 30_000, "대시보드 열기");
  await waitLoaded(tab, url, { what: "대시보드", waitMs: o.waitMs, everyMs: o.everyMs });
}

/** 대시보드 그림 간격 모으기 시작(window.__frameGaps)과 읽기. */
const FRAME_GAPS_START = "(() => { const g = (window.__frameGaps = []); let last = performance.now(); const f = (n) => { g.push(n - last); last = n; if (g.length < 100000) requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()";
const FRAME_GAPS_READ = "window.__frameGaps ?? null";
/** 미니맵 장면 기록 모으기 시작과 읽기: 폰 칸 영상 상자(data-eye-video)의 data-scene-at(그린 장면 촬영 시각, 서버 시계)이 바뀔 때마다 [이 PC 시각, 장면 시각].
 *  이 PC 시계 = 같은 PC 서버 시계라 run.json startMs·frames ms와 같은 시계다. scripts/minimap-cut.ts가 장면마다 그 장면 시각으로 잇는다. */
const SCENES_START = "(() => { const s = (window.__minimapScenes = []); new MutationObserver((list) => { for (const m of list) { const v = Number(m.target.getAttribute('data-scene-at')); if (Number.isFinite(v) && v > 0 && s.length < 200000 && (!s.length || s[s.length - 1][1] !== v)) s.push([Date.now(), v]); } }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-scene-at'] }); return true; })()";
const SCENES_READ = "window.__minimapScenes ?? null";
/** 장면 기록 → 숫자 짝 [보인 시각, 장면 촬영 시각]만, 보인 시각이 앞으로 가는 차례로. */
export function sceneLog(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    if (out.length && p[0] < out.at(-1)![0]) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}
/** 지금 미니맵이 장면을 늦게 보이는 시간(ms): 마지막 짝의 보인 시각 − 장면 시각. 기록이 없으면 0. */
export function sceneLag(scenes: readonly (readonly [number, number])[]): number {
  const last = scenes.at(-1);
  return last ? Math.max(0, last[0] - last[1]) : 0;
}
/** 그림 간격(ms) 목록 → 한 줄(중앙값·p90·최대·초당 장 수). 없으면 null. */
export function frameGapLine(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const g = (raw as number[]).filter((x) => Number.isFinite(x) && x > 0);
  if (!g.length) return null;
  const s = [...g].sort((a, b) => a - b);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
  const total = g.reduce((a, b) => a + b, 0) / 1000;
  return `대시보드 그림 간격: 중앙값 ${q(0.5)}ms · p90 ${q(0.9)}ms · 최대 ${Math.round(s.at(-1)!)}ms · 초당 ${(g.length / Math.max(total, 0.001)).toFixed(1)}장`;
}

/** 트윈이 다 뜰 때까지 기다린다: 대시보드가 data-ready를 달고(글꼴·마스코트·지도 첫 그림·미리 그려 보기 뒤) 그 뒤 그림 TWIN_FRAMES장이 그려진다. 한도를 넘기면 던진다. */
const TWIN_FRAMES = 5;
export async function waitTwinReady(tab: Pick<Page, "evaluate">, o: { waitMs?: number; everyMs?: number } = {}): Promise<void> {
  const waitMs = o.waitMs ?? 180_000;
  const end = Date.now() + waitMs;
  for (; Date.now() < end; await sleep(o.everyMs ?? 250)) {
    const ready = await tab.evaluate("!!document.querySelector('main[data-ready]')", Math.max(1, end - Date.now())).catch(() => false);
    if (ready !== true) continue;
    const drawn = await tab.evaluate(`new Promise((res) => { let n = 0; const f = () => { n += 1; if (n >= ${TWIN_FRAMES}) res(n); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`, Math.max(1, end - Date.now())).catch(() => 0);
    if (Number(drawn) >= TWIN_FRAMES) return;
  }
  throw new Error(`대시보드 트윈이 ${Math.round(waitMs / 1000)}초 안에 다 뜨지 않았어요`);
}

/** 대시보드 사진을 file에 쓴다. open(--record로 판정 내내 띄운 대시보드 창)이 있으면 그 창을 바로 찍고,
 *  없으면 같은 크롬 새 탭으로 열어 DASH_WAIT_MS 뒤 찍는다. 새 탭 오류 글을 돌려준다(판정에 넣지 않음). */
async function dashboardShot(port: number, api: string, file: string, open?: Page): Promise<string[]> {
  const errors: string[] = [];
  const tab = open ?? (await openTab(port, (msg) => errors.push(msg)));
  try {
    if (!open) {
      await openDashboard(tab, api);
      await sleep(DASH_WAIT_MS);
    }
    const png = await tab.screenshot({ format: "png" }, 30_000);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    return errors;
  } finally {
    if (!open) tab.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") { console.error(args); return 2; }
  const { clip, steps, doneAfterMs, expectMs } = args;
  const fakeMode = args.fake;
  const base = clip.replace(/\.[^.]+$/, "");
  // 실제 판은 판마다 파일 하나(시각을 붙여 앞 판을 덮지 않는다). 스스로 시험은 같은 파일을 덮는다
  const stamp = new Date().toLocaleString("sv-SE").replace(/[-:]/g, "").replace(" ", "-");
  const out = resolve(ROOT, args.out ?? `runtime/videos/${base}.${fakeMode ? "fake" : stamp}.timeline.md`);
  const shotFile = resolve(ROOT, `runtime/videos/${base}.${fakeMode ? "fake" : stamp}.twin.png`);
  // --record: 시연 영상 <폴더>/<시각표 이름 줄기>.demo.mp4, 프레임은 옆 .frames 폴더(영상을 만들면 지움)
  const demo = args.record ? demoFile(resolve(ROOT, args.record), out) : null;
  const framesDir = demo ? demo.replace(/\.demo\.mp4$/, ".frames") : null;
  // 녹화 창 크기·ack 간격·mp4 fps·높이(--record-view·--record-fps)
  const shape = recordSetup(args);
  if (fakeMode && !existsSync(join(ROOT, "ui", "dist", "phone", "index.html"))) { console.error("ui/dist가 없어요: npm run heavy -- npm --prefix ui run build"); return 2; }
  const chromeExe = chromePath();

  let stop = false;
  const onSignal = () => { stop = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const work = async (note: (pid: number) => void): Promise<number> => {
    const errors: string[] = [];
    // 끝까지 돌지 않은 까닭(시간 넘김·중단)
    const unfinished: string[] = [];
    let fake: Fake | undefined;
    let chrome: Chrome | undefined;
    let page: Page | undefined;
    // --record: 판정 내내 띄운 대시보드 창, 녹화, 대시보드 창 오류(판정에 넣지 않음), 녹화 쪽 적을 것
    let dash: Page | undefined;
    let rec: Recording | undefined;
    // 녹화 시작 이 PC 시계(미니맵 이은 영상 판 기록 run.json의 startMs)
    let recStartMs = 0;
    let recorded: Recorded | undefined;
    let encoded = false;
    const dashErrors: string[] = [];
    const recordNotes: string[] = [];
    // 시각표 머리 줄: 어느 기억으로 돌았는지(memoryGate)
    let memoryLine: string | undefined;
    try {
      fake = fakeMode ? await startFake(clip, steps) : undefined;
      const api = (fake?.api ?? args.api).replace(/\/+$/, "");
      const url = phoneUrl(fake?.phone ?? args.phone, clip, steps, args.camera, args.rate);
      const planNow = () => getJson<NonNullable<PlanAnswer>>(`${api}/api/plan`);

      // 앞 판 계획·World State가 남은 서버면 시작하지 않는다(새로 붙은 폰은 남은 명령을 바로 받는다)
      const before = await planNow();
      if (!before) throw new Error(`서버에 닿지 못함: ${api}/api/plan`);
      const used = usedServer(before.plan, await getJson<BrainNow>(`${api}/api/brain`));
      if (used) throw new Error(used);
      // 오늘 기억: 배운 컵 치우기 화살표가 없으면 영상을 틀지 않는다(seed 기억이면 떠날 때 묻는다)
      const today = new Date(Date.now() + historyTzMinutes(process.env) * 60_000).toISOString().slice(0, 10);
      const gate = memoryGate(await getJson(`${api}/api/memory/day/${today}`), fake?.runtimeDir ?? "<서버 RUNTIME_DIR>");
      if (!gate.ok) {
        console.log(`[video-check] ${gate.why}`);
        return 1;
      }
      memoryLine = gate.line;
      console.log(`[video-check] ${gate.line}`);
      // --start-at: 폰 페이지를 열기 전에 그 장면 시작 위치를 넣는다(지금 집이 다르면 시작하지 않는다)
      if (args.startAt) {
        const why = await sendStartPose(api, args.startAt, args.home);
        if (why) throw new Error(why);
        console.log(`[video-check] 시작 위치 ${args.startAt}`);
      }

      chrome = launchChrome({ path: chromeExe, size: SIZE, gpu: args.chrome });
      note(chrome.proc.pid!);
      const port = await devtoolsPort(chrome);
      page = await openPage(port, (msg) => errors.push(msg));
      const cdp = page;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: SIZE[0], height: SIZE[1], deviceScaleFactor: 1, mobile: true });
      await cdp.send("Page.navigate", { url });
      console.log(`[video-check] ${url}`);
      // 폰 문서가 다 뜬 뒤에 녹화·「카메라 켜기」로 간다(새 문서가 들어서기 전 screencast는 「Not attached to an active page」로 실패한다)
      await waitLoaded(cdp, url, { what: "폰 페이지" });
      const read = async () => (await cdp.evaluate(READ, 10_000)) as Seen;

      // 시연 녹화: 같은 크롬 새 창(탭은 폰 탭을 가린다)으로 대시보드를 판정 내내 띄우고, 트윈이 다 뜬 뒤 대시보드(--record-phone이면 폰도) 프레임을 받는다.
      // 「카메라 켜기」(영상 재생)는 녹화를 시작한 뒤에 누른다
      if (framesDir) {
        dash = await openWindow(port, shape.size, (msg) => dashErrors.push(msg));
        await openDashboard(dash, api, { view: args.recordView });
        const twinFrom = Date.now();
        await waitTwinReady(dash);
        console.log(`[video-check] 대시보드${args.recordView === "minimap" ? " 미니맵" : " 트윈"} 준비 ${((Date.now() - twinFrom) / 1000).toFixed(1)}초`);
        // 녹화하는 동안 대시보드 그림 간격(requestAnimationFrame)을 쌓는다(끝에 중앙값·p90·최대를 적는다)
        await dash.evaluate(FRAME_GAPS_START, 10_000).catch(() => {});
        // 미니맵: 보인 장면의 촬영 시각 기록(이은 영상이 장면 시각으로 잇는다)
        if (args.recordView === "minimap") await dash.evaluate(SCENES_START, 10_000).catch(() => {});
        rmSync(framesDir, { recursive: true, force: true });
        recStartMs = Date.now();
        rec = await startRecording(framesDir, [...(shape.phoneSize ? [{ name: "phone", page: cdp, size: shape.phoneSize }] : []), { name: "dash", page: dash, size: shape.size }], { intervalMs: shape.intervalMs });
        const shown = await cdp.evaluate("document.visibilityState", 10_000).catch(() => "모름");
        if (args.recordPhone && shown !== "visible") recordNotes.push(`녹화: 폰 탭이 가려짐(visibilityState ${String(shown)})`);
        console.log(`[video-check] 녹화 시작 · ${shape.fps}fps · ${args.recordPhone ? "폰·대시보드" : args.recordView === "minimap" ? "미니맵만" : "대시보드만"} · 크롬 ${args.chrome} · ${framesDir}`);
      }

      // 폰 페이지 자기 자원을 못 받았으면(이 PC는 127.0.0.1 연결이 가끔 실패하고 크롬은 다시 받지 않는다) 「카메라 켜기」 전에 한 번 다시 읽는다
      const failed = ownAssetFailures(errors, fake?.phone ?? args.phone);
      if (failed.length) {
        recordNotes.push(`자원 받기 실패로 폰 페이지를 한 번 다시 읽음: ${failed.join(", ")}`);
        errors.length = 0;
        await cdp.send("Page.navigate", { url });
        await sleep(500);
        await waitLoaded(cdp, url, { what: "폰 페이지" });
      }

      // 「카메라 켜기」를 누르고 재생이 시작될 때까지(t0)
      for (const end = Date.now() + 60_000; !(await cdp.evaluate(CLICK_START, 10_000).catch(() => false)); await sleep(250)) {
        if (Date.now() > end || stop) throw new Error("60초 안에 「카메라 켜기」 단추를 누를 수 없음");
      }
      let seen = await read();
      for (const end = Date.now() + 30_000; seen.record?.t0 == null; seen = await read()) {
        const refused = landscapeRefusal(seen.support, args.clip);
        if (refused) throw new Error(refused);
        if (Date.now() > end || stop) throw new Error(`30초 안에 영상이 시작되지 않음(지원 줄 「${seen.support ?? ""}」)`);
        await sleep(250);
      }
      // 처음 t0는 폰 시계로 어림한 값일 수 있다. 폰 페이지가 시계를 맞춘 뒤 서버 시계로 고친다
      const firstT0 = seen.record!.t0!;
      console.log(`[video-check] 재생 시작 t0=${firstT0}`);

      // 트윈 줄: 1초마다 World State를 읽어 바뀐 것만 쌓는다(ms는 서버 시각, 끝에 t0를 뺀다). 못 받으면 넘어간다
      const twin: { seen: TwinSeen | null; rows: Row[]; last: WorldView | null } = { seen: null, rows: [], last: null };
      // 컵 줄의 방 이름: 장면의 방 목록(못 받으면 「방 모름」)
      const sceneAnswer = await getJson<{scene?:SceneJson & {stations:StationMap}}>(`${api}/api/scene`);
      const rooms = roomLabels(sceneAnswer);
      if(args.scenario && !sceneAnswer?.scene?.stations) throw Error("시나리오 1 자리 설정을 받지 못했어요.");
      const scenario=args.scenario && sceneAnswer?.scene ? new LiveScenario(sceneAnswer.scene) : null;
      // rec: 그때 폰 페이지 기록(t0·sync·틀은 영상). --left를 서버 시각으로 옮긴다(leftServerAt).
      // 중간 판정(final 아님)에서는 아직 오지 않은 떠난 때를 넣지 않는다: 미래 시각이 앞 단계 사이에 끼어 순서 어긋남이 되지 않게
      const scenarioResult=async(since:number, received:VideoCommand[], rec:{t0:number; sync:readonly (readonly [number, number])[]; clips:readonly VideoClip[]}, final:boolean)=>{
        const response=await fetch(`${api}/api/history?since=${since}&kinds=${SCENARIO_KINDS.join(",")}&limit=5000`,{signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw Error("시나리오 1 기록 조회 실패 "+response.status);
        const {rows}=await response.json() as {rows:HistoryRow[]};
        if(rows.length>=5000)throw Error("시나리오 1 기록 조회 한도를 넘었어요.");
        const left=args.left?leftServerAt(args.left,args.clip,rec,args.rate,firstDurationMs):null;
        if(final && args.left && left===null) throw Error(`--left ${args.left.clip}:${args.left.ms/1000}초가 튼 영상 안에 없어요(안 튼 영상이거나 영상 길이를 넘음).`);
        return scenario!.judge(rows,received,left!==null && (final || left<=Date.now())?left:null);
      };
      const pollWorld = async () => {
        const w = (await getJson<{ world?: WorldView }>(`${api}/api/world`))?.world;
        if (!w) return;
        scenario?.sample(w);
        try {
          const r = twinRows(twin.seen, w, 0, rooms);
          twin.seen = r.seen;
          twin.rows.push(...r.rows);
          twin.last = w;
        } catch { /* 모양이 다른 답은 넘어간다 */ }
      };

      // 끝날 때까지 1초마다 읽고, 새 명령에 고른 누르기를 예약하고(--approve·--done-on·--done-after), 말(--say)을 그 시각에 보낸다. 끝내기는 judgeState가 정한다
      // 영상 시각은 단계 영상을 바꿔도 이어 센다: 지금 영상의 시작 = 마지막으로 바꾼 영상 시각
      let endedAt: number | null = null;
      let stillSince: number | null = null;
      let clipAt = Date.now();
      const runStart = Date.now();
      let due: PlannedClick[] = [];
      const rule: ClickRule = { approveAfterMs: args.approveAfterMs, doneOn: args.doneOn, doneAfterMs, answers: args.answers };
      const saysLeft = [...args.says].sort((a, b) => a.atMs - b.atMs);
      const said: { at: number; text: string }[] = [];
      const pressed: { ms: number; at: number; label: string; text: string }[] = [];
      let known = 0;
      let knownClips = 0;
      let clicks = 0;
      let commands: VideoCommand[] = [];
      let clips: VideoClip[] = [];
      let duration: number | null = null;
      // 첫 영상 길이(단계 영상으로 바꾸기 전에 본 길이): 미니맵 이은 영상이 첫 영상 끝 붙잡기를 뺀다
      let firstDurationMs: number | null = null;
      // 완료 문장(폰 명령 줄): 계획이 끝난 것을 본 때와 완료 문장을 처음 본 때(이 PC 시계)
      let planDoneAt: number | null = null;
      let noticeAt: number | null = null;
      const clipStart = () => clips.at(-1)?.video_ms ?? 0;
      for (;;) {
        seen = await read();
        // 짝 넘침을 읽으면 그 자리에서 멈춘다: 마지막 짝에서 1:1로 이어 센 시각으로 말·누름을 보내면 영상이 멈춘 동안 예정보다 먼저 나갈 수 있다
        if (mustStop(seen.record)) { unfinished.push("짝 넘침"); break; }
        commands = seen.record?.commands ?? commands;
        clips = seen.record?.clips ?? clips;
        duration = seen.duration ?? duration;
        if (!clips.length && seen.duration !== null) firstDurationMs = seen.duration * 1000;
        for (const c of clips.slice(knownClips)) {
          console.log(`[video-check] ${clock(c.video_ms)} 단계 영상 ${c.clip}`);
          clipAt = Date.now();
        }
        knownClips = clips.length;
        for (const c of commands.slice(known)) {
          console.log(`[video-check] ${clock(c.video_ms)} 명령 ${c.text}`);
          due.push(...plannedClicks(c, rule, Date.now()));
          // 미니맵은 명령 줄을 장면 지연만큼 늦게 보인다: 완료 문장이 미니맵에 보인 때부터 센다
          if (isDoneStep(c.step) && noticeAt === null) {
            const lag = dash && args.recordView === "minimap" ? sceneLag(sceneLog(await dash.evaluate(SCENES_READ, 10_000).catch(() => null))) : 0;
            noticeAt = Date.now() + lag;
          }
        }
        known = commands.length;
        const now = Date.now();
        // 말: 영상 시각(폰 페이지 짝으로 옮긴 지금)이 그 초가 되면 폰 소켓으로 보낸다. 보낸 서버 시각을 두었다가 끝에서 같은 짝으로 옮긴다
        const videoNow = videoClock(seen.record?.t0 ?? firstT0, seen.record?.sync ?? [], args.rate)(now);
        while (saysLeft.length && videoNow >= saysLeft[0]!.atMs) {
          const x = saysLeft.shift()!;
          const ok = await sendSay(cdp, x.text).catch(() => false);
          if (ok) {
            said.push({ at: now, text: x.text });
            console.log(`[video-check] ${clock(videoNow)} 말 · ${x.text}`);
          } else errors.push(`말을 보내지 못함: ${x.text}`);
        }
        const ready = due.filter((d) => d.at <= now);
        due = due.filter((d) => d.at > now);
        for (const d of ready) {
          const label = (await cdp.evaluate(clickChoice(d), 10_000)) as string | null;
          if (!label) continue;
          clicks += 1;
          // 누른 때(이 PC 시계 = 같은 PC 서버 시계)를 폰 페이지의 짝으로 영상 시각에 옮긴다. 끝에서 마지막 짝으로 다시 옮긴다
          const pressAt = Date.now();
          const ms = videoClock(seen.record?.t0 ?? firstT0, seen.record?.sync ?? [], args.rate)(pressAt);
          pressed.push({ ms, at: pressAt, label, text: d.text });
          console.log(`[video-check] ${clock(ms)} 누름 · ${label} · ${d.text}`);
        }
        await pollWorld();
        // 영상 끝: 첫 영상 끝이나 붙잡기(단계 영상의 끝도 붙잡기다)
        const endNow = clipEnd(seen, clipStart(), duration);
        if (endNow !== null) {
          if (endedAt === null) {
            endedAt = Date.now();
            console.log(`[video-check] ${clock(endNow)} 영상 끝`);
          }
        } else endedAt = null;
        const still = seen.record ? seen.record.ended || seen.record.hold !== null : seen.ended;
        stillSince = still ? stillSince ?? Date.now() : null;
        const clipDurationMs = clips.at(-1)?.duration_ms ?? (seen.duration !== null ? seen.duration * 1000 : null);
        const { planStatus, offOpen } = judgeInput(await planNow());
        if (planStatus === "done") planDoneAt ??= Date.now();
        // 영상 시각은 원본 시각이라 빠르기를 낮추면 그만큼 오래 돈다
        const clipRealMs = clipDurationMs === null ? null : clipDurationMs / args.rate;
        const state = judgeState({
          stillForMs: stillSince === null ? null : Date.now() - stillSince, untilEnd: fakeMode, clipPlayedMs: Date.now() - clipAt, clipDurationMs: clipRealMs,
          due: due.length, planStatus, tailMs: args.tailMs, totalMs: Date.now() - runStart, maxMs: args.maxMs, offOpen,
          doneNotice: { shownForMs: noticeAt === null ? null : Date.now() - noticeAt, waitedMs: planDoneAt === null ? 0 : Date.now() - planDoneAt },
        });
        if(scenario) {
          const result=await scenarioResult(Math.min(firstT0,seen.record?.t0??firstT0),commands,
            {t0:seen.record?.t0??firstT0,sync:seen.record?.sync??[],clips:seen.record?.clips??clips},false);
          if(result.passed && !offOpen) break;
          // 되돌릴 수 없는 실패면 영상·VLM 호출을 더 쓰지 않는다. 판정은 아래 마지막 판정이 다시 낸다
          if(scenarioSettled(result)) break;
          if(stop || Date.now()-runStart>=args.maxMs){
            unfinished.push((stop?"중단":"전체 시간 초과")+" · "+(result.firstMismatch??"끄기 안내 대기"));
            break;
          }
          await sleep(1000);
          continue;
        }
        if (offOpen && state !== "watch" && state !== "done") unfinished.push("끄기 안내가 풀리지 않음");
        if (state === "clip_over") { unfinished.push(`${Math.round((clipRealMs! + 60_000) / 1000)}초 안에 영상이 끝나지 않음`); break; }
        if (state === "max_over") { unfinished.push(`판 전체 ${Math.round(args.maxMs / 1000)}초를 넘음`); break; }
        if (state !== "watch") break;
        if (stop) { unfinished.push("중단"); break; }
        await sleep(1000);
      }
      await pollWorld();
      // 마지막으로 한 번 더 읽는다: 그 사이 남은 짝(멈칫하는 도중이면 멈춘 시간)까지 옮긴다
      seen = await read().catch(() => seen);
      clips = seen.record?.clips ?? clips;
      // 짝 넘침: 시각표·판정을 만들지 않고 실패로 끝낸다(녹화 프레임은 남긴다)
      const syncWarn = syncWarning(seen.record);
      if (syncWarn) {
        console.log(syncWarn);
        const cost = costLine(await getJson<BrainNow>(`${api}/api/brain`));
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, markdown({
          clip, mode: fakeMode ? "가짜 서버" : `실제 서버 ${api}`, ranAt: new Date().toLocaleString("sv-SE"), memory: memoryLine, rows: [],
          notes: [`끝까지 돌지 않음: ${unfinished.join(", ")}`], verdict: "판정: 짝 넘침으로 하지 않음", cost, warnings: [syncWarn],
        }));
        console.log(`[video-check] ${out}`);
        return 1;
      }
      const gaps = dash ? frameGapLine(await dash.evaluate(FRAME_GAPS_READ, 10_000).catch(() => null)) : null;
      const scenes = dash && args.recordView === "minimap" ? sceneLog(await dash.evaluate(SCENES_READ, 10_000).catch(() => null)) : [];
      if (gaps) { recordNotes.push(gaps); console.log(`[video-check] ${gaps}`); }
      recorded = await rec?.stop();
      const endMs = clipEnd(seen, clipStart(), seen.duration ?? duration);
      const t0 = seen.record?.t0 ?? firstT0;
      if (t0 !== firstT0) console.log(`[video-check] 서버 시계 t0=${t0} (처음 ${firstT0})`);

      // 서버 기록·VLM 비용. 새 서버로만 시작하니 /api/brain 합계가 이번 판 값이다
      const hist = await fetch(`${api}/api/history?since=${Math.min(firstT0, t0)}&kinds=${FETCH_KINDS.join(",")}&limit=5000`);
      if (!hist.ok) throw new Error(`기록을 받지 못함: HTTP ${hist.status}`);
      const history = ((await hist.json()) as { rows: HistoryRow[] }).rows;
      const brain = await getJson<BrainNow>(`${api}/api/brain`);
      const cost = costLine(brain);

      // 서버 시각 → 영상 시각: 폰 페이지가 남긴 짝으로(영상이 멈칫한 만큼을 뺀다)
      const sync = seen.record?.sync ?? [];
      const toVideo = videoClock(t0, sync, args.rate);
      const rows = runTimeline({ t0, sync, history, commands, endMs, clips, twin: twin.rows, says: said, clicks: pressed, rate: args.rate });
      const personUntil = fake?.personUntil() ?? null;
      const expect = fakeMode && !args.expectSet && personUntil !== null ? toVideo(personUntil) : expectMs;
      const v = verdict(rows, commands, history, expect);
      const scenarioVerdict=scenario?await scenarioResult(Math.min(firstT0,t0),commands,{t0,sync,clips},true):null;
      if(scenarioVerdict) {
        const n=scenarioVerdict;
        v.text=[n.passed?"시나리오 1 통과":"시나리오 1 실패 · "+n.firstMismatch,
          `시청 확인 → 첫 컵 이동 ${n.tvConfirmToCupCommandMs??"미확인"}ms · 시청자 떠남 → TV 끄기 ${n.leftToOffMs??"미확인"}ms(5000 이하) · 첫 시청자 부재 → TV 끄기 ${n.noViewerToOffMs??"미확인"}ms · 허브 확인 ${n.noViewerToAckMs??"미확인"}ms`,
          ...n.events.map(e=>`${clock(toVideo(e.at))} · ${e.kind} ${e.id??""}`)].join("\n\n");
      }
      const stepLine = !scenario && steps.length ? stepVerdict(history, commands, clicks, twin.last) : null;
      const reaction = reactionLine(history, commands, t0, sync, args.rate);
      // 단계 자리 판정: --step 자리와 실제 명령 대상, 끝에 치운 컵이 싱크대 안인지. 틀리면 시각표 위에 적고 실패다
      const judged = mainPlan(commands, history);
      const cupClear = !!judged && history.some((h) => h.kind === "plan" && h.subject === judged && h.text.startsWith("컵 치우기"));
      // 판정 기준 계획의 사람 단계(기록의 마지막 계획 줄): 단계 명령이 빠졌는지 본다
      const planRow = judged ? history.filter((h) => h.kind === "plan" && h.subject === judged).sort((a, b) => a.at_ms - b.at_ms || a.id - b.id).at(-1) : undefined;
      const planSteps = ((planRow?.data as PlanData | null | undefined)?.steps ?? []).filter((x) => !!x.kind).map((x) => ({ id: x.id, label: x.label, kind: x.kind! }));
      const places = steps.length ? stepPlaces(steps, commands, twin.last, { plan: judged, cupClear, planStatus: planState(judged, history), ...(planSteps.length ? { planSteps } : {}) }) : null;
      const pageErrors = errors.filter((e) => !/favicon/.test(e));
      const notes = [
        unfinished.length ? `끝까지 돌지 않음: ${unfinished.join(", ")}` : "",
        pageErrors.length ? `페이지 오류 ${pageErrors.length}개` : "",
        ...recordNotes,
      ].filter(Boolean);

      // 대시보드 사진: 같은 크롬 새 탭(--record면 판정 내내 띄운 창). 못 남기면 적기만 한다
      let image: string | undefined;
      try {
        const tabErrors = [...(await withTimeout(dashboardShot(port, api, shotFile, dash), 90_000, "대시보드 사진")), ...dashErrors];
        image = relative(dirname(out), shotFile).replace(/\\/g, "/");
        console.log(`[video-check] 대시보드 사진 ${shotFile}`);
        if (tabErrors.length) console.log(`[video-check] 대시보드 탭 오류 ${tabErrors.length}개\n${tabErrors.slice(0, 5).join("\n")}`);
      } catch (e) {
        notes.push(`대시보드 사진 못 남김: ${(e as Error).message}`);
      }

      // 시연 영상: 크롬을 먼저 끄고(3D 그리기를 멈춤) 프레임을 mp4 하나로 합친다. 못 만들면 프레임 폴더를 남기고 적는다
      if (recorded && framesDir && demo) {
        page?.close();
        dash?.close();
        page = dash = undefined;
        if (chrome) { await closeChrome(chrome); chrome = undefined; }
        const n = (name: string) => recorded!.frames[name]?.length ?? 0;
        const fps = (name: string) => (n(name) / Math.max(recorded!.endMs / 1000, 0.001)).toFixed(1);
        console.log(`[video-check] 녹화 ${(recorded.endMs / 1000).toFixed(1)}초 · ${args.recordPhone ? `폰 ${n("phone")}장(${fps("phone")}fps) · ` : ""}대시보드 ${n("dash")}장(${fps("dash")}fps)${recorded.lost ? ` · 못 쓴 프레임 ${recorded.lost}장` : ""}`);
        // 미니맵 보기: 장면 폴더를 두고 판 기록(run.json)을 남긴다. scripts/minimap-cut.ts가 붙잡기를 뺀 이은 영상을 만든다
        if (args.recordView === "minimap") {
          const doneMs = commands.find((c) => isDoneStep(c.step))?.video_ms ?? null;
          const run: CutRun = { startMs: recStartMs, endMs: recorded.endMs, size: shape.size, frames: recorded.frames.dash ?? [], t0, sync: seen.record?.sync ?? [], firstDurationMs, clips, rate: args.rate, doneMs, ...(scenes.length ? { scenes } : {}) };
          console.log(`[video-check] 미니맵 장면 기록 ${scenes.length}개${scenes.length ? ` · 끝 지연 ${sceneLag(scenes)}ms` : " · 받은 시각으로 이어요"}`);
          writeFileSync(join(framesDir, CUT_RUN_FILE), JSON.stringify(run));
        }
        const made = await encodeDemo(framesDir, recorded, demo, { ...(shape.phoneSize ? { phoneSize: shape.phoneSize } : {}), dashSize: shape.size, fps: shape.fps, height: shape.height, keepFrames: args.recordView === "minimap" });
        encoded = true;
        if (made.ok) console.log(`[video-check] 시연 영상 ${demo}`);
        else { console.log(`[video-check] ${made.why}`); notes.push(`시연 영상 못 만듦: ${made.why}`); }
      }

      console.log("");
      for (const r of rows) console.log(`${clock(r.ms)} · ${r.kind} · ${rowText(r)}`);
      console.log("");
      for (const n of notes) console.log(n);
      if (places) console.log(places.text);
      console.log(v.text);
      if (reaction) console.log(reaction);
      if (stepLine) console.log(stepLine);
      console.log(cost);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, markdown({ clip, mode: fakeMode ? "가짜 서버" : `실제 서버 ${api}`, ranAt: new Date().toLocaleString("sv-SE"), memory: memoryLine, rows, notes, verdict: v.text, extra: [reaction, stepLine].filter((x): x is string => !!x), cost, image, ...(places ? { warnings: [`${places.ok ? "판정 통과" : "판정 실패"} · ${places.text}`] } : {}) }));
      console.log(`[video-check] ${out}`);

      if (pageErrors.length) console.log(`[video-check] 페이지 오류\n${pageErrors.slice(0, 20).join("\n")}`);
      if (scenarioVerdict) return unfinished.length || !scenarioVerdict.passed ? 1 : 0;
      if (!fakeMode) return unfinished.length || (places && !places.ok) ? 1 : 0;
      // 스스로 시험: 사람 사라짐 → PAM 컵 치우기 → 사람 사라짐 뒤 첫 명령 → 네 단계 끝 → 계획 끝, 트윈 눈·컵 줄
      const gone = rows.find((r) => r.kind === "사람 사라짐");
      const firstPlan = mainPlan(commands, history);
      const stepsDone = history.filter((h) => h.kind === "plan" && h.subject === firstPlan).at(-1);
      const missing = [
        !gone && "사람 사라짐 줄",
        !rows.some((r) => r.kind === "PAM 판단" && r.text === "컵 치우기") && "PAM 컵 치우기 판단",
        !(gone && v.firstMs !== null && v.firstMs > gone.ms) && "사람 사라짐 뒤 첫 명령",
        !(((stepsDone?.data as PlanData | null)?.steps ?? []).filter((s) => s.status === "done").length === 4) && "네 단계 끝",
        !v.done && "계획 끝",
        endMs === null && "영상 끝",
        !rows.some((r) => r.kind === "트윈" && r.text.startsWith("눈 ")) && "트윈 눈 줄",
        !rows.some((r) => r.kind === "트윈" && r.text.startsWith("컵 ")) && "트윈 컵 줄",
        pageErrors.length > 0 && "페이지 오류 없음",
      ].filter(Boolean);
      if (missing.length) {
        console.log(`[video-check] 스스로 시험 틀림: ${missing.join(", ")} 없음`);
        console.log(fake!.logs.slice(-80).join("\n"));
        return 1;
      }
      console.log("[video-check] 스스로 시험 맞음");
      return 0;
    } catch (e) {
      console.error(`[video-check] 중단: ${(e as Error).message}`);
      if (errors.length) console.error(errors.slice(0, 20).join("\n"));
      if (fake) console.error(fake.logs.slice(-40).join("\n"));
      return 1;
    } finally {
      // 영상을 만들기 전에 멈춘 판은 프레임 폴더만 남긴다
      if (rec && !encoded) {
        await rec.stop().catch(() => {});
        console.error(`[video-check] 녹화 프레임을 남겼어요: ${framesDir}`);
      }
      page?.close();
      dash?.close();
      if (chrome) await closeChrome(chrome);
      await fake?.close();
    }
  };

  // npm run heavy -- 안이면 그 잠금에, 아니면 스스로 잡은 잠금에 크롬 pid를 적는다(이 프로세스가 죽어도 다음 잠금이 크롬을 끝낸다)
  const run = (lock: Lock) => work((pid) => lock.note({ chromePid: pid }));
  const inner = heldLock();
  return inner ? run(inner) : withHeavy(`video-check ${clip}`, run);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (e) => { console.error((e as Error).message); process.exit((e as Error).message.startsWith("다른 무거운 일이 돌고 있어요") ? 3 : 1); });
}
