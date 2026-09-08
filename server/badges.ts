export type Badge = {
    slug: string;
    label: string;
    icon: string;
    criteria: string;
    bg: string;
    color: string;
};

/** Ω tokens credited the first time a badge lands on a submission. Flat across
 *  the catalog — if badges ever need different values, move this onto the Badge
 *  type as an optional `tokens` field and default it to this. */
export const TOKENS_PER_BADGE = 2;

export const BADGES: Badge[] = [
    { slug: 'first_ship',   label: 'First Ship',   icon: '▲', criteria: 'Get your first project approved.',                        bg: 'rgba(74,150,80,.16)',  color: '#35682f' },
    { slug: 'design_craft', label: 'Design Craft', icon: '◈', criteria: 'Interface work reviewers single out as exceptional.',     bg: 'rgba(47,109,176,.18)', color: '#28598f' },
    { slug: 'deep_build',   label: 'Deep Build',   icon: '▣', criteria: 'Real architecture under the hood — not glue code.',       bg: 'rgba(255,179,71,.22)', color: '#95610b' },
    { slug: 'in_the_wild',  label: 'In The Wild',  icon: '◉', criteria: 'Real people outside the program actually use it.',        bg: 'rgba(255,107,53,.18)', color: '#a83c14' },
    { slug: 'all_rounder',  label: 'All Rounder',  icon: '✦', criteria: 'Ships and runs on both Android and iOS.',                 bg: 'rgba(122,75,150,.18)', color: '#5a3f80' },
    { slug: 'elite_tier',   label: 'Elite Tier',   icon: '⚡', criteria: 'Exceptional complexity and polish — rare.',               bg: 'rgba(255,179,71,.22)', color: '#95610b' },
];

const BY_SLUG = new Map(BADGES.map((b) => [b.slug, b]));

export function isBadge(slug: string): boolean {
    return BY_SLUG.has(slug);
}

export function sanitizeBadges(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return [...new Set(input.filter((s): s is string => typeof s === 'string' && isBadge(s)))];
    
}

export function hydrate(slugs: string[]): Badge[] {
    return slugs.map((s) => BY_SLUG.get(s)).filter((b): b is Badge => !!b);
}
