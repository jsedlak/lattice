import { describe, expect, it } from "vitest";
import { remarkLattice } from "./remark-lattice";

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

describe("remarkLattice", () => {
  it("splits text nodes into tag and wiki-link nodes", () => {
    const tree: MdNode = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "see #tag and [[Foo|bar]]" }] },
      ],
    };
    remarkLattice()(tree);
    const kids = tree.children![0]!.children!;
    expect(kids.map((k) => k.type)).toEqual(["text", "link", "text", "link"]);
    expect(kids[1]!.url).toBe("lattice-tag:tag");
    expect(kids[1]!.children![0]!.value).toBe("#tag");
    expect(kids[3]!.url).toBe("lattice-wiki:Foo");
    expect(kids[3]!.children![0]!.value).toBe("bar"); // alias displayed
  });

  it("leaves inline code untouched", () => {
    const tree: MdNode = {
      type: "root",
      children: [{ type: "inlineCode", value: "#tag" }],
    };
    remarkLattice()(tree);
    expect(tree.children![0]).toEqual({ type: "inlineCode", value: "#tag" });
  });

  it("leaves plain text without tokens unchanged", () => {
    const tree: MdNode = {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "nothing here" }] }],
    };
    remarkLattice()(tree);
    expect(tree.children![0]!.children).toEqual([{ type: "text", value: "nothing here" }]);
  });
});
