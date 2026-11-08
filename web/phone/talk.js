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
