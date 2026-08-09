import { SearchHome } from "@/components/SearchHome";
import { getSuggestions } from "@/lib/pipeline/suggestions";

// Computed on the server so the search form opens with real suggestions
// already in it, rather than flashing hardcoded examples and replacing them.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Never let a suggestion query stop the search page rendering — suggestions
  // are a convenience, and the form works perfectly without them.
  const suggestions = await getSuggestions().catch(() => []);
  return <SearchHome suggestions={suggestions} />;
}
