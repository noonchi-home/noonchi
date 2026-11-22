export const assistanceEvenings = [
  { date: "2026-11-20", captured: "18:19:57", arrived: "18:19:59", activity: "watching_tv", people: 1, resident: "alice", reply: "reject" },
  { date: "2026-11-21", captured: "18:19:58", arrived: "18:20:00", activity: "watching_tv", people: 1, resident: "alice", reply: "reject" },
  { date: "2026-11-22", captured: "18:19:57", arrived: "18:19:59", activity: "watching_tv", people: 1, resident: "alice", speech: "몇 시야?" },
] as const;

export const learningVariant = [
  assistanceEvenings[0],
  { ...assistanceEvenings[1], reply: "approve" },
  assistanceEvenings[2],
] as const;

export const ambiguousVariant = [
  assistanceEvenings[0],
  { ...assistanceEvenings[1], people: 2 },
  assistanceEvenings[2],
] as const;

export const localTime = (date: string, time: string) => Date.parse(`${date}T${time}+09:00`);
