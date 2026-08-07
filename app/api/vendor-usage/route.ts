import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { VENDOR_FETCHERS, unreadable, type VendorUsage } from "@/lib/vendor-usage";

// Ten vendor round-trips at up to 10s each, but they run concurrently, so the
// realistic worst case is one slow vendor plus overhead. 30s leaves room for
// that without letting a wedged vendor hold the request open indefinitely.
export const maxDuration = 30;

export async function GET() {
  // Same gate as app/api/settings/route.ts. It matters as much here: these
  // numbers are the shape of someone's spending, and reading them costs a real
  // API call against real keys.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // allSettled, not all: the entire point of this page is that six vendors
  // fail independently. One of them being down has to cost that one card, not
  // the section. Each fetcher already swallows its own errors, so a rejection
  // here means something genuinely unexpected — surface it on that vendor's
  // card rather than losing the other nine.
  const settled = await Promise.allSettled(VENDOR_FETCHERS.map((v) => v.run(v)));

  const vendors: VendorUsage[] = [];
  settled.forEach((result, i) => {
    const { id, vendor, dashboardUrl } = VENDOR_FETCHERS[i];
    if (result.status === "fulfilled") {
      // null = an optional vendor that isn't configured; no card for it.
      if (result.value) vendors.push(result.value);
      return;
    }
    const message = (result.reason as Error)?.message ?? String(result.reason);
    vendors.push(unreadable({ id, vendor, dashboardUrl }, `Unexpected error: ${message.slice(0, 120)}`));
  });

  return NextResponse.json({ vendors });
}
