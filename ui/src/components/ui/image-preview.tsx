"use client";

// 21st.dev「Image Preview」(id 19197, arihantcodes_1f7b8c4d/image-preview) 받은 코드.
// 바꾼 것: next/image → img, 덮개 bg-black/50 → scrim 토큰, 닫기 단추 bg-black/50 text-white → scrim·on-scrim 토큰(hover ink/75), Close → 「닫기」,
// 닫기 단추 focus:outline-none → focus-visible:outline-2 outline-ring outline-offset-2, 작은 사진을 DialogPrimitive.Trigger 단추(「사진 크게 보기」)로 감쌌다(키보드로 열림),
// 크기를 모르는 사진이라 width·height는 없어도 된다. 화면이 주는 className은 받은 꾸밈 뒤에 붙인다. 읽기 도구용 제목(DialogTitle sr-only)을 더했다.
import React, { useState } from "react";
import { X } from "lucide-react";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
}

export default function ImagePreview({
  src = "",
  alt = "Preview image",
  width,
  height,
  className,
}: ImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" aria-label="사진 크게 보기" className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
          <img
            src={src}
            alt={alt}
            width={width}
            height={height}
            className={cn("cursor-pointer rounded-lg hover:opacity-90 transition-opacity", className)}
          />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] max-w-[90vw] max-h-[90vh] w-auto h-auto p-0 bg-transparent border-0">
          <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute right-4 top-4 z-10 rounded-full bg-scrim p-2 text-on-scrim hover:bg-ink/75 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            <X className="h-6 w-6" />
            <span className="sr-only">닫기</span>
          </button>
          <div className="relative w-full h-full">
            <img
              src={src}
              alt={alt}
              width={width ? width * 2 : undefined}
              height={height ? height * 2 : undefined}
              className="object-contain max-w-[90vw] max-h-[90vh]"
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { ImagePreview };
