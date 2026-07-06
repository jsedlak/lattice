/** Small, dependency-free formatting helpers. */

export function relativeTime(date: Date | string | number): string {
  const d = typeof date === "object" ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.round(mon / 12)}y ago`;
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fileTypeLabel(mime: string | null | undefined, kind: "note" | "upload"): string {
  if (kind === "note") return "NOTE";
  if (!mime) return "FILE";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("wordprocessingml")) return "DOCX";
  if (mime.includes("spreadsheetml") || mime.includes("ms-excel")) return "XLSX";
  if (mime.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  if (mime.startsWith("text/")) return "TXT";
  return "FILE";
}
