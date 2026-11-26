import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";

const scriptUrl = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
type PostcodeConstructor = new (options: {
  oncomplete: (result: { roadAddress: string }) => void;
  width: string;
  height: string;
  minWidth: number;
}) => { embed(target: HTMLElement): void };

const constructorFromWindow = () => (window as Window & {
  kakao?: { Postcode?: PostcodeConstructor };
}).kakao?.Postcode;

let pending: Promise<PostcodeConstructor> | undefined;

function loadPostcode(): Promise<PostcodeConstructor> {
  const loaded = constructorFromWindow();
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.referrerPolicy = "no-referrer";
    function unavailable() {
      script.remove();
      pending = undefined;
      reject(new Error("주소 검색을 열지 못했습니다."));
    }
    script.onload = () => {
      const Postcode = constructorFromWindow();
      if (!Postcode) { unavailable(); return; }
      pending = undefined;
      resolve(Postcode);
    };
    script.onerror = unavailable;
    document.head.append(script);
  });
  return pending;
}

export function PostcodeSearch({ onSelect }: { onSelect: (roadAddress: string) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = host.current;
    if (!open || !target) return;
    let live = true;
    loadPostcode().then((Postcode) => {
      if (!live) return;
      new Postcode({
        width: "100%", height: "100%", minWidth: 200,
        oncomplete: ({ roadAddress }) => {
          if (!live) return;
          onSelect(roadAddress);
          setOpen(false);
        },
      }).embed(target);
      setStatus("ready");
    }).catch(() => { if (live) setStatus("error"); });
    return () => {
      live = false;
      target.replaceChildren();
    };
  }, [open, onSelect]);

  if (!open) return <Button variant="outline" size="setup-sm" onClick={() => {
    setStatus("loading");
    setOpen(true);
  }}>전국 주소 검색</Button>;

  return <section aria-label="Kakao 우편번호 검색" className="grid min-w-0 gap-2">
    {status === "loading" && <p role="status">주소 검색을 불러오는 중이에요.</p>}
    {status === "error" && <p role="alert">주소 검색을 열지 못했어요. 위 검색칸에 직접 입력해 주세요.</p>}
    <div ref={host} className={status === "error" ? "hidden" : "h-96 min-w-0 w-full"} />
    <Button variant="ghost" onClick={() => setOpen(false)}>주소 검색 닫기</Button>
  </section>;
}
