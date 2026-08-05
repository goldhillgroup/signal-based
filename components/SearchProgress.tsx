"use client";

import { useEffect, useRef, useState } from "react";
import { Company } from "@/lib/mock-companies";
import { estimateScannedPool } from "@/lib/search-engine";
import { RadarIcon } from "./icons";

interface Props {
  query: string;
  results: Company[];
  onComplete: () => void;
}

type StepKey = "discover" | "fetch" | "classify" | "contacts" | "verify";

const STEP_LABELS: Record<StepKey, string> = {
  discover: "Discovering candidate companies",
  fetch: "Fetching leadership pages",
  classify: "Classifying signals",
  contacts: "Finding next-gen contacts",
  verify: "Verifying deliverability",
};
const STEP_ORDER: StepKey[] = ["discover", "fetch", "classify", "contacts", "verify"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SearchProgress({ query, results, onComplete }: Props) {
  const [activeStep, setActiveStep] = useState<StepKey>("discover");
  const [done, setDone] = useState<Set<StepKey>>(new Set());
  const [counts, setCounts] = useState({
    scanned: 0,
    fetched: 0,
    qualified: 0,
    verify: 0,
    rejected: 0,
    contactsFound: 0,
    contactsValid: 0,
  });
  const startedRef = useRef(false);

  const scannedTarget = estimateScannedPool(results.length);
  const qualifiedTarget = results.filter((c) => c.status === "qualified" && c.confidence !== "verify").length;
  const verifyTarget = results.filter((c) => c.status === "qualified" && c.confidence === "verify").length;
  const rejectedTarget = results.filter((c) => c.status === "rejected").length;
  const contactsFoundTarget = results.filter((c) => c.contact?.findStatus === "found").length;
  const contactsValidTarget = results.filter((c) => c.contact?.verificationStatus === "valid").length;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function tickTo(
      key: keyof typeof counts,
      target: number,
      durationMs: number
    ) {
      if (target === 0) {
        await sleep(durationMs * 0.4);
        return;
      }
      const steps = Math.min(target, 14);
      const stepDelay = durationMs / steps;
      for (let i = 1; i <= steps; i++) {
        await sleep(stepDelay);
        const value = Math.round((target * i) / steps);
        setCounts((prev) => ({ ...prev, [key]: value }));
      }
      setCounts((prev) => ({ ...prev, [key]: target }));
    }

    async function run() {
      setActiveStep("discover");
      await tickTo("scanned", scannedTarget, 900);
      setDone((d) => new Set(d).add("discover"));

      setActiveStep("fetch");
      await tickTo("fetched", scannedTarget, 900);
      setDone((d) => new Set(d).add("fetch"));

      setActiveStep("classify");
      await Promise.all([
        tickTo("qualified", qualifiedTarget, 1100),
        tickTo("verify", verifyTarget, 1100),
        tickTo("rejected", rejectedTarget, 1100),
      ]);
      setDone((d) => new Set(d).add("classify"));

      setActiveStep("contacts");
      await tickTo("contactsFound", contactsFoundTarget, 800);
      setDone((d) => new Set(d).add("contacts"));

      setActiveStep("verify");
      await tickTo("contactsValid", contactsValidTarget, 700);
      setDone((d) => new Set(d).add("verify"));

      await sleep(400);
      onComplete();
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stepDetail(key: StepKey): string {
    switch (key) {
      case "discover":
        return `${counts.scanned} candidates found`;
      case "fetch":
        return `${counts.fetched}/${scannedTarget} pages fetched`;
      case "classify":
        return `${counts.qualified} qualified · ${counts.verify} verify · ${counts.rejected} rejected`;
      case "contacts":
        return `${counts.contactsFound}/${qualifiedTarget + verifyTarget} found`;
      case "verify":
        return `${counts.contactsValid}/${contactsFoundTarget || counts.contactsFound} valid`;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gh-navy-3/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gh-border bg-gh-surface p-7 shadow-2xl">
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span
            className="absolute rounded-full border border-gh-sky"
            style={{ width: 80, height: 80, opacity: 0.12, animation: "gh-ping 2.4s cubic-bezier(0,0,0.2,1) infinite 0.6s" }}
          />
          <span
            className="absolute rounded-full border border-gh-sky"
            style={{ width: 56, height: 56, opacity: 0.2, animation: "gh-ping 2.4s cubic-bezier(0,0,0.2,1) infinite 0.3s" }}
          />
          <span
            className="absolute rounded-full border-[1.5px] border-gh-sky"
            style={{ width: 38, height: 38, opacity: 0.35, animation: "gh-ping 2.4s cubic-bezier(0,0,0.2,1) infinite" }}
          />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gh-navy text-white shadow-lg">
            <RadarIcon className="h-5 w-5" />
          </span>
        </div>

        <p className="mt-5 text-center text-xs font-medium text-gh-ink-muted">Searching for</p>
        <p className="mt-1 text-center text-sm font-semibold leading-snug text-gh-ink">
          &ldquo;{query}&rdquo;
        </p>

        <div className="mt-6 space-y-1">
          {STEP_ORDER.map((key) => {
            const isDone = done.has(key);
            const isActive = activeStep === key && !isDone;
            return (
              <div
                key={key}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  isActive ? "bg-gh-surface-sunken" : ""
                }`}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: isDone ? "#0b7a0b" : isActive ? "var(--gh-sky)" : "var(--gh-surface-sunken)",
                  }}
                >
                  {isDone ? (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                      <path d="M2.5 6l2.2 2.2L9.5 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isActive ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-semibold ${
                      isDone || isActive ? "text-gh-ink" : "text-gh-ink-muted"
                    }`}
                  >
                    {STEP_LABELS[key]}
                  </p>
                  {(isDone || isActive) && (
                    <p className="tabular text-[11px] text-gh-ink-muted">{stepDetail(key)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes gh-ping {
          0% { transform: scale(0.7); opacity: 0.4; }
          80%, 100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
