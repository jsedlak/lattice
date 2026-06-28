import { EventSchemas, Inngest } from "inngest";

/** Inngest event contract. Every event carries the userId so functions re-scope
 *  all work to the owner (isolation in the background tier). */
type Events = {
  "doc/uploaded": { data: { userId: string; documentId: string } };
  "doc/saved": { data: { userId: string; documentId: string } };
  "doc/chunked": { data: { userId: string; documentId: string } };
};

export const inngest = new Inngest({
  id: "lattice",
  schemas: new EventSchemas().fromRecord<Events>(),
});

export type LatticeEvents = Events;
