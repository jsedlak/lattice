import { describe, expect, it } from "vitest";
import { toCitations } from "./citations";

describe("toCitations", () => {
  it("returns [] for undefined / empty steps", () => {
    expect(toCitations(undefined)).toEqual([]);
    expect(toCitations([])).toEqual([]);
  });

  it("maps semanticSearch hits and dedupes by chunk", () => {
    const steps = [
      {
        toolResults: [
          {
            toolName: "semanticSearch",
            result: [
              { documentId: "d1", chunkId: "c1", title: "Doc 1", snippet: "hello" },
              { documentId: "d1", chunkId: "c1", title: "Doc 1", snippet: "hello again" },
              { documentId: "d2", chunkId: "c2", title: "Doc 2", snippet: "world" },
            ],
          },
        ],
      },
    ];
    const cites = toCitations(steps);
    expect(cites).toHaveLength(2);
    expect(cites[0]).toMatchObject({ label: "Doc 1", documentId: "d1", chunkId: "c1" });
    expect(cites[1]).toMatchObject({ label: "Doc 2", documentId: "d2" });
  });

  it("maps searchNodes document nodes", () => {
    const steps = [
      {
        toolResults: [
          {
            toolName: "searchNodes",
            result: [
              { nodeId: "n1", label: "Atlas", documentId: "d3" },
              { nodeId: "n2", label: "sometag", documentId: null },
            ],
          },
        ],
      },
    ];
    const cites = toCitations(steps);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({ label: "Atlas", documentId: "d3", nodeId: "n1" });
  });

  it("maps getNeighbors document nodes", () => {
    const steps = [
      {
        toolResults: [
          {
            toolName: "getNeighbors",
            result: [{ node: { id: "n9", label: "Neighbor", documentId: "d9" } }],
          },
        ],
      },
    ];
    expect(toCitations(steps)[0]).toMatchObject({ label: "Neighbor", documentId: "d9" });
  });

  it("ignores non-array tool results", () => {
    const steps = [{ toolResults: [{ toolName: "semanticSearch", result: null }] }];
    expect(toCitations(steps)).toEqual([]);
  });
});
