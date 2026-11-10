// 만든 파일: src/design/tokens.json(NOONCHI 1.1.0)에서 npm run tokens가 만든다. 고칠 때는 원본을 고치고 npm run tokens를 돌린다.
// 트윈 위 표시·SVG·캔버스·3D 계획(VIZ)·3D 장면(scene3d) 색은 여기 값만 쓴다.

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
  "marker-b-ink": "#ffffff",
  "scene-bg": "#bdbdbd",
  "scene-cap": "#4e4b48",
  "scene-window": "#d0d1d1",
  "scene-rail": "#e4eaec",
  "scene-light": "#ffffff",
  "scene-shade": "#000000",
  "scene-placeholder": "#bdbdbd"
} as const;

export const rgba = {
  "glass": "rgb(255 252 248 / 0.9)",
  "glass-soft": "rgb(255 252 248 / 0.6)",
  "glass-edge": "rgb(66 64 63 / 0.12)",
  "glass-highlight": "rgb(255 252 248 / 0.5)",
  "glass-phone": "rgb(255 252 248 / 0.94)",
  "scrim": "rgb(42 38 39 / 0.6)",
  "scrim-phone": "rgb(42 38 39 / 0.8)"
} as const;

export const alias = {
  "background": "#fffcf8",
  "foreground": "#2a2627",
  "card": "#fffcf8",
  "card-foreground": "#2a2627",
  "popover": "#fffcf8",
  "popover-foreground": "#2a2627",
  "primary": "#a1143e",
  "primary-foreground": "#ffffff",
  "secondary": "#f2e4d3",
  "secondary-foreground": "#2a2627",
  "muted": "#f2e4d3",
  "muted-foreground": "#645b5b",
  "destructive": "#b5350e",
  "destructive-foreground": "#ffffff",
  "border": "#e7dbce",
  "input": "#8f847f",
  "ring": "#a1143e",
  "chart-2": "#1b7041",
  "shade": "#2a2627",
  "twin-edge": "#42403f"
} as const;

export const overlayLine = {
  "rule": "트윈·지도·폰 영상 위 선과 표시는 세 겹: 바깥 charcoal, 그 안 흰 테(twin-casing 0.95), 가운데 불투명 심. 불투명도로 상태를 나누지 않는다. 상태는 색·굵기·끝 표시로 나눈다",
  "casing": {
    "color": "#ffffff",
    "opacity": 0.95
  },
  "edge": "#42403f",
  "px": {
    "casingAdd": 4,
    "edgeAdd": 6,
    "note": "흰 테 폭 = 심 + 4(양쪽 2), 숯색 폭 = 심 + 6(양쪽 1 더)"
  },
  "m3d": {
    "casingAdd": 0.04,
    "edgeAdd": 0.06,
    "y": {
      "edge": 0.028,
      "casing": 0.029,
      "core": 0.03
    },
    "note": "세 장을 아래부터 숯색·흰 테·심 순서로 깐다(depthWrite false, renderOrder 0·1·2)"
  }
} as const;

