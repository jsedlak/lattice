import type { Metadata } from "next";
import { GraphView } from "@/components/graph/graph-view";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Graph" };

export default async function GraphPage() {
  await requireUser();
  return <GraphView />;
}
