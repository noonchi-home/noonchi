'use client';
// 21st.dev「Text Shimmer」(id 1169, ibelick/text-shimmer) 받은 코드.
// 바꾼 것: framer-motion → motion/react(같은 API, motion() → motion.create()를 한 번만 만든다), #a1a1aa·#000 → muted-foreground·foreground 토큰, #0000 → transparent, dark: 줄 지움.
// Chain of Thought가 넘기는 invertLight(띠와 바탕 색을 바꿈)·disableShimmer(그냥 글) 두 prop과 글이 아닌 children을 잇는다. 기본 태그 p → span(단추 안에 들어간다).
// 대시보드 판단 기록에서는 disableShimmer로 반짝임을 끈다: 2026-11-08 사용자 결정, 반짝임이 화면 바꾸기를 멈추게 했다.
import React, { useMemo, type JSX } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface TextShimmerProps {
  children: React.ReactNode;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  spread?: number;
  invertLight?: boolean;
  disableShimmer?: boolean;
}

function TextShimmerComponent({
  children,
  as: Component = 'span',
  className,
  duration = 2,
  spread = 2,
  invertLight = false,
  disableShimmer = false,
}: TextShimmerProps) {
  const MotionComponent = useMemo(() => motion.create(Component as keyof JSX.IntrinsicElements), [Component]);

  const dynamicSpread = useMemo(() => {
    return (typeof children === 'string' ? children.length : 12) * spread;
  }, [children, spread]);

  if (disableShimmer) return <Component className={cn('relative inline-block', className)}>{children}</Component>;

  return (
    <MotionComponent
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text',
        invertLight
          ? 'text-transparent [--base-color:var(--color-foreground)] [--base-gradient-color:var(--color-muted-foreground)]'
          : 'text-transparent [--base-color:var(--color-muted-foreground)] [--base-gradient-color:var(--color-foreground)]',
        '[--bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--base-gradient-color),transparent_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        className
      )}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{
        repeat: Infinity,
        duration,
        ease: 'linear',
      }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage: `var(--bg), linear-gradient(var(--base-color), var(--base-color))`,
        } as React.CSSProperties
      }
    >
      {children}
    </MotionComponent>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);
