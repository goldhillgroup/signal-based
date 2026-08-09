import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";
import { SearchesProvider } from "@/lib/searches-store";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { reapStaleRuns } from "@/lib/pipeline/reap";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured) {
    return <SupabaseNotConfigured />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Close out any run the platform killed before it could mark itself finished
  // (see lib/pipeline/reap.ts). This is the recovery path for the failure that
  // stranded a real search at "16 of 20" forever, taking its 16 paid-for leads
  // with it and blocking Enrich, which refuses to run on a search that is not
  // 'complete'.
  //
  // Here, rather than on a cron, because this is where it matters: any page
  // that could SHOW a stale run has just rendered. One indexed lookup that
  // almost always matches nothing, and it self-heals without the client
  // needing to know the failure mode exists. Never allowed to break the
  // dashboard — a reaper that takes down the page it exists to fix is worse
  // than the stuck row.
  try {
    await reapStaleRuns(createServiceRoleClient());
  } catch (e) {
    console.error("Stale-run reaper failed, dashboard rendering anyway:", e);
  }

  return (
    <SearchesProvider>
      {/* The whole app is exactly one viewport tall and never scrolls itself.
          Only the content column below does.

          It used to be min-h-screen, which lets the OUTER container grow with
          whatever is inside it, so a long page (Settings, with ten API-key
          cards) scrolled the entire layout and carried the sidebar off the top
          of the screen with it. Navigation should not be something you have to
          scroll back up to reach.

          h-dvh rather than h-screen: on mobile 100vh is the tallest the
          viewport ever gets, so a fixed-height layout using it hides its last
          rows behind the browser's address bar. dvh tracks the real height. */}
      <div className="flex h-dvh w-full overflow-hidden bg-gh-page">
        <Sidebar userEmail={user.email ?? null} />
        {/* min-w-0 is load-bearing. A flex child defaults to min-width:auto,
            which refuses to shrink below its content's intrinsic width: the
            Topbar's logo + "New search" + bell set that floor at 577px, so on
            a 375px phone the whole app scrolled sideways. Without this the
            page is unusable on mobile and nothing else about the layout
            reveals why.

            overflow-y-auto makes THIS the scroll container, which is also what
            keeps the Topbar's `sticky top-0` pinned to the top of the content
            rather than to a page that is scrolling underneath it. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Topbar />
          <main className="flex-1 p-5 lg:p-8">{children}</main>
        </div>
      </div>
    </SearchesProvider>
  );
}
