import type {
  Industry,
  CompanyStatus,
  Confidence,
  FindStatus,
  VerificationStatus,
} from "./supabase/types";

// Goldhill-brand categorical palette, validated (dataviz skill): 2-slot order
// passes every adjacent-pair + normal-vision check in light mode.
export const INDUSTRY_META: Record<Industry, { label: string; color: string }> = {
  landscaping: { label: "Landscaping", color: "var(--gh-cat-1)" }, // #2451a4
  home_builder: { label: "Home Builder", color: "var(--gh-cat-3)" }, // #1b8a5a
};

// Confidence reuses the fixed status palette on purpose — it IS a status
// (how much to trust the classification), never a themed categorical hue.
export const CONFIDENCE_META: Record<
  Confidence,
  { label: string; description: string; color: string; bg: string }
> = {
  high: {
    label: "High",
    description: "Two generations named together + explicit succession language, disprove pass held.",
    color: "#0b7a0b",
    bg: "#e2f6e2",
  },
  medium: {
    label: "Medium",
    description: "Signal present but one element is implied rather than stated outright.",
    color: "#8a6400",
    bg: "#fef3d6",
  },
  verify: {
    label: "Verify",
    description: "Borderline match — flagged for a human look before it's worked as qualified.",
    color: "#9a4a1f",
    bg: "#fbe4d7",
  },
};

export const STATUS_META: Record<
  CompanyStatus,
  { label: string; color: string; bg: string }
> = {
  pending: { label: "Scanning", color: "var(--gh-ink-muted)", bg: "var(--gh-surface-sunken)" },
  qualified: { label: "Qualified", color: "#0b7a0b", bg: "#e2f6e2" },
  rejected: { label: "Rejected", color: "var(--gh-ink-muted)", bg: "var(--gh-surface-sunken)" },
};

export const FIND_STATUS_META: Record<
  FindStatus,
  { label: string; color: string; bg: string }
> = {
  not_attempted: { label: "Not attempted", color: "var(--gh-ink-muted)", bg: "var(--gh-surface-sunken)" },
  found: { label: "Contact found", color: "#0b5e85", bg: "#e2f3fb" },
  not_found: { label: "Contact not found", color: "#8a6400", bg: "#fef3d6" },
};

export const VERIFICATION_META: Record<
  VerificationStatus,
  { label: string; color: string; bg: string }
> = {
  not_attempted: { label: "Not verified", color: "var(--gh-ink-muted)", bg: "var(--gh-surface-sunken)" },
  valid: { label: "Valid", color: "#0b7a0b", bg: "#e2f6e2" },
  invalid: { label: "Invalid", color: "#a3272a", bg: "#fbdcdc" },
  risky: { label: "Risky", color: "#9a4a1f", bg: "#fbe4d7" },
  unknown: { label: "Unknown", color: "var(--gh-ink-muted)", bg: "var(--gh-surface-sunken)" },
};

// Common, real rejection reasons per the scope's own classification bar.
export const REJECTION_REASONS = [
  "Only the founder is listed — no next-gen name on the leadership page",
  "Next-gen name present, but no succession or transition language found",
  "No About / Team / Leadership page found on the site",
  "Professionally managed — no family-owned language or indicators",
  "Outside target revenue band",
  "Outside agreed states",
  "Duplicate of an already-tracked company",
] as const;
