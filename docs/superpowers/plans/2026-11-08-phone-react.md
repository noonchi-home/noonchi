# 폰 화면 React 옮기기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰 화면(클로이드의 눈)을 `web/phone/`의 빌드 없는 HTML·JS에서 `ui/`의 React 입구로 옮기고, 21st.dev 부품과 디자인 토큰만으로 그린다. 카메라·영상·엔진 프레임·자세·기준점·말하기·초점은 지금과 똑같이 돈다.

**Architecture:** `web/phone/`의 순수 모듈(capture·display-encoder·encoder-worker·engine·marks·pipeline·project·touch·video)은 로직을 그대로 `ui/src/phone/core/`로 옮기고, `phone.js`에 있던 연결·AR 고리·누르고 말하기는 같은 코드를 `core/link.js`·`core/ar.js`·`core/talk.js`로 떼어 낸다. 화면 글·상태 규칙은 `ui/src/phone/state.ts`(순수 함수)와 `controller.ts`(타이머·보내기)로 옮기고, `PhoneScreen.tsx`는 21st.dev 부품을 배치만 한다. 조준점·초점 고리는 디자인 시스템이 「그림(규칙 밖)」으로 정한 것이라 `draw.ts`가 canvas에 그린다. 폰 서버는 `ui/dist`에서 `/phone/`(=`dist/phone/index.html`)과 빌드 파일 `/assets/`·브랜드 그림·파비콘만 내준다.

**Tech Stack:** React 19 + TypeScript + Vite 8(다중 입구) + Tailwind 4, 21st.dev 부품(`ui/src/components/ui`), lucide-react, vitest(루트 node, ui jsdom), Node 22.15 서버(`src/phone/server.ts`), WebXR(immersive-ar, dom-overlay, hit-test, camera-access), WebCodecs, OffscreenCanvas 워커.

**Spec:**
- 사용자 결정(2026-11-08): (3) 폰 화면은 React로 옮기고 21st.dev 부품으로만 만든다. (1) 트윈 말풍선은 디자인 시스템 전 크기, (2) 시안 B·C 삭제, (4) 「진행 중」 반짝임 끔은 이미 반영됐다(커밋 ea477ca·310415a).
- 디자인 시스템: `C:/Users/ABC/AppData/Local/Temp/claude/eead35b1142cee90/61d6f935-50a4-41c8-9622-f578cdb45009/scratchpad/design-system/spec.md`(1절 폰 원칙, 3절 폰 영상 위 대비, 4절 글꼴, 5절 유리·움직임, 6절 아이콘·마스코트, 9절 부품 F1~F15), `tokens.json`, `components.json`(parts F1~F15의 `later`). 저장소 토큰 원본은 `src/design/tokens.json`, `npm run tokens`.
- 옮기기 전 화면: `web/phone/index.html`·`phone.css`·`phone.js`, 사진 `.../scratchpad/design-system/before/phone-390-*.png`·`after/noonchi/phone-390-*.png`.
- 저장소 `CLAUDE.md` 규칙 표.

## Global Constraints

- 작업 폴더: `C:/Users/ABC/Desktop/소웨공/twin-home-noonchi`, 브랜치 `feat/noonchi`. 시작 커밋 `14db38f`(작은 고침 ea477ca·310415a·c2bc488·14db38f 뒤).
- 무거운 일 잠금: 시험(파일 하나도)·빌드·Docker·헤드리스 크롬은 저장소 뿌리에서 `H <명령>`으로만 돌린다. `H` = `npm --prefix C:/Users/ABC/Desktop/소웨공/twin-home-noonchi run heavy --`. 「다른 무거운 일이 돌고 있어요」면 `bash C:/Users/ABC/AppData/Local/Temp/claude/eead35b1142cee90/61d6f935-50a4-41c8-9622-f578cdb45009/scratchpad/design-system/heavy-retry.sh C:/Users/ABC/Desktop/소웨공/twin-home-noonchi <명령>`으로 다시 시도한다. 캡처는 `npm run capture`(스스로 잠금을 잡는다)로만, 크롬은 한 번에 하나.
- 포트: 화면 사진 서버는 8520~8529(`PORT`·`PHONE_PORT`). 컨테이너 확인은 8500·8510·8530. 8600은 시안 미리보기. 8200·8210·5173·8700은 건드리지 않는다. 내가 띄운 프로세스만, PID가 4보다 큰지 보고 끈다.
- 실제 모델 API·ThinQ를 부르지 않는다. `.env`·키 파일을 읽거나 찍지 않는다(이 작업 폴더에는 `.env`가 없다. `Test-Path .env`로만 본다).
- git: 경로를 하나씩 `git add`. 저장소 전체 add·reset·checkout·stash 금지, force-push 금지, push 안 함. `graft/`·`.ignore`·커밋 안 된 `.gitignore` 변경은 건드리지 않는다. 지금 `ui/src/tokens.css`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`web/phone/tokens.css`·`web/phone/tokens.js`·`web/phone/fonts/*`가 「바뀜」으로 보이지만 줄끝만 다르다(`git diff --ignore-cr-at-eol --stat`이 빈 줄). 앞의 둘은 스테이지하지 않는다. 뒤의 것은 작업 7에서 지운다.
- 커밋 메시지: 영어, 무엇이 바뀌었는지만, 마지막 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 시험 먼저: 새 시험이 먼저 실패하는 것을 본 뒤 구현한다. 이 PC의 EFAULT 소켓 오류가 다시 돌려 통과하면 괜찮다. 보고에 적는다.
- 부품: 보이는 것은 `ui/src/components/ui`의 21st.dev 부품만. 고칠 수 있는 것은 토큰 색·글꼴·모서리·그림자, 한국어 글, 안 쓰는 기능 빼기, 데이터 연결. 부품을 고치면 맨 위 `// 바꾼 것:` 줄에 적고, `mcp__21st__get_component`(ToolSearch `select:mcp__21st__search,mcp__21st__get_component`)로 받은 코드와 견준다. 화면 코드는 배치 class만(flex·grid·gap·여백·크기·위치·z·overflow·숨김·pointer-events·transform·whitespace). 날 색 없음. `npm run lint`가 글·색·부품 규칙을 본다.
- 화면 글: 사용자 할 일과 지금 상태만(CLAUDE.md). 글은 옮기기 전 `phone.js`·`index.html`과 같게 둔다. 글자 아이콘(🎙·📷·■·⋯·🤖)이 단추·줄 머리에 있던 자리는 lucide 아이콘(Mic·Camera·Square·Ellipsis·Bot)으로 바꾼다. 「🎙 …」처럼 줄 글 안에 있던 것은 그대로 둔다.
- 폰 원칙(spec 1절): 390px 한 손. 누르는 것 48px 이상, 주 동작은 아래. 옆 여백 16px, 아래 `env(safe-area-inset-bottom) + 16px`. 카메라 영상 위 글은 판 위 ink·덮개 위 on-scrim만, 14px(body-sm) 이상.
- 지금과 똑같이 둘 것: 카메라 잡기(capture.js), 표시 영상(display-encoder.js·video.js·encoder-worker.js), 엔진 프레임 규칙(engine.js·`engine_ms`), 자세·투영(project.js·pose 0.1초), 기준점(touch.js·floor/touch 기록), 말하기·답·승인·부탁(say·reply·confirm·cancel·request·action·brain_reply), 초점(focus·marks.js). 이 모듈의 로직은 옮기기만 하고 다시 쓰지 않는다.
- 그룹 끝 검사(작업 9에서 모두 통과):

```
H npx vitest run
H npm --prefix ui test
H npx tsc --noEmit
H npm --prefix ui run typecheck
H npm run lint
H npm --prefix ui run build
H docker build -t noonchi:check .
H npx tsx scripts/container-smoke.ts
```

---

## 파일 지도

| 파일 | 맡는 일 | 작업 |
|---|---|---|
| `ui/src/components/ui/button.tsx`·`status.tsx`·`alert.tsx` | 폰용 변형: Button `size="touch"`, Status `variant="scrim"`·`size="touch"`, Alert `variant="brand"`·`size="lg"` | 1 |
| `web/phone/link.js`·`ar.js`·`talk.js`(+`.d.ts`) → 작업 6에서 `ui/src/phone/core/` | phone.js의 연결·시계, AR 세션·프레임 고리, 누르고 말하기·읽기 | 2 |
| `tests/phone-link.test.ts`·`phone-ar.test.ts`·`phone-talk.test.ts` | 위 셋을 가짜 소켓·가짜 XR·가짜 음성 인식으로 | 2 |
| `ui/src/phone/state.ts` | 화면 상태 형, 글 만드는 순수 함수, 메시지 → 상태, 작은 저장소 | 3 |
| `ui/src/phone/draw.ts` | 조준점·초점 고리·화면 밖 화살표·이름표 canvas 그림 | 4 |
| `ui/src/phone/PhoneScreen.tsx`, `ui/src/phone/fixtures.ts` | 상태 하나를 부품으로 배치, 상태 예시 | 5 |
| `ui/src/phone/core/*` | 옮긴 모듈(로직 그대로), `font-faces.js`(만든 파일) | 6 |
| `ui/src/phone/controller.ts`, `PhoneApp.tsx`, `main.tsx`, `ui/phone/index.html` | 제어·뿌리·입구 | 6 |
| `ui/vite.config.ts`, `ui/tsconfig.json` | 입구 `phone`, `../src/design/tokens.ts` | 4·6·9 |
| `src/phone/server.ts`, `src/phone/links.ts` | `ui/dist`에서 폰 화면 내주기, tailscale 뿌리 mount만 | 6 |
| `scripts/design-tokens.ts` | 워커 글꼴 목록 `ui/src/phone/core/font-faces.js`(작업 6), 폰 전용 출력 없앰(작업 7) | 6·7 |
| `scripts/lint-ui-color.ts`·`lint-ui-copy.ts`·`lint-ui-parts.ts` | 폰 입구 HTML, `.js`, 폰 날 요소 | 7·8 |
| `CLAUDE.md`, `docs/reference.md`, `README.md`, `THIRD_PARTY.md`, `ui/public/brand/README.md`, `src/server/static.ts` | 규칙 표의 폰 예외 줄 지움, 문서 | 7·8 |
| `ui/phone/shots/index.html`, `ui/src/phone/shots.tsx` | 상태마다 390×844 사진을 찍는 페이지(`PHONE_SHOTS=1` 빌드에만) | 9 |
| `Dockerfile`, `tests/deploy-files.test.ts` | 실행 이미지에서 `COPY web web` 뺌 | 6 |

### 상태마다 쓰는 부품(components.json F1~F15)

| 상태·자리 | 부품(id, slug) | 쓰는 법 |
|---|---|---|
| 처음 화면 제목·AR 지원 줄·안내(F1) | Card(1551, shadcn/card) | CardTitle 「클로이드의 눈」, CardDescription 지원 줄(role=status), CardContent 안내 `<ol>` |
| AR 시작(F2·F11) | Button(133, originui/button) | default, `size="touch"`, `h-12 w-full`. 확인 중·보안 아님·AR 없음이면 disabled |
| 누르고 말하기(F3) | Button(133) | default, 듣는 동안 destructive. Mic 아이콘 |
| 글 입력·보내기(F4) | Input(159, originui/input), Button(133) | `h-12`, maxLength 500. AR 중에는 ⋯ 메뉴 안 |
| 조준점(F5)·초점 고리·화살표·이름표(F13) | 그림(규칙 밖) | `draw.ts`가 canvas에 |
| 위 상태 줄·보낸 장 수·판단 줄(F6) | Status(25393, diceui/status) | `variant="scrim"`(scrim-phone 바탕, on-scrim 글), `size="touch"`(14px) |
| ⋯ 단추·메뉴(F7) | Button(133) ghost + Liquid Glass(40333, manuarora700/liquid-glass) | 단추는 LiquidGlass 알약 안, 메뉴 판은 LiquidGlass radius 16. 둘 다 `mode="opaque"` |
| 사진 요청 큰 글(F8) | Alert(11326, coss.com/alert) | `variant="brand"` `size="lg"`(headline), Camera 아이콘 |
| 행동 부탁 카드·「모의」·「클로이드라면」(F9) | Card(1551), Status(25393) | Status warning touch + TriangleAlert, CardContent에 「클로이드라면」 줄(ink), 선택 단추 첫째 default·나머지 outline |
| 기준점 단추·큰 단추 셋·알림·승인 대기(F10) | Button(133), Liquid Glass(40333), Card(1551), Basic Item(28573, bundui/item1) | 기준점 outline `h-12`, 큰 단추 `h-16 w-[76px]`, 알림은 LiquidGlass 알약(role=status), 승인 대기는 Card 안 Item(size sm) + 승인·취소 Button |
| 답 줄 | Alert(11326) | default, MessageSquare, role=status |
| 측정 글(F12) | Card(1551) | CardContent 안 `<pre>` |
| 글꼴(F14) | — | `@fontsource-variable/noto-sans-kr`(ui 꾸러미), 워커는 `core/font-faces.js` |
| 마스코트(F15) | 그림 | `<img src="/brand/mascot@1x.webp">` 높이 96px, 위아래 10px |

새로 받을 21st.dev 부품은 없다. Button·Status·Alert는 변형만 더한다(토큰 색·글꼴만, 작업 1).

---

### 작업 0: 시작 전 확인(커밋 없음)

- [ ] **Step 1: 상태 보기**

```
git -C C:/Users/ABC/Desktop/소웨공/twin-home-noonchi status --short
git -C C:/Users/ABC/Desktop/소웨공/twin-home-noonchi diff --ignore-cr-at-eol --stat
git -C C:/Users/ABC/Desktop/소웨공/twin-home-noonchi log --oneline -1
```

Expected: 브랜치 `feat/noonchi`, HEAD `14db38f` 이후, 줄끝만 다른 파일 외 content diff는 `.gitignore` 3줄뿐.

- [ ] **Step 2: 시작 기준선**

```
H npx vitest run tests/phone-server.test.ts tests/phone-design.test.ts tests/design-tokens.test.ts tests/lint-ui-color.test.ts tests/lint-ui-copy.test.ts tests/lint-ui-parts.test.ts
H npm --prefix ui test
H npm run lint
```

Expected: 모두 PASS. 실패하면 systematic-debugging으로 원인을 먼저 본다(이 계획 밖 실패면 멈추고 보고).

---

### 작업 1: 폰용 부품 변형

**Files:**
- Modify: `ui/src/components/ui/button.tsx`, `ui/src/components/ui/status.tsx`, `ui/src/components/ui/alert.tsx`
- Test: `ui/tests/phone-parts.test.tsx`

**Interfaces:**
- Produces: `<Button size="touch">`(default 크기 + `text-body-sm`), `<Status variant="scrim" size="touch">`, `<Alert variant="brand" size="lg">`. 작업 5가 쓴다.

- [ ] **Step 1: 받은 코드와 견주기**

`mcp__21st__get_component`로 id 133(Button), 25393(Status), 11326(Alert)을 받아 지금 파일과 구조가 같은지 본다(바꾼 것 줄 밖의 차이가 없어야 한다). 하루 받기 수가 모자라면 보고에 적고 넘어간다.

- [ ] **Step 2: 실패하는 시험**

`ui/tests/phone-parts.test.tsx`:

```tsx
// 폰 화면이 쓰는 부품 변형: 영상 위 글 14px(body-sm 토큰), 상태 줄 scrim 바탕, 사진 요청 brand 바탕·headline 글.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, AlertTitle } from "../src/components/ui/alert";
import { Button } from "../src/components/ui/button";
import { Status, StatusLabel } from "../src/components/ui/status";

const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("폰용 부품 변형", () => {
  it("Button size touch는 body-sm 글이고, 키는 배치 class로 키운다", () => {
    render(<Button size="touch" className="h-12">AR 시작</Button>);
    const w = words(screen.getByRole("button", { name: "AR 시작" }));
    expect(w).toEqual(expect.arrayContaining(["text-body-sm", "h-12"]));
    expect(w).not.toContain("text-label");
    expect(w).not.toContain("h-9");
  });

  it("Status scrim은 scrim-phone 바탕에 on-scrim 글, size touch는 body-sm", () => {
    render(<Status variant="scrim" size="touch"><StatusLabel>맞추기 전</StatusLabel></Status>);
    const w = words(screen.getByText("맞추기 전").closest("[data-slot=status]")!);
    expect(w).toEqual(expect.arrayContaining(["bg-scrim-phone", "text-on-scrim", "text-body-sm"]));
    expect(w).not.toContain("text-label");
  });

  it("Alert brand는 brand 바탕에 on-brand 글, size lg는 headline 글", () => {
    render(<Alert variant="brand" size="lg"><AlertTitle>컵 안을 비춰 주세요</AlertTitle></Alert>);
    const w = words(screen.getByRole("alert"));
    expect(w).toEqual(expect.arrayContaining(["bg-brand", "text-on-brand", "text-headline"]));
    expect(w).not.toContain("text-body-sm");
  });

  it("기본 변형은 그대로다", () => {
    render(<><Button>설정</Button><Status><StatusLabel>연결됨</StatusLabel></Status></>);
    expect(words(screen.getByRole("button", { name: "설정" }))).toEqual(expect.arrayContaining(["text-label", "h-9"]));
    expect(words(screen.getByText("연결됨").closest("[data-slot=status]")!)).toContain("text-label");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `H npm --prefix ui test -- tests/phone-parts.test.tsx`
Expected: FAIL(Button에 `text-label`·`h-9`가 남음, Status·Alert에 scrim·brand class 없음).

- [ ] **Step 4: Button**

`ui/src/components/ui/button.tsx` 2번째 줄 끝에 이어 쓴다:

```
// 바꾼 것: shadow-black/5 → shadow-shade/5, text-sm·text-xs → label 토큰, hover:bg-accent·hover:text-accent-foreground → hover:bg-hover·hover:text-ink(accent 별칭 없음). 폰 영상 위 글 14px를 위해 size touch(default 크기에 body-sm 토큰)를 더함.
```

`size` 안 `icon: "h-9 w-9",` 다음 줄에 더한다:

```ts
        touch: "h-9 px-4 py-2 text-body-sm",
