// 폰 ↔ 폰 서버 연결(phone.js에서 옮겼다): /phone/events WebSocket. 끊기면 1초 뒤 다시 붙는다(close() 뒤에는 기다리던 것도 멈춘다).
// 붙으면 onOpen, 끊기면 onClose(close() 뒤에는 부르지 않는다): 화면의 「다시 연결하는 중」이 쓴다.
// 시계 맞춤: 붙으면 바로, 그 뒤 2초마다 clock 핑(NTP식)을 보내고, 최근 10개 표본 중 왕복이 가장 짧은 것으로 서버 시계와의 차(offset)를 정한다. 오차는 왕복의 절반.
// 폰 판본: 붙으면 맨 먼저 hello(이 빌드의 PHONE_PROTOCOL)를 보낸다. 서버 상태(status)의 protocol이 이 빌드와 다르면 페이지를 다시 읽는다(붙을 때·다시 붙을 때마다 본다).
// 같은 탭에서 60초 안에 두 번 다시 읽지 않는다(sessionStorage). 그때나 저장소가 막혔으면 다시 읽지 않고 onStale을 부른다(화면에 새로 고침이 필요하다고 알린다).
import { PHONE_PROTOCOL } from "../protocol.ts";

const CLOCK_MS = 2000;
const RELOAD_KEY = "noonchi.phone.reloadAt";
const RELOAD_GAP_MS = 60_000;
const RECONNECT_MS = 1000;
const phoneNow = () => performance.timeOrigin + performance.now();

/** 페이지 주소 → 폰 서버 WebSocket 주소(https면 wss). 영상 모드면 트는 영상 이름(video=)을 붙인다: 서버가 그 영상이 있을 때만 영상 모드 연결로 본다. */
export function phoneSocketUrl(loc, video = null, path = "/phone/events") { // 영상 모드: 카메라 입력
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${path}${video ? `?video=${encodeURIComponent(video)}` : ""}`;
}

/** onMessage: 서버 JSON 메시지(clock 답은 여기서 쓰고 넘기지 않는다). onOpen·onClose: 붙음·끊김. onStale: 판본이 달라도 다시 읽지 못함.
 *  Socket·now·protocol·reload·storage는 시험이 바꾼다. */
export function createLink({
  url, onMessage, onOpen = () => {}, onClose = () => {}, onStale = () => {}, Socket = WebSocket, now = phoneNow,
  autoConnect = true,
  protocol = PHONE_PROTOCOL, reload = () => globalThis.location?.reload(), storage = globalThis.sessionStorage,
}) {
  let ws = null;
  let active = false;
  let closed = false;
  let clockSamples = [];
  let clockTimer = null;
  let reconnectTimer = null;

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

  /** 서버 판본이 이 빌드와 다르면 다시 읽는다(같은 탭에서 60초에 한 번). 못 읽으면 onStale. */
  function checkProtocol(msg) {
    if (msg.type !== "status" || typeof msg.protocol !== "number" || msg.protocol === protocol) return;
    try {
      const last = storage.getItem(RELOAD_KEY);
      if (last !== null && now() - Number(last) < RELOAD_GAP_MS) return onStale();
      storage.setItem(RELOAD_KEY, String(now()));
    } catch {
      return onStale();
    }
    reload();
  }

  function connect() {
    if (!active || closed) return;
    const socket = new Socket(url);
    ws = socket;
    socket.addEventListener("open", () => {
      if (ws !== socket) return;
      clockSamples = [];
      send({ type: "hello", protocol });
      const ping = () => send({ type: "clock", t0: now() });
      ping();
      clearInterval(clockTimer);
      clockTimer = setInterval(ping, CLOCK_MS);
      onOpen();
    });
    socket.addEventListener("message", (event) => {
      if (ws !== socket) return;
      const msg = JSON.parse(event.data);
      if (msg.type === "clock") return onClock(msg);
      checkProtocol(msg);
      onMessage(msg);
    });
    socket.addEventListener("close", () => {
      if (ws !== socket) return;
      ws = null;
      clearInterval(clockTimer);
      onClose();
      if (active && !closed) reconnectTimer = setTimeout(connect, RECONNECT_MS);
    });
  }
  function start() {
    if (closed || active) return;
    active = true;
    connect();
  }
  function suspend() {
    active = false;
    clearInterval(clockTimer);
    clearTimeout(reconnectTimer);
    const socket = ws;
    ws = null;
    clockSamples = [];
    socket?.close();
  }
  if (autoConnect) start();

  return {
    start,
    suspend,
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
      suspend();
    },
  };
}
