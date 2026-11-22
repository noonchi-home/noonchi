export interface LearningEvening {
  day: string;
  capture: string;
  arrive: string;
  activity: "watching_tv";
  people: 1 | 2;
  answer?: "reject" | "approve";
  speech?: string;
}

export const assistanceEvenings: readonly LearningEvening[] = [
  { day: "2026-11-20", capture: "23:29:50", arrive: "23:29:52", activity: "watching_tv", people: 1, answer: "reject" },
  { day: "2026-11-21", capture: "23:29:51", arrive: "23:29:53", activity: "watching_tv", people: 1, answer: "reject" },
  { day: "2026-11-22", capture: "23:29:50", arrive: "23:29:52", activity: "watching_tv", people: 1, speech: "몇 시야?" },
];

export const learningVariant = [
  assistanceEvenings[0]!,
  { ...assistanceEvenings[1]!, answer: "approve" },
  assistanceEvenings[2]!,
] as const;

export const ambiguousVariant = [
  assistanceEvenings[0]!,
  { ...assistanceEvenings[1]!, people: 2 },
  assistanceEvenings[2]!,
] as const;

export const localTime = (date: string, time: string) => Date.parse(`${date}T${time}+09:00`);
