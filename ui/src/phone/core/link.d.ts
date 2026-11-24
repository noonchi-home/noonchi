// link.js의 형(시험·React 화면이 TypeScript로 부른다).
export interface PhoneSocket { readonly readyState: number; readonly bufferedAmount: number; send(data: unknown): void }
export interface PhoneLink {
  send(msg: object): boolean;
  socket(): PhoneSocket | null;
  open(): boolean;
  stamp(phoneMs: number): { captured_at?: number; time_err_ms?: number };
  close(): void;
}
interface ManagedPhoneLink extends PhoneLink {
  start(): void;
  suspend(): void;
}
export function phoneSocketUrl(loc: { protocol: string; host: string }, video?: string | null, path?: string): string;
export function createLink(opts: {
  url: string;
  onMessage: (msg: Record<string, any>) => void;
  onOpen?: () => void;
  onClose?: () => void;
  /** 서버 판본이 달라도 다시 읽지 못함(같은 탭에서 60초 안·저장소 막힘). */
  onStale?: () => void;
  Socket?: unknown;
  now?: () => number;
  autoConnect?: boolean;
  /** 이 빌드의 폰 계약 판본(기본 ui/src/phone/protocol.ts PHONE_PROTOCOL). */
  protocol?: number;
  /** 페이지 다시 읽기(기본 location.reload). */
  reload?: () => void;
  /** 다시 읽은 시각을 두는 곳(기본 sessionStorage). */
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}): ManagedPhoneLink;
