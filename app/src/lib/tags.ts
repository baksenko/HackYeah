/**
 * What each bit of `Campaign.tags` means. The program stores only the
 * bitmask; this catalogue is how the app reads it.
 *
 * Bits are permanent: changing a tag's `bit` would relabel every campaign
 * already on chain. Add new tags on unused bits, never renumber.
 */
export type TagScope = 'public' | 'private'

export type Tag = {
  bit: number
  slug: string
  label: string
  emoji: string
  scope: TagScope
}

export const TAGS: Tag[] = [
  // Public — crowdfunding causes (bits 0–15)
  { bit: 0, slug: 'medical', label: 'Medical', emoji: '🏥', scope: 'public' },
  { bit: 1, slug: 'education', label: 'Education', emoji: '🎓', scope: 'public' },
  { bit: 2, slug: 'community', label: 'Community', emoji: '🏘️', scope: 'public' },
  { bit: 3, slug: 'animals', label: 'Animals', emoji: '🐾', scope: 'public' },
  { bit: 4, slug: 'environment', label: 'Environment', emoji: '🌱', scope: 'public' },
  { bit: 5, slug: 'emergency', label: 'Emergency', emoji: '🚨', scope: 'public' },
  { bit: 6, slug: 'arts', label: 'Arts & culture', emoji: '🎨', scope: 'public' },
  { bit: 7, slug: 'sports', label: 'Sports', emoji: '⚽', scope: 'public' },
  { bit: 8, slug: 'tech', label: 'Tech', emoji: '💻', scope: 'public' },
  { bit: 9, slug: 'local-business', label: 'Local business', emoji: '🏪', scope: 'public' },

  // Private — friend groups (bits 16–31)
  { bit: 16, slug: 'trip', label: 'Trip', emoji: '✈️', scope: 'private' },
  { bit: 17, slug: 'gift', label: 'Gift', emoji: '🎁', scope: 'private' },
  { bit: 18, slug: 'birthday', label: 'Birthday', emoji: '🎂', scope: 'private' },
  { bit: 19, slug: 'party', label: 'Party', emoji: '🎉', scope: 'private' },
  { bit: 20, slug: 'flatmates', label: 'Flatmates', emoji: '🏠', scope: 'private' },
  { bit: 21, slug: 'tickets', label: 'Concert & tickets', emoji: '🎫', scope: 'private' },
  { bit: 22, slug: 'dinner', label: 'Food & dinner', emoji: '🍕', scope: 'private' },
  { bit: 23, slug: 'wedding', label: 'Wedding', emoji: '💍', scope: 'private' },
  { bit: 24, slug: 'shared-purchase', label: 'Shared purchase', emoji: '🛒', scope: 'private' },
  { bit: 25, slug: 'gear', label: 'Sports gear', emoji: '🏂', scope: 'private' },
]

/** Mirrors `MAX_TAGS` in program/programs/fundraiser/src/constants.rs. */
export const MAX_TAGS = 5

const BY_SLUG = new Map(TAGS.map((t) => [t.slug, t]))

export const tagsForScope = (scope: TagScope) => TAGS.filter((t) => t.scope === scope)

export const tagBySlug = (slug: string) => BY_SLUG.get(slug)

/** Bitmask from chain -> tags, in catalogue order. Unknown bits are ignored. */
export const decodeTags = (mask: number): Tag[] => TAGS.filter((t) => (mask >>> t.bit) & 1)

/** Tags -> bitmask for `create_campaign`. `>>> 0` keeps bit 31 unsigned. */
export const encodeTags = (tags: Tag[]): number =>
  tags.reduce((mask, t) => (mask | (1 << t.bit)) >>> 0, 0)
