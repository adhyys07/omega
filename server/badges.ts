export type Badge = {
    slug: string;
    label: string;
    icon: string;
    criteria: string;
    bg: string;
    color: string;
};

export const BADGES: Badge[] = [
    { slug: 'android_builder',    label: 'Android Builder',    icon: '▲', criteria: 'Ships a working Android app.',                    bg: 'rgba(74,150,80,.16)',  color: '#3d7a40' },
    { slug: 'ios_shipper',        label: 'iOS Shipper',        icon: '◉', criteria: 'Ships a working iOS app.',                        bg: 'rgba(255,107,53,.16)', color: '#c2451a' },
    { slug: 'gemini_integration', label: 'Gemini Integration',  icon: '✦', criteria: 'Meaningfully integrates Gemini.',                 bg: 'rgba(47,109,176,.16)', color: '#2f6db0' },
    { slug: 'cider_crossover',    label: 'Cider Crossover',     icon: '▣', criteria: 'Built with / integrates Cider.',                  bg: 'rgba(255,179,71,.2)',  color: '#b07410' },
    { slug: 'dual_platform',      label: 'Dual Platform',       icon: '◆', criteria: 'Ships on BOTH Android and iOS.',                  bg: 'rgba(255,107,53,.16)', color: '#c2451a' },
    { slug: 'elite_tier',         label: 'Elite Tier',          icon: '⚡', criteria: 'Exceptional complexity and polish — rare.',       bg: 'rgba(255,179,71,.2)',  color: '#b07410' },
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
