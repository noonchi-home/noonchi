export const evenings = [
  { day: "2026-11-20", capture: "23:29:49", arrive: "23:29:50", answer: "reject" },
  { day: "2026-11-21", capture: "23:29:49", arrive: "23:29:50", answer: "reject" },
  { day: "2026-11-22", capture: "23:29:49", arrive: "23:29:50" },
] as const;

export const mixedEvenings = [evenings[0], { ...evenings[1], answer: "approve" }, evenings[2]] as const;
export const at = (day: string, hms: string) => Date.parse(`${day}T${hms}+09:00`);
