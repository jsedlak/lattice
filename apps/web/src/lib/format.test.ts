import { describe, expect, it } from "vitest";
import { fileSize, fileTypeLabel, relativeTime } from "./format";

describe("relativeTime", () => {
  const now = Date.now();
  it("reports recent times", () => {
    expect(relativeTime(now - 10_000)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000)).toBe("2d ago");
  });
});

describe("fileSize", () => {
  it("formats bytes", () => {
    expect(fileSize(null)).toBe("—");
    expect(fileSize(0)).toBe("—");
    expect(fileSize(500)).toBe("500 B");
    expect(fileSize(1024)).toBe("1.0 KB");
    expect(fileSize(1536)).toBe("1.5 KB");
    expect(fileSize(1_572_864)).toBe("1.5 MB");
  });
});

describe("fileTypeLabel", () => {
  it("labels notes and known mimes", () => {
    expect(fileTypeLabel(null, "note")).toBe("NOTE");
    expect(fileTypeLabel("application/pdf", "upload")).toBe("PDF");
    expect(
      fileTypeLabel(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "upload",
      ),
    ).toBe("DOCX");
    expect(fileTypeLabel("image/png", "upload")).toBe("PNG");
    expect(fileTypeLabel(null, "upload")).toBe("FILE");
  });
});
