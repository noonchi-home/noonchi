// device-search.js의 형(테스트에서 TypeScript로 부른다).
export function searchDevices<T extends { id: string; label: string; kindLabel?: string; roomLabel?: string }>(devices: T[], query: string): T[];
