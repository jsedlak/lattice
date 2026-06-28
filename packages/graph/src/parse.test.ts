import { describe, expect, it } from "vitest";
import { parseLinks, tokenizeLinks } from "./parse";

describe("parseLinks", () => {
  it("extracts tags, lowercased and deduped", () => {
    const { tags } = parseLinks("Note about #Graph and #graph and #theory");
    expect(tags).toEqual(["graph", "theory"]);
  });

  it("does not treat markdown headings as tags", () => {
    const { tags } = parseLinks("# Heading\nsome #realtag here");
    expect(tags).toEqual(["realtag"]);
  });

  it("does not match # in the middle of a word", () => {
    const { tags } = parseLinks("color#fff and issue C#sharp");
    // `#fff` is preceded by a letter, `#sharp` is preceded by a letter — neither
    // is at a word boundary, so neither is a tag.
    expect(tags).toEqual([]);
  });

  it("matches a tag after an opening paren", () => {
    const { tags } = parseLinks("see (#vectors)");
    expect(tags).toEqual(["vectors"]);
  });

  it("extracts wiki-link targets, before the alias pipe", () => {
    const { wikiLinks } = parseLinks("Link to [[Knowledge Graphs 101]] and [[Foo|the alias]]");
    expect(wikiLinks).toEqual(["Knowledge Graphs 101", "Foo"]);
  });

  it("dedupes wiki-links", () => {
    const { wikiLinks } = parseLinks("[[A]] [[A]] [[B]]");
    expect(wikiLinks).toEqual(["A", "B"]);
  });

  it("returns empty arrays for plain text", () => {
    expect(parseLinks("just some words")).toEqual({ tags: [], wikiLinks: [] });
  });
});

describe("tokenizeLinks", () => {
  it("returns ranges for tags and wiki-links sorted by position", () => {
    const src = "a #tag then [[Link]]";
    const tokens = tokenizeLinks(src);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ type: "tag", value: "tag" });
    expect(src.slice(tokens[0]!.from, tokens[0]!.to)).toBe("#tag");
    expect(tokens[1]).toMatchObject({ type: "wikilink", value: "Link" });
    expect(src.slice(tokens[1]!.from, tokens[1]!.to)).toBe("[[Link]]");
  });
});