export const twin = {
  "route": {
    "core": "#a1143e",
    "width": 5,
    "casing": {
      "color": "#ffffff",
      "width": 9,
      "opacity": 0.95
    },
    "edge": {
      "color": "#42403f",
      "width": 11
    }
  },
  "routeAhead": {
    "core": "#a1143e",
    "width": 3,
    "casing": {
      "color": "#ffffff",
      "width": 7,
      "opacity": 0.95
    },
    "edge": {
      "color": "#42403f",
      "width": 9
    }
  },
  "routePassed": {
    "core": "#a39994",
    "width": 2,
    "casing": {
      "color": "#ffffff",
      "width": 6,
      "opacity": 0.95
    },
    "edge": {
      "color": "#42403f",
      "width": 8
    }
  },
  "destination": {
    "ring": "#a1143e",
    "ringWidth": 3,
    "core": "#ffffff",
    "casing": {
      "color": "#ffffff",
      "width": 2
    },
    "edge": {
      "color": "#42403f",
      "width": 1
    },
    "halo": {
      "color": "#a1143e",
      "opacity": 0.14
    },
    "dot": "#a1143e"
  },
  "cloid": {
    "fill": "#a1143e",
    "casing": {
      "color": "#ffffff",
      "width": 2.5
    },
    "edge": {
      "color": "#42403f",
      "width": 1
    },
    "heading": "#ffffff",
    "halo": {
      "color": "#a1143e",
      "opacity": 0.16
    },
    "cone": "#b92a51",
    "coneOpacityFrom": 0.38,
    "coneOpacityTo": 0
  },
  "checkedDevice": {
    "bubbleRing": "#a1143e",
    "bubbleRingWidth": 2,
    "plate3d": {
      "color": "#b92a51",
      "opacity": 0.16
    },
    "emissive": 0.12
  },
  "checkDot": {
    "core": "#ffffff",
    "ring": {
      "color": "#42403f",
      "width": 1
    }
  },
  "roomEdge": {
    "color": "#8f847f",
    "width": 1
  },
  "dimRoom": {
    "color": "#2a2627",
    "opacity": 0.16
  },
  "bubble": {
    "bg": "#fffcf8",
    "text": "#2a2627",
    "sub": "#574f50",
    "edge": "#42403f",
    "arrow": "#fffcf8",
    "arrowEdge": "#42403f",
    "shadow": "shadow-float",
    "numberText": "#ffffff",
    "numberFill": {
      "on": "#1b7041",
      "off": "#645b5b",
      "alert": "#b5350e",
      "unknown": "#835700"
    },
    "numberIcon": {
      "alert": "TriangleAlert",
      "unknown": "CircleHelp"
    },
    "numberSize": {
      "md": 20
    },
    "objectDot": "#a1143e",
    "verb": {
      "확인": "ink-2",
      "바꿈": "ok",
      "승인 대기": "warn",
      "실패": "error",
      "취소": "ink-3",
      "지켜봄": "brand"
    }
  },
  "phoneFocus": {
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
      "hit": "#2e9e5f",
      "estimated": "#e8a33a",
      "hitShape": "가운데 점 채움",
      "estimatedShape": "가운데 점 채움",
      "missShape": "빈 고리"
    }
  },
  "markers": {
    "a": "#e8590c",
    "aInk": "#ffffff",
    "b": "#1c7ed6",
    "bInk": "#ffffff"
  }
} as const;

export const viz = {
  "cone": {
    "ok": "#b92a51",
    "limited": "#a39994",
    "estimated": "#a39994",
    "faceOpacity": 0.22,
    "outline": "원뿔 가장자리 선·바닥 원판 둘레는 세 겹(심 0.03 m)",
    "arrowHalfDeg": 5,
    "length": 1.2
  },
  "attention": "#e8a33a",
  "mockTint": "#7a68c0",
  "status": {
    "pending": "#a39994",
    "running": "#a1143e",
    "done": "#2e9e5f",
    "failed": "#e0442a",
    "replan": "#2f7fd8",
    "cancelled": "#645b5b"
  },
  "path": {
    "active": {
      "color": "#a1143e",
      "width": 0.14
    },
    "planned": {
      "color": "#a39994",
      "width": 0.08
    },
    "done": {
      "color": "#2e9e5f",
      "width": 0.05
    },
    "failed": {
      "color": "#e0442a",
      "width": 0.14,
      "endMark": "x"
    },
    "replaced": {
      "color": "#645b5b",
      "width": 0.05
    }
  },
  "highlight": {
    "color": "#b92a51",
    "floorOpacity": 0.16,
    "emissive": 0.12,
    "line": "경계선·바닥 링은 세 겹"
  },
  "minimap": {
    "room": "#f6efe6",
    "focusRoom": {
      "color": "#b92a51",
      "opacity": 0.3
    },
    "roomEdge": "#8f847f",
    "cloid": "#a1143e",
    "cloidEstimated": "#a39994"
  },
  "touchPins": {
    "a": "#e8590c",
    "b": "#1c7ed6"
  }
} as const;

export const scene3d = {
  "background": "#bdbdbd",
  "wallCap": "#4e4b48",
  "windowGlass": {
    "color": "#d0d1d1",
    "opacity": 0.88
  },
  "railGlass": {
    "color": "#e4eaec",
    "opacity": 0.22
  },
  "light": "#ffffff",
  "groundShade": "#000000",
  "placeholder": "#bdbdbd"
} as const;

export const font = {
  "sans": "\"Noto Sans KR Variable\", \"Noto Sans KR\", \"Malgun Gothic\", \"Apple SD Gothic Neo\", system-ui, sans-serif",
  "mono": "ui-monospace, \"Cascadia Mono\", Consolas, \"D2Coding\", monospace",
  "canvas": "\"Noto Sans KR Variable\", \"Malgun Gothic\", sans-serif",
  "weights": {
    "regular": 400,
    "medium": 500,
    "semibold": 600,
    "bold": 700,
    "brand": 850
  }
} as const;

export type ColorToken = keyof typeof color;
