"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSearches } from "@/lib/searches-store";
import { FolderView } from "@/components/FolderView";
import { ArrowLeftIcon } from "@/components/icons";

export default function FolderPage() {
  const params = useParams<{ id: string }>();
  const { getFolder, getCompanies } = useSearches();
  const folder = getFolder(params.id);

  if (!folder) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="font-display text-lg font-semibold text-gh-ink">List not found</p>
        <p className="mt-2 text-sm text-gh-ink-secondary">
          This search doesn&rsquo;t exist, or was created in a session that&rsquo;s no
          longer active.
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

  return <FolderView folder={folder} companies={getCompanies(folder.id)} />;
}
