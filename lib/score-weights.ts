/**
 * What a lead is scored on, and how much each thing is worth.
 *
 * ADJUSTABLE, because the right weights are Jonathan's opinion rather than a
 * fact. He works these territories; whether a phone number matters more than a
 * town is his call, and hard-coding it would make the score an argument he
 * cannot join.
 *
 * SOFTER THAN THE FIRST VERSION, deliberately. That one gave a lead nothing
 * for passing every gate, so a real family-owned business in the right trade
 * and territory -- checked, judged, and kept -- could score 15 out of 100
 * because nobody had bought an address for it yet. Measured across the
 * database, the median was 15 and 86% sat in the bottom band, which reads as
 * "most of your list is rubbish" when it means "most of your list has not been
 * enriched". `base` is the fix: a lead that survived the gates starts with
 * something, because surviving the gates is itself a finding.
 *
 * Stored in app_settings under SCORE_WEIGHTS as JSON. No migration: that table
 * already exists and already holds the vendor keys.
 */

export interface ScoreWeights {
  /** For passing every gate at all. A kept lead is not a zero. */
  base: number;
  /** Founder and successor both named and running it, wording firm. */
  signalFirm: number;
  /** Same, but the classifier flagged the wording as arguable. */
  signalVerify: number;
  /** A verbatim quote on file, which is what makes a lead checkable. */
  quote: number;
  /** The quote survived the adversarial second pass. */
  disproved: number;
  /** Both generations named. */
  bothNamed: number;
  /** Only one of them. */
  oneNamed: number;
  /** A personal address confirmed deliverable. */
  emailValid: number;
  /** A personal address not yet checked. */
  emailUnverified: number;
  /** Office inbox only. */
  emailGeneral: number;
  phone: number;
  location: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  base: 25,
  signalFirm: 30,
  signalVerify: 18,
  quote: 10,
  disproved: 3,
  bothNamed: 10,
  oneNamed: 5,
  emailValid: 15,
  emailUnverified: 10,
  emailGeneral: 4,
  phone: 4,
  location: 4,
};

/** Shown in Settings, so each field can say what it is without a manual. */
export const WEIGHT_LABELS: { key: keyof ScoreWeights; label: string; hint: string }[] = [
  { key: "base", label: "Passed every gate", hint: "Every kept lead starts here. Raise it if too many look weak." },
  { key: "signalFirm", label: "Founder + successor, firmly worded", hint: "The signal this product exists to find." },
  { key: "signalVerify", label: "Reads like a handover, wording arguable", hint: "A signal the classifier was not certain about." },
  { key: "quote", label: "Verbatim quote on file", hint: "What makes the lead checkable against the live page." },
  { key: "disproved", label: "Survived the disprove pass", hint: "The second opinion tried to kill it and failed." },
  { key: "bothNamed", label: "Both generations named", hint: "Two people you can ask for by name." },
  { key: "oneNamed", label: "One person named", hint: "Somebody to ask for, but not the pair." },
  { key: "emailValid", label: "Personal email, confirmed", hint: "Checked as deliverable." },
  { key: "emailUnverified", label: "Personal email, unchecked", hint: "Found, not yet verified." },
  { key: "emailGeneral", label: "Office inbox only", hint: "Reaches the front desk, not the person." },
  { key: "phone", label: "Phone number", hint: "Worth more if you would rather ring than write." },
  { key: "location", label: "Town and state known", hint: "Matters if you plan a week around territories." },
];

/** Anything missing or nonsense falls back rather than scoring as zero. */
export function parseWeights(raw: unknown): ScoreWeights {
  if (!raw || typeof raw !== "object") return DEFAULT_WEIGHTS;
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) out[k] = Math.round(v);
  }
  return out;
}
