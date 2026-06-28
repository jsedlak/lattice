import { ConfirmProvider, ThemeProvider } from "@lattice/ui";
import type { Metadata, Viewport } from "next";
import { fontMono, fontSans } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lattice",
    template: "%s · Lattice",
  },
  description: "Your knowledge graph second brain — write, connect, and ask.",
  // Favicon + apple-touch-icon are auto-detected from app/icon.png and
  // app/apple-icon.png (generated from the brand logo).
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0e11" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
