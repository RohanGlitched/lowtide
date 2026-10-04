"use client";
import { useEffect, useRef, useState } from "react";

/** Mounts its children when the box comes within `margin` of the viewport or the browser goes idle, whichever is first. */
export default function WhenNear({ children, margin = "400px", className }: { children: React.ReactNode; margin?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    // Or as soon as the browser is idle, so the work is done before anyone scrolls to it.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => setNear(true), { timeout: 4000 }) : window.setTimeout(() => setNear(true), 2500);
    return () => {
      io.disconnect();
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [near, margin]);
  return (
    <div ref={ref} className={className} style={{ height: "100%" }}>
      {near ? children : null}
    </div>
  );
}
