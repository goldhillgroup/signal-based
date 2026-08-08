import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";
import { SearchesProvider } from "@/lib/searches-store";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

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

  return (
    <SearchesProvider>
      <div className="flex min-h-screen w-full bg-gh-page">
        <Sidebar userEmail={user.email ?? null} />
        {/* min-w-0 is load-bearing. A flex child defaults to min-width:auto,
            which refuses to shrink below its content's intrinsic width — the
            Topbar's logo + "New search" + bell set that floor at 577px, so on
            a 375px phone the whole app scrolled sideways. Without this the
            page is unusable on mobile and nothing else about the layout
            reveals why. */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-5 lg:p-8">{children}</main>
        </div>
      </div>
    </SearchesProvider>
  );
}
