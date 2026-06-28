/**
 * A tiny remark plugin (no extra deps) that turns `#tags` and `[[wiki-links]]`
 * in markdown text nodes into special link nodes the preview renders as colored
 * chips / internal links. Skips code (code/inlineCode are leaf nodes we never
 * recurse into), so tags inside code fences are left alone.
 */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const PATTERN = /(#[a-zA-Z][\w-]*)|(\[\[[^\]]+?\]\])/g;

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(PATTERN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: value.slice(last, idx) });
    const token = m[0];
    if (token.startsWith("#")) {
      out.push({
        type: "link",
        url: `lattice-tag:${token.slice(1)}`,
        children: [{ type: "text", value: token }],
      });
    } else {
      const inner = token.slice(2, -2);
      const target = (inner.split("|")[0] ?? "").trim();
      const display = (inner.split("|")[1] ?? target).trim();
      out.push({
        type: "link",
        url: `lattice-wiki:${encodeURIComponent(target)}`,
        children: [{ type: "text", value: display }],
      });
    }
    last = idx + token.length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && PATTERN.test(child.value)) {
      PATTERN.lastIndex = 0;
      next.push(...splitText(child.value));
    } else {
      transform(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkLattice() {
  return (tree: MdNode) => {
    transform(tree);
  };
}
