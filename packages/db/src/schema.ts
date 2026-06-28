import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIM } from "./constants";

/**
 * Application schema. BetterAuth owns user/session/account/verification (its CLI
 * generates them — see packages/auth). Every application row carries `userId`
 * for uniform "filter by session user" scoping (defense in depth over FK joins).
 */

// ── Documents: authored notes + uploaded files ──────────────────────────────
export const document = pgTable(
  "document",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(), // -> user.id
    kind: text("kind", { enum: ["note", "upload"] })
      .notNull()
      .default("note"),
    title: text("title").notNull(),
    /** markdown body (notes) or extracted text (uploads) — kept in PG for fast
     *  edit/preview/search; the original upload bytes live in Vercel Blob. */
    content: text("content").notNull().default(""),
    folder: text("folder"), // deprecated (legacy lightweight grouping) — kept to avoid a destructive migration
    folderId: uuid("folder_id"), // -> folder.id; null = root
    blobPathname: text("blob_pathname"), // set for kind=upload
    blobUrl: text("blob_url"), // public (unguessable) Vercel Blob URL; served via authed route
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    pageCount: integer("page_count"),
    ingestStatus: text("ingest_status", {
      enum: ["idle", "queued", "processing", "ready", "error"],
    })
      .notNull()
      .default("idle"),
    ingestError: text("ingest_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("document_user_idx").on(t.userId)],
);

// ── Folders: user-organized document tree ───────────────────────────────────
export const folder = pgTable(
  "folder",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"), // -> folder.id; null = root (no hard FK: app-managed)
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("folder_user_idx").on(t.userId)],
);

// ── Chunks: retrievable text spans with embeddings ──────────────────────────
export const chunk = pgTable(
  "chunk",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("chunk_user_idx").on(t.userId),
    index("chunk_doc_idx").on(t.documentId),
    index("chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ── Graph nodes: document | tag | entity ────────────────────────────────────
export const node = pgTable(
  "node",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type", { enum: ["document", "tag", "entity"] }).notNull(),
    label: text("label").notNull(),
    documentId: uuid("document_id").references(() => document.id, {
      onDelete: "cascade",
    }), // for type=document
    entityId: uuid("entity_id"), // for type=entity -> entity.id (soft ref)
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("node_user_idx").on(t.userId),
    index("node_type_idx").on(t.userId, t.type),
  ],
);

// ── Graph edges: typed relationships ────────────────────────────────────────
export const edge = pgTable(
  "edge",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => node.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => node.id, { onDelete: "cascade" }),
    relation: text("relation", {
      enum: ["wikilink", "tag", "mentions", "related"],
    }).notNull(),
    origin: text("origin", { enum: ["deterministic", "llm"] }).notNull(),
    label: text("label"), // raw relation phrase for llm 'related' edges
    weight: integer("weight").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("edge_user_idx").on(t.userId),
    index("edge_source_idx").on(t.sourceId),
    index("edge_target_idx").on(t.targetId),
  ],
);

// ── Canonical entities (post resolution/dedupe) ─────────────────────────────
export const entity = pgTable(
  "entity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: text("entity_type"), // person | organization | concept | place | event | other
    description: text("description"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("entity_user_idx").on(t.userId),
    index("entity_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ── Chat ────────────────────────────────────────────────────────────────────
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    model: text("model"), // selected chat model slug (per-conversation); null = default
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("conversation_user_idx").on(t.userId)],
);

export const message = pgTable(
  "message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    /** Citation[] — see @lattice/db types. */
    citations: jsonb("citations"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("message_conversation_idx").on(t.conversationId)],
);

// ── Ingestion job tracking (surfaced in the UI) ─────────────────────────────
export const ingestJob = pgTable(
  "ingest_job",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "processing", "ready", "error"],
    })
      .notNull()
      .default("queued"),
    step: text("step"), // parse | chunk | embed | extract | resolve
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ingest_job_user_idx").on(t.userId)],
);

// ── Inferred types ──────────────────────────────────────────────────────────
export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type Folder = typeof folder.$inferSelect;
export type Chunk = typeof chunk.$inferSelect;
export type NewChunk = typeof chunk.$inferInsert;
export type Node = typeof node.$inferSelect;
export type NewNode = typeof node.$inferInsert;
export type Edge = typeof edge.$inferSelect;
export type NewEdge = typeof edge.$inferInsert;
export type Entity = typeof entity.$inferSelect;
export type NewEntity = typeof entity.$inferInsert;
export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
export type IngestJob = typeof ingestJob.$inferSelect;

export type NodeType = Node["type"];
export type RelationType = Edge["relation"];
export type EdgeOrigin = Edge["origin"];
export type IngestStatus = Document["ingestStatus"];

/** Shape stored in message.citations (jsonb). */
export interface Citation {
  label: string;
  documentId?: string;
  chunkId?: string;
  nodeId?: string;
  snippet?: string;
}
