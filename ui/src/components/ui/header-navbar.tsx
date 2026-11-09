"use client";

// 21st.dev「Core Header Navbar」(id 9847, kumail_ali_r/core-header-navbar) 받은 코드.
// 바꾼 것: SecondaryNavbar와 오른쪽 사용자 칸(이름·「Active Now」·동그라미 아바타)을 뺐다. 그 자리는 밖에서 넣는 칸(children)이다. 왼쪽 칸 간격 gap-4 → gap-[9px](위키 로고 짝 간격).
// 제목 h1을 NavbarTitle로 내보낸다: class(text-xl bold tracking-tighter italic) → 브랜드 제목(850, 0.11em, uppercase, ink 토큰), size(setup 18px, hub title-sm 토큰), as(대시보드는 span).
// title 앞에 logo 자리(ReactNode)와 제목 옆 label(label 토큰)을 이었다. 격자 바탕 var(--muted)는 그대로(muted=cream), 마스크 #000 → shade 토큰(가리는 모양 그대로).
import React from "react";
import { cn } from "@/lib/utils";

type NavbarTitleProps = {
  children: React.ReactNode;
  size?: "setup" | "hub";
  as?: "h1" | "span";
  className?: string;
};

export function NavbarTitle({ children, size = "setup", as: Tag = "h1", className }: NavbarTitleProps) {
  return (
    <Tag className={cn("m-0 font-brand tracking-[0.11em] uppercase text-ink leading-none", size === "setup" ? "text-[18px]" : "text-title-sm", className)}>
      {children}
    </Tag>
  );
}

type SimpleNavbarProps = {
  title: string;
  logo?: React.ReactNode;
  label?: string;
  children?: React.ReactNode;
};

export function SimpleNavbar({ title, logo, label, children }: SimpleNavbarProps) {
  return (
    <nav className="relative border-b h-16 flex items-center justify-between px-4 overflow-hidden bg-background/50 backdrop-blur-md">
          <div className="min-h-full -z-10 w-full bg-transparent absolute top-0 left-0">
      {/* Diagonal Fade Grid Background - Top Left */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `
        linear-gradient(to right, var(--muted) 1px, transparent 1px),
        linear-gradient(to bottom, var(--muted) 1px, transparent 1px)
      `,
          backgroundSize: "32px 32px",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 80% at 0% 0%, var(--shade) 50%, transparent 90%)",
          maskImage:
            "radial-gradient(ellipse 80% 80% at 0% 0%, var(--shade) 50%, transparent 90%)",
        }}
      />
      {/* Your Content/Components */}
    </div>

      <div className="z-10 flex items-center gap-[9px]">
        {logo}
        <NavbarTitle>{title}</NavbarTitle>
        {label && <span className="ml-1 text-label text-muted-foreground">{label}</span>}
      </div>

      <div className="z-10 flex items-center gap-3">
        {children}
      </div>
    </nav>
  );
}
