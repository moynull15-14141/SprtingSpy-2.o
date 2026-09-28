'use client';

import React, { useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { toMediaAsset } from '../../../lib/media';
import { DEFAULT_INTRO_APPEARANCE, INTRO_PRESETS } from '../../../lib/siteExperience/intro';
import type { HomeSection, IntroAppearance } from '../../../lib/siteExperience/types';
import { MediaPicker, thumbnailUrl } from '../media/MediaShared';
import { IntroBanner } from '../../site/IntroBanner';
import { Select, labelClass } from './fields';

type Intro = Extract<HomeSection, { type: 'intro' }>;
export function IntroAppearanceEditor({ section, onChange }: { section: Intro; onChange: (s: Intro) => void }) {
  const { mediaItems } = useApp();
  const [picking, setPicking] = useState(false);
  const [mobile, setMobile] = useState(false);
  const a = section.appearance ?? DEFAULT_INTRO_APPEARANCE;
  const selected = mediaItems.find((m) => m.id === a.mediaId);
  const usable = selected && selected.copyrightReview !== 'restricted';
  const change = (patch: Partial<IntroAppearance>) => onChange({ ...section, appearance: { ...a, ...patch } });
  const slider = (label: string, key: 'focalX' | 'focalY' | 'mobileFocalX' | 'mobileFocalY' | 'zoom' | 'overlay', min: number, max: number) =>
    <label className={labelClass}>{label} <span className="font-normal">{a[key]}%</span><input type="range" min={min} max={max} step={1} value={a[key]} onChange={(e) => change({ [key]: Number(e.target.value) })} className="mt-2 block w-full accent-amber-600" /></label>;
  return <fieldset className="min-w-0 space-y-4 rounded-xl border border-stone-300 p-4 dark:border-stone-700">
    <legend className="px-2 text-sm font-bold">Background image & banner style</legend>
    <div className="flex flex-wrap items-center gap-3">
      {selected && <img src={thumbnailUrl(selected)} alt="" className="h-16 w-28 rounded-lg object-cover" />}
      <div className="min-w-0"><p className="text-xs font-semibold">{selected?.title ?? (a.mediaId ? 'Selected image is unavailable' : 'No background image selected')}</p><p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Choose or upload through Media Library. The photograph sits behind your headline, text and buttons.</p></div>
      <button type="button" onClick={() => setPicking(true)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold dark:border-stone-700">{a.mediaId ? 'Change background image' : 'Choose background image'}</button>
      {a.mediaId && <button type="button" onClick={() => change({ mediaId: '' })} className="text-xs font-semibold text-rose-700 dark:text-rose-400">Remove background image</button>}
    </div>
    {a.mediaId && !usable && <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">This image is missing or restricted. Choose another before saving.</p>}
    {picking && <MediaPicker onClose={() => setPicking(false)} onSelect={(m) => { change({ mediaId: m.id }); setPicking(false); }} />}
    <div role="group" aria-label="Banner style presets" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {INTRO_PRESETS.map((p) => {
        const centred = ['stadium', 'framed', 'spotlight'].includes(p.id);
        const right = p.id === 'right-focus';
        const bottom = ['bottom-caption', 'minimal'].includes(p.id);
        return <button key={p.id} type="button" aria-pressed={a.style === p.id} title={p.description} onClick={() => change({ style: p.id, align: 'preset', vertical: 'preset' })}
          className={`min-w-0 overflow-hidden rounded-lg border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${a.style === p.id ? 'border-amber-600 ring-1 ring-amber-600' : 'border-stone-300 dark:border-stone-700'}`}>
          <span aria-hidden="true" className={`relative flex h-20 overflow-hidden bg-stone-900 p-3 ${bottom ? 'items-end' : 'items-center'} ${centred ? 'justify-center' : right ? 'justify-end' : ''}`}>
            {usable && <img src={thumbnailUrl(selected)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" loading="lazy" />}
            {p.id === 'amber' && <span className="absolute inset-0 bg-amber-900/50" />}
            {p.id === 'framed' && <span className="absolute inset-2 border border-white/50" />}
            <span className={`relative w-2/3 space-y-1.5 ${p.id === 'glass' ? 'rounded border border-white/30 bg-black/50 p-2 backdrop-blur-sm' : p.id === 'split' ? 'bg-black/80 p-2' : p.id === 'bottom-caption' ? 'border-l-2 border-amber-400 pl-2' : ''}`}>
              <span className={`block h-1 w-1/2 rounded bg-amber-400 ${centred ? 'mx-auto' : right ? 'ml-auto' : ''}`} />
              <span className="block h-2 w-full rounded bg-white" /><span className="block h-1 w-full rounded bg-white/60" />
            </span>
          </span>
          <span className="block p-2 text-[11px] font-semibold">{p.name}</span>
        </button>;
      })}
    </div>
    <p className="text-xs text-stone-500 dark:text-stone-400">{INTRO_PRESETS.find((p) => p.id === a.style)?.description}</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Select label="Banner height" value={a.height} onChange={(height) => change({ height })} options={[[ 'compact', 'Compact' ], ['standard', 'Standard'], ['tall', 'Tall']]} />
      <Select label="Headline size" value={a.textSize} onChange={(textSize) => change({ textSize })} options={[[ 'compact', 'Compact' ], ['standard', 'Standard'], ['large', 'Large']]} />
      <Select label="Text width" value={a.width} onChange={(width) => change({ width })} options={[[ 'narrow', 'Narrow' ], ['medium', 'Medium'], ['wide', 'Wide']]} />
      <Select label="Text alignment" value={a.align} onChange={(align) => change({ align })} options={[[ 'preset', 'Style default' ], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} />
      <Select label="Vertical text position" value={a.vertical} onChange={(vertical) => change({ vertical })} options={[[ 'preset', 'Style default' ], ['top', 'Top'], ['center', 'Centre'], ['bottom', 'Bottom']]} />
      {slider('Overlay darkness', 'overlay', 25, 90)}
      {slider('Desktop crop horizontal', 'focalX', 0, 100)}{slider('Desktop crop vertical', 'focalY', 0, 100)}
      {slider('Image zoom', 'zoom', 100, 160)}
      {slider('Mobile crop horizontal', 'mobileFocalX', 0, 100)}{slider('Mobile crop vertical', 'mobileFocalY', 0, 100)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">Live banner preview · {mobile ? 'Mobile' : 'Desktop'}</p><div className="flex gap-2">
      <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)} className="rounded border border-stone-300 px-3 py-1.5 text-xs dark:border-stone-700">Desktop preview</button>
      <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)} className="rounded border border-stone-300 px-3 py-1.5 text-xs dark:border-stone-700">Mobile preview</button>
    </div></div>
    <div className="min-w-0 overflow-hidden" role="region" aria-label="Live banner preview"><div className={mobile ? 'mx-auto w-full max-w-[390px]' : 'w-full'}><IntroBanner section={section} image={usable ? toMediaAsset(selected) : null} preview mobilePreview={mobile} /></div></div>
    <p className="text-xs text-stone-500 dark:text-stone-400">Preview updates as you edit. Save draft, then use Preview / Publish to view it on the website or make it live. Removing the photo retains the selected style with a gradient background.</p>
  </fieldset>;
}
