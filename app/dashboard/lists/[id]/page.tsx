"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSearches, SearchFolder } from "@/lib/searches-store";
import { Company } from "@/lib/mock-companies";
import { FolderView } from "@/components/FolderView";
import { SearchProgress } from "@/components/SearchProgress";
import { ArrowLeftIcon } from "@/components/icons";

export default function FolderPage() {
  const params = useParams<{ id: string }>();
  const { fetchFolder, fetchCompanies } = useSearches();
  const [folder, setFolder] = useState<SearchFolder | null | "loading">("loading");
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const f = await fetchFolder(params.id);
      if (cancelled) return;
      setFolder(f);
      if (f && f.status === "complete") {
        const c = await fetchCompanies(params.id);
        if (!cancelled) setCompanies(c);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (folder === "loading") {
    return null;
  }

  if (!folder) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="font-display text-lg font-semibold text-gh-ink">List not found</p>
        <p className="mt-2 text-sm text-gh-ink-secondary">
          This search doesn&rsquo;t exist, or you don&rsquo;t have access to it.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gh-sky hover:underline"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to your lists
        </Link>
      </div>
    );
  }

  // Search is still running (e.g. the user navigated here directly via a
  // bookmark/refresh mid-run) — resume the same live progress view rather
  // than showing an empty table.
  if (folder.status === "running") {
    return (
      <SearchProgress
        searchId={folder.id}
        query={folder.query}
        onComplete={async () => {
          const c = await fetchCompanies(folder.id);
          setCompanies(c);
          const refreshed = await fetchFolder(folder.id);
          setFolder(refreshed);
        }}
        onError={async () => {
          const refreshed = await fetchFolder(folder.id);
          setFolder(refreshed);
        }}
      />
    );
  }

  if (folder.status === "failed") {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="font-display text-lg font-semibold text-gh-ink">This search failed</p>
        <p className="mt-2 text-sm text-gh-ink-secondary">
          {folder.errorMessage ?? "Something went wrong partway through — try running it again."}
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gh-sky hover:underline"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to your lists
        </Link>
      </div>
    );
  }

  return <FolderView folder={folder} companies={companies} />;
}
