/**
 * SportingSpy Permanent Events & Staged Editions Manager
 * Manages the core hierarchy:
 * SPORT -> PERMANENT EVENT -> EVENT EDITION
 * Supports creating, editing, and deleting events and editions.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { EventEdition, SportEvent } from '../../types';

export const AdminEvents: React.FC = () => {
  const {
    sports,
    events,
    editions,
    addEvent,
    updateEvent,
    deleteEvent,
    addEdition,
    updateEdition,
    deleteEdition,
    navigate,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'events' | 'editions'>('events');

  // Event form state
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [eventShortName, setEventShortName] = useState('');
  const [eventSportSlug, setEventSportSlug] = useState(sports[0]?.slug || 'tennis');
  const [eventDesc, setEventDesc] = useState('');
  const [eventHistory, setEventHistory] = useState('');
  const [eventVenue, setEventVenue] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventFreq, setEventFreq] = useState('Annual');

  // Edition form state
  const [isCreatingEdition, setIsCreatingEdition] = useState(false);
  const [editingEditionId, setEditingEditionId] = useState<string | null>(null);
  const [editionEventSlug, setEditionEventSlug] = useState(events[0]?.slug || 'french-open');
  const [editionYear, setEditionYear] = useState<number>(2028);
  const [editionTitle, setEditionTitle] = useState('');
  const [editionStart, setEditionStart] = useState('2028-05-28');
  const [editionEnd, setEditionEnd] = useState('2028-06-11');
  const [editionVenue, setEditionVenue] = useState('');
  const [editionLocation, setEditionLocation] = useState('');
  const [editionPurse, setEditionPurse] = useState('');
  const [editionStatus, setEditionStatus] = useState<'upcoming' | 'ongoing' | 'completed'>('upcoming');
  const [editionDesc, setEditionDesc] = useState('');

  const [feedback, setFeedback] = useState<string | null>(null);

  const resetEventForm = () => {
    setEditingEventId(null);
    setIsCreatingEvent(false);
    setEventName('');
    setEventSlug('');
    setEventShortName('');
    setEventSportSlug(sports[0]?.slug || 'tennis');
    setEventDesc('');
    setEventHistory('');
    setEventVenue('');
    setEventLocation('');
    setEventFreq('Annual');
  };

  const startEditEvent = (evt: SportEvent) => {
    setEditingEventId(evt.id);
    setIsCreatingEvent(true);
    setEventName(evt.name);
    setEventSlug(evt.slug);
    setEventShortName(evt.shortName);
    setEventSportSlug(evt.sportSlug);
    setEventDesc(evt.description);
    setEventHistory(evt.history || '');
    setEventVenue(evt.defaultVenue);
    setEventLocation(evt.defaultLocation);
    setEventFreq(evt.frequency);
  };

  const handleSaveEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim() || !eventSlug.trim()) return;

    if (editingEventId) {
      updateEvent(editingEventId, {
        name: eventName,
        slug: eventSlug,
        shortName: eventShortName || eventName,
        sportSlug: eventSportSlug,
        description: eventDesc,
        history: eventHistory,
        defaultVenue: eventVenue || 'TBD',
        defaultLocation: eventLocation || 'TBD',
        frequency: eventFreq,
        seo: {
          metaTitle: `${eventName} Championship Guide | SportingSpy`,
          metaDescription: eventDesc,
        },
      });
      setFeedback(`Permanent event "${eventName}" updated.`);
    } else {
      addEvent({
        name: eventName,
        slug: eventSlug,
        shortName: eventShortName || eventName,
        sportSlug: eventSportSlug,
        description: eventDesc,
        history: eventHistory,
        defaultVenue: eventVenue || 'TBD',
        defaultLocation: eventLocation || 'TBD',
        frequency: eventFreq,
        currentEditionYear: new Date().getFullYear(),
        allEditionYears: [new Date().getFullYear()],
        featured: true,
        isVisible: true,
        seo: {
          metaTitle: `${eventName} Championship Guide | SportingSpy`,
          metaDescription: eventDesc,
        },
      });
      setFeedback(`Permanent event "${eventName}" created.`);
    }

    resetEventForm();
    setTimeout(() => setFeedback(null), 4000);
  };

  const resetEditionForm = () => {
    setEditingEditionId(null);
    setIsCreatingEdition(false);
    setEditionEventSlug(events[0]?.slug || 'french-open');
    setEditionYear(2028);
    setEditionTitle('');
    setEditionStart('2028-05-28');
    setEditionEnd('2028-06-11');
    setEditionVenue('');
    setEditionLocation('');
    setEditionPurse('');
    setEditionStatus('upcoming');
    setEditionDesc('');
  };

  const startEditEdition = (ed: EventEdition) => {
    setEditingEditionId(ed.id);
    setIsCreatingEdition(true);
    setEditionEventSlug(ed.eventSlug);
    setEditionYear(ed.year);
    setEditionTitle(ed.title);
    setEditionStart(ed.startDate);
    setEditionEnd(ed.endDate);
    setEditionVenue(ed.venue);
    setEditionLocation(ed.location);
    setEditionPurse(ed.prizeMoneyTotal || '');
    setEditionStatus(ed.status);
    setEditionDesc(ed.description);
  };

  const handleSaveEdition = (e: React.FormEvent) => {
    e.preventDefault();
    const parentEvent = events.find((ev) => ev.slug === editionEventSlug);
    if (!parentEvent) return;

    if (editingEditionId) {
      updateEdition(editingEditionId, {
        title: editionTitle || `${editionYear} ${parentEvent.name}`,
        startDate: editionStart,
        endDate: editionEnd,
        venue: editionVenue || parentEvent.defaultVenue,
        location: editionLocation || parentEvent.defaultLocation,
        status: editionStatus,
        prizeMoneyTotal: editionPurse || undefined,
        description: editionDesc || `The ${editionYear} staging of ${parentEvent.name}.`,
      });
      setFeedback(`Edition ${editionYear} updated.`);
    } else {
      addEdition({
        eventSlug: editionEventSlug,
        sportSlug: parentEvent.sportSlug,
        year: Number(editionYear),
        title: editionTitle || `${editionYear} ${parentEvent.name}`,
        startDate: editionStart,
        endDate: editionEnd,
        venue: editionVenue || parentEvent.defaultVenue,
        location: editionLocation || parentEvent.defaultLocation,
        status: editionStatus,
        prizeMoneyTotal: editionPurse || undefined,
        description: editionDesc || `The ${editionYear} staging of ${parentEvent.name}.`,
        quickFacts: [
          { label: 'Venue Ground', value: editionVenue || parentEvent.defaultVenue },
          { label: 'Cadence', value: parentEvent.frequency },
        ],
        featuredImage: parentEvent.featuredImage || '/src/assets/images/hero_championship_trophy_1790401859104.jpg',
        seo: {
          metaTitle: `${editionYear} ${parentEvent.name} – Dates & Guide | SportingSpy`,
          metaDescription: editionDesc,
        },
      });
      setFeedback(`Edition ${editionYear} for ${parentEvent.name} staged.`);
    }

    resetEditionForm();
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800 gap-3">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Championships & Yearly Editions
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Preserve permanent event heritage while staging annual tournament editions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('events')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              activeSubTab === 'events' ? 'bg-amber-600 text-white font-semibold' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
            }`}
          >
            Permanent Events ({events.length})
          </button>
          <button
            onClick={() => setActiveSubTab('editions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              activeSubTab === 'editions' ? 'bg-amber-600 text-white font-semibold' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
            }`}
          >
            Staged Editions ({editions.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {/* SUBTAB 1: PERMANENT EVENTS */}
      {activeSubTab === 'events' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {!isCreatingEvent && (
              <Button onClick={() => setIsCreatingEvent(true)} size="sm">
                + New Permanent Event
              </Button>
            )}
          </div>

          {isCreatingEvent && (
            <form onSubmit={handleSaveEvent} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
              <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                {editingEventId ? 'Edit Permanent Event' : 'Register Permanent Event Institution'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Event Name *</label>
                  <input
                    type="text"
                    required
                    value={eventName}
                    onChange={(e) => {
                      setEventName(e.target.value);
                      if (!editingEventId && !eventSlug) setEventSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                    }}
                    placeholder="e.g. US Open, Ryder Cup"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">URL Slug *</label>
                  <input
                    type="text"
                    required
                    value={eventSlug}
                    onChange={(e) => setEventSlug(e.target.value)}
                    placeholder="us-open"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Sport Discipline *</label>
                  <select
                    value={eventSportSlug}
                    onChange={(e) => setEventSportSlug(e.target.value)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  >
                    {sports.map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Short Name</label>
                  <input
                    type="text"
                    value={eventShortName}
                    onChange={(e) => setEventShortName(e.target.value)}
                    placeholder="e.g. US Open"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Default Venue Ground</label>
                  <input
                    type="text"
                    value={eventVenue}
                    onChange={(e) => setEventVenue(e.target.value)}
                    placeholder="e.g. USTA Billie Jean King NTC"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Default Location</label>
                  <input
                    type="text"
                    value={eventLocation}
                    onChange={(e) => setEventLocation(e.target.value)}
                    placeholder="e.g. New York, USA"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
              </div>

              <div className="text-xs">
                <label className="block font-semibold mb-1">Event Overview / Scope *</label>
                <textarea
                  rows={2}
                  required
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  placeholder="Permanent tournament identity and status..."
                  className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetEventForm}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  {editingEventId ? 'Save Updates' : 'Save Event'}
                </Button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="p-3">Event Name</th>
                  <th className="p-3">Sport</th>
                  <th className="p-3">Active Edition</th>
                  <th className="p-3">Default Venue</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {events.map((evt) => {
                  const sp = sports.find((s) => s.slug === evt.sportSlug);
                  return (
                    <tr key={evt.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                      <td className="p-3 font-semibold text-stone-900 dark:text-stone-100">
                        {evt.name}
                        <span className="block text-[11px] font-mono text-stone-400">/{evt.sportSlug}/{evt.slug}</span>
                      </td>
                      <td className="p-3">{sp?.name}</td>
                      <td className="p-3 font-mono tabular-nums">{evt.currentEditionYear}</td>
                      <td className="p-3 text-stone-500">{evt.defaultVenue}</td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          onClick={() => navigate(`/${evt.sportSlug}/${evt.slug}`)}
                          className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold cursor-pointer"
                        >
                          View
                        </button>
                        <button
                          onClick={() => startEditEvent(evt)}
                          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete permanent event "${evt.name}"?`)) {
                              deleteEvent(evt.id);
                            }
                          }}
                          className="text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 2: STAGED EDITIONS */}
      {activeSubTab === 'editions' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {!isCreatingEdition && (
              <Button onClick={() => setIsCreatingEdition(true)} size="sm">
                + Stage Yearly Edition
              </Button>
            )}
          </div>

          {isCreatingEdition && (
            <form onSubmit={handleSaveEdition} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
              <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                {editingEditionId ? 'Edit Tournament Edition' : 'Stage Yearly Tournament Edition (e.g. 2028)'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Parent Event *</label>
                  <select
                    disabled={!!editingEditionId}
                    value={editionEventSlug}
                    onChange={(e) => setEditionEventSlug(e.target.value)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 disabled:opacity-60"
                  >
                    {events.map((e) => (
                      <option key={e.id} value={e.slug}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Staging Year *</label>
                  <input
                    type="number"
                    required
                    disabled={!!editingEditionId}
                    value={editionYear}
                    onChange={(e) => setEditionYear(Number(e.target.value))}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Edition Title</label>
                  <input
                    type="text"
                    value={editionTitle}
                    onChange={(e) => setEditionTitle(e.target.value)}
                    placeholder="e.g. 2028 French Open"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Status</label>
                  <select
                    value={editionStatus}
                    onChange={(e) => setEditionStatus(e.target.value as any)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-semibold"
                  >
                    <option value="upcoming">Upcoming</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Start Date</label>
                  <input
                    type="date"
                    value={editionStart}
                    onChange={(e) => setEditionStart(e.target.value)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">End Date</label>
                  <input
                    type="date"
                    value={editionEnd}
                    onChange={(e) => setEditionEnd(e.target.value)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Total Prize Money / Purse</label>
                  <input
                    type="text"
                    value={editionPurse}
                    onChange={(e) => setEditionPurse(e.target.value)}
                    placeholder="e.g. €56,000,000"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetEditionForm}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  {editingEditionId ? 'Save Changes' : 'Stage Edition'}
                </Button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800">
                <tr>
                  <th className="p-3">Edition Title</th>
                  <th className="p-3">Year</th>
                  <th className="p-3">Dates</th>
                  <th className="p-3">Venue</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {editions.map((ed) => (
                  <tr key={ed.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                    <td className="p-3 font-semibold text-stone-900 dark:text-stone-100">{ed.title}</td>
                    <td className="p-3 font-mono tabular-nums">{ed.year}</td>
                    <td className="p-3 text-stone-500 tabular-nums">
                      {ed.startDate} - {ed.endDate}
                    </td>
                    <td className="p-3 text-stone-500">{ed.venue}</td>
                    <td className="p-3">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400">
                        {ed.status}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => navigate(`/${ed.sportSlug}/${ed.eventSlug}/${ed.year}`)}
                        className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold cursor-pointer"
                      >
                        View
                      </button>
                      <button
                        onClick={() => startEditEdition(ed)}
                        className="text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete tournament edition "${ed.title}"?`)) {
                            deleteEdition(ed.id);
                          }
                        }}
                        className="text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
