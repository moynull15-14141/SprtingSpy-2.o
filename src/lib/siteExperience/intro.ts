import type { IntroAppearance } from './types';

export const DEFAULT_INTRO_APPEARANCE: IntroAppearance = {
  mediaId: '', style: 'editorial', focalX: 50, focalY: 50, mobileFocalX: 50, mobileFocalY: 50,
  zoom: 100, overlay: 55, height: 'standard', textSize: 'standard', align: 'preset', vertical: 'preset', width: 'medium',
};
export const INTRO_PRESETS = [
  { id: 'editorial', name: 'Editorial gradient', description: 'Left-aligned text with a side gradient.' },
  { id: 'stadium', name: 'Stadium centre', description: 'Centred headline with a dramatic full-image backdrop.' },
  { id: 'bottom-caption', name: 'Lower caption', description: 'Headline and buttons anchored near the bottom.' },
  { id: 'right-focus', name: 'Right focus', description: 'Text on the right leaves the left subject visible.' },
  { id: 'glass', name: 'Glass panel', description: 'A translucent panel softens the image behind the text.' },
  { id: 'framed', name: 'Framed cover', description: 'Centred type inside a fine editorial frame.' },
  { id: 'split', name: 'Side panel', description: 'A solid side panel with the photograph visible beside it.' },
  { id: 'spotlight', name: 'Spotlight', description: 'A radial vignette draws attention to centred text.' },
  { id: 'amber', name: 'Warm editorial', description: 'A warm amber wash with an accent rule.' },
  { id: 'minimal', name: 'Minimal cover', description: 'Compact lower text with a simple bottom fade.' },
] as const;

/** Tolerates corrupt stored JSON for media usage tracking without executing any values. */
export function introMediaReferences(doc: unknown): { mediaId: string; id: string; title: string }[] {
  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { sections?: unknown }).sections)) return [];
  return (doc as { sections: unknown[] }).sections.flatMap((s) => {
    if (!s || typeof s !== 'object') return [];
    const section = s as { type?: unknown; id?: unknown; title?: unknown; appearance?: { mediaId?: unknown } };
    return section.type === 'intro' && typeof section.appearance?.mediaId === 'string' && section.appearance.mediaId
      ? [{ mediaId: section.appearance.mediaId, id: String(section.id ?? 'intro'), title: String(section.title ?? 'Intro banner') }] : [];
  });
}
