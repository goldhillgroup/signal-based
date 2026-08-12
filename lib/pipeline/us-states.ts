// Full US state list — used by the SearchHome geography dropdown, the
// free-text intake parser and the search route's validation. Single source
// of truth for all three.
// The four states named in the method Jonathan describes ('California, New
// York, Texas, and Florida') and covered by the delivered proof. Surfaced
// first in the picker as the agreed baseline — every other state stays
// selectable, since the point is a default, not a restriction.
/**
 * The client's priority states, in his own order: "California; New York and
 * the Northeast; Florida; Texas."
 *
 * "The Northeast" was the half that had nowhere to go — the list held only NY,
 * so a phrase covering nine states searched one. The rest are the Northeast as
 * the Census defines it, which is also how a business there would describe
 * itself: New England plus the Mid-Atlantic.
 *
 * They are PRIORITY, not restriction — the ICP says "located in the United
 * States, with priority given to" these — so the state picker still offers all
 * fifty and this is only what a search starts with.
 */
export const AGREED_STATES = [
  "CA",
  "NY", "NJ", "PA", "CT", "MA", "RI", "NH", "VT", "ME",
  "FL",
  "TX",
];

export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

export function stateNameFor(code: string): string {
  return US_STATES.find((s) => s.code === code)?.name ?? code;
}

/**
 * Sentinel for "anywhere in the United States", used wherever a states array
 * is carried through the UI.
 *
 * "US" is not a state code, so it can never collide with a real one, and it
 * keeps nationwide expressible as a POSITIVE selection. The alternative —
 * representing it as an empty array — makes "he asked for the whole country"
 * and "the form failed to send any states" indistinguishable, and those two
 * must never run the same search.
 *
 * POST /api/search converts it to [] before the pipeline sees it; every
 * discovery channel already treats an empty states array as nationwide.
 */
export const NATIONWIDE = "US";