```

- [ ] **Step 5: Status**

`ui/src/components/ui/status.tsx` 3번째 줄 다음에 줄을 더한다:

```
// 폰 AR 상태 줄용 scrim variant(scrim-phone 바탕, on-scrim 글·점)와 size touch(body-sm 토큰, 영상 위 글 14px)를 더함.
```

`brand:` variant부터 `defaultVariants` 끝까지를 바꾼다:

```ts
        brand:
          "border-transparent bg-muted text-brand **:data-[slot=status-indicator]:bg-brand",
        scrim:
          "border-transparent bg-scrim-phone text-on-scrim **:data-[slot=status-indicator]:bg-on-scrim",
      },
      size: {
        default: "",
        touch: "text-body-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
```

`Status` 함수:

```tsx
function Status(props: StatusProps) {
  const { className, variant = "default", size = "default", asChild, ...rootProps } = props;

  const RootPrimitive = asChild ? Slot : "div";

  return (
    <RootPrimitive
      data-slot="status"
      data-variant={variant}
      {...rootProps}
      className={cn(statusVariants({ variant, size }), className)}
    />
  );
}
```

- [ ] **Step 6: Alert**

`ui/src/components/ui/alert.tsx` 2번째 줄 끝에 ` 폰 사진 요청용 brand variant(brand 바탕, on-brand 글·아이콘)와 size lg(headline 토큰)를 더함.`을 이어 쓴다. cva를 바꾼다:

```ts
    defaultVariants: {
      variant: "default",
      size: "default",
    },
    variants: {
      variant: {
        default:
          "bg-transparent text-card-foreground [&>svg]:text-muted-foreground",
        error:
          "border-error/30 bg-error/5 text-error [&>svg]:text-error",
        success:
          "border-ok/30 bg-ok/5 text-ok [&>svg]:text-ok",
        warning:
          "border-warn/30 bg-warn/5 text-warn [&>svg]:text-warn",
        brand:
          "border-brand bg-brand text-on-brand [&>svg]:text-on-brand",
      },
      size: {
        default: "",
        lg: "text-headline",
      },
    },
```

`Alert` 함수:

```tsx
export function Alert({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants>): React.ReactElement {
  return (
    <div
      className={cn(alertVariants({ variant, size }), className)}
      data-slot="alert"
      role="alert"
      {...props}
    />
  );
}
```

- [ ] **Step 7: 통과 확인**

```
H npm --prefix ui test -- tests/phone-parts.test.tsx tests/reduced-motion.test.tsx tests/smoke.test.tsx
H npm --prefix ui run typecheck
H npm run lint
```

Expected: PASS, lint 0곳.

- [ ] **Step 8: 커밋**

```
git add ui/src/components/ui/button.tsx ui/src/components/ui/status.tsx ui/src/components/ui/alert.tsx ui/tests/phone-parts.test.tsx
git commit -m "feat(ui): add phone variants to the Button, Status and Alert parts" -m "Button size touch keeps the default size with body-sm text, Status gets a scrim variant and a touch size, and Alert gets a brand variant with an lg headline size, so text over the camera view stays at 14px or more." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 2: phone.js의 연결·AR·말하기를 모듈로 떼기

`phone.js`는 그대로 둔다(옛 화면이 작업 6까지 돈다). 같은 코드를 새 모듈로 옮겨 시험으로 묶는다. 작업 6에서 phone.js를 지운다.

**Files:**
- Create: `web/phone/link.js`, `web/phone/link.d.ts`, `web/phone/ar.js`, `web/phone/ar.d.ts`, `web/phone/talk.js`, `web/phone/talk.d.ts`
- Test: `tests/phone-link.test.ts`, `tests/phone-ar.test.ts`, `tests/phone-talk.test.ts`

**Interfaces:**
- Produces:
  - `phoneSocketUrl(loc: { protocol: string; host: string }): string`
  - `createLink({ url, onMessage, Socket?, now? }): PhoneLink` — `send(msg): boolean`, `socket()`, `open()`, `stamp(phoneMs)`, `close()`
  - `createAr({ link, params, hooks, deps? }): PhoneAr` — `state`, `start(overlay)`, `stop()`, `requestPhoto()`, `setEngineMs(ms)`, `setFocus(targets, ttlMs)`, `perf(): { fps, detail }`. hooks: `onStart`, `onEnd`, `onHit(hit)`, `onMarks(marks)`, `onPerf`, `note(text)`
  - `createPressToTalk(Recognition, { onListening, onLine, onHeard }): { down(), up() }`, `speak(text)`, `recognition(w?)`

- [ ] **Step 1: 실패하는 시험 셋**

`tests/phone-link.test.ts`:

```ts
// 폰 ↔ 폰 서버 연결(link.js): https면 wss로 /phone/events, 붙으면 시계 핑(바로·2초마다), clock 답으로 촬영 시각·오차를 맞추고, 끊기면 1초 뒤 다시 붙는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, phoneSocketUrl } from "../web/phone/link.js";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  addEventListener(type: string, fn: (e: any) => void) { (this.on[type] ??= []).push(fn); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.fire("close", {}); }
  fire(type: string, e: unknown) { for (const fn of this.on[type] ?? []) fn(e); }
  open() { this.readyState = 1; this.fire("open", {}); }
  push(msg: unknown) { this.fire("message", { data: JSON.stringify(msg) }); }
}

let t = 0;
beforeEach(() => { FakeSocket.all = []; t = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const make = (onMessage = (_: unknown) => {}) => createLink({ url: "ws://pc/phone/events", onMessage, Socket: FakeSocket as never, now: () => t });

describe("폰 연결(link.js)", () => {
  it("https면 wss, 아니면 ws로 /phone/events", () => {
    expect(phoneSocketUrl({ protocol: "https:", host: "pc.ts.net:8443" })).toBe("wss://pc.ts.net:8443/phone/events");
    expect(phoneSocketUrl({ protocol: "http:", host: "192.168.0.7:8210" })).toBe("ws://192.168.0.7:8210/phone/events");
  });

  it("열리기 전에는 보내지 않고 false. 열리면 바로·2초마다 clock 핑", () => {
    const link = make();
    const ws = FakeSocket.all[0]!;
    expect(link.send({ type: "pose" })).toBe(false);
    ws.open();
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ type: "clock", t0: 0 }]);
    vi.advanceTimersByTime(4000);
    expect(ws.sent.filter((s) => JSON.parse(s).type === "clock")).toHaveLength(3);
    expect(link.send({ type: "pose" })).toBe(true);
    link.close();
  });

  it("clock 답 중 왕복이 가장 짧은 표본으로 촬영 시각·오차를 붙인다. 표본이 없으면 빈 객체. clock은 화면으로 넘기지 않는다", () => {
    const seen: unknown[] = [];
    const link = make((m) => seen.push(m));
    const ws = FakeSocket.all[0]!;
    expect(link.stamp(1000)).toEqual({});
    ws.open();
    t = 1000;
    ws.push({ type: "clock", t0: 960, server: 5980 }); // 왕복 40, 차 5000
    ws.push({ type: "clock", t0: 990, server: 7995 }); // 왕복 10, 차 7000 → 이것
    ws.push({ type: "status", anchors: [] });
    expect(seen).toEqual([{ type: "status", anchors: [] }]);
    expect(link.stamp(1000)).toEqual({ captured_at: 8000, time_err_ms: 5 });
    link.close();
  });

  it("끊기면 1초 뒤 다시 붙고, close() 뒤에는 다시 붙지 않는다", () => {
    const link = make();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.close();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    link.close();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all).toHaveLength(2);
  });
});
```

`tests/phone-talk.test.ts`:

```ts
// 누르고 말하기(talk.js): 누르면 크롬 음성 인식(ko-KR)으로 듣고, 들은 글을 15초 줄로 보이고, 떼면 그 글을 보낸다.
import { describe, expect, it } from "vitest";
import { createPressToTalk, recognition } from "../web/phone/talk.js";

class FakeRec {
  static last: FakeRec;
  lang = "";
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  constructor() { FakeRec.last = this; }
  start() { this.started += 1; }
  stop() { this.onend?.(); }
}

function hooks() {
  const log: string[] = [];
  return {
    log,
    h: {
      onListening: (on: boolean) => log.push(on ? "듣는 중" : "멈춤"),
      onLine: (text: string, ms?: number) => log.push(`줄 ${text}${ms ? ` ${ms}` : ""}`),
      onHeard: (text: string) => log.push(`보냄 ${text}`),
    },
  };
}

describe("누르고 말하기(talk.js)", () => {
  it("누르면 ko-KR로 듣고, 들은 글을 15초 줄로, 떼면 그 글을 보낸다. 듣는 중에 또 눌러도 새로 만들지 않는다", () => {
    const { log, h } = hooks();
    const talk = createPressToTalk(FakeRec as never, h);
    talk.down();
    const rec = FakeRec.last;
    expect([rec.lang, rec.interimResults, rec.maxAlternatives, rec.started]).toEqual(["ko-KR", true, 1, 1]);
    talk.down();
    expect(FakeRec.last).toBe(rec);
    rec.onresult!({ results: [[{ transcript: "TV " }], [{ transcript: "켜줘" }]] });
    talk.up();
    expect(log).toEqual(["듣는 중", "줄 🎙 TV 켜줘 15000", "멈춤", "보냄 TV 켜줘"]);
  });

  it("아무 말도 없으면 보내지 않는다. 마이크 권한이 없으면 허용하라고, 다른 오류는 그 이름", () => {
    const { log, h } = hooks();
    const talk = createPressToTalk(FakeRec as never, h);
    talk.down();
    FakeRec.last.onerror!({ error: "not-allowed" });
    FakeRec.last.onerror!({ error: "network" });
    talk.up();
    expect(log).toEqual(["듣는 중", "줄 마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요.", "줄 음성 인식 오류: network", "멈춤"]);
  });

  it("시작이 실패하면 그 까닭을 보이고 듣지 않는다", () => {
    class Busy extends FakeRec { override start() { throw new Error("busy"); } }
    const { log, h } = hooks();
    createPressToTalk(Busy as never, h).down();
    expect(log).toEqual(["줄 음성 인식을 시작하지 못했어요: busy"]);
  });

  it("음성 인식이 없는 브라우저는 null", () => {
    expect(recognition({})).toBeNull();
    expect(recognition({ webkitSpeechRecognition: FakeRec })).toBe(FakeRec);
  });
});
```

`tests/phone-ar.test.ts`:

```ts
// 폰 AR(ar.js)을 가짜 XR 세션으로 돌린다. 옮기기 전 phone.js와 같은 규칙인지 본다: 시작하면 원점 이름을 새로 정해 reset,
// 자세는 0.1초마다, 조준점·초점은 hooks로, 카메라가 있으면 화면 프레임(0.55, 초점 고리)·사진(원본, 0.9)·엔진 프레임(0.8, 투영 행렬·촬영 시각).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAr } from "../web/phone/ar.js";

type Fn = (...a: any[]) => void;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function fakeSession() {
  const on: Record<string, Fn[]> = {};
  let raf: Fn | null = null;
  return {
    requested: [] as unknown[],
    renderState: { baseLayer: { framebuffer: "fb" } },
    updateRenderState() {},
    async requestReferenceSpace(kind: string) { return { kind, addEventListener: (t: string, f: Fn) => { (on[`space-${t}`] ??= []).push(f); } }; },
    async requestHitTestSource() { return "hits"; },
    addEventListener(t: string, f: Fn) { (on[t] ??= []).push(f); },
    requestAnimationFrame(f: Fn) { raf = f; },
    end() { for (const f of on.end ?? []) f(); },
    fire(t: string) { for (const f of on[t] ?? []) f(); },
    step(time: number, frame: unknown) { const f = raf; raf = null; f?.(time, frame); },
  };
}

function frame({ hit = [0, 0, -1] as number[] | null, pose = true, camera = false, limited = false } = {}) {
  return {
    getHitTestResults: () => (hit ? [{ getPose: () => ({ transform: { position: { x: hit[0], y: hit[1], z: hit[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }] : []),
    getViewerPose: () => (pose ? {
      emulatedPosition: limited,
      transform: { position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      views: [{ projectionMatrix: identity, transform: { inverse: { matrix: identity } }, camera: camera ? { width: 640, height: 480 } : undefined }],
    } : null),
  };
}

/** [헤더 길이 u32][JSON 헤더][JPEG] 묶음의 헤더. */
async function header(blob: Blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const n = new DataView(b.buffer, b.byteOffset).getUint32(0);
  return JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + n)));
}

function setup({ camera = false } = {}) {
  const session = fakeSession();
  const sent: Record<string, any>[] = [];
  const socket = { readyState: 1, bufferedAmount: 0, binary: [] as Blob[], send(d: Blob) { this.binary.push(d); } };
  const link = { send: (m: Record<string, unknown>) => { sent.push(m); return true; }, socket: () => socket, open: () => true, stamp: () => ({ captured_at: 5, time_err_ms: 1 }), close() {} };
  const log: string[] = [];
  const marks: unknown[][] = [];
  const hooks = {
    onStart: () => log.push("start"), onEnd: () => log.push("end"),
    onHit: (h: boolean) => log.push(h ? "hit" : "miss"), onMarks: (m: unknown[]) => marks.push(m),
    onPerf: () => log.push("perf"), note: (text: string) => log.push(`note ${text}`),
  };
  const toJpeg = vi.fn(async (..._args: unknown[]) => new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
  const deps = {
    xr: () => ({ requestSession: async (mode: string, opts: unknown) => { session.requested.push([mode, opts]); return session; } }),
    gl: () => ({ FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} }),
    layer: () => ({}),
    binding: () => (camera ? { getCameraImage: () => "texture" } : null),
    createGrabber: () => ({ encoderMode: "worker×2", grab: (_t: unknown, w: number, h: number) => new Uint8Array(w * h * 4), toJpeg }),
    createDisplayEncoder: () => ({ frame() {}, close() {}, describe: () => "표시 영상 시험" }),
  };
  const ar = createAr({ link, params: new URLSearchParams(""), hooks, deps });
  stops.push(() => ar.stop());
  return { ar, session, sent, socket, log, marks, toJpeg };
}

const overlay = {};
const stops: (() => void)[] = [];
afterEach(() => { while (stops.length) stops.pop()!(); });

describe("폰 AR(ar.js)", () => {
  it("시작: DOM 오버레이·hit-test로 세션을 열고, 새 원점 이름으로 reset을 보낸다. 카메라가 없으면 「카메라 없음」", async () => {
    const t = setup();
    await t.ar.start(overlay);
    expect(t.session.requested).toEqual([["immersive-ar", { requiredFeatures: ["local", "hit-test", "dom-overlay"], optionalFeatures: ["camera-access"], domOverlay: { root: overlay } }]]);
    expect(t.log[0]).toBe("start");
    expect(t.ar.state.on).toBe(true);
    expect(t.ar.state.epoch).toMatch(/^[0-9a-z]+-[0-9a-z]{1,6}$/);
    expect(t.sent).toEqual([{ type: "reset", epoch: t.ar.state.epoch }]);
    expect(t.ar.state.encoder).toBe("카메라 없음");
  });

  it("자세는 0.1초마다 조준점·원점 이름과 함께. 조준점이 바닥에 닿으면 hit, 바닥 후보도 그 점", async () => {
    const t = setup();
    await t.ar.start(overlay);
    for (const time of [100, 150, 200]) t.session.step(time, frame());
    const poses = t.sent.filter((m) => m.type === "pose");
    expect(poses).toHaveLength(2);
    expect(poses[0]).toEqual({ type: "pose", position: [0, 1.5, 0], orientation: [0, 0, 0, 1], tracking: "ok", hit: [0, 0, -1], epoch: t.ar.state.epoch });
    expect(t.log.filter((l) => l === "hit")).toHaveLength(3);
    expect(t.ar.state.lastFloor).toEqual([0, 0, -1]);
    t.session.step(300, frame({ hit: null }));
    expect(t.log.at(-1)).toBe("miss");
    expect(t.ar.state.lastFloor).toBeNull();
  });

  it("자세가 없으면 바닥 후보를 지우고 자세·초점을 보내지 않는다. 추적이 약하면 limited", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.session.step(100, frame({ pose: false }));
    expect(t.ar.state.lastFloor).toBeNull();
    expect(t.sent.filter((m) => m.type === "pose")).toEqual([]);
    expect(t.marks).toEqual([]);
    t.session.step(200, frame({ limited: true }));
    expect(t.ar.state.limited).toBe(true);
    expect(t.sent.at(-1)).toMatchObject({ type: "pose", tracking: "limited" });
  });

  it("초점: 기간 안에는 화면 위 표시(u·v)를 hooks로, 지나면 빈 목록", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.ar.setFocus([{ id: "cup", label: "컵", ar: [0, 0, -0.5] }], 8000);
    t.session.step(100, frame());
    expect(t.marks.at(-1)).toEqual([{ id: "cup", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 }]);
    t.session.step(performance.now() + 9000, frame());
    expect(t.marks.at(-1)).toEqual([]);
  });

  it("추적 원점이 바뀌면 원점 이름을 새로 정해 reset을 보내고 다시 기록하라고 알린다", async () => {
    const t = setup();
    await t.ar.start(overlay);
    const first = t.ar.state.epoch;
    t.session.fire("space-reset");
    expect(t.ar.state.epoch).not.toBe(first);
    expect(t.sent.at(-1)).toEqual({ type: "reset", epoch: t.ar.state.epoch });
    expect(t.log).toContain("note 추적 원점이 바뀌어 맞춤을 지웠어요. 기준점을 다시 기록해 주세요");
  });

  it("끝내면 초점 표시를 지우고 덮개를 닫는다", async () => {
    const t = setup();
    await t.ar.start(overlay);
    t.ar.stop();
    expect(t.marks.at(-1)).toEqual([]);
    expect(t.log.at(-1)).toBe("end");
    expect(t.ar.state.on).toBe(false);
  });

  it("카메라가 있으면 화면 프레임·사진·엔진 프레임을 보낸다", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    expect(t.ar.state.encoder).toBe("worker×2");
    t.ar.setFocus([{ id: "cup", label: "컵", ar: [0, 0, -0.5] }], 8000);
    t.session.step(100, frame({ camera: true }));
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(1));
    expect(await header(t.socket.binary[0]!)).toMatchObject({ kind: "frame", width: 480, height: 360, tracking: "ok", epoch: t.ar.state.epoch, captured_at: 5, time_err_ms: 1 });
    expect(t.toJpeg.mock.calls[0]!.slice(1, 4)).toEqual([480, 360, 0.55]);
    expect(t.toJpeg.mock.calls[0]![4]).toHaveLength(1);
    t.ar.requestPhoto();
    t.session.step(110, frame({ camera: true })); // 사진은 화면 프레임 간격과 상관없이 바로
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(2));
    expect(await header(t.socket.binary[1]!)).toMatchObject({ kind: "photo", width: 640, height: 480 });
    expect(t.toJpeg.mock.calls[1]!.slice(1, 5)).toEqual([640, 480, 0.9, []]);
    t.ar.setEngineMs(1000);
    t.session.step(120, frame({ camera: true })); // 화면 프레임 간격 전: 엔진 프레임만
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(3));
    expect(await header(t.socket.binary[2]!)).toMatchObject({ kind: "engine", width: 480, height: 360, projection: identity, captured_at: 5 });
    expect(t.toJpeg.mock.calls[2]!.slice(3, 5)).toEqual([0.8, []]);
  });

  it("측정: 보낸 장 수와 자세한 줄(목표 fps·인코더·크기·표시 영상)", async () => {
    const t = setup({ camera: true });
    await t.ar.start(overlay);
    t.session.step(100, frame({ camera: true }));
    await vi.waitFor(() => expect(t.socket.binary).toHaveLength(1));
    const p = t.ar.perf();
    expect(p.fps).toBe("0.5 fps");
    expect(p.detail.split("\n")).toEqual([
      "보낸 화면 0.5 / 목표 12 fps · 장당 0.0KB",
      expect.stringMatching(/^readPixels [\d.]+ms · 인코딩 [\d.]+ms \(worker×2\)$/),
      "와이파이 대기 0KB · 크기 480×360",
      "2초간 건너뜀: 인코딩 중 0 · 버퍼 가득 0 · 순서 뒤바뀜 0",
      "표시 영상 시험",
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `H npx vitest run tests/phone-link.test.ts tests/phone-talk.test.ts tests/phone-ar.test.ts`
Expected: FAIL(`Failed to load url ../web/phone/link.js` 등).

- [ ] **Step 3: link.js·link.d.ts**

`web/phone/link.js`(phone.js의 connect·send·clockFix·onClock·stamp를 옮겼다):

```js
// 폰 ↔ 폰 서버 연결(phone.js에서 옮겼다): /phone/events WebSocket. 끊기면 1초 뒤 다시 붙는다.
// 시계 맞춤: 붙으면 바로, 그 뒤 2초마다 clock 핑(NTP식)을 보내고, 최근 10개 표본 중 왕복이 가장 짧은 것으로 서버 시계와의 차(offset)를 정한다. 오차는 왕복의 절반.

const CLOCK_MS = 2000;
const RECONNECT_MS = 1000;
const phoneNow = () => performance.timeOrigin + performance.now();

/** 페이지 주소 → 폰 서버 WebSocket 주소(https면 wss). */
export function phoneSocketUrl(loc) {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/phone/events`;
}

/** onMessage: 서버 JSON 메시지(clock 답은 여기서 쓰고 넘기지 않는다). Socket·now는 시험이 바꾼다. */
export function createLink({ url, onMessage, Socket = WebSocket, now = phoneNow }) {
  let ws = null;
  let closed = false;
  let clockSamples = [];
  let clockTimer = null;

  const send = (msg) => {
    if (ws?.readyState !== Socket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  };

  function clockFix() {
    if (!clockSamples.length) return null;
    const best = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    return { offset: best.offset, err: Math.ceil(best.rtt / 2) };
  }

  function onClock(msg) {
    const t1 = now();
    const rtt = t1 - msg.t0;
    if (!(rtt >= 0)) return;
    clockSamples = [...clockSamples, { rtt, offset: msg.server - (msg.t0 + t1) / 2 }].slice(-10);
  }

  function connect() {
    ws = new Socket(url);
    ws.addEventListener("open", () => {
      clockSamples = [];
      const ping = () => send({ type: "clock", t0: now() });
      ping();
      clearInterval(clockTimer);
      clockTimer = setInterval(ping, CLOCK_MS);
    });
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "clock") onClock(msg);
      else onMessage(msg);
    });
    ws.addEventListener("close", () => {
      clearInterval(clockTimer);
      if (!closed) setTimeout(connect, RECONNECT_MS);
    });
  }
  connect();

  return {
    send,
    /** 지금 소켓(바이너리 프레임·bufferedAmount). */
    socket: () => ws,
    open: () => ws?.readyState === Socket.OPEN,
    /** 폰 시각(ms) → 헤더에 붙일 서버 시계 촬영 시각과 오차. 아직 표본이 없으면 빈 객체(서버가 받은 시각을 쓴다). */
    stamp(phoneMs) {
      const fix = clockFix();
      return fix ? { captured_at: Math.round(phoneMs + fix.offset), time_err_ms: fix.err } : {};
    },
    close() {
      closed = true;
      clearInterval(clockTimer);
      ws?.close();
    },
  };
}
```

`web/phone/link.d.ts`:

```ts
// link.js의 형(시험·React 화면이 TypeScript로 부른다).
export interface PhoneSocket { readonly readyState: number; readonly bufferedAmount: number; send(data: unknown): void }
export interface PhoneLink {
  send(msg: object): boolean;
  socket(): PhoneSocket | null;
  open(): boolean;
  stamp(phoneMs: number): { captured_at?: number; time_err_ms?: number };
  close(): void;
}
export function phoneSocketUrl(loc: { protocol: string; host: string }): string;
export function createLink(opts: {
  url: string;
  onMessage: (msg: Record<string, any>) => void;
  Socket?: unknown;
  now?: () => number;
}): PhoneLink;
```

- [ ] **Step 4: talk.js·talk.d.ts**

`web/phone/talk.js`(phone.js의 bindTalk 안 인식 부분과 speak를 옮겼다. 단추 모양 바꾸기는 hooks로):

```js
// 누르고 말하기(phone.js에서 옮겼다): 크롬 내장 음성 인식(ko-KR)으로 받아쓰고, 손을 떼면 멈추고 들은 말을 보낸다. 답은 speak로 읽어 준다.

/** 이 브라우저의 음성 인식(없으면 null). */
export const recognition = (w = globalThis) => w.SpeechRecognition || w.webkitSpeechRecognition || null;

/** hooks: onListening(on) 단추 모양, onLine(text, ms) 들은 말·오류 줄, onHeard(text) 들은 말 보내기. */
export function createPressToTalk(Recognition, hooks) {
  let rec = null;
  let heard = "";
  return {
    down() {
      if (rec) return;
      heard = "";
      rec = new Recognition();
      rec.lang = "ko-KR";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        heard = Array.from(e.results).map((r) => r[0].transcript).join("");
        hooks.onLine(`🎙 ${heard}`, 15000);
      };
      rec.onerror = (e) => hooks.onLine(e.error === "not-allowed" ? "마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요." : `음성 인식 오류: ${e.error}`);
      rec.onend = () => {
        rec = null;
        hooks.onListening(false);
        if (heard.trim()) hooks.onHeard(heard);
      };
      try {
        rec.start();
        globalThis.speechSynthesis?.cancel();
        hooks.onListening(true);
      } catch (error) {
        rec = null;
        hooks.onLine(`음성 인식을 시작하지 못했어요: ${error.message}`);
      }
    },
    up() {
      rec?.stop();
    },
  };
}

/** 소리로 읽기(ko-KR, 1.05배). 음성 합성이 없거나 글이 비면 하지 않는다. */
export function speak(text) {
  if (!("speechSynthesis" in globalThis) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
```

`web/phone/talk.d.ts`:

```ts
// talk.js의 형.
export type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
export interface TalkHooks { onListening(on: boolean): void; onLine(text: string, ms?: number): void; onHeard(text: string): void }
export interface PressToTalk { down(): void; up(): void }
export function recognition(w?: object): RecognitionCtor | null;
export function createPressToTalk(Recognition: RecognitionCtor, hooks: TalkHooks): PressToTalk;
export function speak(text: string): void;
```

- [ ] **Step 5: ar.js·ar.d.ts**

`web/phone/ar.js`(phone.js의 start·onFrame·sendFrame·renderPerf를 옮겼다. `$()` DOM 쓰기만 hooks로 바꿨다):

```js
// 클로이드의 눈 AR(phone.js에서 옮겼다): WebXR AR로 폰 자세를 재고, 화면 가운데 조준점이 가리키는 바닥 점을 기준점·'여기'로 쓴다.
// 자세(+조준점)는 초당 10번, 카메라 화면은 기본 초당 12장(가로 촬영 가로 480px·세로 360px JPEG, ?fps=·?w=로 바꾼다) /phone/events로 보낸다.
// 인코딩은 워커 두 개로 두 장까지 겹치고(capture.js), 순서가 뒤바뀐 오래된 프레임과 와이파이에 쌓인 프레임은 건너뛴다(pipeline.js).
// '사진 찍기'는 카메라 원본 크기로 한 장을 보내고, 서버가 그 순간의 눈 자세를 붙여 저장한다. 트윈 좌표 계산은 서버(src/phone)가 한다.
// 초점: 서버가 보낸 대상(AR 좌표)을 화면 표시(hooks.onMarks)와 대시보드로 가는 화면 프레임에 그린다(사진·엔진 프레임에는 그리지 않음).
// 엔진 프레임(서버 BRAIN=1): 서버가 상태 메시지 engine_ms로 알려 준 간격마다 분석용 JPEG을 따로 보낸다(촬영 순간 자세·투영 행렬·서버 시계 촬영 시각과 오차).
// 화면은 hooks로만 바꾼다: onStart·onEnd(덮개), onHit(조준점이 바닥에 닿음), onMarks(초점 표시), onPerf(1초마다 측정), note(잠깐 알릴 말).

import { createGrabber, framePacket } from "./capture.js";
import { createDisplayEncoder } from "./display-encoder.js";
import { engineDue } from "./engine.js";
import { createFramePipeline, createSendStats, frameWidth } from "./pipeline.js";
import { focusMarks } from "./project.js";
import { floorCandidate } from "./touch.js";

const SEND_MS = 100;
const FRAME_QUALITY = 0.55; // 장 수를 늘린 만큼 한 장 크기를 줄인다(사진은 0.9)
const ENGINE_QUALITY = 0.8; // 엔진 프레임은 YOLOX·VLM이 분석한다
const MAX_BUFFERED = 512 * 1024; // 와이파이가 느리면 프레임을 쌓지 않고 건너뛴다
const OPEN = 1; // WebSocket.OPEN
const clamp = (raw, lo, hi, fallback) => {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
// 이 AR 세션·추적 원점의 이름. 자세·기록·사진에 붙여, 연결이 끊겨 reset을 못 보내도 서버가 이전 원점의 맞춤을 버리게 한다
export const newEpoch = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const browser = {
  xr: () => navigator.xr,
  gl: () => document.createElement("canvas").getContext("webgl", { xrCompatible: true }),
  layer: (session, gl) => new XRWebGLLayer(session, gl),
  // 카메라 접근(camera-access)이 없으면 자세만 보낸다
  binding: (session, gl) => (typeof XRWebGLBinding === "function" ? new XRWebGLBinding(session, gl) : null),
  createGrabber,
  createDisplayEncoder,
};

/** link: link.js. params: 페이지 주소 검색값(fps·w·flip, 표시 영상 v*). deps: 시험이 XR·GL·카메라 잡기·표시 영상을 바꾼다. */
export function createAr({ link, params, hooks, deps = {} }) {
  const d = { ...browser, ...deps };
  const FRAME_MS = 1000 / clamp(params.get("fps"), 1, 30, 12);
  const FLIP = params.get("flip") !== "0";
  const pipeline = createFramePipeline({ maxInFlight: 2 });
  const stats = createSendStats({ windowMs: 2000 });
  /** on(AR 중), epoch(원점 이름), hitPoint(조준점 바닥 점), lastFloor(바닥 후보), limited(추적 약함), size·encoder(측정 글). */
  const state = { on: false, epoch: null, hitPoint: null, lastFloor: null, limited: false, size: "-", encoder: "-" };
  let session = null;
  let display = null; // 표시 영상(H.264, display-encoder.js). 분석용 JPEG와 따로 대시보드 화면에만 간다
  let wantPhoto = false;
  let engineMs = 0;
  let lastEngine = null;
  let lastSent = 0;
  let lastFrame = 0;
  let focus = { targets: [], until: 0 };
  const ws = () => link.socket();

  async function start(overlay) {
    // 전체 화면·가로 고정은 요청하지 않는다. DOM 오버레이도 전체 화면 기능을 써서, 같이 요청하면 AR 화면이 나오지 않았다.
    const xrSession = await d.xr().requestSession("immersive-ar", {
      requiredFeatures: ["local", "hit-test", "dom-overlay"],
      optionalFeatures: ["camera-access"],
      domOverlay: { root: overlay },
    });
    session = xrSession;
    hooks.onStart();
    const gl = d.gl();
    xrSession.updateRenderState({ baseLayer: d.layer(xrSession, gl) });
    const space = await xrSession.requestReferenceSpace("local");
    // 새 AR 세션은 좌표 원점이 새로 잡힌다: 이전 맞춤·기록을 버린다. 추적이 원점을 다시 잡아도(reset) 같다
    state.on = true;
    state.epoch = newEpoch();
    link.send({ type: "reset", epoch: state.epoch });
    space.addEventListener?.("reset", () => {
      state.lastFloor = null;
      state.epoch = newEpoch();
      link.send({ type: "reset", epoch: state.epoch });
      hooks.note("추적 원점이 바뀌어 맞춤을 지웠어요. 기준점을 다시 기록해 주세요");
    });
    const hitSource = await xrSession.requestHitTestSource({ space: await xrSession.requestReferenceSpace("viewer") });
    const binding = d.binding(xrSession, gl);
    const grabber = binding ? d.createGrabber(gl, { flipY: FLIP }) : null;
    state.encoder = grabber?.encoderMode ?? "카메라 없음";
    display = grabber ? d.createDisplayEncoder({ gl, flipY: FLIP, socket: ws, params, onError: hooks.note }) : null;
    let cameraSeen = false;
    setTimeout(() => {
      if (!cameraSeen) hooks.note("카메라 화면을 보낼 수 없어요. 위치만 보내요");
    }, 3000);
    const perfTimer = setInterval(hooks.onPerf, 1000);
    xrSession.addEventListener("end", () => {
      state.on = false;
      state.lastFloor = null;
      display?.close();
      display = null;
      clearInterval(perfTimer);
      session = null;
      hooks.onMarks([]);
      hooks.onEnd();
    });

    // always: 사진·엔진 프레임은 늘 보내고 표시 통계에 넣지 않는다
    const sendFrame = (pixels, header, quality, marks, readMs, always) => {
      const id = pipeline.start();
      const t0 = performance.now();
      grabber.toJpeg(pixels, header.width, header.height, quality, marks)
        .then((jpeg) => {
          const encodeMs = performance.now() - t0;
          // 사진·엔진 프레임은 늘 보낸다. 화면 프레임은 더 새 프레임이 먼저 나갔으면 버린다(순서 뒤바뀜)
          if (!pipeline.finish(id) && !always) {
            stats.skipped("stale");
            return;
          }
          if (ws()?.readyState !== OPEN) return;
          ws().send(framePacket(header, jpeg));
          if (!always) stats.sent({ bytes: jpeg.size, readMs, encodeMs });
        })
        .catch((error) => {
          pipeline.fail(id);
          hooks.note(`화면을 보내지 못했어요: ${error.message}`);
        });
    };

    const onFrame = (time, frame) => {
      xrSession.requestAnimationFrame(onFrame);
      // 아무것도 그리지 않는다(투명). 카메라 화면 위에 DOM 오버레이만 보인다.
      gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const hit = frame.getHitTestResults(hitSource)[0]?.getPose(space);
      state.hitPoint = hit ? [hit.transform.position.x, hit.transform.position.y, hit.transform.position.z] : null;
      const ho = hit?.transform.orientation;
      const hitOrientation = ho ? [ho.x, ho.y, ho.z, ho.w] : null;
      hooks.onHit(Boolean(state.hitPoint));

      const pose = frame.getViewerPose(space);
      if (!pose) {
        state.lastFloor = null;
        return;
      }
      const { position: p, orientation: o } = pose.transform;
      const position = [p.x, p.y, p.z];
      const orientation = [o.x, o.y, o.z, o.w];
      const tracking = pose.emulatedPosition ? "limited" : "ok";
      state.limited = tracking === "limited";
      state.lastFloor = floorCandidate(state.hitPoint, hitOrientation, position);
      if (time - lastSent >= SEND_MS) {
        lastSent = time;
        link.send({ type: "pose", position, orientation, tracking, hit: state.hitPoint, epoch: state.epoch });
      }

      const xrView = pose.views[0];
      const marks = xrView && focus.targets.length && time < focus.until
        ? focusMarks(focus.targets, xrView.projectionMatrix, xrView.transform.inverse.matrix)
        : [];
      hooks.onMarks(marks);

      const camera = xrView?.camera;
      if (!grabber || !camera) return;
      cameraSeen = true;
      display?.frame(binding.getCameraImage(camera), camera, time);
      if (engineMs && engineDue(lastEngine, time, engineMs) && ws()?.readyState === OPEN) {
        lastEngine = time;
        const ew = Math.min(frameWidth(params.get("w"), camera.height > camera.width), camera.width);
        const eh = Math.round((ew * camera.height) / camera.width);
        const e0 = performance.now();
        const enginePixels = grabber.grab(binding.getCameraImage(camera), ew, eh);
        const engineRead = performance.now() - e0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
        const engineHeader = {
          kind: "engine", width: ew, height: eh, position, orientation, tracking, epoch: state.epoch,
          projection: Array.from(xrView.projectionMatrix), ...link.stamp(performance.timeOrigin + time),
        };
        sendFrame(enginePixels, engineHeader, ENGINE_QUALITY, [], engineRead, true);
      }
      const photo = wantPhoto;
      if (!photo && time - lastFrame < FRAME_MS) return;
      if (ws()?.readyState !== OPEN) return;
      if (!photo && !pipeline.canStart()) {
        stats.skipped("encoding");
        return;
      }
      if (!photo && ws().bufferedAmount > MAX_BUFFERED) {
        stats.skipped("buffer");
        return;
      }
      wantPhoto = false;
      lastFrame = time;
      const portrait = camera.height > camera.width;
      const width = photo ? camera.width : Math.min(frameWidth(params.get("w"), portrait), camera.width);
      const height = Math.round((width * camera.height) / camera.width);
      if (!photo) state.size = `${width}×${height}`;
      const t0 = performance.now();
      const pixels = grabber.grab(binding.getCameraImage(camera), width, height);
      const readMs = performance.now() - t0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
      const header = { kind: photo ? "photo" : "frame", width, height, position, orientation, tracking, epoch: state.epoch, ...link.stamp(performance.timeOrigin + time) };
      sendFrame(pixels, header, photo ? 0.9 : FRAME_QUALITY, photo ? [] : marks, readMs, photo);
    };
    xrSession.requestAnimationFrame(onFrame);
  }

  /** 측정: 위 상태 줄의 보낸 fps와 ⋯ 메뉴의 자세한 줄. */
  function perf() {
    const s = stats.snapshot();
    const ms = (v) => (v === null ? "-" : `${v.toFixed(1)}ms`);
    return {
      fps: `${s.fps.toFixed(1)} fps`,
      detail: [
        `보낸 화면 ${s.fps.toFixed(1)} / 목표 ${(1000 / FRAME_MS).toFixed(0)} fps · 장당 ${s.kbPerFrame === null ? "-" : `${s.kbPerFrame.toFixed(1)}KB`}`,
        `readPixels ${ms(s.readMs)} · 인코딩 ${ms(s.encodeMs)} (${state.encoder})`,
        `와이파이 대기 ${Math.round((ws()?.bufferedAmount ?? 0) / 1024)}KB · 크기 ${state.size}`,
        `2초간 건너뜀: 인코딩 중 ${s.skipped.encoding} · 버퍼 가득 ${s.skipped.buffer} · 순서 뒤바뀜 ${s.skipped.stale}`,
        display?.describe() ?? "표시 영상 꺼짐",
      ].join("\n"),
    };
  }

  return {
    state,
    start,
    stop: () => session?.end(),
    requestPhoto: () => { wantPhoto = true; },
    /** 서버 상태 engine_ms. 0보다 큰 숫자일 때만 바꾼다. */
    setEngineMs(ms) {
      if (typeof ms === "number" && ms > 0) engineMs = ms;
    },
    setFocus(targets, ttlMs) {
      focus = { targets: targets ?? [], until: performance.now() + (ttlMs ?? 8000) };
    },
    perf,
  };
}
```

`web/phone/ar.d.ts`:

```ts
// ar.js의 형.
import type { PhoneLink } from "./link.js";
import type { FocusMark } from "./marks.js";

export interface ArState {
  on: boolean;
  epoch: string | null;
  hitPoint: number[] | null;
  lastFloor: number[] | null;
  limited: boolean;
  size: string;
  encoder: string;
}
export interface ArHooks {
  onStart(): void;
  onEnd(): void;
  onHit(hit: boolean): void;
  onMarks(marks: FocusMark[]): void;
  onPerf(): void;
  note(text: string): void;
}
export interface FocusTargetAr { id: string; label: string; ar: [number, number, number] }
export interface PhoneAr {
  readonly state: ArState;
  start(overlay: object): Promise<void>;
  stop(): void;
  requestPhoto(): void;
  setEngineMs(ms: unknown): void;
  setFocus(targets: FocusTargetAr[] | undefined, ttlMs: number | undefined): void;
  perf(): { fps: string; detail: string };
}
export function newEpoch(): string;
export function createAr(opts: { link: PhoneLink; params: URLSearchParams; hooks: ArHooks; deps?: Record<string, unknown> }): PhoneAr;
```

- [ ] **Step 6: 통과 확인**

```
H npx vitest run tests/phone-link.test.ts tests/phone-talk.test.ts tests/phone-ar.test.ts
H npx tsc --noEmit
H npm run lint
```

Expected: PASS. lint 0곳(새 글은 phone.js와 같은 글이다).

- [ ] **Step 7: 커밋**

```
git add web/phone/link.js web/phone/link.d.ts web/phone/talk.js web/phone/talk.d.ts web/phone/ar.js web/phone/ar.d.ts tests/phone-link.test.ts tests/phone-talk.test.ts tests/phone-ar.test.ts
git commit -m "refactor(phone): move the phone link, AR loop and press-to-talk into modules" -m "link.js, ar.js and talk.js hold the WebSocket and clock sync, the WebXR session and frame loop, and speech recognition from phone.js with the DOM writes turned into hooks, so the React phone screen can import them. phone.js stays until the React page replaces it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 3: 폰 화면 상태

**Files:**
- Create: `ui/src/phone/state.ts`
- Test: `ui/tests/phone-state.test.ts`

**Interfaces:**
- Produces(작업 4~6이 쓴다):
  - 형: `AlignMode`, `Support`, `Anchor`, `Pending`, `Choice`, `BrainAction`, `FocusMark`, `TalkSpot`, `PhoneView`, `PhoneActions`, `StatusInput`
  - `initialView(speech: boolean): PhoneView`, `statusLine(s: StatusInput): { text; title }`, `anchorCount(anchors)`, `anchorNames(mode, anchors)`, `anchorLabel(mode, a)`, `supportText(s)`, `photoSavedText(msg)`, `wouldLine(would)`, `onStatus(v, s)`, `onRequest(v, msg)`, `onAction(v, msg)`, `createStore<T>(initial)`

- [ ] **Step 1: 실패하는 시험**

`ui/tests/phone-state.test.ts`:

```ts
// 폰 화면 상태(state.ts): 옮기기 전 phone.js의 render·renderStatus·showRequest·showAction 글과 규칙 그대로인지 본다.
import { describe, expect, it, vi } from "vitest";
import {
  anchorCount, anchorLabel, anchorNames, createStore, initialView, onAction, onRequest, onStatus, photoSavedText, statusLine, supportText, wouldLine,
  type Anchor,
} from "../src/phone/state";

const anchors: Anchor[] = [{ id: "A", label: "거실 창가", recorded: true }, { id: "B", label: "현관", recorded: false }];
const base = { aligned: false, mismatchM: null, limited: false, anchorCount: "1/2", note: null };

describe("위 상태 줄", () => {
  it("맞추기 전: 바닥 기준점은 창가 기준 방향만, 벽 기준점은 벽 지점 수", () => {
    expect(statusLine({ ...base, mode: "floor" }).text).toBe("맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록");
    expect(statusLine({ ...base, mode: "touch" }).text).toBe("맞추기 전 · 벽 지점 1/2 기록");
  });
  it("맞춤: 거리 차이 cm, 벽 기준점은 근사, 추적이 약하면 덧붙인다", () => {
    expect(statusLine({ ...base, mode: "floor", aligned: true, mismatchM: 0.123 }).text).toBe("맞춤 ✓ · 거리 차이 12cm");
    expect(statusLine({ ...base, mode: "touch", aligned: true, mismatchM: 0.05, limited: true }).text).toBe("근사 맞춤 ✓ · 거리 차이 5cm · 추적 약함");
  });
  it("잠깐 알릴 말이 있으면 그 말, title은 늘 맞춤 상태", () => {
    expect(statusLine({ ...base, mode: "floor", note: "AR을 먼저 시작하세요" })).toEqual({ text: "AR을 먼저 시작하세요", title: "맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록" });
  });
  it("처음 값: 바닥을 비춰 주세요, 0 fps, 측정 전", () => {
    const v = initialView(true);
    expect([v.status.text, v.fps, v.perfDetail, v.speech, v.support]).toEqual(["바닥을 비춰 주세요", "0 fps", "측정 전", true, { kind: "checking" }]);
  });
});

describe("기준점 글", () => {
  it("기록 수/전체, 첫 안내 이름(상태 전이면 방 모서리), 단추 글", () => {
    expect(anchorCount(anchors)).toBe("1/2");
    expect(anchorNames("floor", null)).toBe("방 모서리");
    expect(anchorNames("floor", anchors)).toBe("거실 창가, 현관");
    expect(anchorNames("touch", anchors)).toBe("A 거실 창가, B 현관");
    expect(anchorLabel("floor", anchors[0]!)).toBe("✓ 거실 창가 지점 기록");
    expect(anchorLabel("touch", anchors[1]!)).toBe("B 현관 아래 바닥 조준하고 기록");
  });
});

describe("처음 화면·알림 글", () => {
  it("AR 지원 줄", () => {
    expect(supportText({ kind: "checking" })).toBe("AR 지원을 확인하는 중…");
    expect(supportText({ kind: "insecure" })).toBe("보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.");
    expect(supportText({ kind: "no-ar" })).toBe("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.");
    expect(supportText({ kind: "ready" })).toBe("준비됐어요. 첫 기준점 근처에서 AR을 시작하세요.");
    expect(supportText({ kind: "failed", message: "거부됨" })).toBe("AR을 시작하지 못했어요: 거부됨");
  });
  it("사진 보냄 알림, 클로이드라면 줄", () => {
    expect(photoSavedText({ answer: true })).toBe("요청한 컵 사진을 보냈어요");
    expect(photoSavedText({ aligned: true })).toBe("사진을 위치와 함께 보냈어요");
    expect(photoSavedText({})).toBe("위치 없이 사진을 보냈어요");
    expect(wouldLine("컵 집기")).toBe("클로이드라면: 컵 집기 · 기기 명령은 보내지 않아요");
    expect(wouldLine(null)).toBeNull();
  });
});

describe("메시지 → 상태", () => {
  it("상태 메시지: 방식·기준점·맞춤(방식이 없으면 floor)", () => {
    const v = onStatus(initialView(false), { anchors, aligned: true });
    expect([v.mode, v.anchors, v.aligned]).toEqual(["floor", anchors, true]);
  });
  it("사진 요청: 거둘 때까지 둔다. 다른 요청을 거두는 말은 무시한다", () => {
    const shown = onRequest(initialView(false), { id: "r1", text: "컵 안을 비춰 주세요", active: true });
    expect(shown.request).toEqual({ id: "r1", text: "컵 안을 비춰 주세요" });
    expect(onRequest(shown, { id: "r0", text: "", active: false })).toBe(shown);
    expect(onRequest(shown, { id: "r1", text: "", active: false }).request).toBeNull();
  });
  it("행동 부탁: 같은 부탁을 거둘 때만 지운다. 선택·클로이드라면이 없으면 빈 값", () => {
    const shown = onAction(initialView(false), { id: "a1", text: "식탁 위 컵을 치워 주세요", active: true });
    expect(shown.action).toEqual({ id: "a1", text: "식탁 위 컵을 치워 주세요", would: null, choices: [] });
    expect(onAction(shown, { id: "a0", active: false })).toBe(shown);
    expect(onAction(shown, { id: "a1", active: false }).action).toBeNull();
  });
});

describe("저장소", () => {
  it("값을 바꾸면 듣는 쪽을 부르고, 끊으면 부르지 않는다", () => {
    const s = createStore(1);
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.set((n) => n + 1);
    expect([s.get(), fn.mock.calls.length]).toEqual([2, 1]);
    off();
    s.set(5);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `H npm --prefix ui test -- tests/phone-state.test.ts`
Expected: FAIL(`Failed to resolve import "../src/phone/state"`).

- [ ] **Step 3: state.ts**

`ui/src/phone/state.ts`:

```ts
// 폰 화면 상태: 서버 메시지·AR·말하기가 바꾸는 값과, 화면 글을 만드는 순수 함수(옮기기 전 web/phone/phone.js의 render·renderStatus·showRequest·showAction에서 옮겼다).
// 타이머(알림·판단 줄·잠깐 알릴 말)와 보내기는 controller.ts가 맡는다.

export type AlignMode = "floor" | "touch";
export type Support =
  | { kind: "checking" }
  | { kind: "insecure" }
  | { kind: "no-ar" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };
export interface Anchor { id: string; label: string; recorded: boolean }
export interface Pending { token: string; deviceLabel: string; reason: string }
export interface Choice { id: string; label: string }
export interface BrainAction { id: string; text: string; would: string | null; choices: Choice[] }
/** 화면 위 초점 표시 하나(core/project.js focusMarks와 같은 모양). */
export interface FocusMark { id: string; label: string; u: number; v: number; off: boolean; angle: number }
/** 누르고 말하기 단추 자리: 처음 화면, AR 아래 단추. */
export type TalkSpot = "intro" | "ar";

export interface PhoneView {
  support: Support;
  /** 음성 인식이 있다(없으면 말하기 단추 없이 글 입력만). */
  speech: boolean;
  /** AR 중(덮개가 보인다). */
  ar: boolean;
  mode: AlignMode;
  /** 서버 상태 전이면 null. */
  anchors: Anchor[] | null;
  aligned: boolean;
  status: { text: string; title: string };
  fps: string;
  perfDetail: string;
  /** 처음 화면 답 줄. 아직 말이 없으면 null. */
  reply: string | null;
  toast: string | null;
  pending: Pending[];
  brainLine: string | null;
  request: { id: string; text: string } | null;
  action: BrainAction | null;
  menuOpen: boolean;
  listening: TalkSpot | null;
}

/** 화면의 단추가 부르는 것(controller.ts가 만든다). */
export interface PhoneActions {
  startAr(): void;
  stopAr(): void;
  takePhoto(): void;
  recordAnchor(id: string): void;
  resetAnchors(): void;
  setMenu(open: boolean): void;
  say(text: string): void;
  confirm(token: string): void;
  cancel(token: string): void;
  brainReply(id: string, choice: string): void;
  talkDown(spot: TalkSpot): void;
  talkUp(spot: TalkSpot): void;
}

export const initialView = (speech: boolean): PhoneView => ({
  support: { kind: "checking" }, speech, ar: false, mode: "floor", anchors: null, aligned: false,
  status: { text: "바닥을 비춰 주세요", title: "" }, fps: "0 fps", perfDetail: "측정 전",
  reply: null, toast: null, pending: [], brainLine: null, request: null, action: null, menuOpen: false, listening: null,
});

export interface StatusInput { aligned: boolean; mode: AlignMode; mismatchM: number | null; limited: boolean; anchorCount: string; note: string | null }

/** 위 상태 줄: 맞춤 상태·거리 차이·추적 약함. 잠깐 알릴 말(note)이 있으면 그 말, title은 늘 맞춤 상태. */
export function statusLine(s: StatusInput): { text: string; title: string } {
  const base = s.aligned
    ? `${s.mode === "touch" ? "근사 " : ""}맞춤 ✓ · 거리 차이 ${Math.round((s.mismatchM ?? 0) * 100)}cm${s.limited ? " · 추적 약함" : ""}`
    : s.mode === "touch"
      ? `맞추기 전 · 벽 지점 ${s.anchorCount} 기록`
      : `맞추기 전 · 창가 기준 방향만 · 기준점 ${s.anchorCount} 기록`;
  return { text: s.note ?? base, title: base };
}

/** 기록한 수/전체(예 1/2). */
export const anchorCount = (anchors: Anchor[]) => `${anchors.filter((a) => a.recorded).length}/${anchors.length}`;

/** 처음 화면 첫 안내의 기준점 이름. 상태 전이면 「방 모서리」. */
export function anchorNames(mode: AlignMode, anchors: Anchor[] | null): string {
  if (!anchors) return "방 모서리";
  return anchors.map((a) => (mode === "touch" ? `${a.id} ${a.label}` : a.label)).join(", ");
}

/** AR 위 기준점 단추 글. */
export function anchorLabel(mode: AlignMode, a: Anchor): string {
  return mode === "touch"
    ? `${a.recorded ? "✓ " : ""}${a.id} ${a.label} 아래 바닥 조준하고 기록`
    : `${a.recorded ? "✓ " : ""}${a.label} 지점 기록`;
}

/** 처음 화면 AR 지원 줄. */
export function supportText(s: Support): string {
  switch (s.kind) {
    case "checking": return "AR 지원을 확인하는 중…";
    case "insecure": return "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.";
    case "no-ar": return "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.";
    case "ready": return "준비됐어요. 첫 기준점 근처에서 AR을 시작하세요.";
    case "failed": return `AR을 시작하지 못했어요: ${s.message}`;
  }
}

/** 사진을 보낸 뒤 알림. */
export function photoSavedText(msg: { answer?: unknown; aligned?: unknown }): string {
  return msg.answer ? "요청한 컵 사진을 보냈어요" : msg.aligned ? "사진을 위치와 함께 보냈어요" : "위치 없이 사진을 보냈어요";
}

/** 행동 부탁 카드의 「클로이드라면」 줄. would가 없으면 null. */
export const wouldLine = (would: string | null) => (would ? `클로이드라면: ${would} · 기기 명령은 보내지 않아요` : null);

/** 서버 상태(status) → 방식·기준점·맞춤. 상태 줄은 controller가 잠깐 알릴 말과 함께 다시 만든다. */
export function onStatus(v: PhoneView, s: { mode?: AlignMode; anchors: Anchor[]; aligned: boolean }): PhoneView {
  return { ...v, mode: s.mode ?? "floor", anchors: s.anchors, aligned: s.aligned };
}

/** 사진 요청(request): 거둘 때(active false)까지 둔다. 다른 요청을 거두는 말은 무시한다. */
export function onRequest(v: PhoneView, msg: { id: string; text: string; active: boolean }): PhoneView {
  if (!msg.active && msg.id !== v.request?.id) return v;
  return { ...v, request: msg.active ? { id: msg.id, text: msg.text } : null };
}

/** 행동 부탁·질문(action, 모의): 같은 부탁을 거둘 때만 지운다. */
export function onAction(v: PhoneView, msg: { id: string; text?: string; would?: string | null; choices?: Choice[]; active: boolean }): PhoneView {
  if (!msg.active) return msg.id === v.action?.id ? { ...v, action: null } : v;
  return { ...v, action: { id: msg.id, text: msg.text ?? "", would: msg.would ?? null, choices: msg.choices ?? [] } };
}

/** 작은 저장소(useSyncExternalStore용). */
export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === "function" ? (next as (v: T) => T)(value) : next;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

```
H npm --prefix ui test -- tests/phone-state.test.ts
H npm --prefix ui run typecheck
H npm run lint
```

Expected: PASS, lint 0곳.

- [ ] **Step 5: 커밋**

```
git add ui/src/phone/state.ts ui/tests/phone-state.test.ts
git commit -m "feat(phone): add the phone screen state and its text rules for React" -m "state.ts holds the view shape, the status line, anchor, support and photo texts, and the status, request and action updates from phone.js as pure functions." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 4: AR 위 그림(조준점·초점)

**Files:**
- Create: `ui/src/phone/draw.ts`
- Modify: `ui/tsconfig.json`(include에 `"../src/design/tokens.ts"`)
- Test: `ui/tests/phone-draw.test.ts`

**Interfaces:**
- Consumes: `FocusMark`(작업 3)
- Produces: `drawOverlay(ctx, size: { width; height }, scene: OverlayScene, now: number, reduced: boolean): void`, `fitCanvas(canvas, width, height, dpr): CanvasRenderingContext2D | null`, `pulse(now, reduced): number`, `labelFont: string`, `markLabel(label): string`, `OverlayScene = { hit: boolean; marks: FocusMark[] }`

- [ ] **Step 1: 실패하는 시험**

`ui/tests/phone-draw.test.ts`:

```ts
// 폰 AR 위 그림(draw.ts): 조준점·초점 고리·화면 밖 화살표·이름표의 색·크기·자리가 옮기기 전 phone.css와 같은지 본다.
// 조준점: 28px, 심 3px(못 맞춤 error-vivid·맞춤 ok-vivid), 안팎 흰 테 2px·숯색 1px, 맞으면 가운데 점(지름 10px).
// 초점 고리: 64px, 심 3px brand, 고리+이름표 묶음의 가운데가 그 점, 이름표는 4px 아래 scrim-phone 위 on-scrim 14px.
import { describe, expect, it } from "vitest";
import { color, rgba, twin } from "../../src/design/tokens.ts";
import { drawOverlay, labelFont, pulse } from "../src/phone/draw";

const F = twin.phoneFocus;
type Op = { op: string; [k: string]: any };
function recorder() {
  const ops: Op[] = [];
  // ctx를 읽는 칸은 블록 몸 메서드로 둔다(자기 자신을 읽는 화살표 함수는 타입 추론이 돌고 돈다)
  const ctx = {
    lineWidth: 0, strokeStyle: "", fillStyle: "", font: "", textAlign: "", textBaseline: "", lineJoin: "",
    clearRect(_x: number, _y: number, w: number, h: number) { ops.push({ op: "clear", w, h }); },
    beginPath() {},
    closePath() {},
    arc(x: number, y: number, r: number) { ops.push({ op: "arc", x, y, r }); },
    moveTo(x: number, y: number) { ops.push({ op: "move", x, y }); },
    lineTo(x: number, y: number) { ops.push({ op: "line", x, y }); },
    roundRect(x: number, y: number, w: number, h: number, r: number) { ops.push({ op: "round", x, y, w, h, r }); },
    stroke() { ops.push({ op: "stroke", color: ctx.strokeStyle, width: ctx.lineWidth }); },
    fill() { ops.push({ op: "fill", color: ctx.fillStyle }); },
    fillText(text: string, x: number, y: number) { ops.push({ op: "text", text, x, y, color: ctx.fillStyle, font: ctx.font }); },
    measureText(t: string) { return { width: t.length * 10 }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}
const SIZE = { width: 390, height: 844 };
const of = (ops: Op[], op: string) => ops.filter((o) => o.op === op);

describe("토큰", () => {
  it("이름표는 scrim-phone 위 on-scrim, 화면 밖 화살표는 brand, 글꼴은 묶은 Noto Sans KR 14px", () => {
    expect(F.labelBg).toBe(rgba["scrim-phone"]);
    expect(F.offscreenArrow).toBe(color.brand);
    expect(labelFont).toMatch(/^400 14px "Noto Sans KR Variable"/);
  });
});

describe("조준점", () => {
  it("못 맞춤: 화면 가운데 error-vivid 빈 고리(심 3px), 안팎 흰 테 2px·숯색 1px", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [] }, 0, true);
    expect(ops[0]).toEqual({ op: "clear", w: 390, h: 844 });
    expect(of(ops, "arc").every((a) => a.x === 195 && a.y === 422)).toBe(true);
    expect(of(ops, "arc").map((a) => a.r)).toEqual([16.5, 8.5, 15, 10, 12.5]);
    expect(of(ops, "stroke").map((s) => [s.color, s.width])).toEqual([[F.edge.color, 1], [F.edge.color, 1], [F.casing.color, 2], [F.casing.color, 2], [F.aim.miss, 3]]);
    expect(of(ops, "fill")).toEqual([]);
  });

  it("맞춤: ok-vivid 고리에 가운데 점(지름 10px)을 흰 테·숯색 1px씩 두른다", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: true, marks: [] }, 0, true);
    expect(of(ops, "stroke").at(-1)).toEqual({ op: "stroke", color: F.aim.hit, width: 3 });
    expect(of(ops, "arc").slice(5).map((a) => a.r)).toEqual([7, 6, 5]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.edge.color, F.casing.color, F.aim.hit]);
  });
});

describe("초점 표시", () => {
  const cup = { id: "cup", label: "컵", u: 0.5, v: 0.5, off: false, angle: 0 };

  it("화면 안: brand 고리(64px, 심 3px)와 4px 아래 이름표 「클로이드 주목 · 컵」. 묶음의 가운데가 그 점이라 고리 가운데는 14px 위", () => {
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [cup] }, 0, true);
    const ring = of(ops, "arc").slice(5);
    expect(ring.map((a) => a.r)).toEqual([34.5, 26.5, 33, 28, 30.5]);
    expect(ring.every((a) => a.x === 195 && a.y === 408)).toBe(true);
    expect(of(ops, "stroke").at(-1)).toEqual({ op: "stroke", color: F.ring.color, width: 3 });
    const w = "클로이드 주목 · 컵".length * 10 + 16; // 글 너비(시험 measureText) + 좌우 8px
    expect(of(ops, "round")).toEqual([{ op: "round", x: 195 - w / 2, y: 444, w, h: 24, r: 8 }]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.labelBg]);
    expect(of(ops, "text")).toEqual([{ op: "text", text: "클로이드 주목 · 컵", x: 195, y: 456, color: F.labelText, font: labelFont }]);
  });

  it("고리는 1.2초마다 1.12배로 숨쉰다. 움직임 줄이기면 멈춘다", () => {
    expect(pulse(0, false)).toBe(1);
    expect(pulse(600, false)).toBeCloseTo(1.12);
    expect(pulse(1200, false)).toBeCloseTo(1);
    expect(pulse(600, true)).toBe(1);
    const { ctx, ops } = recorder();
    drawOverlay(ctx, SIZE, { hit: false, marks: [cup] }, 600, false);
    expect(of(ops, "arc").at(-1)!.r).toBeCloseTo(30.5 * 1.12);
  });

  it("화면 밖: 그쪽을 가리키는 세모(22×28px)를 숯색·흰 테로 두르고 brand로 채운다", () => {
    const { ctx, ops } = recorder();
    const x = 0.9 * 390;
    drawOverlay(ctx, SIZE, { hit: false, marks: [{ id: "tv", label: "TV", u: 0.9, v: 0.5, off: true, angle: 0 }] }, 0, true);
    expect(of(ops, "move")).toEqual([{ op: "move", x: x - 18, y: 394 }]);
    expect(of(ops, "line")).toEqual([{ op: "line", x: x + 4, y: 408 }, { op: "line", x: x - 18, y: 422 }]);
    expect(of(ops, "stroke").slice(5).map((s) => [s.color, s.width])).toEqual([[F.edge.color, 6], [F.casing.color, 4]]);
    expect(of(ops, "fill").map((f) => f.color)).toEqual([F.offscreenArrow, F.labelBg]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `H npm --prefix ui test -- tests/phone-draw.test.ts`
Expected: FAIL(`../src/phone/draw` 없음).

- [ ] **Step 3: tsconfig·draw.ts**

`ui/tsconfig.json` include 끝에 `"../src/design/tokens.ts"`를 더한다:

```json
  "include": ["src", "tests", "vite.config.ts", "../src/contract", "../src/hub/types.ts", "../src/design/tokens.json", "../src/design/tokens.ts"]
```

`ui/src/phone/draw.ts`:

```ts
// 폰 AR 위 그림(components.json F5·F13 「그림(규칙 밖)」): 가운데 조준점과 초점 고리·화면 밖 화살표·이름표를 canvas에 그린다.
// 모양·크기는 옮기기 전 phone.css와 같다. 조준점 28px(심 3px, 안팎 흰 테 2px·숯색 1px), 맞으면 가운데 점(지름 10px)을 채운다.
// 초점 고리 64px(심 3px brand), 1.2초마다 1.12배로 숨쉬고(움직임 줄이기면 멈춤), 4px 아래 이름표 「클로이드 주목 · 이름」.
// 화면 밖이면 그쪽을 가리키는 세모(22×28px). 고리(또는 세모)+이름표 묶음의 가운데가 그 점이다(옛 DOM 배치와 같음).
import { radius, type } from "../../../src/design/tokens.json";
import { font, twin } from "../../../src/design/tokens.ts";
import type { FocusMark } from "./state";

const F = twin.phoneFocus;
const RETICLE_PX = 28;
const RING_PX = 64;
const GAP_PX = 4;
/** 옛 CSS 세모 상자: 왼쪽 테두리 22px + 오른쪽 투명 14px, 높이 28px. */
const ARROW = { box: 36, height: 28, tip: 22 };
const LABEL = { padX: 8, padY: 2, size: type["body-sm"].size.phone, line: type["body-sm"].lineHeight.phone, weight: type["body-sm"].weight, radius: radius["radius-lg"] };
const PULSE_MS = 1200;
const PULSE = 0.12;

export const labelFont = `${LABEL.weight} ${LABEL.size}px ${font.canvas}`;
export const markLabel = (label: string) => `클로이드 주목 · ${label}`;
export interface OverlayScene { hit: boolean; marks: FocusMark[] }

/** 숨쉬기 배율: 0.6초 동안 1 → 1.12, 다음 0.6초 동안 1.12 → 1(ease-in-out). 움직임 줄이기면 1. */
export function pulse(now: number, reduced: boolean): number {
  if (reduced) return 1;
  const t = (now % PULSE_MS) / (PULSE_MS / 2);
  const p = t <= 1 ? t : 2 - t;
  return 1 + (PULSE * (1 - Math.cos(Math.PI * p))) / 2;
}

/** canvas를 화면 크기 × 화소 비율로 맞추고 CSS px로 그리게 한다. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): CanvasRenderingContext2D | null {
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** 세 겹 고리: 심 가운데 반지름 r, 심 굵기 w, 안팎으로 흰 테·숯색. k는 숨쉬기 배율. */
function rings(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, w: number, core: string, k = 1) {
  const R = r * k;
  const h = (w * k) / 2;
  const c = F.casing.width * k;
  const e = F.edge.width * k;
  const layers: [number, number, string][] = [
    [R + h + c + e / 2, e, F.edge.color],
    [R - h - c - e / 2, e, F.edge.color],
    [R + h + c / 2, c, F.casing.color],
    [R - h - c / 2, c, F.casing.color],
    [R, w * k, core],
  ];
  for (const [rr, lw, col] of layers) {
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = col;
    ctx.stroke();
  }
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, hit: boolean) {
  const core = hit ? F.aim.hit : F.aim.miss;
  rings(ctx, x, y, RETICLE_PX / 2 - F.ring.width / 2, F.ring.width, core);
  if (!hit) return;
  // 맞춤: 가운데 점(지름 10px)을 흰 테 1px·숯색 1px로 두른다
  for (const [r, c] of [[7, F.edge.color], [6, F.casing.color], [5, core]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  const half = ARROW.box / 2;
  const pts: [number, number][] = [[-half, -ARROW.height / 2], [ARROW.tip - half, 0], [-half, ARROW.height / 2]];
  const at = ([px, py]: [number, number]) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)] as const;
  const [p0, p1, p2] = pts.map(at);
  ctx.beginPath();
  ctx.moveTo(p0![0], p0![1]);
  ctx.lineTo(p1![0], p1![1]);
  ctx.lineTo(p2![0], p2![1]);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2 * (F.casing.width + F.edge.width);
  ctx.strokeStyle = F.edge.color;
  ctx.stroke();
  ctx.lineWidth = 2 * F.casing.width;
  ctx.strokeStyle = F.casing.color;
  ctx.stroke();
  ctx.fillStyle = F.offscreenArrow;
  ctx.fill();
}

function drawMark(ctx: CanvasRenderingContext2D, m: FocusMark, size: { width: number; height: number }, now: number, reduced: boolean) {
  const x = m.u * size.width;
  const y = m.v * size.height;
  const boxH = m.off ? ARROW.height : RING_PX;
  const labelH = LABEL.line + 2 * LABEL.padY;
  const top = y - (boxH + GAP_PX + labelH) / 2;
  const cy = top + boxH / 2;
  if (m.off) drawArrow(ctx, x, cy, m.angle);
  else rings(ctx, x, cy, RING_PX / 2 - F.ring.width / 2, F.ring.width, F.ring.color, pulse(now, reduced));
  const text = markLabel(m.label);
  ctx.font = labelFont;
  const w = ctx.measureText(text).width + 2 * LABEL.padX;
  const ly = top + boxH + GAP_PX;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, ly, w, labelH, LABEL.radius);
  ctx.fillStyle = F.labelBg;
  ctx.fill();
  ctx.fillStyle = F.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, ly + labelH / 2);
}

/** 한 장 그리기: 지우고, 조준점, 그 위에 초점 표시(옛 DOM 순서와 같다). size는 CSS px. */
export function drawOverlay(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, scene: OverlayScene, now: number, reduced: boolean): void {
  ctx.clearRect(0, 0, size.width, size.height);
  drawReticle(ctx, size.width / 2, size.height / 2, scene.hit);
  for (const m of scene.marks) drawMark(ctx, m, size, now, reduced);
}
```

- [ ] **Step 4: 통과 확인**

```
H npm --prefix ui test -- tests/phone-draw.test.ts
H npm --prefix ui run typecheck
H npm run lint
```

Expected: PASS, lint 0곳(색은 토큰 값만, canvas라 부품 규칙에 걸리지 않는다).

- [ ] **Step 5: 커밋**

```
git add ui/src/phone/draw.ts ui/tests/phone-draw.test.ts ui/tsconfig.json
git commit -m "feat(phone): draw the aim point and focus rings on a canvas from the design tokens" -m "draw.ts paints the three-layer aim point and focus rings, the off-screen arrow and the label with the sizes and placement of the old phone.css, and stops the ring pulse under reduced motion." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 5: 폰 화면(부품 배치)과 상태 예시

**Files:**
- Create: `ui/src/phone/PhoneScreen.tsx`, `ui/src/phone/fixtures.ts`
- Test: `ui/tests/phone-screen.test.tsx`

**Interfaces:**
- Consumes: 작업 1 변형, 작업 3 `PhoneView`·`PhoneActions`·글 함수
- Produces: `PhoneScreen({ view, act, overlayRef?, canvasRef? })`(덮개 div `data-phone-overlay`, 메뉴 `#phone-menu`, 지원 줄 `data-support`), `SHOTS: Record<ShotName, Shot>`, `SHOT_NAMES`, `Shot = { view: PhoneView; draw: OverlayScene 모양 }`

- [ ] **Step 1: 상태 예시**

`ui/src/phone/fixtures.ts`:

```ts
// 폰 화면 상태 예시: 화면 시험(ui/tests/phone-screen.test.tsx)과 화면 사진 페이지(shots.tsx)가 함께 쓴다.
// 부탁 글·선택은 src/act/prompts.ts의 「컵 치우기」와 같다.
import { initialView, statusLine, type Anchor, type FocusMark, type PhoneView } from "./state";

export const SHOT_NAMES = ["intro", "camera", "overlay", "menu", "request", "talk", "listening", "error"] as const;
export type ShotName = (typeof SHOT_NAMES)[number];
export interface Shot { view: PhoneView; draw: { hit: boolean; marks: FocusMark[] } }

const anchors: Anchor[] = [
  { id: "A", label: "거실 창 오른쪽 벽", recorded: true },
  { id: "B", label: "반대편 벽", recorded: false },
];
const intro: PhoneView = { ...initialView(true), support: { kind: "ready" }, mode: "touch", anchors };
const camera: PhoneView = {
  ...intro, ar: true, fps: "11.5 fps",
  status: statusLine({ aligned: false, mode: "touch", mismatchM: null, limited: false, anchorCount: "1/2", note: null }),
};
const aligned: PhoneView = {
  ...camera, aligned: true, anchors: anchors.map((a) => ({ ...a, recorded: true })),
  status: statusLine({ aligned: true, mode: "touch", mismatchM: 0.06, limited: false, anchorCount: "2/2", note: null }),
};
const none = { hit: false, marks: [] as FocusMark[] };
const cup: FocusMark = { id: "cup", label: "컵", u: 0.5, v: 0.42, off: false, angle: 0 };

export const SHOTS: Record<ShotName, Shot> = {
  intro: { view: intro, draw: none },
  camera: { view: camera, draw: { hit: true, marks: [] } },
  overlay: {
    view: { ...aligned, brainLine: "식탁 위 컵을 보고 있어요", toast: "A 지점을 기록했어요" },
    draw: { hit: true, marks: [cup, { id: "fridge", label: "냉장고", u: 0.92, v: 0.6, off: true, angle: 15 }] },
  },
  menu: {
    view: {
      ...aligned, menuOpen: true,
      perfDetail: [
        "보낸 화면 11.5 / 목표 12 fps · 장당 18.4KB",
        "readPixels 3.1ms · 인코딩 9.8ms",
        "와이파이 대기 0KB · 크기 360×480",
        "2초간 건너뜀: 인코딩 중 0 · 버퍼 가득 0 · 순서 뒤바뀜 0",
        "표시 영상 꺼짐",
      ].join("\n"),
    },
    draw: none,
  },
  request: {
    view: {
      ...aligned,
      request: { id: "r1", text: "컵 안을 비춰 주세요" },
      action: { id: "a1", text: "식탁 위 컵을 치워 주세요", would: "로봇이 식탁의 컵을 싱크대로 옮긴다", choices: [{ id: "done", label: "치웠어요" }, { id: "later", label: "나중에" }] },
    },
    draw: { hit: true, marks: [cup] },
  },
  talk: {
    view: { ...intro, reply: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }] },
    draw: none,
  },
  listening: { view: { ...intro, listening: "intro", reply: "🎙 TV 켜줘" }, draw: none },
  error: { view: { ...intro, support: { kind: "insecure" }, reply: "마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요." }, draw: none },
};
```

- [ ] **Step 2: 실패하는 시험**

`ui/tests/phone-screen.test.tsx`:

```tsx
// 폰 화면(PhoneScreen.tsx)을 상태마다 그린다: 처음 화면, 카메라 중, 덮개(판단 줄·알림·초점), 메뉴, 사진 요청·행동 부탁, 묻고 답하기, 오류.
// 영상 위 글은 14px 이상(label·caption 토큰 없음), 누르는 것은 48px 이상(h-12·h-16·size-12)인지도 본다.
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SHOTS } from "../src/phone/fixtures";
import { PhoneScreen } from "../src/phone/PhoneScreen";
import type { PhoneActions, PhoneView, Support } from "../src/phone/state";

const actions = (): PhoneActions => ({
  startAr: vi.fn(), stopAr: vi.fn(), takePhoto: vi.fn(), recordAnchor: vi.fn(), resetAnchors: vi.fn(), setMenu: vi.fn(),
  say: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), brainReply: vi.fn(), talkDown: vi.fn(), talkUp: vi.fn(),
});
function show(view: PhoneView) {
  const act = actions();
  const r = render(<PhoneScreen view={view} act={act} />);
  const overlay = r.container.querySelector<HTMLElement>("[data-phone-overlay]")!;
  return { act, overlay, o: within(overlay), ...r };
}
const words = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("처음 화면", () => {
  it("마스코트·제목·AR 지원 줄·안내 둘. 준비되면 AR 시작을 누를 수 있다. 덮개는 숨어 있다", async () => {
    const { act, overlay, container } = show(SHOTS.intro.view);
    expect(overlay.hidden).toBe(true);
    expect(container.querySelector('img[src="/brand/mascot@1x.webp"]')).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { name: "클로이드의 눈" })).toBeInTheDocument();
    expect(screen.getByText("준비됐어요. 첫 기준점 근처에서 AR을 시작하세요.")).toHaveAttribute("data-support", "ready");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "A 거실 창 오른쪽 벽, B 반대편 벽 바로 아래 바닥에 조준점을 맞추고 기록을 눌러요. 초록이면 닿은 거예요",
      '물건 아래 바닥을 조준하고 말하기를 누른 채 "냉장고 여기로"라고 말해요',
    ]);
    await userEvent.click(screen.getByRole("button", { name: "AR 시작" }));
    expect(act.startAr).toHaveBeenCalledOnce();
  });

  it("기준점 상태 전이면 「방 모서리」, 바닥 기준점이면 「지점 기록」", () => {
    show({ ...SHOTS.intro.view, mode: "floor", anchors: null });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("방 모서리 바닥에 차례로 조준점을 맞추고 지점 기록을 눌러요");
  });

  it("음성 인식이 없으면 말하기 단추 없이 글 입력만", () => {
    show({ ...SHOTS.intro.view, speech: false });
    expect(screen.queryByRole("button", { name: /누르고 말하기/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "클로이드에게 할 말" })).toHaveAttribute("maxlength", "500");
  });
});

describe("카메라 중(AR)", () => {
  it("덮개에 상태 줄·보낸 장 수·메뉴·기준점·큰 단추 셋. 처음 화면은 숨는다", async () => {
    const { act, overlay, o } = show(SHOTS.camera.view);
    expect(overlay.hidden).toBe(false);
    expect(screen.queryByRole("heading", { name: "클로이드의 눈" })).toBeNull();
    expect(o.getByText("맞추기 전 · 벽 지점 1/2 기록")).toBeInTheDocument();
    expect(o.getByText("11.5 fps")).toHaveAttribute("title", "최근 2초 동안 대시보드로 보낸 화면 장 수");
    expect(o.getByRole("button", { name: "메뉴" })).toHaveAttribute("aria-expanded", "false");
    expect(overlay.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(o.getByRole("button", { name: "✓ A 거실 창 오른쪽 벽 아래 바닥 조준하고 기록" }));
    expect(act.recordAnchor).toHaveBeenCalledWith("A");
    await userEvent.click(o.getByRole("button", { name: "사진 찍기" }));
    await userEvent.click(o.getByRole("button", { name: "끝내기" }));
    await userEvent.click(o.getByRole("button", { name: "메뉴" }));
    expect([act.takePhoto, act.stopAr].map((f) => vi.mocked(f).mock.calls.length)).toEqual([1, 1]);
    expect(act.setMenu).toHaveBeenCalledWith(true);
    expect(o.getByRole("button", { name: "사진 찍기" })).toHaveTextContent("사진");
  });

  it("누르고 말하기: 누르면 talkDown, 떼거나 벗어나면 talkUp(AR 자리)", () => {
    const { act, o } = show(SHOTS.camera.view);
    const talk = o.getByRole("button", { name: "누르고 말하기" });
    fireEvent.pointerDown(talk);
    fireEvent.pointerUp(talk);
    fireEvent.pointerLeave(talk);
    expect(act.talkDown).toHaveBeenCalledWith("ar");
    expect(act.talkUp).toHaveBeenCalledWith("ar");
  });

  it("맞추면 기준점 단추가 사라진다", () => {
    const { o } = show(SHOTS.overlay.view);
    expect(o.queryByRole("button", { name: /조준하고 기록/ })).toBeNull();
  });

  it("영상 위 글은 14px 이상(label·caption 토큰 없음), 누르는 것은 48px 이상", () => {
    for (const name of ["camera", "overlay", "menu", "request"] as const) {
      const { overlay, unmount } = show(SHOTS[name].view);
      const small = [...overlay.querySelectorAll("[class]")].filter((el) => words(el).some((w) => w === "text-label" || w === "text-caption"));
      expect(small.map((el) => el.textContent), name).toEqual([]);
      const tiny = [...overlay.querySelectorAll("button")].filter((b) => !words(b).some((w) => ["h-12", "h-16", "size-12"].includes(w)));
      expect(tiny.map((b) => b.getAttribute("aria-label") ?? b.textContent), name).toEqual([]);
      unmount();
    }
  });
});

describe("덮개: 판단 줄·알림·메뉴", () => {
  it("판단 줄과 알림은 role=status, 맞춤이면 근사 맞춤과 거리 차이", () => {
    const { o } = show(SHOTS.overlay.view);
    expect(o.getByText("식탁 위 컵을 보고 있어요").closest("[role=status]")).not.toBeNull();
    expect(o.getByText("A 지점을 기록했어요").closest("[role=status]")).not.toBeNull();
    expect(o.getByText("근사 맞춤 ✓ · 거리 차이 6cm")).toBeInTheDocument();
  });

  it("메뉴: 글 입력·기준점 다시 찍기·측정 글·닫기. 글을 보내면 say하고 칸을 비운다", async () => {
    const { act, overlay, o } = show(SHOTS.menu.view);
    expect(o.getByRole("button", { name: "메뉴" })).toHaveAttribute("aria-expanded", "true");
    const menu = within(overlay.querySelector<HTMLElement>("#phone-menu")!);
    const input = menu.getByRole("textbox", { name: "클로이드에게 할 말" });
    await userEvent.type(input, "TV 켜줘");
    await userEvent.click(menu.getByRole("button", { name: "보내기" }));
    expect(act.say).toHaveBeenCalledWith("TV 켜줘");
    expect(input).toHaveValue("");
    await userEvent.click(menu.getByRole("button", { name: "기준점 다시 찍기" }));
    expect(act.resetAnchors).toHaveBeenCalledOnce();
    expect(menu.getByText(/보낸 화면 11\.5 \/ 목표 12 fps/)).toBeInTheDocument();
    await userEvent.click(menu.getByRole("button", { name: "닫기" }));
    expect(act.setMenu).toHaveBeenCalledWith(false);
  });
});

describe("사진 요청·행동 부탁", () => {
  it("사진 요청은 큰 글 알림(role=alert), 사진 단추는 「컵 안」", () => {
    const { o } = show(SHOTS.request.view);
    expect(o.getByRole("alert")).toHaveTextContent("컵 안을 비춰 주세요");
    expect(o.getByRole("button", { name: "사진 찍기" })).toHaveTextContent("컵 안");
  });

  it("행동 부탁 카드: 모의 표·부탁·클로이드라면 줄. 첫 선택이 주 단추, 누르면 brainReply", async () => {
    const { act, o } = show(SHOTS.request.view);
    expect(o.getByText("모의")).toBeInTheDocument();
    expect(o.getByText("식탁 위 컵을 치워 주세요")).toBeInTheDocument();
    expect(o.getByText("클로이드라면: 로봇이 식탁의 컵을 싱크대로 옮긴다 · 기기 명령은 보내지 않아요")).toBeInTheDocument();
    expect(words(o.getByRole("button", { name: "치웠어요" }))).toContain("bg-primary");
    expect(words(o.getByRole("button", { name: "나중에" }))).toContain("border-input");
    await userEvent.click(o.getByRole("button", { name: "치웠어요" }));
    await userEvent.click(o.getByRole("button", { name: "나중에" }));
    expect(vi.mocked(act.brainReply).mock.calls).toEqual([["a1", "done"], ["a1", "later"]]);
  });
});

describe("묻고 답하기", () => {
  it("답 줄(role=status)과 승인 대기: 승인·취소는 그 토큰으로", async () => {
    const { act } = show(SHOTS.talk.view);
    expect(screen.getByText("현관문 잠금 해제는 승인이 필요해요.").closest("[role=status]")).not.toBeNull();
    expect(screen.getByText("현관문: 현관문 잠금 해제")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect([vi.mocked(act.confirm).mock.calls, vi.mocked(act.cancel).mock.calls]).toEqual([[["t1"]], [["t1"]]]);
  });

  it("듣는 중이면 그 단추가 destructive에 「듣는 중… 손을 떼면 보내요」, 떼면 talkUp(처음 화면 자리)", () => {
    const { act } = show(SHOTS.listening.view);
    const b = screen.getByRole("button", { name: "듣는 중… 손을 떼면 보내요" });
    expect(words(b)).toContain("bg-destructive");
    fireEvent.pointerUp(b);
    expect(act.talkUp).toHaveBeenCalledWith("intro");
  });

  it("처음 화면 글 입력을 보내면 say하고 칸을 비운다", async () => {
    const { act } = show(SHOTS.intro.view);
    const input = screen.getByRole("textbox", { name: "클로이드에게 할 말" });
    await userEvent.type(input, "불 꺼줘{Enter}");
    expect(act.say).toHaveBeenCalledWith("불 꺼줘");
    expect(input).toHaveValue("");
  });
});

describe("오류", () => {
  it.each([
    [{ kind: "checking" }, "AR 지원을 확인하는 중…", true],
    [{ kind: "insecure" }, "보안 연결이 아니라 AR을 켤 수 없어요. https 주소로 여세요.", true],
    [{ kind: "no-ar" }, "이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.", true],
    [{ kind: "failed", message: "NotAllowedError" }, "AR을 시작하지 못했어요: NotAllowedError", false],
  ] as [Support, string, boolean][])("%o: 까닭을 보이고, 시작 실패만 다시 누를 수 있다", (support, text, disabled) => {
    show({ ...SHOTS.intro.view, support });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AR 시작" }).hasAttribute("disabled")).toBe(disabled);
  });

  it("마이크 권한 오류는 답 줄에", () => {
    show(SHOTS.error.view);
    expect(screen.getByText("마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요.").closest("[role=status]")).not.toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `H npm --prefix ui test -- tests/phone-screen.test.tsx`
Expected: FAIL(`../src/phone/PhoneScreen` 없음).

- [ ] **Step 4: PhoneScreen.tsx**

`ui/src/phone/PhoneScreen.tsx`:

```tsx
// 폰 화면(클로이드의 눈). 처음 화면: 마스코트·제목·AR 지원 줄·안내 둘·AR 시작, 대화(답 줄·승인 대기·누르고 말하기·글 입력).
// AR 덮개(DOM 오버레이 뿌리): 조준점·초점 그림(canvas), 위 상태 줄·보낸 장 수·⋯, 판단 줄, 사진 요청, 행동 부탁, 기준점 단추, 큰 단추 셋, 승인 대기, 알림, ⋯ 메뉴.
// AR 중에는 덮개만 보이므로 글 입력은 ⋯ 메뉴에, 승인 대기는 위 가운데에 둔다. 가로로 돌리면 큰 단추가 오른쪽 세로 줄로 간다.
// 부품은 ui/src/components/ui의 21st.dev 부품만 쓰고(components.json F1~F15), 여기서는 배치만 한다.
import { Bot, Camera, Ellipsis, MessageSquare, Mic, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { useState, type Dispatch, type FormEvent, type PointerEvent as ReactPointerEvent, type Ref, type SetStateAction } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { Status, StatusLabel } from "@/components/ui/status";
import { anchorLabel, anchorNames, supportText, wouldLine, type BrainAction, type Pending, type PhoneActions, type PhoneView, type TalkSpot } from "./state";

/** AR 위 큰 단추(말하기·사진·끝내기): 76×64px, 아이콘 위·이름 아래. */
const BIG = "h-16 w-[76px] flex-col gap-0.5 px-1";

export interface PhoneScreenProps {
  view: PhoneView;
  act: PhoneActions;
  overlayRef?: Ref<HTMLDivElement>;
  canvasRef?: Ref<HTMLCanvasElement>;
}

export function PhoneScreen({ view, act, overlayRef, canvasRef }: PhoneScreenProps) {
  // 처음 화면과 ⋯ 메뉴의 글 입력이 같은 글을 이어 쓴다(옮기기 전에는 같은 입력칸을 옮겼다)
  const [draft, setDraft] = useState("");
  return (
    <>
      <Intro view={view} act={act} draft={draft} setDraft={setDraft} />
      <Overlay view={view} act={act} draft={draft} setDraft={setDraft} overlayRef={overlayRef} canvasRef={canvasRef} />
    </>
  );
}

/** 누르는 동안 듣고, 떼거나 손가락이 벗어나면 멈춘다. 길게 눌러도 메뉴가 뜨지 않게 한다. */
function hold(act: PhoneActions, spot: TalkSpot) {
  return {
    onPointerDown: (e: ReactPointerEvent) => { e.preventDefault(); act.talkDown(spot); },
    onPointerUp: () => act.talkUp(spot),
    onPointerCancel: () => act.talkUp(spot),
    onPointerLeave: () => act.talkUp(spot),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
}

type DraftProps = { act: PhoneActions; draft: string; setDraft: Dispatch<SetStateAction<string>> };

function TalkForm({ act, draft, setDraft }: DraftProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.say(draft);
    setDraft("");
  };
  return (
    <form className="flex gap-2" autoComplete="off" onSubmit={submit}>
      <Input className="h-12 min-w-0 flex-1" maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="예: TV 켜줘 / 냉장고 위치 여기로 맞춰줘" aria-label="클로이드에게 할 말" />
      <Button type="submit" variant="outline" size="touch" className="h-12">보내기</Button>
    </form>
  );
}

function PendingList({ items, act }: { items: Pending[]; act: PhoneActions }) {
  return (
    <Card className="flex flex-col gap-1.5 p-1.5">
      {items.map((p) => (
        <Item key={p.token} size="sm">
          <ItemContent><ItemTitle>{p.deviceLabel}: {p.reason}</ItemTitle></ItemContent>
          <ItemActions>
            <Button size="touch" className="h-12" onClick={() => act.confirm(p.token)}>승인</Button>
            <Button variant="outline" size="touch" className="h-12" onClick={() => act.cancel(p.token)}>취소</Button>
          </ItemActions>
        </Item>
      ))}
    </Card>
  );
}

function Intro({ view, act, draft, setDraft }: { view: PhoneView } & DraftProps) {
  const names = anchorNames(view.mode, view.anchors);
  const canStart = view.support.kind === "ready" || view.support.kind === "failed";
  return (
    <main hidden={view.ar} className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-4 px-4 pt-6 pb-4">
      <img src="/brand/mascot@1x.webp" alt="" width={55} height={96} className="mx-auto my-2.5 h-24 w-auto" />
      <Card>
        <CardHeader>
          <CardTitle>클로이드의 눈</CardTitle>
          <CardDescription role="status" data-support={view.support.kind}>{supportText(view.support)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex list-decimal flex-col gap-2 ps-5">
            {view.mode === "touch"
              ? <li>{names} 바로 아래 바닥에 조준점을 맞추고 <b>기록</b>을 눌러요. 초록이면 닿은 거예요</li>
              : <li>{names} 바닥에 차례로 조준점을 맞추고 <b>지점 기록</b>을 눌러요</li>}
            <li>물건 아래 바닥을 조준하고 <b>말하기</b>를 누른 채 "냉장고 여기로"라고 말해요</li>
          </ol>
        </CardContent>
        <CardFooter>
          <Button size="touch" className="h-12 w-full" disabled={!canStart} onClick={act.startAr}>AR 시작</Button>
        </CardFooter>
      </Card>
      <section aria-label="클로이드와 대화" className="flex flex-col gap-2">
        {view.reply !== null && (
          <Alert role="status" aria-live="polite"><MessageSquare /><AlertDescription>{view.reply}</AlertDescription></Alert>
        )}
        {!view.ar && view.pending.length > 0 && <PendingList items={view.pending} act={act} />}
        {view.speech && (
          <Button size="touch" variant={view.listening === "intro" ? "destructive" : "default"} className="h-12 w-full touch-none select-none" {...hold(act, "intro")}>
            <Mic />{view.listening === "intro" ? "듣는 중… 손을 떼면 보내요" : "누르고 말하기"}
          </Button>
        )}
        {!view.ar && <TalkForm act={act} draft={draft} setDraft={setDraft} />}
      </section>
    </main>
  );
}

function ActionCard({ action, act }: { action: BrainAction; act: PhoneActions }) {
  const would = wouldLine(action.would);
  return (
    <Card className="fixed inset-x-4 top-[22%]">
      <CardHeader className="p-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Status variant="warning" size="touch"><TriangleAlert className="size-4" />모의</Status>
          {action.text}
        </CardTitle>
      </CardHeader>
      {would && <CardContent className="px-4 pb-2">{would}</CardContent>}
      <CardFooter className="gap-2 p-4 pt-0">
        {/* 첫 선택이 주 단추(default), 나머지는 outline. variant를 식으로 고르면 부품 lint가 "outline"을 class로 본다 */}
        {action.choices.map((c, i) => {
          const pick = () => act.brainReply(action.id, c.id);
          return i === 0
            ? <Button key={c.id} size="touch" className="h-12 flex-1" onClick={pick}>{c.label}</Button>
            : <Button key={c.id} size="touch" variant="outline" className="h-12 flex-1" onClick={pick}>{c.label}</Button>;
        })}
      </CardFooter>
    </Card>
  );
}

function Overlay({ view, act, draft, setDraft, overlayRef, canvasRef }: { view: PhoneView; overlayRef?: Ref<HTMLDivElement>; canvasRef?: Ref<HTMLCanvasElement> } & DraftProps) {
  return (
    <div ref={overlayRef} hidden={!view.ar} data-phone-overlay="" className="fixed inset-0">
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 size-full" />
      <div className="fixed inset-x-0 top-0 flex items-center gap-2 px-2 pt-2">
        <Status variant="scrim" size="touch" role="status" title={view.status.title} className="min-w-0 flex-1">
          <StatusLabel className="truncate">{view.status.text}</StatusLabel>
        </Status>
        <Status variant="scrim" size="touch" title="최근 2초 동안 대시보드로 보낸 화면 장 수" className="tabular-nums">{view.fps}</Status>
        <LiquidGlass mode="opaque" className="shrink-0">
          <Button variant="ghost" size="touch" aria-label="메뉴" aria-expanded={view.menuOpen} aria-controls="phone-menu" className="size-12 px-0" onClick={() => act.setMenu(!view.menuOpen)}>
            <Ellipsis />
          </Button>
        </LiquidGlass>
      </div>
      {view.brainLine !== null && (
        <Status variant="scrim" size="touch" role="status" aria-live="polite" className="fixed inset-x-2 top-16 w-auto">
          <Bot className="size-4" /><StatusLabel className="min-w-0 truncate">{view.brainLine}</StatusLabel>
        </Status>
      )}
      {view.request && (
        <Alert variant="brand" size="lg" className="pointer-events-none fixed inset-x-4 top-[30%] w-auto -translate-y-1/2">
          <Camera /><AlertTitle>{view.request.text}</AlertTitle>
        </Alert>
      )}
      {view.action && <ActionCard action={view.action} act={act} />}
      {view.anchors && !view.aligned && (
        <div className="fixed inset-x-4 bottom-24 flex flex-col gap-2 landscape:right-auto landscape:bottom-3 landscape:max-w-[42vw]">
          {view.anchors.map((a) => (
            <Button key={a.id} variant="outline" size="touch" className="h-12 w-full justify-start" onClick={() => act.recordAnchor(a.id)}>
              {anchorLabel(view.mode, a)}
            </Button>
          ))}
        </div>
      )}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+16px)] flex justify-center gap-3.5 landscape:inset-x-auto landscape:right-2.5 landscape:bottom-auto landscape:top-1/2 landscape:-translate-y-1/2 landscape:flex-col landscape:gap-2.5">
        {view.speech && (
          <Button size="touch" variant={view.listening === "ar" ? "destructive" : "default"} aria-label="누르고 말하기" className={`${BIG} touch-none select-none`} {...hold(act, "ar")}>
            <Mic className="size-6" />{view.listening === "ar" ? "듣는 중" : "말하기"}
          </Button>
        )}
        <Button size="touch" variant="outline" aria-label="사진 찍기" className={BIG} onClick={act.takePhoto}>
          <Camera className="size-6" />{view.request ? "컵 안" : "사진"}
        </Button>
        <Button size="touch" variant="outline" aria-label="끝내기" className={BIG} onClick={act.stopAr}>
          <Square className="size-6" />끝내기
        </Button>
      </div>
      {view.ar && view.pending.length > 0 && (
        <div className="fixed left-1/2 top-24 w-[min(90vw,480px)] -translate-x-1/2"><PendingList items={view.pending} act={act} /></div>
      )}
      {view.toast !== null && (
        <LiquidGlass mode="opaque" role="status" aria-live="polite" className="fixed left-1/2 top-28 max-w-[min(90vw,520px)] -translate-x-1/2" contentClassName="px-3.5 py-2 text-center">
          {view.toast}
        </LiquidGlass>
      )}
      <LiquidGlass id="phone-menu" hidden={!view.menuOpen} mode="opaque" radius={16}
        className="fixed right-2 top-16 max-h-[calc(100dvh-140px)] w-[min(380px,calc(100vw-16px))] overflow-auto landscape:right-24 landscape:max-h-[calc(100dvh-56px)]"
        contentClassName="flex flex-col gap-2 p-2.5">
        {view.ar && <TalkForm act={act} draft={draft} setDraft={setDraft} />}
        <Button variant="outline" size="touch" className="h-12" onClick={act.resetAnchors}><RotateCcw />기준점 다시 찍기</Button>
        <Card><CardContent className="p-2"><pre className="m-0 whitespace-pre-wrap">{view.perfDetail}</pre></CardContent></Card>
        <Button variant="outline" size="touch" className="h-12" onClick={() => act.setMenu(false)}>닫기</Button>
      </LiquidGlass>
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

```
H npm --prefix ui test -- tests/phone-screen.test.tsx tests/phone-parts.test.tsx
H npm --prefix ui run typecheck
H npm run lint
```

Expected: PASS, lint 0곳. 부품 lint에 걸리면 걸린 class를 배치 class로 바꾸거나 부품 쪽 변형으로 옮긴다(화면 코드에 꾸밈 class를 두지 않는다).

- [ ] **Step 6: 커밋**

```
git add ui/src/phone/PhoneScreen.tsx ui/src/phone/fixtures.ts ui/tests/phone-screen.test.tsx
git commit -m "feat(phone): build the phone screen states from 21st.dev parts" -m "PhoneScreen lays out the intro, the AR overlay, the menu, the photo request, the action card, the replies and approvals and the error lines with Card, Button, Input, Status, Alert, Item and Liquid Glass. fixtures.ts holds one view per state for the tests and the capture page." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 6: 넘기기 — 폰 서버가 React 폰 화면을 내준다

옛 화면(`index.html`·`phone.css`·`phone.js`)을 지우고, 순수 모듈을 `ui/src/phone/core/`로 옮기고, 폰 서버를 `ui/dist`로 바꾸는 것을 한 커밋에 한다(중간 커밋에서 폰 화면이 깨지지 않게).

**Files:**
- Move: `web/phone/{ar,capture,display-encoder,encoder-worker,engine,link,marks,pipeline,project,talk,touch,video}.js`, `web/phone/{ar,engine,link,marks,pipeline,project,talk,touch,video}.d.ts` → `ui/src/phone/core/`
- Delete: `web/phone/index.html`, `web/phone/phone.css`, `web/phone/phone.js`
- Create: `ui/src/phone/core/font-faces.js`(npm run tokens가 만든다), `ui/src/phone/controller.ts`, `ui/src/phone/PhoneApp.tsx`, `ui/src/phone/main.tsx`, `ui/phone/index.html`
- Modify: `ui/src/phone/core/marks.js`, `ui/src/phone/core/encoder-worker.js`, `scripts/design-tokens.ts`(FONT_FACES·renderFontFaces), `ui/vite.config.ts`, `src/phone/server.ts`, `src/phone/links.ts`, `src/server/static.ts`(주석), `Dockerfile`
- Test: `ui/tests/phone-controller.test.ts`, `ui/tests/phone-app.test.tsx`, `ui/tests/pages.test.ts`, `tests/phone-server.test.ts`, `tests/phone-links.test.ts`, `tests/phone-design.test.ts`, `tests/design-tokens.test.ts`, `tests/deploy-files.test.ts`, `tests/lint-ui-color.test.ts`, 경로만: `tests/phone-{display,engine,pipeline,project,touch-sampler,link,ar,talk}.test.ts`

**Interfaces:**
- Consumes: 작업 2 `createLink`·`createAr`·`createPressToTalk`·`speak`·`recognition`, 작업 3 상태 함수, 작업 4 `drawOverlay`·`fitCanvas`·`labelFont`·`markLabel`, 작업 5 `PhoneScreen`
- Produces:
  - `createPhoneController(deps: ControllerDeps): PhoneController` — `view()`, `subscribe(fn)`, `actions: PhoneActions`, `attach(overlay, draw: { hit(on), marks(marks) })`, `close()`
  - `ControllerDeps = { location: { protocol; host; search }; Socket?; Recognition?: RecognitionCtor | null; speak?; now?; secure?; xr?: XrLike | null; arDeps? }`
  - `PhoneApp({ controller })`
  - 서버: `createPhoneServer({ …, uiDir? })`, `DEFAULT_UI_DIR`(…`/ui/dist/`), `PHONE_NOT_BUILT`

- [ ] **Step 1: 실패하는 시험(서버·주소·입구·글꼴)**

`tests/phone-server.test.ts`:
1) import에 `mkdirSync`와 `dirname`을 더하고, `createPhoneServer, sameHost` 옆에 `DEFAULT_UI_DIR`을 더한다.
2) `cleanups` 정의 아래에 도우미를 둔다:

```ts
/** 가짜 ui/dist: 폰 화면·빌드 파일·브랜드 그림·파비콘과 대시보드·설정 화면. */
function fakeUiDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "phone-ui-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const files: [string, string][] = [
    ["phone/index.html", '<title>폰 테스트</title><script type="module" src="/assets/phone-x.js"></script>'],
    ["assets/phone-x.js", "export {};"],
    ["assets/noto-sans-kr-0-wght-normal-x.woff2", "w"],
    ["brand/mascot@1x.webp", "m"],
    ["favicon.ico", "i"],
    ["fonts/OFL-noto-sans-kr.txt", "ofl"],
    ["index.html", "<title>대시보드</title>"],
    ["setup/index.html", "<title>설정</title>"],
  ];
  for (const [p, body] of files) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}
```

3) `setup()`의 `webDir` 세 줄(`mkdtempSync`·`cleanups.push`·`writeFileSync`)을 지우고 `createPhoneServer({ targets: TARGETS, uiDir: fakeUiDist(), feed, …})`로 바꾼다. `engineSetup()`·`talkSetup()`의 `webDir` 세 줄과 `webDir` 칸은 지운다(이 시험은 화면을 받지 않는다).
4) 「web/phone의 실제 페이지와 스크립트를 준다」 시험을 다음 셋으로 바꾼다:

```ts
  it("ui/dist에서 폰 화면·빌드 파일·브랜드 그림·글꼴 라이선스·파비콘만 준다. 대시보드·설정 화면은 주지 않는다", async () => {
    const phone = createPhoneServer({ targets: TARGETS, uiDir: fakeUiDist(), onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const base = `http://127.0.0.1:${port}`;
    expect(await (await fetchRetry(`${base}/phone/`)).text()).toContain("폰 테스트");
    const js = await fetchRetry(`${base}/assets/phone-x.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await fetchRetry(`${base}/assets/noto-sans-kr-0-wght-normal-x.woff2`)).headers.get("content-type")).toBe("font/woff2");
    for (const p of ["/brand/mascot@1x.webp", "/favicon.ico", "/fonts/OFL-noto-sans-kr.txt"]) expect((await fetchRetry(`${base}${p}`)).status, p).toBe(200);
    for (const p of ["/index.html", "/setup/", "/setup/index.html", "/api/devices", "/phone/..%2Findex.html", "/brand/..%2Findex.html", "/assets/..%2Fsetup%2Findex.html"]) {
      expect((await fetchRetry(`${base}${p}`)).status, p).toBe(404);
    }
    expect((await fetchRetry(`${base}/`, { redirect: "manual" })).headers.get("location")).toBe("/phone/");
  });

  it("기본 화면 폴더는 ui/dist", () => {
    expect(DEFAULT_UI_DIR.replace(/\\/g, "/")).toMatch(/\/ui\/dist\/$/);
  });

  it("빌드 전이면 /phone/은 503과 빌드 명령", async () => {
    const empty = mkdtempSync(join(tmpdir(), "phone-ui-empty-"));
    cleanups.push(() => rmSync(empty, { recursive: true, force: true }));
    const phone = createPhoneServer({ targets: TARGETS, uiDir: empty, onEye: () => {}, log: () => {} });
    const { port } = await phone.listen(0, "127.0.0.1");
    cleanups.push(() => phone.close());
    const r = await fetchRetry(`http://127.0.0.1:${port}/phone/`);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("npm run ui:build");
  });
```

`tests/phone-links.test.ts` 「다른 기계로 가는 프록시·이상한 값은 버린다」 아래에 더한다:

```ts
  it("사이트 뿌리(/)로 이은 것만 쓴다(폰 화면 빌드 파일이 /assets/에 있다)", () => {
    expect(servedPhoneUrls(serve({ [`${FAKE}:443`]: { Handlers: { "/eye": { Proxy: "http://127.0.0.1:8210" } } } }), 8210)).toEqual([]);
  });
```

`ui/tests/pages.test.ts`: `it.each`의 표에 `["phone/index.html", "phone"]`을 더하고, `expect(html).toContain("<title>NOONCHI");`를 `expect(html).toMatch(/<title>[^<]*NOONCHI[^<]*<\/title>/);`로 바꾼다(「NOONCHI 설정」·「클로이드의 눈 · NOONCHI」 둘 다 맞는다). 글꼴 `it.each`에 `"src/phone/main.tsx"`를 더한다.

`tests/design-tokens.test.ts` 「워커 글꼴 목록」 시험을 바꾼다:

```ts
  it("워커 글꼴 목록(ui/src/phone/core/font-faces.js)이 꾸러미 CSS와 같고, 글꼴 파일은 ui 빌드가 묶는다(?url)", () => {
    expect(FONT_FACES).toBe("ui/src/phone/core/font-faces.js");
    expect(onDisk(FONT_FACES)).toBe(renderFontFaces());
    const css = readFileSync(repoPath("ui/node_modules/@fontsource-variable/noto-sans-kr/index.css"), "utf8");
    const imports = renderFontFaces().match(/^import f\d+ from "@fontsource-variable\/noto-sans-kr\/files\/[\w-]+\.woff2\?url";$/gm) ?? [];
    expect(imports).toHaveLength(css.match(/@font-face/g)!.length);
    expect(renderFontFaces()).toMatch(/\{ url: f0, unicodeRange: "U\+/);
  });
```

`tests/deploy-files.test.ts` 첫 Dockerfile 시험에 `expect(d).not.toContain("COPY web web");`를 더한다(폰 화면도 `ui/dist`에서 나온다).

`tests/phone-design.test.ts`를 바꾼다: `web` 도우미를 `const core = (p: string) => readFileSync(fileURLToPath(new URL(\`../ui/src/phone/core/${p}\`, import.meta.url)), "utf8");`로, import를 `from "../ui/src/phone/core/marks.js"`로, 첫 줄 주석을 「폰 초점 그림(ui/src/phone/core/marks.js): 색은 src/design/tokens.ts, 워커 글꼴은 ui 빌드가 묶은 Noto Sans KR Variable.」로 바꾼다. 「marks.js·워커는 …」 시험을 다음으로 바꾼다:

```ts
  it("marks.js는 src/design/tokens.ts 값, 워커는 ui 빌드가 묶은 글꼴 목록(font-faces.js)을 쓴다", () => {
    expect(core("marks.js")).toContain('from "../../../../src/design/tokens.ts"');
    expect(markFont(640)).toMatch(/^bold \d+px "Noto Sans KR Variable"/);
    const worker = core("encoder-worker.js");
    expect(worker).toContain('from "./font-faces.js"');
    expect(worker).toContain("new FontFace(");
    expect(worker).toContain("self.fonts.load(");
  });
```

그리고 `describe("폰 페이지(web/phone/index.html)")`·`describe("폰 서버가 글꼴·파비콘·마스코트를 준다")` 두 묶음과 쓰지 않게 된 import(`afterEach`, `createPhoneServer`, `fetchRetry`, `cleanups`)를 지운다(14px 규칙은 `ui/tests/phone-screen.test.tsx`, 화면 파일은 `tests/phone-server.test.ts`·`ui/tests/pages.test.ts`가 본다).

`tests/lint-ui-color.test.ts` 「대시보드·설정·폰 화면 파일을 본다」의 목록을 바꾼다:

```ts
    for (const p of ["ui/index.html", "ui/setup/index.html", "ui/src/styles.css", "ui/src/bubbles/BubbleLayer.tsx", "ui/src/phone/PhoneScreen.tsx", "ui/src/phone/core/marks.js"]) {
```

- [ ] **Step 2: 실패하는 시험(제어·뿌리)**

`ui/tests/phone-controller.test.ts`:

```ts
// 폰 화면 제어(controller.ts)를 가짜 소켓·가짜 음성·가짜 XR로 돌린다. 옮기기 전 phone.js 규칙 그대로인지 본다:
// 알림 5초(승인이 있으면 12초), 판단 줄 8초, 잠깐 알릴 말 4초, 부탁은 소리로 읽고, 답은 말이나 단추로 보낸다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhoneController, type ControllerDeps } from "../src/phone/controller";
import { supportText } from "../src/phone/state";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, any>[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.last = this; }
  addEventListener(t: string, f: (e: any) => void) { (this.on[t] ??= []).push(f); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

function fakeSession() {
  const ends: (() => void)[] = [];
  return {
    renderState: { baseLayer: { framebuffer: null } },
    updateRenderState() {},
    requestReferenceSpace: async () => ({ addEventListener() {} }),
    requestHitTestSource: async () => ({}),
    addEventListener: (t: string, f: () => void) => { if (t === "end") ends.push(f); },
    requestAnimationFrame() {},
    end() { for (const f of ends) f(); },
  };
}
const gl = { FRAMEBUFFER: 1, COLOR_BUFFER_BIT: 2, bindFramebuffer() {}, clearColor() {}, clear() {} };

let t = 0;
const made: { close(): void }[] = [];
afterEach(() => { while (made.length) made.pop()!.close(); vi.useRealTimers(); t = 0; });

function make(over: Partial<ControllerDeps> = {}) {
  const spoken: string[] = [];
  const c = createPhoneController({
    location: { protocol: "https:", host: "pc.ts.net:8443", search: "" },
    Socket: FakeSocket, Recognition: null, speak: (s) => spoken.push(s), now: () => t,
    secure: true, xr: { isSessionSupported: async () => true }, ...over,
  });
  made.push(c);
  const ws = FakeSocket.last;
  ws.open();
  const sent = () => ws.sent.filter((m) => m.type !== "clock");
  return { c, ws, spoken, sent };
}
const anchors = [{ id: "a", label: "거실 창가", recorded: true }, { id: "b", label: "현관", recorded: false }];
const status = (over: Record<string, unknown> = {}) => ({ type: "status", mode: "floor", revision: 3, anchors, aligned: false, mismatch_m: null, ...over });

describe("폰 화면 제어(controller.ts)", () => {
  it("https 주소면 wss로 /phone/events에 붙는다", () => {
    expect(make().ws.url).toBe("wss://pc.ts.net:8443/phone/events");
  });

  it("AR 지원: 보안 연결·immersive-ar면 준비, 아니면 그 까닭", async () => {
    const ok = make();
    await vi.waitFor(() => expect(ok.c.view().support).toEqual({ kind: "ready" }));
    expect(make({ secure: false }).c.view().support).toEqual({ kind: "insecure" });
    const none = make({ xr: null });
    await vi.waitFor(() => expect(none.c.view().support).toEqual({ kind: "no-ar" }));
    const no = make({ xr: { isSessionSupported: async () => false } });
    await vi.waitFor(() => expect(no.c.view().support).toEqual({ kind: "no-ar" }));
  });

  it("상태 메시지: 기준점·맞춤과 상태 줄. 잠깐 알릴 말은 4초, title은 늘 맞춤 상태", () => {
    t = 1000;
    const { c, ws } = make();
    ws.push(status());
    expect(c.view().anchors).toEqual(anchors);
    expect(c.view().status).toEqual({ text: "맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록", title: "맞추기 전 · 창가 기준 방향만 · 기준점 1/2 기록" });
    c.actions.recordAnchor("a");
    expect(c.view().status.text).toBe("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
    t = 5001;
    ws.push(status({ aligned: true, mismatch_m: 0.12 }));
    expect(c.view().status.text).toBe("맞춤 ✓ · 거리 차이 12cm");
    ws.push(status({ error: "기준점이 너무 가까워요" }));
    expect(c.view().status.text).toBe("기준점이 너무 가까워요");
  });

  it("벽 기준점: AR 전에는 먼저 시작하라고 하고 보내지 않는다", () => {
    const { c, ws, sent } = make();
    ws.push(status({ mode: "touch" }));
    c.actions.recordAnchor("A");
    expect(c.view().status.text).toBe("AR을 먼저 시작하세요");
    expect(sent()).toEqual([]);
  });

  it("말하기: 빈 말은 보내지 않고, 보내면 「생각 중」 줄 15초. 연결이 끊기면 다시 말하라고", () => {
    vi.useFakeTimers();
    const { c, ws, sent } = make();
    c.actions.say("   ");
    expect(sent()).toEqual([]);
    c.actions.say(" TV 켜줘 ");
    expect(sent()).toEqual([{ type: "say", text: "TV 켜줘" }]);
    expect([c.view().reply, c.view().toast]).toEqual(['🎙 "TV 켜줘" … 생각 중', '🎙 "TV 켜줘" … 생각 중']);
    vi.advanceTimersByTime(15000);
    expect(c.view().toast).toBeNull();
    ws.readyState = 3;
    c.actions.say("불 꺼줘");
    expect(c.view().reply).toBe("서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요.");
  });

  it("답: 소리로 읽고 승인 대기를 보인다. 승인이 있으면 알림 12초. 승인·취소는 그 줄을 지우고 보낸다", () => {
    vi.useFakeTimers();
    const { c, ws, spoken, sent } = make();
    ws.push({ type: "reply", text: "현관문 잠금 해제는 승인이 필요해요.", pending: [{ token: "t1", deviceLabel: "현관문", reason: "현관문 잠금 해제" }, { token: "t2", deviceLabel: "창문", reason: "창문 열기" }] });
    expect(spoken).toEqual(["현관문 잠금 해제는 승인이 필요해요."]);
    expect(c.view().pending.map((p) => p.token)).toEqual(["t1", "t2"]);
    vi.advanceTimersByTime(11999);
    expect(c.view().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(c.view().toast).toBeNull();
    c.actions.confirm("t1");
    c.actions.cancel("t2");
    expect(c.view().pending).toEqual([]);
    expect(sent()).toEqual([{ type: "confirm", token: "t1" }, { type: "cancel", token: "t2" }]);
  });

  it("사진 요청: 거둘 때까지 보이고 소리로 읽는다. 다른 요청을 거두는 말은 무시한다", () => {
    const { c, ws, spoken } = make();
    ws.push({ type: "request", id: "r1", text: "컵 안을 비춰 주세요", active: true });
    expect(c.view().request).toEqual({ id: "r1", text: "컵 안을 비춰 주세요" });
    ws.push({ type: "request", id: "r0", text: "", active: false });
    expect(c.view().request).not.toBeNull();
    ws.push({ type: "request", id: "r1", text: "컵 안을 비춰 주세요", active: false });
    expect(c.view().request).toBeNull();
    expect(spoken).toEqual(["컵 안을 비춰 주세요"]);
  });

  it("행동 부탁: speak면 읽고, 고르면 brain_reply. done이면 고맙다는 알림 3초. 연결이 끊기면 상태 줄", () => {
    vi.useFakeTimers();
    const { c, ws, spoken, sent } = make();
    const choices = [{ id: "done", label: "치웠어요" }, { id: "later", label: "나중에" }];
    ws.push({ type: "action", id: "a1", text: "식탁 위 컵을 치워 주세요", would: "로봇이 식탁의 컵을 싱크대로 옮긴다", choices, active: true, speak: true });
    expect(c.view().action).toEqual({ id: "a1", text: "식탁 위 컵을 치워 주세요", would: "로봇이 식탁의 컵을 싱크대로 옮긴다", choices });
    expect(spoken).toEqual(["식탁 위 컵을 치워 주세요"]);
    c.actions.brainReply("a1", "done");
    expect(sent()).toEqual([{ type: "brain_reply", id: "a1", choice: "done" }]);
    expect(c.view().toast).toBe("고마워요. 컵이 안 보이는지 확인할게요");
    vi.advanceTimersByTime(3000);
    expect(c.view().toast).toBeNull();
    ws.push({ type: "action", id: "a0", active: false });
    expect(c.view().action).not.toBeNull();
    ws.push({ type: "action", id: "a1", active: false });
    expect(c.view().action).toBeNull();
    ws.readyState = 3;
    c.actions.brainReply("a1", "later");
    expect(c.view().status.text).toBe("서버와 연결이 끊겨 답을 보내지 못했어요");
  });

  it("판단 줄은 8초, 사진 보냄 알림은 위치·요청에 따라", () => {
    vi.useFakeTimers();
    const { c, ws } = make();
    ws.push({ type: "brain_line", text: "식탁 위 컵을 보고 있어요" });
    expect(c.view().brainLine).toBe("식탁 위 컵을 보고 있어요");
    vi.advanceTimersByTime(8000);
    expect(c.view().brainLine).toBeNull();
    ws.push({ type: "photo_saved", id: "p1", aligned: true });
    expect(c.view().toast).toBe("사진을 위치와 함께 보냈어요");
    ws.push({ type: "photo_saved", id: "p2", aligned: false });
    expect(c.view().toast).toBe("위치 없이 사진을 보냈어요");
    ws.push({ type: "photo_saved", id: "p3", answer: true });
    expect(c.view().toast).toBe("요청한 컵 사진을 보냈어요");
  });

  it("메뉴: 열고, 기준점 다시 찍기는 같은 원점 이름으로 reset을 보내고 메뉴를 닫는다", () => {
    const { c, sent } = make();
    c.actions.setMenu(true);
    expect(c.view().menuOpen).toBe(true);
    c.actions.resetAnchors();
    expect(sent()).toEqual([{ type: "reset", epoch: null }]);
    expect(c.view().menuOpen).toBe(false);
  });

  it("AR 시작·끝: 덮개를 보이고 숨긴다. 시작이 실패하면 처음 화면에 까닭", async () => {
    const session = fakeSession();
    const { c, sent } = make({ arDeps: { xr: () => ({ requestSession: async () => session }), gl: () => gl, layer: () => ({}), binding: () => null } });
    c.attach(document.createElement("div"), { hit() {}, marks() {} });
    c.actions.startAr();
    await vi.waitFor(() => expect(sent().some((m) => m.type === "reset" && typeof m.epoch === "string")).toBe(true));
    expect(c.view().ar).toBe(true);
    c.actions.stopAr();
    expect(c.view().ar).toBe(false);
    const bad = make({ arDeps: { xr: () => ({ requestSession: async () => { throw new Error("거부됨"); } }) } });
    bad.c.attach(document.createElement("div"), { hit() {}, marks() {} });
    bad.c.actions.startAr();
    await vi.waitFor(() => expect(supportText(bad.c.view().support)).toBe("AR을 시작하지 못했어요: 거부됨"));
  });

  it("누르고 말하기: 누르는 동안 그 자리 단추만 듣는 중, 떼면 들은 말을 보낸다", () => {
    class Rec {
      static last: Rec;
      lang = ""; interimResults = false; maxAlternatives = 0;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      constructor() { Rec.last = this; }
      start() {}
      stop() { this.onend?.(); }
    }
    const { c, sent } = make({ Recognition: Rec as never });
    expect(c.view().speech).toBe(true);
    c.actions.talkDown("ar");
    expect(c.view().listening).toBe("ar");
    Rec.last.onresult!({ results: [[{ transcript: "불 꺼줘" }]] });
    c.actions.talkUp("ar");
    expect(c.view().listening).toBeNull();
    expect(sent()).toEqual([{ type: "say", text: "불 꺼줘" }]);
  });
});
```

`ui/tests/phone-app.test.tsx`:

```tsx
// 폰 화면 뿌리(PhoneApp): 제어(controller.ts)의 상태를 그대로 그리고, 화면 단추가 서버로 말을 보낸다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createPhoneController } from "../src/phone/controller";
import { PhoneApp } from "../src/phone/PhoneApp";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 0;
  sent: Record<string, any>[] = [];
  private on: Record<string, ((e: any) => void)[]> = {};
  constructor(readonly url: string) { FakeSocket.last = this; }
  addEventListener(t: string, f: (e: any) => void) { (this.on[t] ??= []).push(f); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; for (const f of this.on.open ?? []) f({}); }
  push(m: unknown) { for (const f of this.on.message ?? []) f({ data: JSON.stringify(m) }); }
}

const made: { close(): void }[] = [];
afterEach(() => { while (made.length) made.pop()!.close(); });

describe("폰 화면 뿌리(PhoneApp)", () => {
  it("상태 메시지가 오면 첫 안내에 기준점 이름, AR이 없으면 까닭, 글을 보내면 서버로 say", async () => {
    const c = createPhoneController({
      location: { protocol: "http:", host: "127.0.0.1:8521", search: "" }, Socket: FakeSocket, Recognition: null,
      speak: () => {}, secure: true, xr: { isSessionSupported: async () => false },
    });
    made.push(c);
    render(<PhoneApp controller={c} />);
    act(() => {
      FakeSocket.last.open();
      FakeSocket.last.push({ type: "status", mode: "floor", revision: 1, anchors: [{ id: "a", label: "거실 창가", recorded: false }], aligned: false, mismatch_m: null });
    });
    const main = within(screen.getByRole("main"));
    expect(main.getAllByRole("listitem")[0]).toHaveTextContent("거실 창가 바닥에 차례로 조준점을 맞추고 지점 기록을 눌러요");
    expect(await main.findByText("이 브라우저는 AR을 지원하지 않아요. 안드로이드 크롬으로 여세요.")).toBeInTheDocument();
    await userEvent.type(main.getByRole("textbox", { name: "클로이드에게 할 말" }), "TV 켜줘");
    await userEvent.click(main.getByRole("button", { name: "보내기" }));
    expect(FakeSocket.last.sent).toContainEqual({ type: "say", text: "TV 켜줘" });
    expect(main.getByText('🎙 "TV 켜줘" … 생각 중').closest("[role=status]")).not.toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

```
H npx vitest run tests/phone-server.test.ts tests/phone-links.test.ts tests/phone-design.test.ts tests/design-tokens.test.ts tests/deploy-files.test.ts tests/lint-ui-color.test.ts
H npm --prefix ui test -- tests/phone-controller.test.ts tests/phone-app.test.tsx tests/pages.test.ts
```

Expected: FAIL — `uiDir`가 없어 「폰 테스트」·`/assets/` 시험 실패, `DEFAULT_UI_DIR` undefined, `/eye` mount가 주소로 나옴, `FONT_FACES`가 `web/phone/fonts/faces.js`, `COPY web web`이 있음, `ui/src/phone/core/marks.js` 없음, `../src/phone/controller` 없음, `phone/index.html` 없음.

- [ ] **Step 4: 모듈 옮기기**

```
cd C:/Users/ABC/Desktop/소웨공/twin-home-noonchi
mkdir -p ui/src/phone/core
for f in ar capture display-encoder encoder-worker engine link marks pipeline project talk touch video; do git mv web/phone/$f.js ui/src/phone/core/$f.js; done
for f in ar engine link marks pipeline project talk touch video; do git mv web/phone/$f.d.ts ui/src/phone/core/$f.d.ts; done
git rm web/phone/index.html web/phone/phone.css web/phone/phone.js
sed -i 's#\.\./web/phone/#../ui/src/phone/core/#g; s#web/phone/#ui/src/phone/core/#g' tests/phone-display.test.ts tests/phone-engine.test.ts tests/phone-pipeline.test.ts tests/phone-project.test.ts tests/phone-touch-sampler.test.ts tests/phone-link.test.ts tests/phone-ar.test.ts tests/phone-talk.test.ts
```

(Bash 도구로 돌린다.) `ui/src/phone/core/marks.js` 첫 두 줄과 import를 바꾼다:

```js
// 초점 고리 그리기. 화면(capture.js)과 JPEG 인코딩 워커(encoder-worker.js)가 함께 쓴다(DOM 없음).
// 색·굵기는 src/design/tokens.ts(원본 src/design/tokens.json): 영상 위 표시는 세 겹(바깥 숯색, 흰 테, brand 심)이라 어떤 바탕에서도 보인다.

import { font, twin } from "../../../../src/design/tokens.ts";

const focus = twin.phoneFocus;
const canvasFont = font.canvas;
```

`ui/src/phone/core/encoder-worker.js`: 4번째 줄 주석을 「// 초점 이름표 글꼴: 워커에는 페이지의 @font-face가 없어서 ui 빌드가 묶은 Noto Sans KR Variable 조각(font-faces.js)을 FontFace로 넣고, 그릴 글자의 조각을 받은 뒤 그린다.」로, `import { faces, family } from "./fonts/faces.js";`를 `import { faces, family } from "./font-faces.js";`로, FontFace 줄을 바꾼다:

```js
      self.fonts.add(new FontFace(family, `url(${f.url}) format("woff2")`, { weight: "100 900", unicodeRange: f.unicodeRange }));
```

- [ ] **Step 5: 워커 글꼴 목록 만들기**

`scripts/design-tokens.ts`: 7번째 줄 주석을 `//   ui/src/phone/core/font-faces.js  인코딩 워커가 FontFace로 넣는 글꼴 조각 목록(꾸러미 CSS에서 만든다, 파일은 ui 빌드가 ?url로 묶는다)`로, `FONT_FACES`와 `renderFontFaces`를 바꾼다:

```ts
export const FONT_FACES = "ui/src/phone/core/font-faces.js";
```

```ts
/** 꾸러미 CSS의 @font-face(파일·unicode-range)를 워커용 ESM 목록으로. 파일은 ?url import라 ui 빌드가 묶은 주소가 들어간다. */
export function renderFontFaces(): string {
  const css = readFileSync(repoPath(`${FONT_PKG}/index.css`), "utf8");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
    file: /url\(\.\/files\/([^)]+)\)/.exec(m[1]!)![1]!,
    unicodeRange: /unicode-range:\s*([^;]+);/.exec(m[1]!)![1]!.trim(),
  }));
  const family = /font-family:\s*'([^']+)'/.exec(css)![1]!;
  return [
    "// 만든 파일: npm run tokens가 @fontsource-variable/noto-sans-kr 꾸러미 CSS에서 만든다. 손으로 고치지 않는다.",
    "// 인코딩 워커(encoder-worker.js)가 이 목록으로 FontFace를 넣는다. 글꼴 파일은 ui 빌드가 묶는다(?url).",
    "",
    ...faces.map((f, i) => `import f${i} from "@fontsource-variable/noto-sans-kr/files/${f.file}?url";`),
    "",
    `export const family = ${JSON.stringify(family)};`,
    "",
    `export const faces = [\n${faces.map((f, i) => `  { url: f${i}, unicodeRange: ${JSON.stringify(f.unicodeRange)} },`).join("\n")}\n];`,
    "",
  ].join("\n");
}
```

Run: `H npm run tokens` → `만듦 ui/src/phone/core/font-faces.js`가 찍힌다. 그다음 `git diff --ignore-cr-at-eol --stat -- ui/src/tokens.css src/design/tokens.ts ui/public/fonts web/phone`이 빈 줄인지 본다(내용이 바뀌면 멈추고 원인을 본다).

- [ ] **Step 6: 제어·뿌리·입구**

`ui/src/phone/controller.ts`:

```ts
// 폰 화면 제어: 연결(core/link.js)·AR(core/ar.js)·누르고 말하기(core/talk.js)를 묶고, 서버 메시지와 단추를 화면 상태(state.ts)로 바꾼다.
// 규칙은 옮기기 전 web/phone/phone.js 그대로다: 알림 5초(답에 승인이 있으면 12초), 판단 줄 8초, 잠깐 알릴 말 4초.
// 상태 줄은 상태 메시지·잠깐 알릴 말·1초마다의 측정 때 다시 만든다. 부탁·질문이 뜨면 소리로 읽고, 답은 말이나 단추로 보낸다.
import { createAr } from "./core/ar.js";
import { createLink, phoneSocketUrl } from "./core/link.js";
import { createPressToTalk, recognition, speak as speakAloud, type PressToTalk, type RecognitionCtor } from "./core/talk.js";
import {
  anchorCount, createStore, initialView, onAction, onRequest, onStatus, photoSavedText, statusLine,
  type Anchor, type AlignMode, type Choice, type FocusMark, type Pending, type PhoneActions, type PhoneView, type TalkSpot,
} from "./state";

const TOAST_MS = 5000;
const NOTE_MS = 4000;
const BRAIN_LINE_MS = 8000;

type XrLike = { isSessionSupported(mode: string): Promise<boolean> };
export interface ControllerDeps {
  location: { protocol: string; host: string; search: string };
  /** 시험이 바꾼다. 없으면 브라우저 WebSocket. */
  Socket?: unknown;
  /** undefined면 브라우저 음성 인식, null이면 없음. */
  Recognition?: RecognitionCtor | null;
  speak?: (text: string) => void;
  now?: () => number;
  secure?: boolean;
  /** 없으면 navigator.xr. null이면 AR 없음. */
  xr?: XrLike | null;
  arDeps?: Record<string, unknown>;
}
export interface ControllerDraw { hit(on: boolean): void; marks(marks: FocusMark[]): void }
export interface PhoneController {
  view(): PhoneView;
  subscribe(fn: () => void): () => void;
  actions: PhoneActions;
  /** AR 덮개 뿌리(DOM 오버레이)와 canvas 그림을 잇는다. */
  attach(overlay: HTMLElement | null, draw: ControllerDraw): void;
  close(): void;
}

type Msg = Record<string, any>;

export function createPhoneController(deps: ControllerDeps): PhoneController {
  const now = deps.now ?? (() => performance.now());
  const speak = deps.speak ?? speakAloud;
  const Recognition = deps.Recognition === undefined ? recognition() : deps.Recognition;
  const params = new URLSearchParams(deps.location.search);
  const store = createStore<PhoneView>(initialView(Boolean(Recognition)));
  const set = (fn: (v: PhoneView) => PhoneView) => store.set(fn);
  // 상태 줄 재료와 기록에 붙일 서버 기준점 판
  let revision: number | null = null;
  let mismatchM: number | null = null;
  let note: { text: string; until: number } | null = null;
  let overlay: HTMLElement | null = null;
  let draw: ControllerDraw = { hit: () => {}, marks: () => {} };
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let lineTimer: ReturnType<typeof setTimeout> | undefined;

  const link = createLink({ url: phoneSocketUrl(deps.location), onMessage, Socket: deps.Socket, now: undefined });
  const ar = createAr({
    link, params, deps: deps.arDeps,
    hooks: {
      onStart: () => set((v) => ({ ...v, ar: true })),
      onEnd: () => set((v) => ({ ...v, ar: false })),
      onHit: (hit) => draw.hit(hit),
      onMarks: (marks) => draw.marks(marks),
      onPerf: () => {
        const p = ar.perf();
        set((v) => ({ ...v, fps: p.fps, perfDetail: p.detail }));
        renderStatus();
      },
      note: showNote,
    },
  });
  const talk: Partial<Record<TalkSpot, PressToTalk>> = {};
  if (Recognition) {
    for (const spot of ["intro", "ar"] as const) {
      talk[spot] = createPressToTalk(Recognition, {
        onListening: (on) => set((v) => ({ ...v, listening: on ? spot : null })),
        onLine: showLine,
        onHeard: (text) => actions.say(text),
      });
    }
  }

  function renderStatus() {
    set((v) => ({
      ...v,
      status: statusLine({
        aligned: v.aligned, mode: v.mode, mismatchM, limited: ar.state.limited,
        anchorCount: v.anchors ? anchorCount(v.anchors) : "",
        note: note && now() < note.until ? note.text : null,
      }),
    }));
  }
  function showNote(text: string) {
    note = { text, until: now() + NOTE_MS };
    renderStatus();
  }
  function toast(text: string, ms = TOAST_MS) {
    set((v) => ({ ...v, toast: text }));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set((v) => ({ ...v, toast: null })), ms);
  }
  function showLine(text: string, ms?: number) {
    set((v) => ({ ...v, reply: text }));
    toast(text, ms);
  }

  function onMessage(msg: Msg) {
    if (msg.type === "status") {
      revision = msg.revision ?? null;
      ar.setEngineMs(msg.engine_ms);
      mismatchM = msg.mismatch_m ?? null;
      set((v) => onStatus(v, msg as { mode?: AlignMode; anchors: Anchor[]; aligned: boolean }));
      if (msg.error) showNote(msg.error);
      else renderStatus();
    } else if (msg.type === "photo_saved") toast(photoSavedText(msg));
    else if (msg.type === "reply") {
      const pending: Pending[] = msg.pending ?? [];
      showLine(msg.text, pending.length ? 12000 : TOAST_MS);
      speak(msg.text);
      set((v) => ({ ...v, pending }));
    } else if (msg.type === "focus") ar.setFocus(msg.targets, msg.ttl_ms);
    else if (msg.type === "request") {
      if (!msg.active && msg.id !== store.get().request?.id) return;
      set((v) => onRequest(v, msg as { id: string; text: string; active: boolean }));
      if (msg.active) speak(msg.text);
    } else if (msg.type === "action") {
      set((v) => onAction(v, msg as { id: string; text?: string; would?: string | null; choices?: Choice[]; active: boolean }));
      if (msg.active && msg.speak) speak(msg.text);
    } else if (msg.type === "brain_line") {
      set((v) => ({ ...v, brainLine: String(msg.text ?? "") }));
      clearTimeout(lineTimer);
      lineTimer = setTimeout(() => set((v) => ({ ...v, brainLine: null })), BRAIN_LINE_MS);
    }
  }

  /** 벽 기준점 기록: 조준점이 닿은 바닥 점(벽 바로 아래)을 그 기준점으로 보낸다. 점 자체가 바닥이라 floor도 같은 점이다. */
  function aimTouch(id: string) {
    if (!ar.state.on) return showNote("AR을 먼저 시작하세요");
    if (!ar.state.lastFloor) return showNote(`조준점이 바닥에 닿지 않았어요. ${id} 벽 바로 아래 바닥을 천천히 비춰 주세요`);
    if (link.send({ type: "anchor", id, point: ar.state.lastFloor, floor: ar.state.lastFloor, epoch: ar.state.epoch, revision })) toast(`${id} 지점을 기록했어요`, 2500);
    else showNote("서버와 연결이 끊겨 기록하지 못했어요");
  }

  const actions: PhoneActions = {
    startAr() {
      // 사용자 동작 안에서 바로 requestSession까지 간다(await 없이)
      if (!overlay) return;
      ar.start(overlay).catch((error: Error) => set((v) => ({ ...v, support: { kind: "failed", message: error.message } })));
    },
    stopAr: () => ar.stop(),
    takePhoto: () => ar.requestPhoto(),
    recordAnchor(id) {
      if (store.get().mode === "touch") return aimTouch(id);
      if (!ar.state.hitPoint) return showNote("조준점이 바닥에 닿지 않았어요. 바닥을 천천히 비춰 주세요");
      link.send({ type: "anchor", id, point: ar.state.hitPoint, epoch: ar.state.epoch, revision });
    },
    resetAnchors() {
      // 같은 AR 공간에서 다시 맞추기: 원점(epoch)은 그대로 두고 기록만 지운다
      link.send({ type: "reset", epoch: ar.state.epoch });
      set((v) => ({ ...v, menuOpen: false }));
    },
    setMenu: (open) => set((v) => ({ ...v, menuOpen: open })),
    say(text) {
      const t = text.trim();
      if (!t) return;
      showLine(`🎙 "${t}" … 생각 중`, 15000);
      if (!link.send({ type: "say", text: t })) showLine("서버와 연결이 끊겼어요. 잠시 뒤 다시 말해 주세요.");
    },
    confirm(token) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "confirm", token });
    },
    cancel(token) {
      set((v) => ({ ...v, pending: v.pending.filter((p) => p.token !== token) }));
      link.send({ type: "cancel", token });
    },
    brainReply(id, choice) {
      if (!link.send({ type: "brain_reply", id, choice })) showNote("서버와 연결이 끊겨 답을 보내지 못했어요");
      else if (choice === "done") toast("고마워요. 컵이 안 보이는지 확인할게요", 3000);
    },
    talkDown: (spot) => talk[spot]?.down(),
    talkUp: (spot) => talk[spot]?.up(),
  };

  async function checkSupport() {
    if (!(deps.secure ?? window.isSecureContext)) return set((v) => ({ ...v, support: { kind: "insecure" } }));
    const xr = "xr" in deps ? deps.xr : (navigator as Navigator & { xr?: XrLike }).xr;
    const ok = xr ? await xr.isSessionSupported("immersive-ar").catch(() => false) : false;
    set((v) => ({ ...v, support: { kind: ok ? "ready" : "no-ar" } }));
  }
  void checkSupport();

  return {
    view: store.get,
    subscribe: store.subscribe,
    actions,
    attach(root, d) {
      overlay = root;
      draw = d;
    },
    close() {
      link.close();
      ar.stop();
      clearTimeout(toastTimer);
      clearTimeout(lineTimer);
    },
  };
}
```

(`now: undefined`는 link.js 기본 시계를 쓴다는 뜻이다. `deps.now`는 상태 줄 시계만 바꾼다.)

`ui/src/phone/PhoneApp.tsx`:

```tsx
// 폰 화면 뿌리: 제어(controller.ts)의 상태를 그리고, AR 덮개 뿌리와 canvas 그림(draw.ts)을 잇는다.
// 조준점·초점은 XR 프레임마다 React 상태를 거치지 않고 canvas에 바로 그린다.
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PhoneController } from "./controller";
import { drawOverlay, fitCanvas, labelFont, markLabel, type OverlayScene } from "./draw";
import { PhoneScreen } from "./PhoneScreen";

export function PhoneApp({ controller }: { controller: PhoneController }) {
  const view = useSyncExternalStore(controller.subscribe, controller.view);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const scene: OverlayScene = { hit: false, marks: [] };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let labels = "";
    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = fitCanvas(canvas, innerWidth, innerHeight, devicePixelRatio || 1);
      if (ctx) drawOverlay(ctx, { width: innerWidth, height: innerHeight }, scene, performance.now(), reduced.matches);
    };
    controller.attach(overlayRef.current, {
      hit(on) {
        if (scene.hit === on) return;
        scene.hit = on;
        paint();
      },
      marks(marks) {
        scene.marks = marks;
        // 이름표 글자의 글꼴 조각을 받는다(못 받으면 대체 글꼴로 그린다)
        const text = marks.map((m) => markLabel(m.label)).join("");
        if (text && text !== labels) void document.fonts?.load(labelFont, text).catch(() => {});
        labels = text;
        paint();
      },
    });
  }, [controller]);
  return <PhoneScreen view={view} act={controller.actions} overlayRef={overlayRef} canvasRef={canvasRef} />;
}
```

`ui/src/phone/main.tsx`:

```tsx
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { createPhoneController } from "./controller";
import { PhoneApp } from "./PhoneApp";

// 제어는 한 번만 만든다(StrictMode가 효과를 두 번 돌려도 연결은 하나)
const controller = createPhoneController({ location });
createRoot(document.getElementById("root")!).render(<StrictMode><MotionConfig reducedMotion="user"><PhoneApp controller={controller} /></MotionConfig></StrictMode>);
```

`ui/phone/index.html`:

```html
<!doctype html>
<html lang="ko" data-surface="phone">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>클로이드의 눈 · NOONCHI</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"></head>
<body><div id="root"></div><script type="module" src="/src/phone/main.tsx"></script></body>
</html>
```

`ui/vite.config.ts`의 input:

```ts
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: { main: page("index.html"), setup: page("setup/index.html"), phone: page("phone/index.html") } } },
```

- [ ] **Step 7: 폰 서버·주소**

`src/phone/server.ts`: 1번째 줄 주석 뒤에 `// 폰 화면은 React 빌드 ui/dist/phone/이고 빌드 파일은 /assets/다(대시보드와 같은 빌드).`를 더한다. import를 `import { existsSync } from "node:fs";`, `import { join, resolve } from "node:path";`로 바꾼다. `DEFAULT_WEB_DIR` 줄을 바꾼다:

```ts
/** 폰 화면 빌드 폴더: ui/dist(대시보드와 같은 빌드). npm start·npm run dev가 먼저 빌드한다. */
export const DEFAULT_UI_DIR = fileURLToPath(new URL("../../ui/dist/", import.meta.url));
/** 빌드 전이면 /phone/ 요청에 주는 글. */
export const PHONE_NOT_BUILT = "폰 화면이 아직 빌드되지 않았어요. npm run ui:build";
/** /phone/ 밖에서 내주는 ui/dist 파일: 빌드 파일·브랜드 그림·글꼴 라이선스 폴더와 파비콘. 대시보드·설정 화면은 내주지 않는다. */
const PHONE_FILES = /^\/(assets|brand|fonts)\/(.+)$|^\/(favicon\.ico|favicon-32\.png|apple-touch-icon\.png|icon-192\.png|icon-512\.png)$/;
```

옵션 `webDir?: string;`을 바꾼다:

```ts
  /** 화면 빌드 폴더(기본 ui/dist). 폰 화면은 그 안 phone/index.html. */
  uiDir?: string;
```

`createPhoneServer` 안 `const webDir = …` 줄을 `const uiDir = resolve(opts.uiDir ?? DEFAULT_UI_DIR);`로, 요청 처리의 `/phone/` 줄을 바꾼다:

```ts
    const head = req.method === "HEAD";
    // 폴더마다 그 폴더를 뿌리로 내준다(..%2F로 ui/dist의 대시보드·설정 화면에 닿지 않게)
    const file = PHONE_FILES.exec(path);
    if (path.startsWith("/phone/")) {
      if (serveFile(res, join(uiDir, "phone"), path.slice("/phone/".length), head)) return;
      if (!existsSync(join(uiDir, "phone", "index.html"))) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end(PHONE_NOT_BUILT);
        return;
      }
    } else if (file && serveFile(res, file[1] ? join(uiDir, file[1]) : uiDir, file[2] ?? file[3]!, head)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("없는 경로입니다");
```

`src/phone/links.ts` `servedPhoneUrls`: 위 주석에 「폰 화면 빌드 파일이 /assets/에 있어서 사이트 뿌리(/)로 이은 것만 쓴다」를 더하고, 거르는 줄과 주소 줄을 바꾼다:

```ts
      if (!LOCAL_HOSTS.has(target.hostname) || targetPort !== phonePort || target.pathname !== "/" || mount !== "/") continue;
      out.push(`https://${host}${port === "443" ? "" : `:${port}`}/phone/`);
```

`src/server/static.ts` 1번째 줄: `// 폴더 안의 파일만 내주는 정적 응답(본 서버 ui/dist·/twin/, 폰 서버 ui/dist 공용).`

`Dockerfile`에서 `COPY web web` 줄을 지운다.

- [ ] **Step 8: 통과 확인**

```
H npx vitest run tests/phone-server.test.ts tests/phone-links.test.ts tests/phone-design.test.ts tests/design-tokens.test.ts tests/deploy-files.test.ts tests/lint-ui-color.test.ts tests/phone-display.test.ts tests/phone-engine.test.ts tests/phone-pipeline.test.ts tests/phone-project.test.ts tests/phone-touch-sampler.test.ts tests/phone-link.test.ts tests/phone-ar.test.ts tests/phone-talk.test.ts tests/phone-voice.test.ts tests/phone-start.test.ts
H npm --prefix ui test
H npx tsc --noEmit
H npm --prefix ui run typecheck
H npm run lint
H npm --prefix ui run build
```

Expected: 모두 PASS, lint 0곳, 빌드 성공. 빌드 뒤 확인(Bash):

```
ls ui/dist/phone/index.html
grep -l "noto-sans-kr-0-wght-normal-" ui/dist/assets/encoder-worker-*.js
ls ui/dist/assets | grep -c "\.woff2$"
```

Expected: 파일이 있고, 워커 묶음 파일 이름이 찍히고(워커가 묶은 글꼴 주소를 가진다), woff2가 124개 이상.

- [ ] **Step 9: 커밋**

```
git add ui/src/phone/core ui/src/phone/controller.ts ui/src/phone/PhoneApp.tsx ui/src/phone/main.tsx ui/phone/index.html ui/vite.config.ts ui/tests/phone-controller.test.ts ui/tests/phone-app.test.tsx ui/tests/pages.test.ts scripts/design-tokens.ts src/phone/server.ts src/phone/links.ts src/server/static.ts Dockerfile tests/phone-server.test.ts tests/phone-links.test.ts tests/phone-design.test.ts tests/design-tokens.test.ts tests/deploy-files.test.ts tests/lint-ui-color.test.ts tests/phone-display.test.ts tests/phone-engine.test.ts tests/phone-pipeline.test.ts tests/phone-project.test.ts tests/phone-touch-sampler.test.ts tests/phone-link.test.ts tests/phone-ar.test.ts tests/phone-talk.test.ts
git status --short
```

`git status --short`에 `ui/src/tokens.css`·`ui/public/fonts/OFL-noto-sans-kr.txt`·`web/phone/tokens.*`·`web/phone/fonts/*`(줄끝만)와 `.gitignore`만 스테이지 밖에 남는지 본다.

```
git commit -m "feat(phone): serve the React phone screen from ui/dist" -m "The phone page is now the ui entry phone/index.html built with the dashboard. The camera, video, engine frame, pose, anchor, talk and focus modules moved unchanged to ui/src/phone/core; marks.js reads src/design/tokens.ts and the encoder worker loads the bundled Noto Sans KR files from font-faces.js. controller.ts and PhoneApp wire them to PhoneScreen. The phone server serves /phone/, /assets/, the brand images and the icons from ui/dist and answers 503 before a build; tailscale phone addresses need a root mount. The old web/phone page and the runtime copy of web/ are gone." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 7: 폰 전용 토큰·글꼴·아이콘 사본 지우기

**Files:**
- Modify: `scripts/design-tokens.ts`, `scripts/lint-ui-color.ts`, `THIRD_PARTY.md`, `ui/public/brand/README.md`
- Delete: `web/phone/tokens.css`, `web/phone/tokens.js`, `web/phone/fonts/`, `web/phone/favicon.ico`, `web/phone/favicon-32.png`, `web/phone/apple-touch-icon.png`, `web/phone/icon-192.png`, `web/phone/brand/`
- Test: `tests/design-tokens.test.ts`, `tests/lint-ui-color.test.ts`

- [ ] **Step 1: 실패하는 시험**

`tests/design-tokens.test.ts`: 「만든 파일 넷이…」 이름을 「만든 파일 둘이 원본과 같다(다르면 npm run tokens)」로 바꾸고 첫 줄에 `expect([...OUTPUTS]).toEqual(["ui/src/tokens.css", "src/design/tokens.ts"]);`를 더한다. 「폰에 옮긴 글꼴…」 시험을 바꾼다:

```ts
  it("글꼴 라이선스만 ui/public/fonts로 옮긴다. 폰 전용 사본(web/phone)은 없다", () => {
    expect(copies()).toEqual([{ from: "ui/node_modules/@fontsource-variable/noto-sans-kr/LICENSE", to: "ui/public/fonts/OFL-noto-sans-kr.txt" }]);
    const text = (p: string) => readFileSync(repoPath(p), "utf8").replace(/\r\n/g, "\n");
    expect(text("ui/public/fonts/OFL-noto-sans-kr.txt")).toBe(text("ui/node_modules/@fontsource-variable/noto-sans-kr/LICENSE"));
    expect(existsSync(repoPath("web/phone"))).toBe(false);
  });
```

`tests/lint-ui-color.test.ts`: `expect(TOKEN_OUTPUTS).toEqual(["ui/src/tokens.css", "web/phone/tokens.css", "web/phone/tokens.js"]);`를 `expect(TOKEN_OUTPUTS).toEqual(["ui/src/tokens.css"]);`로, `expect(COLOR_FIX).toContain("web/phone/tokens.css");`를 `expect(COLOR_FIX).not.toContain("web/phone");`로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `H npx vitest run tests/design-tokens.test.ts tests/lint-ui-color.test.ts`
Expected: FAIL(OUTPUTS 넷, copies에 web/phone 사본, web/phone 있음, TOKEN_OUTPUTS 셋).

- [ ] **Step 3: 생성기**

`scripts/design-tokens.ts` 1~9번째 줄 주석:

```ts
// 디자인 토큰 만들기: 원본 src/design/tokens.json 하나에서 화면마다 쓰는 파일을 만든다.
//   ui/src/tokens.css      대시보드·설정·폰(Tailwind @theme와 :root 변수, 화면 글 크기는 html[data-surface])
//   src/design/tokens.ts   트윈·SVG·캔버스(폰 조준점·초점 그림 포함)·3D 계획 색(TS 값)
//   ui/src/phone/core/font-faces.js  폰 인코딩 워커가 FontFace로 넣는 글꼴 조각 목록(꾸러미 CSS에서 만든다, 파일은 ui 빌드가 ?url로 묶는다)
// 같이 옮기는 것: 글꼴 라이선스를 ui/public/fonts/로.
// 원본의 {"ref": 이름}은 hex(또는 rgb(… / α))로, 값이 더 있는 {"ref": 이름, width, opacity}는 { color, width, opacity }로 푼다.
// 사용: npm run tokens (tests/design-tokens.test.ts가 만든 파일이 원본과 같은지 본다)
```

`OUTPUTS`를 `["ui/src/tokens.css", "src/design/tokens.ts"] as const`로, `renderTokens`의 「원본에서 만든 파일 넷」 주석을 「둘」로, 돌려주는 객체에서 `"web/phone/tokens.css"`·`"web/phone/tokens.js"` 두 줄을 지운다. `phoneCss`·`phoneJs`·`values` 함수를 지운다. `copies()`를 바꾼다:

```ts
/** 그대로 옮기는 파일: 글꼴 라이선스. */
export function copies(): { from: string; to: string }[] {
  return [{ from: `${FONT_PKG}/LICENSE`, to: "ui/public/fonts/OFL-noto-sans-kr.txt" }];
}
```

import에서 `readdirSync`를 지우고, 맨 아래 로그를 `console.log(\`옮김 ${list.length}개(글꼴 라이선스)\`);`로 바꾼다.

`scripts/lint-ui-color.ts`:

```ts
/** 토큰 원본(src/design/tokens.json)에서 npm run tokens가 만든 파일. 날 값은 여기에만 있다(src/design/tokens.ts는 검사 범위 밖). */
export const TOKEN_OUTPUTS = ["ui/src/tokens.css"];

export const COLOR_FIX =
  "날 색 대신 src/design/tokens.json의 토큰을 쓰세요. 대시보드·설정·폰 화면은 ui/src/tokens.css의 토큰 class(bg-surface·text-ink…), 트윈·SVG·캔버스 색은 src/design/tokens.ts예요.";
```

- [ ] **Step 4: 사본 지우기**

```
git diff --ignore-cr-at-eol --stat -- web/phone
```

Expected: 빈 줄(줄끝만 다르다). 그다음:

```
git rm -r -f -- web/phone/tokens.css web/phone/tokens.js web/phone/fonts web/phone/favicon.ico web/phone/favicon-32.png web/phone/apple-touch-icon.png web/phone/icon-192.png web/phone/brand
ls web
```

Expected: `web/`에 `eye-video.d.ts`·`eye-video.js`·`eye-video-worker.js`만 남는다.

`THIRD_PARTY.md` 글꼴 두 줄을 바꾼다:

```
  - 대시보드·설정·폰 화면은 `ui`가 꾸러미를 묶어 내준다. 폰 인코딩 워커는 `ui/src/phone/core/font-faces.js` 목록으로 같은 파일을 넣는다. 외부 CDN을 쓰지 않는다.
  - 라이선스 글: `ui/public/fonts/OFL-noto-sans-kr.txt`.
```

`ui/public/brand/README.md` 10번째 줄을 `- 폰 화면도 이 폴더의 파비콘·마스코트를 쓴다(폰 서버가 ui/dist에서 내준다).`로 바꾼다.

- [ ] **Step 5: 통과 확인**

```
H npm run tokens
H npx vitest run tests/design-tokens.test.ts tests/design-contrast.test.ts tests/lint-ui-color.test.ts tests/phone-design.test.ts tests/self-contained.test.ts
H npm run lint
```

Expected: PASS. `npm run tokens` 뒤 `git diff --ignore-cr-at-eol --stat -- ui/src/tokens.css src/design/tokens.ts ui/src/phone/core/font-faces.js ui/public/fonts`가 빈 줄.

- [ ] **Step 6: 커밋**

```
git add scripts/design-tokens.ts scripts/lint-ui-color.ts tests/design-tokens.test.ts tests/lint-ui-color.test.ts THIRD_PARTY.md ui/public/brand/README.md
git commit -m "refactor(design): drop the phone-only token, font and icon copies" -m "npm run tokens now writes ui/src/tokens.css, src/design/tokens.ts and the worker font list, and copies only the font license. web/phone/tokens.css, tokens.js, fonts, icons and the mascot copy are deleted because the phone screen uses the ui bundle." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 8: 글·색·부품 검사를 폰 화면까지, 규칙 표·문서

**Files:**
- Modify: `scripts/lint-ui-copy.ts`, `scripts/lint-ui-color.ts`, `scripts/lint-ui-parts.ts`, `CLAUDE.md`, `docs/reference.md`, `README.md`
- Test: `tests/lint-ui-copy.test.ts`, `tests/lint-ui-color.test.ts`, `tests/lint-ui-parts.test.ts`

- [ ] **Step 1: 실패하는 시험**

`tests/lint-ui-copy.test.ts`: `uiDir` 아래에 `const uiPhoneDir = fileURLToPath(new URL("../ui/phone/", import.meta.url));`를 두고, `expect(COPY_TARGETS).toEqual([webDir, uiDir, labels, …])`를 `expect(COPY_TARGETS).toEqual([webDir, uiDir, uiPhoneDir, labels, worldLabels, historyLabels, prompts]);`로 바꾼다. 「web/(폰)과 ui/src 전체」 묶음 이름을 「web/·ui/src·폰 입구 전체」로 바꾸고 다음을 더한다:

```ts
  it("폰 입구 HTML(ui/phone/index.html)과 폰 화면 코드(ui/src/phone)를 본다", () => {
    const files = copyFiles(COPY_TARGETS).map((f) => f.replace(/\\/g, "/"));
    for (const p of ["ui/phone/index.html", "ui/src/phone/PhoneScreen.tsx", "ui/src/phone/core/ar.js"]) expect(files.some((f) => f.endsWith(p)), p).toBe(true);
  });
```

`tests/lint-ui-color.test.ts` 「대시보드·설정·폰 화면 파일을 본다」 목록에 `"ui/phone/index.html"`을 더한다.

`tests/lint-ui-parts.test.ts`: import에 `RAW_FIX`를 더하고, 「화면 코드는 배치만」 묶음 끝에 더한다:

```ts
  it("폰 화면(ui/src/phone)에는 날 button·input·select·textarea가 없다. core 모듈과 다른 화면은 이 규칙 밖", () => {
    expect(found("ui/src/phone/PhoneScreen.tsx", 'const A = () => <button type="button">말하기</button>;')).toEqual(["1 날 요소 <button"]);
    expect(found("ui/src/phone/X.tsx", 'const A = () => <form><input aria-label="할 말" /><textarea /></form>;')).toEqual(["1 날 요소 <input", "1 날 요소 <textarea"]);
    expect(found("ui/src/phone/X.tsx", "const A = () => <Button>말하기</Button>;")).toEqual([]);
    expect(found("ui/src/setup/X.tsx", 'const A = () => <button type="button">다음</button>;')).toEqual([]);
  });

  it("날 요소 오류 글은 Button·Input 부품을 쓰라고 말한다", () => {
    expect(RAW_FIX).toContain("Button");
    expect(RAW_FIX).toContain("Input");
  });
```

「ui/src 전체」의 첫 시험 이름을 「화면 코드는 components/ui 밖 .ts·.tsx·.js다」로 바꾸고 다음을 더한다:

```ts
    expect(files.some((f) => f.endsWith("ui/src/phone/PhoneScreen.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("ui/src/phone/core/marks.js"))).toBe(true);
    expect(files.some((f) => f.endsWith(".d.ts"))).toBe(false);
```

- [ ] **Step 2: 실패 확인**

Run: `H npx vitest run tests/lint-ui-copy.test.ts tests/lint-ui-color.test.ts tests/lint-ui-parts.test.ts`
Expected: FAIL(COPY_TARGETS·COLOR_TARGETS에 ui/phone 없음, 날 요소 규칙 없음, `RAW_FIX` 없음, `.js` 안 봄).

- [ ] **Step 3: 검사 넓히기**

`scripts/lint-ui-copy.ts`: 1번째 줄 주석의 `web/(폰)과 ui/src`를 `web/·ui/src·폰 입구(ui/phone)`로, `COPY_TARGETS`의 `ui/src/` 다음에 `fileURLToPath(new URL("../ui/phone/", import.meta.url)),`를 더하고, `shown` 주석의 `web/phone/phone.js`를 `ui/src/phone/PhoneScreen.tsx`로 바꾼다.

`scripts/lint-ui-color.ts`: 1번째 줄 주석의 `폰·서버 화면(web/)`을 `폰 입구(ui/phone)·web/`로, `COLOR_TARGETS`의 `ui/setup/index.html` 다음에 `fileURLToPath(new URL("../ui/phone/", import.meta.url)),`를 더한다(입구 HTML 셋의 주석도 「입구 HTML(대시보드·설정·폰)」로).

`scripts/lint-ui-parts.ts`:
- 머리 주석 (2) 다음에 `// (3) 폰 화면(ui/src/phone, core 밖)에는 날 button·input·select·textarea를 두지 않는다. Button·Input 부품을 쓴다.`를 더한다.
- `PARTS_FIX` 아래에:

```ts
export const RAW_FIX = "폰 화면의 단추·입력칸은 ui/src/components/ui의 21st.dev 부품(Button·Input)으로 놓아요.";
/** 날 요소 규칙을 받는 화면: 폰 화면 코드(core 모듈 밖). */
const PHONE_SCREEN = /(^|\/)ui\/src\/phone\/(?!core\/)/;
const RAW_TAG = /<(button|input|select|textarea)\b/g;
```

- `screenProblems`의 「SVG·아이콘 색 속성」 블록 앞에:

```ts
  // 폰 화면의 날 단추·입력칸
  if (jsx && PHONE_SCREEN.test(file)) for (const m of code.matchAll(RAW_TAG)) hits.push({ at: m.index!, text: `<${m[1]}`, rule: "날 요소" });
```

- `walk`의 거르는 줄을 `.js`·`.jsx`까지 본다:

```ts
    return /\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.d\.ts$|\.test\.[jt]sx?$/.test(e.name) ? [p] : [];
```

- `screenFiles` 주석을 「ui/src 아래 .ts·.tsx·.js 중 ui/src/components/ui 밖」으로, 맨 아래 출력에 `if (problems.some((p) => p.rule === "날 요소")) console.log(\`  → ${RAW_FIX}\`);`를 더한다.

- [ ] **Step 4: 규칙 표·문서**

`CLAUDE.md` 표:
- 1번째 줄(화면 기술)을 바꾼다:

```
| 대시보드·설정·폰 화면은 React+TypeScript(`ui/`)로 만든다. 빌드 없는 HTML·JS 화면을 새로 만들지 않는다. | 구조: 본 서버와 폰 서버는 React 빌드 `ui/dist/`만 내준다(`src/server/app.ts` `DEFAULT_WEB_DIR`·`tests/server.test.ts` 「기본 화면 폴더는 ui/dist」, `src/phone/server.ts` `DEFAULT_UI_DIR`·`tests/phone-server.test.ts` 「기본 화면 폴더는 ui/dist」). `web/`에 화면을 만들어도 나오지 않는다. |
```

- 부품 줄의 막는 장치에서 `그 밖의 \`ui/src\` 화면 코드에 꾸밈 class·꾸밈 style(…)이 없는지 본다`를 `그 밖의 \`ui/src\` 화면 코드(.ts·.tsx·.js)에 꾸밈 class·꾸밈 style(배경·글자색·테두리·모서리·그림자·링·흐림·글꼴)이 없는지, 폰 화면(\`ui/src/phone\`)에 날 button·input·select·textarea가 없는지 본다`로 바꾼다.
- 색 줄의 막는 장치에서 `` `ui/src`·입구 HTML·`web/` ``을 `` `ui/src`·입구 HTML(`ui/index.html`·`ui/setup/`·`ui/phone/`)·`web/` ``으로, `npm run tokens`가 만든 파일 목록을 `` (`ui/src/tokens.css`, `src/design/tokens.ts`, 폰 인코딩 워커 글꼴 목록 `ui/src/phone/core/font-faces.js`)과 옮긴 글꼴 라이선스 ``로 바꾼다.
- 글 줄의 막는 장치에서 `web/(폰)과 ui/src의`를 `web/·ui/src·폰 입구(ui/phone)의`로 바꾼다.

`docs/reference.md`:
- 48번째 줄 `web/phone/              폰 화면(빌드 없는 ES 모듈)`을 지우고, 47번째 줄을 `ui/                     대시보드·설정·폰 화면(React+TypeScript, 빌드 결과 ui/dist/)`로 바꾼다.
- 214번째 줄을 `- **폰 화면** (\`/phone/\`, \`ui/phone/index.html\`·\`ui/src/phone/\`): 폰 서버가 \`ui/dist\`에서 폰 화면과 그 빌드 파일(\`/assets/\`)·브랜드 그림·파비콘만 내준다. tailscale serve는 폰 포트를 사이트 뿌리(\`/\`)로 잇는다.`로 바꾼다.
- 278번째 줄의 `` `src/phone/`·`web/phone/` ``을 `` `src/phone/`·`ui/src/phone/` ``으로 바꾼다.

`README.md` 96번째 줄의 `Phone (web/phone/)       ` 앞부분을 `Phone (ui/src/phone/)    `로 바꾼다(줄 맞춤 유지).

- [ ] **Step 5: 통과 확인**

```
H npx vitest run tests/lint-ui-copy.test.ts tests/lint-ui-color.test.ts tests/lint-ui-parts.test.ts
H npm run lint
```

Expected: PASS, lint 0곳. 걸리면 그 화면 코드를 고친다(검사를 끄지 않는다).

- [ ] **Step 6: 커밋**

```
git add scripts/lint-ui-copy.ts scripts/lint-ui-color.ts scripts/lint-ui-parts.ts tests/lint-ui-copy.test.ts tests/lint-ui-color.test.ts tests/lint-ui-parts.test.ts CLAUDE.md docs/reference.md README.md
git commit -m "test(lint): check the React phone screen with the copy, color and parts lints" -m "The copy and color lints read the phone entry ui/phone, the parts lint reads .js files under ui/src and rejects raw button, input, select and textarea in the phone screen. CLAUDE.md drops the web/phone exception and the docs point at ui/src/phone." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 작업 9: 화면 사진 페이지, 상태마다 390×844 사진, 전체 확인

**Files:**
- Create: `ui/phone/shots/index.html`, `ui/src/phone/shots.tsx`
- Modify: `ui/vite.config.ts`
- Test: `ui/tests/pages.test.ts`

- [ ] **Step 1: 실패하는 시험**

`ui/tests/pages.test.ts`에 더한다:

```ts
  it("화면 사진 페이지(ui/phone/shots/)는 폰 글자 크기로 상태 예시를 그린다", () => {
    const html = page("phone/shots/index.html");
    expect(html).toContain('<html lang="ko" data-surface="phone">');
    expect(html).toContain('src="/src/phone/shots.tsx"');
    expect(page("src/phone/shots.tsx")).toContain('import "@fontsource-variable/noto-sans-kr";');
  });
```

Run: `H npm --prefix ui test -- tests/pages.test.ts`
Expected: FAIL(`ENOENT … phone/shots/index.html`).

- [ ] **Step 2: 페이지**

`ui/phone/shots/index.html`:

```html
<!doctype html>
<html lang="ko" data-surface="phone">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>클로이드의 눈 화면 사진 · NOONCHI</title>
<link rel="icon" href="/favicon.ico" sizes="any"></head>
<body><div id="root"></div><script type="module" src="/src/phone/shots.tsx"></script></body>
</html>
```

`ui/src/phone/shots.tsx`:

```tsx
// 화면 사진 페이지(PHONE_SHOTS=1 빌드에만 들어간다): 주소 #이름의 상태 예시(fixtures.ts)를 폰 화면 그대로 그린다.
// AR 상태는 카메라 자리에 ink-4 바탕을 깔고 조준점·초점 그림을 그 위에 그린다. 다 그리면 html에 data-shot을 단다(npm run capture --ready).
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-kr";
import "../styles.css";
import { color } from "../../../src/design/tokens.ts";
import { drawOverlay, fitCanvas, labelFont, markLabel } from "./draw";
import { SHOTS, SHOT_NAMES, type ShotName } from "./fixtures";
import { PhoneScreen } from "./PhoneScreen";
import type { PhoneActions } from "./state";

const noop = () => {};
const act: PhoneActions = {
  startAr: noop, stopAr: noop, takePhoto: noop, recordAnchor: noop, resetAnchors: noop, setMenu: noop,
  say: noop, confirm: noop, cancel: noop, brainReply: noop, talkDown: noop, talkUp: noop,
};

function Shot({ name }: { name: ShotName }) {
  const shot = SHOTS[name];
  const backdrop = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const text = shot.draw.marks.map((m) => markLabel(m.label)).join("");
      await document.fonts.ready;
      if (text) await document.fonts.load(labelFont, text);
      if (!live) return;
      const w = innerWidth;
      const h = innerHeight;
      const dpr = devicePixelRatio || 1;
      if (shot.view.ar && backdrop.current) {
        const b = fitCanvas(backdrop.current, w, h, dpr);
        if (b) {
          b.fillStyle = color["ink-4"];
          b.fillRect(0, 0, w, h);
        }
      }
      if (shot.view.ar && overlay.current) {
        const c = fitCanvas(overlay.current, w, h, dpr);
        if (c) drawOverlay(c, { width: w, height: h }, shot.draw, 0, true);
      }
      document.documentElement.dataset.shot = name;
    })();
    return () => { live = false; };
  }, [name, shot]);
  return (
    <>
      <canvas ref={backdrop} aria-hidden="true" className="pointer-events-none fixed inset-0 size-full" />
      <PhoneScreen view={shot.view} act={act} canvasRef={overlay} />
    </>
  );
}

const name = location.hash.slice(1) as ShotName;
createRoot(document.getElementById("root")!).render(<Shot name={SHOT_NAMES.includes(name) ? name : "intro"} />);
```

`ui/vite.config.ts`: `const page = …` 아래에 두고 input에 펼친다:

```ts
// 화면 사진 페이지(ui/phone/shots/)는 PHONE_SHOTS=1 빌드에만 넣는다(상태마다 npm run capture로 찍을 때).
const shots: Record<string, string> = process.env.PHONE_SHOTS === "1" ? { phoneShots: page("phone/shots/index.html") } : {};
```

```ts
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: { main: page("index.html"), setup: page("setup/index.html"), phone: page("phone/index.html"), ...shots } } },
```

- [ ] **Step 3: 통과 확인·커밋**

```
H npm --prefix ui test -- tests/pages.test.ts
H npm --prefix ui run typecheck
H npm run lint
```

Expected: PASS, lint 0곳.

```
git add ui/phone/shots/index.html ui/src/phone/shots.tsx ui/vite.config.ts ui/tests/pages.test.ts
git commit -m "test(phone): add a capture page that draws each phone screen state" -m "ui/phone/shots/ renders the fixture view named in the URL hash with a stand-in camera background and the aim point and focus drawing, and is built only with PHONE_SHOTS=1." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 사진 찍기(390×844)**

PowerShell, 저장소 뿌리:

```
$R = "C:/Users/ABC/Desktop/소웨공/twin-home-noonchi"
$S = "C:/Users/ABC/AppData/Local/Temp/claude/eead35b1142cee90/61d6f935-50a4-41c8-9622-f578cdb45009/scratchpad/design-system"
$env:PHONE_SHOTS = "1"; npm --prefix $R run heavy -- npm --prefix ui run build; Remove-Item Env:PHONE_SHOTS
Test-Path "$R/.env"
$env:HUB = "memory"; $env:HOST = "127.0.0.1"; $env:PORT = "8520"; $env:PHONE_PORT = "8521"; $env:PHONE_HOST = "127.0.0.1"; $env:RUNTIME_DIR = "$S/runtime-phone-react"
$srv = Start-Process -PassThru -NoNewWindow -FilePath node -ArgumentList "--import","tsx","src/server/main.ts" -RedirectStandardOutput "$S/phone-react-server.log" -RedirectStandardError "$S/phone-react-server.err"
```

`Test-Path .env`가 False인지 본다(True면 서버를 띄우지 않고 멈춘다. 키를 읽게 된다). 서버 로그에 `폰 AR http://127.0.0.1:8521/phone/`가 찍힐 때까지 기다린다(Monitor로 로그를 본다). 그다음 하나씩:

```
npm --prefix $R run capture -- --url http://127.0.0.1:8521/phone/ --ready "[data-support]:not([data-support=checking])" --size 390x844 --views phone-390-intro-live --out "$S/after/phone-react/intro-live"
foreach ($n in "intro","camera","overlay","menu","request","talk","listening","error") {
  npm --prefix $R run capture -- --url "http://127.0.0.1:8521/phone/shots/#$n" --ready "html[data-shot=$n]" --size 390x844 --views "phone-390-$n" --out "$S/after/phone-react/$n"
}
if ($srv.Id -gt 4) { taskkill /T /F /PID $srv.Id }
```

Expected: 아홉 번 모두 `errors: []`(콘솔 오류·HTTP 400 이상 없음), PNG 아홉 장. 사진을 하나씩 열어 본다: 처음 화면은 옮기기 전(`before/phone-390-intro.png`)과 같은 내용(마스코트·제목·지원 줄·안내 둘·AR 시작·말하기·글 입력), 덮개는 위 상태 줄·판단 줄·알림·초점 고리·화살표·기준점·큰 단추 셋이 겹치지 않음, 요청 사진은 큰 brand 알림과 행동 부탁 카드, 영상 위 글이 모두 읽힘. 겹치거나 잘리면 배치 class를 고치고 화면 시험을 다시 돌린 뒤 다시 찍는다. 끝나면 `npm --prefix ui run build`를 `PHONE_SHOTS` 없이 다시 돌려 `dist`에서 사진 페이지를 뺀다.

- [ ] **Step 5: 전체 확인**

Global Constraints의 그룹 끝 검사 여덟 줄을 차례로 돌린다. Expected: 모두 통과. `container-smoke`는 `/phone/` 200을 본다(이미지 안 폰 서버가 `ui/dist/phone/index.html`을 준다). 실패하면 systematic-debugging으로 원인을 고친 뒤 처음부터 다시 돌린다. 고친 것이 있으면 그 파일만 `git add`하고 커밋한다(`fix(phone): …`).

- [ ] **Step 6: 보고**

보고에 넣는다: 커밋 목록, 사진 폴더 `C:/Users/ABC/AppData/Local/Temp/claude/eead35b1142cee90/61d6f935-50a4-41c8-9622-f578cdb45009/scratchpad/design-system/after/phone-react/`, 21st.dev 받은 코드 견주기 결과(작업 1), EFAULT 다시 돌림이 있었으면 그 시험, 아래 「실제 폰에서만 확인할 것」 목록.

---

## 실제 폰에서만 확인할 것(사용자 확인 목록)

안드로이드 크롬, `PHONE_PORT=8210 npm start` 또는 배포 서버.

- [ ] **HTTPS(tailscale serve):** `tailscale serve`가 폰 포트를 사이트 뿌리(`/`)로 잇는다. 폰에서 `https://<PC>.<tailnet>.ts.net/phone/`(배포 서버는 `:8443/phone/`)을 열면 화면·한글 글꼴이 뜨고 「준비됐어요. 폰을 세로로 들고 첫 기준점 근처에서 AR을 시작하세요.」가 보인다. 세로로 들면 마스코트 그림부터 AR 시작 단추까지 스크롤 없이 보이고, 가로로 들면 마스코트 그림 없이 AR 시작 단추가 첫 화면에 보인다. http 와이파이 주소 + chrome://flags 「Insecure origins treated as secure」 경로도 같다.
- [ ] **카메라 권한:** AR 시작 → 카메라 권한(camera-access) 허용 → 대시보드 「클로이드의 눈」에 영상이 나오고 ⋯ 측정 글의 보낸 화면이 목표 12fps 가까이(옮기기 전과 같은 수준). 권한을 안 주면 「카메라 화면을 보낼 수 없어요. 위치만 보내요」. 영상이 위아래 뒤집히면 `?flip=0`.
- [ ] **세로로 들기:** 세로로 든 채 AR 시작. AR 화면에 React 덮개(위 상태 줄·⋯, 맨 아래 가로 줄 말하기·사진·끝내기)가 보이고 한 손 엄지로 눌린다. 상태 줄 글은 잘리지 않는다: 추적이 약하면 끝의 「추적 약함」까지, 바닥 기준점이면 「기준점 1/2 기록」까지 보인다(길면 두 줄). 조준점은 화면 가운데이고 위 줄(조준점 위)·엄지 자리(조준점 아래)가 조준점을 가리지 않는다. ⋯ 메뉴에서 글 입력 시 키보드가 뜨고 보내진다(키보드가 메뉴를 가리면 적어 둔다).
- [ ] **가로로 들기:** AR 중 폰을 가로로 돌리면 큰 단추가 오른쪽 세로 줄로 가고, 상태 줄 옆에 보낸 장 수(fps)가 보이며, 알림은 뜨지 않는다. 그동안 대시보드 영상·눈 마커가 멈추지 않는다. 다시 세로로 돌리면 아래 가로 줄로 돌아온다. 돌릴 때 AR이 끝나거나 맞춤이 지워지지 않는다(폰 자동 회전이 꺼져 있으면 세로 그대로다).
- [ ] **마스코트 말풍선(`BRAIN=1`):** 판단이 오면 위 줄 맨 위에 마스코트 얼굴과 말풍선이 뜬다. 계획이 열린 동안은 그 판단 글, 끝나면 마지막 판단의 관찰. 말풍선이 큰 단추·조준점·초점 고리를 가리지 않고, 같은 말이 화면에 두 번 보이지 않는다. AR을 다시 시작하거나 폰이 다시 붙어도 지금 글이 바로 보인다. 서버를 다시 켜면(`BRAIN=1` 없이) 폰이 다시 붙은 뒤 말풍선이 사라진다.
- [ ] **AR 맞춤:** 조준점이 화면 가운데, 바닥에 닿으면 초록 점. 기준점 두 곳 기록 → 「맞춤 ✓ · 거리 차이 …cm」(벽 기준점은 「근사 맞춤」). 기준점 다시 찍기가 된다.
- [ ] **초점 겹침(`FOCUS=1`):** 폰 화면의 고리가 실제 물건 위에 있고, 대시보드 눈 영상에 그려진 고리와 같은 자리다(가로·세로 모두). 이름표가 한글 글꼴(인코딩 워커가 묶은 글꼴을 받는다). 화면 밖이면 가장자리 화살표가 그쪽을 가리키고, 위·아래 화살표가 상태 줄·큰 단추 줄에 가리지 않는다(가로면 오른쪽 화살표가 오른쪽 큰 단추 줄에 가리지 않는다).
- [ ] **마이크:** 말하기를 누르고 있으면 마이크 권한 창 → 「🎙 …」 줄 → 손을 떼면 「… 생각 중」 → 답이 줄과 소리로. 권한을 거부하면 「마이크 권한이 없어요. 크롬 사이트 설정에서 마이크를 허용해 주세요.」
- [ ] **사진:** 사진 → 「사진을 위치와 함께 보냈어요」, 대시보드 기록에 사진.
- [ ] **부탁·질문(`BRAIN=1`):** 사진 요청 큰 글과 「컵 안」 단추, 행동 부탁 카드(모의·클로이드라면 줄)와 소리. 단추나 말로 답하면 서버가 받는다.
- [ ] **한 손 세로·밝은 곳:** 세로로 든 채 아래 큰 단추를 엄지로 누르기 쉽고(48px 이상), 그 위 엄지 자리 승인·부탁 단추도 닿는다. 햇빛 아래에서도 영상 위 글과 말풍선이 읽힌다.

---

## Self-Review

- 요구 대응: 모듈 그대로 옮김(작업 2·6), React 입구·라우트·`ui/dist` 서빙(작업 6), 390×844 모바일 우선·부품만·토큰(작업 1·4·5), 부품 id·slug 표(위 표), 글꼴은 ui 꾸러미·`web/phone/fonts`와 폰 전용 토큰 출력 삭제(작업 6·7), lint 넓힘과 CLAUDE.md 폰 예외 줄 삭제(작업 8), 폰 시험 묶음·컨테이너 `/phone/` 200 유지(작업 6·9), 상태마다 React 화면 시험(작업 5: 처음·카메라 중·덮개·메뉴·요청 카드·묻고 답하기·오류), 상태마다 390×844 사진(작업 9), 실제 폰 확인 목록(위).
- 이름 맞춤: `createLink`·`createAr`·`createPressToTalk`·`speak`·`recognition`(작업 2) = controller import(작업 6). `PhoneView`·`PhoneActions`·`TalkSpot`·`FocusMark`(작업 3) = PhoneScreen·fixtures·draw·controller. `drawOverlay`·`fitCanvas`·`labelFont`·`markLabel`·`OverlayScene`(작업 4) = PhoneApp·shots. `SHOTS`·`SHOT_NAMES`(작업 5) = 시험·shots. `uiDir`·`DEFAULT_UI_DIR`·`PHONE_NOT_BUILT`(작업 6) = 서버 시험. `RAW_FIX`(작업 8) = 부품 시험.
- 바뀌는 것(사용자 판단이 필요할 수 있음): AR 위 판(⋯ 단추·메뉴·알림)은 LiquidGlass 불투명 모드(surface 100%)로 둔다. spec의 glass-phone 94%보다 불투명하다(대비는 같거나 높고, AR 중 backdrop-filter를 쓰지 않는다). tailscale serve를 뿌리가 아닌 경로로 이은 폰 주소는 이제 쓰지 않는다(빌드 파일이 `/assets/`에 있다). 본 서버(8200)도 `ui/dist`를 내주므로 `/phone/` 화면 파일이 열리지만 WebSocket은 폰 서버에만 있다.
