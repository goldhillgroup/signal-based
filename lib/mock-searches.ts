export interface SearchFolder {
  id: string;
  query: string;
  label: string;
  createdAt: string;
  finishedAt: string;
}

// Seed folders — each is a saved past search. New ones created from the
// SearchHome bar get appended at runtime via SearchesProvider.
export const MOCK_SEARCHES: SearchFolder[] = [
  {
    id: "search-tx",
    query: "Landscaping and home builders in Texas showing succession signals",
    label: "Texas — landscaping & builders",
    createdAt: "2026-08-04",
    finishedAt: "2026-08-04",
  },
  {
    id: "search-nc-oh",
    query: "Family-owned home builders in North Carolina and Ohio",
    label: "NC & OH — home builders",
    createdAt: "2026-08-01",
    finishedAt: "2026-08-01",
  },
  {
    id: "search-ga",
    query: "Georgia landscaping companies where the founder is handing off",
    label: "Georgia — landscaping",
    createdAt: "2026-07-28",
    finishedAt: "2026-07-28",
  },
];
