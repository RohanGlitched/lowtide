"use client";
import { useEffect, useRef } from "react";
import { drawClock, type ClockData, type ClockTheme } from "@/views/clock";

/** The flat dial (the day from above), sized to its container (square). */
export default function Clock({
  data,
  animate = true,
  labels = true,
  minimal = false,
  label,
  className,
  theme = "light",
}: {
  theme?: ClockTheme;
  data: ClockData;
  animate?: boolean;
  labels?: boolean;
  minimal?: boolean;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastW = 0;
    const draw = () => {
      const w = Math.round(el.clientWidth);
      if (!w || w === lastW) return;
      lastW = w;
      drawClock(el, data, { size: w, animate: animate && first.current, labels, minimal, theme });
      first.current = false;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, animate, labels, minimal, theme]);
  return <div ref={ref} className={className} role="img" aria-label={label} style={{ aspectRatio: "1 / 1", width: "100%" }} />;
}
