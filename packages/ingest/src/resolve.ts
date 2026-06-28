import type { Extraction } from "@lattice/ai";
import { embedChunks } from "@lattice/ai";
import {
  createEntity,
  ENTITY_MERGE_THRESHOLD,
  ensureDocumentNode,
  ensureEdge,
  ensureEntityNode,
  findEntityByName,
  findSimilarEntity,
  getDocument,
  replaceEdgesFromNode,
} from "@lattice/db";

/**
 * Entity resolution / dedupe — the genuinely hard part. For each extracted
 * entity: embed it, cosine-search existing entities, and either reuse the match
 * (similarity ≥ threshold) or create a new canonical entity. Intra-batch dedupe
 * by normalized name first. Conservative threshold: prefer false splits over
 * false merges (a wrong merge corrupts the graph and is hard to undo).
 */
export async function resolveAndWrite(
  userId: string,
  documentId: string,
  extraction: Extraction,
): Promise<{ entityCount: number; relationCount: number }> {
  const doc = await getDocument(userId, documentId);
  if (!doc) return { entityCount: 0, relationCount: 0 };

  const sourceNodeId = await ensureDocumentNode(userId, documentId, doc.title);

  const entities = extraction.entities;
  if (entities.length === 0) {
    await replaceEdgesFromNode(userId, sourceNodeId, "llm", []);
    return { entityCount: 0, relationCount: 0 };
  }

  // Embed entity (name + description) in the same space as everything else.
  const texts = entities.map((e) => (e.description ? `${e.name}: ${e.description}` : e.name));
  const embeddings = await embedChunks(texts);

  const nameToNode = new Map<string, string>();
  const mentionEdges: { targetId: string; relation: "mentions" }[] = [];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]!;
    const emb = embeddings[i]!;
    const norm = e.name.trim().toLowerCase();
    if (nameToNode.has(norm)) continue; // intra-batch dedupe

    // 1) Exact name match — the reliable primary key (merges "Covalent" no
    //    matter what embedding similarity says). 2) embedding similarity for
    //    near-duplicates. 3) otherwise create a new canonical entity.
    const byName = await findEntityByName(userId, e.name);
    let entityId: string;
    if (byName) {
      entityId = byName.id;
    } else {
      const similar = await findSimilarEntity(userId, emb);
      entityId =
        similar && similar.similarity >= ENTITY_MERGE_THRESHOLD
          ? similar.id
          : (
              await createEntity(userId, {
                name: e.name,
                type: e.type,
                description: e.description,
                embedding: emb,
              })
            ).id;
    }

    const nodeId = await ensureEntityNode(userId, entityId, e.name);
    nameToNode.set(norm, nodeId);
    mentionEdges.push({ targetId: nodeId, relation: "mentions" });
  }

  // document --mentions--> entity (replaced per document, idempotent).
  await replaceEdgesFromNode(userId, sourceNodeId, "llm", mentionEdges);

  // entity --related--> entity (upserted, not replaced — relations span docs).
  let relationCount = 0;
  for (const rel of extraction.relationships) {
    const from = nameToNode.get(rel.from.trim().toLowerCase());
    const to = nameToNode.get(rel.to.trim().toLowerCase());
    if (from && to && from !== to) {
      await ensureEdge(userId, from, to, "related", "llm", rel.relation);
      relationCount++;
    }
  }

  return { entityCount: nameToNode.size, relationCount };
}
