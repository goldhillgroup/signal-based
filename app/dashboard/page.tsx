import { SearchHome } from "@/components/SearchHome";
import { getSuggestions } from "@/lib/pipeline/suggestions";
import { DEFAULT_ICP } from "@/lib/pipeline/icp-types";

// Computed on the server so the search form opens with real suggestions
// already in it, rather than flashing hardcoded examples and replacing them.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Never let a suggestion query stop the search page rendering — suggestions
  // are a convenience, and the form works perfectly without them.
  const suggestions = await getSuggestions().catch(() => []);
  // The saved ideal client is what a blank Signal focus falls back to, so the
  // form has to be able to SAY that rather than leaving him to guess.
  const icp = DEFAULT_ICP;
  return <SearchHome suggestions={suggestions} icp={icp} />;
}
