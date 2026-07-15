export type Tier = {
    slug: string;
    label: string;
    icon: string;
    multiplier: number;
    blurb: string;
    bg: string;
    color: string;
}

export const TIERS: Tier[] = [
    { slug: 'starter', label: 'Starter', icon: '◔', multiplier: 1.0,  blurb: 'Basic mechanics, clean UI, working features.',            bg: 'rgba(91,79,68,.12)',   color: '#5b4f44' },
    { slug: 'builder', label: 'Builder', icon: '◑', multiplier: 1.25, blurb: 'Multiple systems, polished design, real-world value.',    bg: 'rgba(255,107,53,.16)', color: '#c2451a' },
    { slug: 'elite',   label: 'Elite',   icon: '⚡', multiplier: 1.5,  blurb: 'Exceptional complexity, shipping quality — truly rare.',  bg: 'rgba(255,179,71,.2)',  color: '#b07410' },
];

const BY_SLUG = new Map(TIERS.map(t => [t.slug, t]));

export function tierBySlug(slug: unknown): Tier | null {
    return typeof slug === 'string' ? (BY_SLUG.get(slug) ?? null) : null;
}

export function computePayout(approvedHours: number, tier: Tier): number {
    return Math.round(approvedHours * tier.multiplier);
}

export const MAX_HOURS = 500;
export const MIN_HOURS = 20;