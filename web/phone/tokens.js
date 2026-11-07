// 만든 파일: src/design/tokens.json(NOONCHI 1.1.0)에서 npm run tokens가 만든다. 고칠 때는 원본을 고치고 npm run tokens를 돌린다.
// 폰 화면 캔버스(marks.js)와 인코딩 워커가 import한다.

export const color = {
  "brand": "#a1143e",
  "brand-strong": "#971238",
  "brand-bright": "#b92a51",
  "on-brand": "#ffffff",
  "cream": "#f2e4d3",
  "charcoal": "#42403f",
  "ink": "#2a2627",
  "ink-2": "#574f50",
  "ink-3": "#645b5b",
  "ink-4": "#9b918e",
  "page": "#fffcf8",
  "canvas": "#f8f2ea",
  "surface": "#fffcf8",
  "inset": "#f6efe6",
  "hover": "#f6efe6",
  "field": "#f6efe6",
  "line": "#e7dbce",
  "line-strong": "#dccdbd",
  "line-soft": "#efe6db",
  "input-line": "#8f847f",
  "ok": "#1b7041",
  "warn": "#835700",
  "error": "#b5350e",
  "on-status": "#ffffff",
  "ok-vivid": "#2e9e5f",
  "warn-vivid": "#e8a33a",
  "error-vivid": "#e0442a",
  "info-vivid": "#2f7fd8",
  "pending": "#a39994",
  "mock": "#7a68c0",
  "ok-tint": "#e8eee6",
  "warn-tint": "#f3ecdf",
  "error-tint": "#f8e8e1",
  "focus-ring": "#a1143e",
  "qr-ink": "#2a2627",
  "qr-bg": "#ffffff",
  "on-scrim": "#ffffff",
  "twin-casing": "#ffffff",
  "marker-a": "#e8590c",
  "marker-b": "#1c7ed6",
  "marker-a-ink": "#ffffff",
  "marker-b-ink": "#ffffff"
};

export const rgba = {
  "glass": "rgb(255 252 248 / 0.9)",
  "glass-soft": "rgb(255 252 248 / 0.6)",
  "glass-edge": "rgb(66 64 63 / 0.12)",
  "glass-highlight": "rgb(255 252 248 / 0.5)",
  "glass-phone": "rgb(255 252 248 / 0.94)",
  "scrim": "rgb(42 38 39 / 0.6)",
  "scrim-phone": "rgb(42 38 39 / 0.8)"
};

/** 트윈·지도·폰 영상 위 표시는 세 겹(바깥 숯색, 흰 테, 심). */
export const overlayLine = {
  "casing": {
    "color": "#ffffff",
    "opacity": 0.95
  },
  "edge": "#42403f",
  "px": {
    "casingAdd": 4,
    "edgeAdd": 6
  },
  "m3d": {
    "casingAdd": 0.04,
    "edgeAdd": 0.06,
    "y": {
      "edge": 0.028,
      "casing": 0.029,
      "core": 0.03
    }
  }
};

export const focus = {
  "ring": {
    "color": "#a1143e",
    "width": 3
  },
  "casing": {
    "color": "#ffffff",
    "width": 2
  },
  "edge": {
    "color": "#42403f",
    "width": 1
  },
  "labelBg": "rgb(42 38 39 / 0.8)",
  "labelText": "#ffffff",
  "offscreenArrow": "#a1143e",
  "aim": {
    "miss": "#e0442a",
    "hit": "#2e9e5f"
  }
};

export const canvasFont = "\"Noto Sans KR Variable\", \"Malgun Gothic\", sans-serif";
