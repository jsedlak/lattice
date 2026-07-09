import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Drag strip laid over a pane border: invisible until hovered, a slim accent
 * bar while hovered/dragging. Reports the pointer's clientX; the parent owns
 * clamping and persistence. Net-zero layout width — negative margins overlay
 * the adjacent panes' borders so nothing shifts.
 */
export function ResizeHandle({
  label,
  onStart,
  onResize,
  onEnd,
  className,
}: {
  label: string;
  onStart?: () => void;
  onResize: (clientX: number) => void;
  onEnd?: () => void;
  className?: string;
}) {
  const dragging = React.useRef(false);
  const [active, setActive] = React.useState(false);

  const stop = (el: HTMLElement, pointerId: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    onEnd?.();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        setActive(true);
        onStart?.();
      }}
      onPointerMove={(e) => {
        if (dragging.current) onResize(e.clientX);
      }}
      onPointerUp={(e) => stop(e.currentTarget, e.pointerId)}
      onLostPointerCapture={(e) => stop(e.currentTarget, e.pointerId)}
      className={cn(
        "relative z-10 -mx-[3.5px] w-[7px] shrink-0 cursor-col-resize touch-none select-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[3px] after:-translate-x-1/2 after:rounded-full after:transition-colors",
        active ? "after:bg-accent/60" : "hover:after:bg-accent/35",
        className,
      )}
    />
  );
}
