import { listDocuments } from "@lattice/db";
import { DashboardContent } from "@/components/dashboard-content";
import { requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser();
  const documents = await listDocuments(user.id);
  return <DashboardContent name={user.name || "there"} documents={documents} />;
}
