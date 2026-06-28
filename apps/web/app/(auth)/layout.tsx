import { LogoMark } from "@lattice/ui";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <LogoMark size={32} />
          <span className="text-lg font-semibold tracking-tight">Lattice</span>
        </Link>
        {children}
        <p className="mt-8 text-center  text-faint">
          Your private workspace. Everything you write stays yours.
        </p>
      </div>
    </div>
  );
}
