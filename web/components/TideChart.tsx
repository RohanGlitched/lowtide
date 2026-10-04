"use client";
import { useEffect, useRef } from "react";
import { drawTide, type ChartData } from "@/views/chart";

/** The same tidal curve the MCP view draws, for the website. */
export default function TideChart({ data, height, compact, label }: { data: ChartData; height?: number; compact?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let first = true;
    let lastW = 0;
    const draw = () => {
      const w = el.clientWidth;
      if (w === lastW) return;
      lastW = w;
      drawTide(el, data, { animate: first, compact, height });
      first = false;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, height, compact]);
  return <div ref={ref} className="tideHost" aria-label={label} style={height ? { minHeight: height } : undefined} />;
}
