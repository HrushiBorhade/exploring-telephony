"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "./get-query-client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // NOTE: Do NOT use useState for the query client — if React suspends
  // during initial render, it will throw away the client. getQueryClient()
  // handles server vs browser singleton correctly.
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
