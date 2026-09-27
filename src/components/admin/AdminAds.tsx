/**
 * SportingSpy Advertisement Architecture & Sponsorship Console
 * Controls reusable ad slots with default state (ADS = OFF).
 * Configures direct brand partnerships, billboard slots, and CLS safety.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AdSlotId } from '../../types';

export const AdminAds: React.FC = () => {
  const { adSlots, toggleAdSlot, updateAdSlot } = useApp();
  const [editingSlotId, setEditingSlotId] = useState<AdSlotId | null>(null);
  const [sponsorName, setSponsorName] = useState('');
  const [bannerText, setBannerText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const startEdit = (slotId: AdSlotId) => {
    const slot = adSlots.find((s) => s.id === slotId);
    if (!slot) return;
    setEditingSlotId(slotId);
    setSponsorName(slot.sponsorName || '');
    setBannerText(slot.bannerText || '');
    setLinkUrl(slot.linkUrl || '');
  };

  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSlotId) return;

    updateAdSlot(editingSlotId, {
      sponsorName: sponsorName.trim() || undefined,
      bannerText: bannerText.trim() || undefined,
      linkUrl: linkUrl.trim() || undefined,
    });

    setEditingSlotId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Ad Placements & Direct Sponsorship Architecture
          </h2>
          <p className="text-xs text-stone-500 mt-1">
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

      {/* EDIT MODAL / FORM */}
      {editingSlotId && (
        <form onSubmit={saveEdit} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-3 text-xs">
          <h3 className="font-serif text-sm font-bold text-stone-900 dark:text-stone-100">
            Configure Slot: {editingSlotId}
          </h3>
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
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingSlotId(null)}
              className="px-3 py-1.5 rounded text-xs text-stone-500 hover:text-stone-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              Save Slot Settings
            </button>
          </div>
        </form>
      )}

      {/* AD SLOTS REPOSITORY */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800">
            <tr>
              <th className="p-3">Slot Identifier</th>
              <th className="p-3">Layout Target</th>
              <th className="p-3">Dimensions</th>
              <th className="p-3">Active Sponsor</th>
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
                  <span className="block text-[11px] text-stone-400">{slot.placementDescription}</span>
                </td>
                <td className="p-3 font-mono text-stone-500">{slot.dimensions}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">
                  {slot.sponsorName ? (
                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                      {slot.sponsorName}
                    </span>
                  ) : (
                    <span className="text-stone-400 italic">None</span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggleAdSlot(slot.id)}
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded cursor-pointer ${
                      slot.enabled
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                        : 'bg-stone-200 dark:bg-stone-800 text-stone-600'
                    }`}
                  >
                    {slot.enabled ? 'Enabled' : 'Disabled (OFF)'}
                  </button>
                </td>
                <td className="p-3 text-right space-x-2">
                  <button
                    onClick={() => startEdit(slot.id)}
                    className="text-amber-600 dark:text-amber-400 font-semibold hover:underline"
                  >
                    Configure
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
