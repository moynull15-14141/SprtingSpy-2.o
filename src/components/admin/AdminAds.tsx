/**
 * SportingSpy Advertisement Architecture & Sponsorship Console
 * Controls reusable ad slots with default state (ADS = OFF).
 * Configures direct brand partnerships, billboard slots, and CLS safety.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AdSlotId, AdProvider, type AdCreative } from '../../types';
import { AdMediaEditor } from './AdMediaEditor';

export const AdminAds: React.FC = () => {
  const { adSlots, toggleAdSlot, updateAdSlot, currentUser } = useApp();
  // The ads API is Admin-only; other staff see the configuration read-only.
  const canManage = currentUser.role === 'Admin';
  const [editingSlotId, setEditingSlotId] = useState<AdSlotId | null>(null);
  const [sponsorName, setSponsorName] = useState('');
  const [bannerText, setBannerText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [provider, setProvider] = useState<AdProvider>('house');
  const [providerSlotId, setProviderSlotId] = useState('');
  const [saving, setSaving] = useState(false);
  const [creative, setCreative] = useState<AdCreative | null>(null);
  const [creativeAlt, setCreativeAlt] = useState('');
  const [creativeFit, setCreativeFit] = useState('contain');
  const [uploadingCreative, setUploadingCreative] = useState(false);

  const startEdit = (slotId: AdSlotId) => {
    const slot = adSlots.find((s) => s.id === slotId);
    if (!slot) return;
    setEditingSlotId(slotId);
    setSponsorName(slot.sponsorName || '');
    setBannerText(slot.bannerText || '');
    setLinkUrl(slot.linkUrl || '');
    setProvider(slot.provider ?? 'house');
    setProviderSlotId(slot.providerSlotId || '');
    setCreative(slot.creative || null);
    setCreativeAlt(slot.creativeAlt || '');
    setCreativeFit(slot.creativeFit || 'contain');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlotId || uploadingCreative || saving) return;
    setSaving(true);
    // Empty strings are sent (not omitted) so clearing a field actually clears it.
    const ok = await updateAdSlot(editingSlotId, {
      sponsorName: sponsorName.trim(),
      bannerText: bannerText.trim(),
      linkUrl: linkUrl.trim(),
      provider,
      providerSlotId: provider === 'adsense' ? providerSlotId.trim() : '',
      creativeId: creative?.id || null,
      creativeAlt: creativeAlt.trim(),
      creativeFit,
    });
    setSaving(false);
    // On failure the API error is shown and the form keeps what was typed.
    if (ok) setEditingSlotId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Ad Placements & Direct Sponsorship Architecture
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Section 27 compliance: Default state is ADS = OFF. Fixed height geometry guarantees 0 CLS.
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400 space-y-1">
        <p>
          <strong>CLS Zero-Shift Policy:</strong> Every enabled advertisement slot retains fixed spatial constraints in CSS, preventing page jumps during render.
        </p>
        <p>
          <strong>Clean Reading Guarantee:</strong> No popunders, overlay interstitials, or deceptive click elements are permitted in the SportingSpy codebase.
        </p>
      </div>

      <div className="p-4 rounded-xl border border-sky-200 bg-sky-50 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200 space-y-1">
        <p><strong>Providers:</strong> <em>House / sponsor</em> shows the slot's own partner banner, labelled “Sponsored”, with no third-party code. <em>Google AdSense</em> shows an AdSense unit labelled “Advertisement”, only after the AdSense publisher ID is set in Settings and only to visitors who allowed advertising in their privacy choices.</p>
        {!canManage && <p><strong>Read-only:</strong> only Admins can change ad placements.</p>}
      </div>

      {/* EDIT MODAL / FORM */}
      {editingSlotId && (
        <form onSubmit={saveEdit} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-3 text-xs">
          <h3 className="font-serif text-sm font-bold text-stone-900 dark:text-stone-100">
            Configure Slot: {editingSlotId}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block font-semibold">Provider
              <select value={provider} onChange={(e) => setProvider(e.target.value as AdProvider)} className="mt-1 w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-normal">
                <option value="house">House / direct sponsor</option>
                <option value="adsense">Google AdSense</option>
              </select>
            </label>
            {provider === 'adsense' && (
              <label className="block font-semibold">AdSense ad unit ID (data-ad-slot)
                <input type="text" inputMode="numeric" required pattern="\d{6,20}" value={providerSlotId} onChange={(e) => setProviderSlotId(e.target.value)} placeholder="Numeric ID from AdSense" className="mt-1 w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono font-normal" />
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Direct Sponsor Name</label>
              <input
                type="text"
                value={sponsorName}
                onChange={(e) => setSponsorName(e.target.value)}
                placeholder="e.g. Rolex, Emirates, Precision Timing"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Sponsor Target URL</label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Sponsorship Copy / Tagline</label>
            <input
              type="text"
              value={bannerText}
              onChange={(e) => setBannerText(e.target.value)}
              placeholder="e.g. Official Chronometer Partner of Grand Slam Championship Coverage."
              className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
            />
          </div>
          {provider === 'house' && <AdMediaEditor key={editingSlotId} creative={creative} onSelect={item => { setCreative(item); setCreativeAlt(item ? sponsorName || item.title : ''); }} alt={creativeAlt} onAlt={setCreativeAlt} fit={creativeFit} onFit={setCreativeFit} dimensions={adSlots.find(slot => slot.id === editingSlotId)?.dimensions || '728x90'} onBusy={setUploadingCreative}/>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving || uploadingCreative}
              onClick={() => setEditingSlotId(null)}
              className="px-3 py-1.5 rounded text-xs text-stone-500 hover:text-stone-800 dark:text-stone-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadingCreative}
              className="px-4 py-1.5 rounded bg-amber-700 hover:bg-amber-800 text-white font-semibold disabled:opacity-50"
            >
              Save Slot Settings
            </button>
          </div>
        </form>
      )}

      {/* AD SLOTS REPOSITORY */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Slot Identifier</th>
              <th className="p-3">Layout Target</th>
              <th className="p-3">Dimensions</th>
              <th className="p-3">Provider / Sponsor</th>
              <th className="p-3">State</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {adSlots.map((slot) => (
              <tr key={slot.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                <td className="p-3 font-mono font-bold text-stone-900 dark:text-stone-100">
                  {slot.id}
                </td>
                <td className="p-3 text-stone-600 dark:text-stone-400">
                  {slot.name}
                  <span className="block text-[11px] text-stone-500 dark:text-stone-400">{slot.placementDescription}</span>
                </td>
                <td className="p-3 font-mono text-stone-500 dark:text-stone-400">{slot.dimensions}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">
                  <span className="block text-[10px] font-bold uppercase text-stone-500 dark:text-stone-400">{slot.provider === 'adsense' ? `AdSense · ${slot.providerSlotId}` : 'House'}</span>
                  {slot.sponsorName ? (
                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                      {slot.sponsorName}
                    </span>
                  ) : (
                    <span className="text-stone-500 italic dark:text-stone-400">None</span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggleAdSlot(slot.id)}
                    disabled={!canManage}
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded cursor-pointer disabled:cursor-default ${
                      slot.enabled
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                        : 'bg-stone-200 dark:bg-stone-800 text-stone-600'
                    }`}
                  >
                    {slot.enabled ? 'Enabled' : 'Disabled (OFF)'}
                  </button>
                </td>
                <td className="p-3 text-right space-x-2">
                  {canManage && (
                    <button
                      disabled={saving || uploadingCreative}
                      onClick={() => startEdit(slot.id)}
                      className="text-amber-700 dark:text-amber-400 font-semibold hover:underline"
                    >
                      Configure
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
