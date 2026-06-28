import { cn } from "../cn";

/**
 * The Lattice brand mark — the real logo (a node-and-edge graph in a blue
 * rounded icon). Served from the web app's /logo-mark.png (a 256px, transparent
 * export of the source logo.png). Plain <img> keeps this package
 * framework-agnostic; the asset is small enough that no optimizer is needed.
 */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-mark.png"
      alt="Lattice"
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className=" font-semibold tracking-tight text-foreground">Lattice</span>
    </span>
  );
}
