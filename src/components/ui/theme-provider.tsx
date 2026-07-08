import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

/** Dark-first theme provider. Wrap the app once. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
