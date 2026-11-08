// link.js의 형(시험·React 화면이 TypeScript로 부른다).
export interface PhoneSocket { readonly readyState: number; readonly bufferedAmount: number; send(data: unknown): void }
export interface PhoneLink {
  send(msg: object): boolean;
  socket(): PhoneSocket | null;
  open(): boolean;
  stamp(phoneMs: number): { captured_at?: number; time_err_ms?: number };
  close(): void;
}
export function phoneSocketUrl(loc: { protocol: string; host: string }): string;
export function createLink(opts: {
  url: string;
  onMessage: (msg: Record<string, any>) => void;
  onOpen?: () => void;
  onClose?: () => void;
  Socket?: unknown;
  now?: () => number;
}): PhoneLink;
