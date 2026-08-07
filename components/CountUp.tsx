"use client";

import { useEffect, useRef } from "react";

/**
 * Animated number that counts from 0 to `value` on an ease-out curve.
 *
 * Writes to the node directly rather than through setState. Two reasons, and
 * the second is the real one:
 *   1. setState in an effect body is what react-hooks/set-state-in-effect
 *      exists to stop.
 *   2. A counter driven by state re-renders its whole subtree on EVERY frame —
 *      roughly 55 renders per number, four numbers on the funnel. The value
 *      being animated is a single text node; writing that text node is the
 *      thing actually being asked for.
 *
 * Server-rendered output is the final value, so the number is correct with no
 * JS, and correct immediately under prefers-reduced-motion.
 */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => n.toLocaleString("en-US");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) {
      node.textContent = fmt(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutExpo — fast start, gentle landing.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      node.textContent = fmt(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  // The rendered value is the FINAL one — the effect animates up to it from 0.
  // That keeps SSR output, no-JS output and reduced-motion output all correct.
  return (
    <span ref={ref} className="tabular">
      {fmt(value)}
    </span>
  );
}
