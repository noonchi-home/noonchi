// 늘 듣기(createListener): 크롬 내장 음성 인식(ko-KR)을 이어서(continuous) 켜 두고, 끝나면 restartMs 뒤 다시 켠다. 끝난 말(isFinal)만 onHeard로 보낸다.
// 말이 시작되면(인식 speechstart) onSpeechStart를 부른다: 그때 떠 있던 명령을 그 말의 답 자리로 잡는다(controller.ts).
// pause()는 듣기를 끊고(폰이 명령을 소리로 읽는 동안 그 소리를 듣지 않게) resume()까지 다시 켜지 않는다.
// 마이크 권한이 없거나(not-allowed·service-not-allowed) 마이크가 없으면(audio-capture) denied로 멈춘다. start()를 다시 부르면 새로 켠다(브라우저가 되면 권한을 다시 묻는다).
// 상태(onState, 바뀔 때만): on 듣는 중, paused 읽는 동안 멈춤, denied 마이크 꺼짐, off 꺼짐(start 전·stop 뒤).
// speak는 앞 소리를 끊고 읽은 뒤(끝·오류) done을 부른다.

/** 이 브라우저의 음성 인식(없으면 null). */
export const recognition = (w = globalThis) => w.SpeechRecognition || w.webkitSpeechRecognition || null;

const DENIED = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

/** hooks: onState(state), onHeard(text) 끝난 말 하나, onSpeechStart() 말이 시작됨(없어도 된다). */
export function createListener(Recognition, hooks, { restartMs = 300 } = {}) {
  let rec = null;
  let want = false;
  let paused = false;
  let denied = false;
  let timer = null;
  let last = "off";
  const report = () => {
    const now = denied ? "denied" : !want ? "off" : paused ? "paused" : "on";
    if (now === last) return;
    last = now;
    hooks.onState(now);
  };
  /** 지금 인식을 끊는다(끊긴 인식의 onend는 다시 켜지 않는다). */
  const drop = () => {
    clearTimeout(timer);
    timer = null;
    const r = rec;
    rec = null;
    r?.abort();
  };
  const later = () => {
    clearTimeout(timer);
    timer = want && !paused && !denied ? setTimeout(begin, restartMs) : null;
  };

  function begin() {
    timer = null;
    if (rec || !want || paused || denied) return;
    const r = new Recognition();
    r.lang = "ko-KR";
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res.isFinal === false ? "" : (res[0]?.transcript ?? "").trim();
        if (text) hooks.onHeard(text);
      }
    };
    r.onspeechstart = () => hooks.onSpeechStart?.();
    r.onerror = (e) => {
      if (!DENIED.has(e.error)) return;
      denied = true;
      report();
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      later();
    };
    rec = r;
    try {
      r.start();
    } catch {
      rec = null;
      later();
    }
  }

  return {
    start() {
      want = true;
      denied = false;
      report();
      begin();
    },
    stop() {
      want = false;
      drop();
      report();
    },
    pause() {
      paused = true;
      drop();
      report();
    },
    resume() {
      paused = false;
      report();
      begin();
    },
  };
}

/** 소리로 읽기(ko-KR, 1.05배). 다 읽거나 오류가 나면 done. 음성 합성이 없거나 글이 비면 바로 done. */
export function speak(text, done = () => {}) {
  if (!("speechSynthesis" in globalThis) || !text) return done();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.05;
  u.onend = () => done();
  u.onerror = () => done();
  speechSynthesis.speak(u);
}
