/**
 * Embedding vector dimension. MUST match the embedding model configured in
 * @lattice/ai (EMBEDDING_MODEL). `text-embedding-3-small` => 1536.
 *
 * This is the single source of truth: the `vector(...)` columns and the HNSW
 * indexes in schema.ts use it, and @lattice/ai re-exports it so call sites and
 * the DB never drift. Changing embedding model => change this => new migration.
 */
export const EMBEDDING_DIM = 1536;

/** Similarity threshold (cosine) above which two extracted entities are treated
 *  as the same canonical entity during resolution/dedupe (Phase 07). Tuned
 *  conservatively: prefer false splits over false merges. */
export const ENTITY_MERGE_THRESHOLD = 0.86;
