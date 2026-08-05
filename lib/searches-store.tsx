"use client";

// Client-side stand-in for the real thing: a `searches` row in Supabase +
// a `search_id` on each `companies` row (see supabase/migrations). Lives at
// the dashboard layout level so it survives client-side navigation between
// the search home and a folder's detail page without a real backend yet.
// Swap `addSearch` for an insert + realtime subscription once the pipeline exists.

import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { MOCK_SEARCHES, SearchFolder } from "./mock-searches";
import { runSearch } from "./search-engine";
import { Company } from "./mock-companies";

interface SearchesContextValue {
  folders: SearchFolder[];
  getFolder: (id: string) => SearchFolder | undefined;
  getCompanies: (id: string) => Company[];
  addSearch: (query: string) => string; // returns new folder id
}

const SearchesContext = createContext<SearchesContextValue | null>(null);

let nextId = 1;

export function SearchesProvider({ children }: { children: ReactNode }) {
  const [folders, setFolders] = useState<SearchFolder[]>(MOCK_SEARCHES);

  const value = useMemo<SearchesContextValue>(
    () => ({
      folders,
      getFolder: (id) => folders.find((f) => f.id === id),
      getCompanies: (id) => {
        const folder = folders.find((f) => f.id === id);
        return folder ? runSearch(folder.query) : [];
      },
      addSearch: (query) => {
        const id = `search-live-${nextId++}`;
        const now = new Date().toISOString().slice(0, 10);
        const label = query.length > 42 ? `${query.slice(0, 42)}…` : query;
        setFolders((prev) => [
          { id, query, label, createdAt: now, finishedAt: now },
          ...prev,
        ]);
        return id;
      },
    }),
    [folders]
  );

  return <SearchesContext.Provider value={value}>{children}</SearchesContext.Provider>;
}

export function useSearches() {
  const ctx = useContext(SearchesContext);
  if (!ctx) throw new Error("useSearches must be used within SearchesProvider");
  return ctx;
}
