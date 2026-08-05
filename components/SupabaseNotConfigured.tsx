import Image from "next/image";

export function SupabaseNotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gh-page px-4">
      <div className="w-full max-w-md rounded-xl border border-gh-border bg-gh-surface p-8 text-center shadow-sm">
        <Image
          src="/brand/goldhill-mark.png"
          alt=""
          width={36}
          height={36}
          className="mx-auto rounded-lg bg-gh-navy p-1.5"
        />
        <h1 className="mt-4 font-display text-lg font-semibold text-gh-ink">
          Signal Radar isn&rsquo;t connected yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gh-ink-secondary">
          This is the skeletal build — schema and auth pages are wired, but no
          Supabase project is attached. Copy{" "}
          <code className="rounded bg-gh-surface-sunken px-1.5 py-0.5 text-xs">
            .env.example
          </code>{" "}
          to{" "}
          <code className="rounded bg-gh-surface-sunken px-1.5 py-0.5 text-xs">
            .env.local
          </code>
          , fill in the Supabase URL + anon key, then run the migration in{" "}
          <code className="rounded bg-gh-surface-sunken px-1.5 py-0.5 text-xs">
            supabase/migrations/
          </code>
          .
        </p>
        <p className="mt-4 text-xs text-gh-ink-muted">Restart the dev server after adding env vars.</p>
      </div>
    </div>
  );
}
