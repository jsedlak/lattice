import { countNodes, listDocuments } from "@lattice/db";
import { Sidebar } from "@/components/sidebar";
import { UploadDropzone } from "@/components/upload-dropzone";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [documents, nodeCount] = await Promise.all([
    listDocuments(user.id),
    countNodes(user.id),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={{ name: user.name, email: user.email, image: user.image }}
        documents={documents.map((d) => ({ id: d.id, title: d.title, kind: d.kind }))}
        nodeCount={nodeCount}
      />
      <main className="flex-1 overflow-hidden">{children}</main>
      <UploadDropzone />
    </div>
  );
}
