import { EnrichmentBoard } from "@/components/EnrichmentBoard";
import { UsersIcon } from "@/components/icons";

export default function EnrichmentPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gh-navy/[0.06] text-gh-navy">
            <UsersIcon className="h-4 w-4" />
          </span>
          <h1 className="font-display text-xl font-semibold text-gh-ink">Enrichment</h1>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gh-ink-secondary">
          Find and verify an email for the people behind accepted companies.
          Runs only when you press it.
        </p>
      </header>
      <EnrichmentBoard />
    </div>
  );
}
