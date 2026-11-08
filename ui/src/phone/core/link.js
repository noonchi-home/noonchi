// 폰 ↔ 폰 서버 연결(phone.js에서 옮겼다): /phone/events WebSocket. 끊기면 1초 뒤 다시 붙는다(close() 뒤에는 기다리던 것도 멈춘다).
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

  function connect() {
    if (closed) return;
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
      if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_MS);
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
      clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
