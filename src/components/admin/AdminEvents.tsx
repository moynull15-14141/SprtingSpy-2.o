/**
 * SportingSpy Permanent Events & Staged Editions Manager
 * Manages the core hierarchy:
 * SPORT -> PERMANENT EVENT -> EVENT EDITION
 * Supports creating, editing, and deleting events and editions.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAutosave } from '../../lib/autosave/useAutosave';
import { discardDraft, listDrafts, markRecovered, takeOpenDraft } from '../../lib/autosave/api';
import { findRecoverable, forgetLocal, loadNewDraft, type Recoverable } from '../../lib/autosave/recovery';
import { AutosaveStatus, DraftRecoveryBanner, StaleSaveWarning } from './autosave/AutosaveUI';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { EDITION_STATUSES, EditionStatus, EventEdition, SportEvent, type SeoMetadata, type SportEventFieldDefinition, type SportEventFieldValues } from '../../types';
import { EMPTY_SEO_DRAFT, RecordList, SeoFields, cleanRecords, draftToSeo, seoToDraft, type RecordField, type SeoDraft } from './EntityFields';
import { DynamicEventFields } from './DynamicEventFields';
import { parseSportEventValues } from '../../../server/sportEventConfiguration';
import dynamic from 'next/dynamic';
import { MediaImageField } from './media/MediaShared';
import { docToPlainText, type RichDoc } from '../../lib/richText';
import { readTabState, writeTabState } from '../../lib/admin/workspace';

// The same rich-text editor as the Article body (loaded on demand, CMS only).
const RichTextEditor = dynamic(() => import('./editor/RichTextEditor'), {
  ssr: false,
  loading: () => <div className="min-h-[160px] rounded-lg border border-stone-300 dark:border-stone-700 p-4 text-xs text-stone-500 dark:text-stone-400">Loading editor…</div>,
});
/** A plain-text description as a document: blank lines separate paragraphs, single newlines stay line breaks. */
const plainToDoc = (text: string): RichDoc => {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return { type: 'doc', content: blocks.length ? blocks.map((block) => ({ type: 'paragraph', content: block.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) })) : [{ type: 'paragraph' }] };
};

// PHASE H: the automatic defaults the public pages use when an SEO field is blank.
const eventSeoDefaults = (name: string, description: string) => ({ title: `${name || 'Event name'} – History, Editions & Guides | SportingSpy`, description });
const editionSeoDefaults = (title: string, description: string) => ({ title: `${title || 'Edition title'} – Official Dates, Venue & Guides | SportingSpy`, description });
const QUICK_FACT_FIELDS: RecordField[] = [{ key: 'label', label: 'Label', placeholder: 'e.g. Surface', maxLength: 80 }, { key: 'value', label: 'Value', placeholder: 'e.g. Red clay', maxLength: 300 }];
const CHAMPION_FIELDS: RecordField[] = [{ key: 'category', label: 'Category', placeholder: "e.g. Men's singles", maxLength: 80 }, { key: 'name', label: 'Champion', placeholder: 'e.g. Carlos Alcaraz', maxLength: 150 }];
/** PHASE AUTOSAVE: the event and edition forms as stored in their working copies. */
interface EventDraftPayload {
  name: string; slug: string; shortName: string; altNames: string; faqSchema: boolean; sportSlug: string; description: string; history: string;
  venue: string; location: string; frequency: string; currentEditionYear: string; eventType: string; officialSourceUrl: string; image: string;
  seo: SeoDraft; values: SportEventFieldValues; valuesDirty: boolean;
  /** Rich overview; working copies saved before it existed carry only `description`. */
  descriptionBody?: RichDoc;
}
interface EditionDraftPayload {
  eventSlug: string; year: number; title: string; startDate: string; endDate: string; venue: string; location: string; purse: string; status: EditionStatus;
  description: string; officialSourceUrl: string; image: string; qualification: string; participants: string;
  facts: Record<string, string>[]; champions: Record<string, string>[]; faqSchema: boolean; seo: SeoDraft;
  /** Rich description; working copies saved before it existed carry only `description`. */
  descriptionBody?: RichDoc;
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export const AdminEvents: React.FC = () => {
  const {
    sports,
    events,
    editions,
    mediaItems,
    addEvent,
    updateEvent,
    deleteEvent,
    addEdition,
    updateEdition,
    deleteEdition,
    navigate,
    apiCall,
  } = useApp();

  // Remembered for this browser tab, so a refresh keeps Permanent Events / Staged Editions.
  const [activeSubTab, setActiveSubTabState] = useState<'events' | 'editions'>(() => readTabState('events-subtab', ['events', 'editions'] as const, 'events'));
  const setActiveSubTab = (tab: 'events' | 'editions') => { setActiveSubTabState(tab); writeTabState('events-subtab', tab); };

  // Event form state
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [eventShortName, setEventShortName] = useState('');
  // PHASE R: alternative names for search; FAQPage structured-data opt-ins.
  const [eventAltNames, setEventAltNames] = useState('');
  const [eventFaqSchema, setEventFaqSchema] = useState(false);
  const [editionFaqSchema, setEditionFaqSchema] = useState(false);
  const [eventSportSlug, setEventSportSlug] = useState(sports[0]?.slug || 'tennis');
  const [eventDesc, setEventDesc] = useState(''); // plain-text projection of eventDescDoc (SEO default, autosave title check)
  const [eventDescDoc, setEventDescDoc] = useState<RichDoc>(() => plainToDoc(''));
  const [eventDescKey, setEventDescKey] = useState(0); // remounts the editor when the document is replaced
  const [eventHistory, setEventHistory] = useState('');
  const [eventVenue, setEventVenue] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventFreq, setEventFreq] = useState('');
  const [eventCurrentEditionYear, setEventCurrentEditionYear] = useState('');
  const [eventType, setEventType] = useState('');
  const [eventOfficialSourceUrl, setEventOfficialSourceUrl] = useState('');
  const [eventImage, setEventImage] = useState('');
  const [eventSeo, setEventSeo] = useState<SeoDraft>(EMPTY_SEO_DRAFT);
  const [eventSeoExisting, setEventSeoExisting] = useState<SeoMetadata | null>(null);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventValues, setEventValues] = useState<SportEventFieldValues>({});
  const [eventValuesDirty, setEventValuesDirty] = useState(false);
  const [dynamicFields, setDynamicFields] = useState<SportEventFieldDefinition[]>([]);
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicError, setDynamicError] = useState('');
  const configurationCache = useRef<Record<string, SportEventFieldDefinition[]>>({});
  const apiCallRef = useRef(apiCall);
  apiCallRef.current = apiCall;

  // Edition form state
  const [isCreatingEdition, setIsCreatingEdition] = useState(false);
  const [editingEditionId, setEditingEditionId] = useState<string | null>(null);
  const [editionEventSlug, setEditionEventSlug] = useState(events[0]?.slug || 'french-open');
  const [editionYear, setEditionYear] = useState<number>(0);
  const [editionTitle, setEditionTitle] = useState('');
  const [editionStart, setEditionStart] = useState('');
  const [editionEnd, setEditionEnd] = useState('');
  const [editionVenue, setEditionVenue] = useState('');
  const [editionLocation, setEditionLocation] = useState('');
  const [editionPurse, setEditionPurse] = useState('');
  const [editionStatus, setEditionStatus] = useState<EditionStatus>('upcoming');
  const [editionStatusFilter, setEditionStatusFilter] = useState<EditionStatus | ''>('');
  const [editionDesc, setEditionDesc] = useState(''); // plain-text projection of editionDescDoc (word count, SEO default)
  const [editionDescDoc, setEditionDescDoc] = useState<RichDoc>(() => plainToDoc(''));
  const [editionDescKey, setEditionDescKey] = useState(0); // remounts the editor when the document is replaced
  const [editionSourceUrl, setEditionSourceUrl] = useState('');
  const [editionImage, setEditionImage] = useState('');
  const [editionQualification, setEditionQualification] = useState('');
  const [editionParticipants, setEditionParticipants] = useState('');
  const [editionFacts, setEditionFacts] = useState<Record<string, string>[]>([]);
  const [editionChampions, setEditionChampions] = useState<Record<string, string>[]>([]);
  const [editionSeo, setEditionSeo] = useState<SeoDraft>(EMPTY_SEO_DRAFT);
  const [editionSeoExisting, setEditionSeoExisting] = useState<SeoMetadata | null>(null);
  const [editionSaving, setEditionSaving] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const flash = (message: string) => { setFeedback(message); setTimeout(() => setFeedback(null), 5000); };

  // ── PHASE AUTOSAVE: event and edition forms autosave to server working copies (never the live rows). ──
  const { currentUser } = useApp();
  const [eventRecovery, setEventRecovery] = useState<Recoverable<EventDraftPayload> | null>(null);
  const [editionRecovery, setEditionRecovery] = useState<Recoverable<EditionDraftPayload> | null>(null);
  const [staleEvent, setStaleEvent] = useState(false);
  const [staleEdition, setStaleEdition] = useState(false);
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  const eventPayload: EventDraftPayload = {
    name: eventName, slug: eventSlug, shortName: eventShortName, altNames: eventAltNames, faqSchema: eventFaqSchema, sportSlug: eventSportSlug,
    description: eventDesc, history: eventHistory, venue: eventVenue, location: eventLocation, frequency: eventFreq, currentEditionYear: eventCurrentEditionYear,
    eventType, officialSourceUrl: eventOfficialSourceUrl, image: eventImage, seo: eventSeo, values: eventValues, valuesDirty: eventValuesDirty,
    descriptionBody: eventDescDoc,
  };
  const editionPayload: EditionDraftPayload = {
    eventSlug: editionEventSlug, year: editionYear, title: editionTitle, startDate: editionStart, endDate: editionEnd, venue: editionVenue, location: editionLocation,
    purse: editionPurse, status: editionStatus, description: editionDesc, officialSourceUrl: editionSourceUrl, image: editionImage, qualification: editionQualification,
    participants: editionParticipants, facts: editionFacts, champions: editionChampions, faqSchema: editionFaqSchema, seo: editionSeo,
    descriptionBody: editionDescDoc,
  };
  const eventAutosave = useAutosave({
    kind: 'event', userId: currentUser.id, enabled: isCreatingEvent && !eventRecovery, title: eventName.trim() || 'Untitled event', payload: eventPayload,
    meaningful: !!eventName.trim() || !!eventDesc.trim(), open: isCreatingEvent,
  });
  const editionAutosave = useAutosave({
    kind: 'edition', userId: currentUser.id, enabled: isCreatingEdition && !editionRecovery, title: editionTitle.trim() || `Untitled edition${editionYear ? ` ${editionYear}` : ''}`, payload: editionPayload,
    meaningful: !!editionTitle.trim() || !!editionDesc.trim(), open: isCreatingEdition,
  });
  const applyEventPayload = (p: Partial<EventDraftPayload>) => {
    if (p.name !== undefined) setEventName(p.name);
    if (p.slug !== undefined) setEventSlug(p.slug);
    if (p.shortName !== undefined) setEventShortName(p.shortName);
    if (p.altNames !== undefined) setEventAltNames(p.altNames);
    if (p.faqSchema !== undefined) setEventFaqSchema(p.faqSchema);
    if (p.sportSlug !== undefined) setEventSportSlug(p.sportSlug);
    if (p.description !== undefined || p.descriptionBody !== undefined) {
      const doc = p.descriptionBody ?? plainToDoc(p.description ?? '');
      setEventDescDoc(doc); setEventDesc(docToPlainText(doc)); setEventDescKey((k) => k + 1);
    }
    if (p.history !== undefined) setEventHistory(p.history);
    if (p.venue !== undefined) setEventVenue(p.venue);
    if (p.location !== undefined) setEventLocation(p.location);
    if (p.frequency !== undefined) setEventFreq(p.frequency);
    if (p.currentEditionYear !== undefined) setEventCurrentEditionYear(p.currentEditionYear);
    if (p.eventType !== undefined) setEventType(p.eventType);
    if (p.officialSourceUrl !== undefined) setEventOfficialSourceUrl(p.officialSourceUrl);
    if (p.image !== undefined) setEventImage(p.image);
    if (p.seo !== undefined) setEventSeo(p.seo);
    if (p.values !== undefined) setEventValues(p.values);
    if (p.valuesDirty !== undefined) setEventValuesDirty(p.valuesDirty);
  };
  const applyEditionPayload = (p: Partial<EditionDraftPayload>) => {
    if (p.eventSlug !== undefined) setEditionEventSlug(p.eventSlug);
    if (p.year !== undefined) setEditionYear(p.year);
    if (p.title !== undefined) setEditionTitle(p.title);
    if (p.startDate !== undefined) setEditionStart(p.startDate);
    if (p.endDate !== undefined) setEditionEnd(p.endDate);
    if (p.venue !== undefined) setEditionVenue(p.venue);
    if (p.location !== undefined) setEditionLocation(p.location);
    if (p.purse !== undefined) setEditionPurse(p.purse);
    if (p.status !== undefined) setEditionStatus(p.status);
    if (p.description !== undefined || p.descriptionBody !== undefined) {
      const doc = p.descriptionBody ?? plainToDoc(p.description ?? '');
      setEditionDescDoc(doc); setEditionDesc(docToPlainText(doc)); setEditionDescKey((k) => k + 1);
    }
    if (p.officialSourceUrl !== undefined) setEditionSourceUrl(p.officialSourceUrl);
    if (p.image !== undefined) setEditionImage(p.image);
    if (p.qualification !== undefined) setEditionQualification(p.qualification);
    if (p.participants !== undefined) setEditionParticipants(p.participants);
    if (p.facts !== undefined) setEditionFacts(p.facts);
    if (p.champions !== undefined) setEditionChampions(p.champions);
    if (p.faqSchema !== undefined) setEditionFaqSchema(p.faqSchema);
    if (p.seo !== undefined) setEditionSeo(p.seo);
  };
  useEffect(() => {
    if (isCreatingEvent || isCreatingEdition) return;
    void listDrafts().then((r) => setUnsaved(new Set((r?.drafts ?? []).filter((d) => d.entityId && (d.kind === 'event' || d.kind === 'edition')).map((d) => `${d.kind}:${d.entityId}`))));
  }, [isCreatingEvent, isCreatingEdition, events, editions]);
  const unsavedBadge = (key: string) => unsaved.has(key) && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-300" data-testid="unsaved-badge">Unsaved changes</span>;

  const resetEventForm = () => {
    setEditingEventId(null);
    setIsCreatingEvent(false);
    setEventName('');
    setEventSlug('');
    setEventShortName('');
    setEventAltNames('');
    setEventFaqSchema(false);
    setEventSportSlug(sports[0]?.slug || 'tennis');
    setEventDesc('');
    setEventDescDoc(plainToDoc(''));
    setEventDescKey((k) => k + 1);
    setEventHistory('');
    setEventVenue('');
    setEventLocation('');
    setEventFreq('');
    setEventCurrentEditionYear('');
    setEventType('');
    setEventOfficialSourceUrl('');
    setEventImage('');
    setEventSeo(EMPTY_SEO_DRAFT);
    setEventSeoExisting(null);
    setEventValues({});
    setEventValuesDirty(false);
    setFormError(null);
  };

  const startEditEvent = (evt: SportEvent) => {
    setFormError(null);
    setEventSeo(seoToDraft(evt.seo));
    setEventSeoExisting(evt.seo ?? null);
    setEditingEventId(evt.id);
    setIsCreatingEvent(true);
    setEventName(evt.name);
    setEventSlug(evt.slug);
    setEventShortName(evt.shortName);
    setEventAltNames(evt.alternativeNames || '');
    setEventFaqSchema(!!evt.faqSchemaEnabled);
    setEventSportSlug(evt.sportSlug);
    const overviewDoc = evt.descriptionBody ?? plainToDoc(evt.description);
    setEventDescDoc(overviewDoc);
    setEventDesc(docToPlainText(overviewDoc));
    setEventDescKey((k) => k + 1);
    setEventHistory(evt.history || '');
    setEventVenue(evt.defaultVenue || '');
    setEventLocation(evt.defaultLocation || '');
    setEventFreq(evt.frequency || '');
    setEventCurrentEditionYear(evt.currentEditionYear == null ? '' : String(evt.currentEditionYear));
    setEventType(evt.eventType || '');
    setEventOfficialSourceUrl(evt.officialSourceUrl || '');
    setEventImage(evt.featuredImage || '');
    setEventValues(evt.sportSpecificValues ?? {});
    setEventValuesDirty(false);
  };

  useEffect(() => {
    if (!isCreatingEvent || !eventSportSlug) return;
    const cached = configurationCache.current[eventSportSlug];
    if (cached) { setDynamicFields(cached); setDynamicLoading(false); setDynamicError(''); return; }
    let cancelled = false;
    setDynamicLoading(true); setDynamicError(''); setDynamicFields([]);
    void apiCallRef.current<{ resolved: { fields: SportEventFieldDefinition[] }; error?: string }>(`/api/sports/${encodeURIComponent(eventSportSlug)}/event-configuration`).then((result) => {
      if (cancelled) return;
      setDynamicLoading(false);
      if (!result.data || result.data.error) { setDynamicError(result.data?.error ?? result.error ?? 'Could not load Event configuration.'); return; }
      configurationCache.current[eventSportSlug] = result.data.resolved.fields;
      setDynamicFields(result.data.resolved.fields);
    });
    return () => { cancelled = true; };
  }, [isCreatingEvent, eventSportSlug]);

  const openEvent = async (evt: SportEvent) => {
    if (isCreatingEvent) await eventAutosave.stop(); // the previous item's working copy is kept
    setStaleEvent(false);
    setEventRecovery(null);
    startEditEvent(evt);
    eventAutosave.start({ entityId: evt.id, baseVersion: null });
    const found = await findRecoverable<EventDraftPayload>('event', currentUser.id, evt.id);
    eventAutosave.setBaseVersion(found.currentVersion);
    if (found.recoverable) setEventRecovery(found.recoverable);
  };
  const newEvent = () => {
    resetEventForm();
    setIsCreatingEvent(true);
    setEventRecovery(null);
    setStaleEvent(false);
    eventAutosave.start({ entityId: null, baseVersion: null });
  };
  /** Close keeps unsaved changes in the working copy; Discard removes it (confirmed). */
  const closeEvent = async () => { await eventAutosave.stop(); setEventRecovery(null); setStaleEvent(false); resetEventForm(); };
  const discardEvent = async () => {
    if (!window.confirm('Discard your unsaved changes? The saved event itself is not changed.')) return;
    const ok = await eventAutosave.discard();
    eventAutosave.end(); setEventRecovery(null); setStaleEvent(false); resetEventForm();
    if (!ok) flash('Another editor changed the working copy meanwhile, so it was kept.');
  };
  const continueEventDraft = () => {
    if (!eventRecovery) return;
    applyEventPayload(eventRecovery.payload);
    eventAutosave.start(eventRecovery.start);
    if (eventRecovery.serverDraft) markRecovered(eventRecovery.serverDraft.id);
    setEventRecovery(null);
  };
  const discardEventRecovery = async () => {
    if (!eventRecovery || !window.confirm('Discard the unsaved working copy? The saved event itself is not changed.')) return;
    if (eventRecovery.serverDraft && !(await discardDraft(eventRecovery.serverDraft.id, eventRecovery.serverDraft.revision))) { setFormError('The working copy changed meanwhile, so it was kept. Reopen the event to see it.'); return; }
    forgetLocal(eventRecovery.localKey);
    setEventRecovery(null);
  };

  const changeEventSport = (slug: string) => {
    if (slug === eventSportSlug) return;
    if (Object.keys(eventValues).length && !window.confirm('Changing Sport clears this Event’s sport-specific values. Continue?')) return;
    setEventSportSlug(slug);
    setEventValues({});
    setEventValuesDirty(true);
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventName.trim() || !eventSlug.trim() || eventSaving) return;
    setFormError(null);
    // PHASE H: SEO/social values are exactly what the editor entered (blank = automatic default).
    // They are never regenerated from the name/description on save.
    const seo = draftToSeo(eventSeo, eventSeoExisting);
    const originalEvent = events.find((evt) => evt.id === editingEventId);
    const selectedCurrentYear = eventCurrentEditionYear ? Number(eventCurrentEditionYear) : null;
    if (dynamicLoading || dynamicError) { setFormError(dynamicError || 'Wait for the Sport configuration to load.'); return; }
    const originalValues = originalEvent?.sportSpecificValues ?? {};
    const orphanKeys = Object.keys(eventValues).filter((key) => !dynamicFields.some((field) => field.key === key));
    if (eventValuesDirty && orphanKeys.length) { setFormError(`Existing values have no field definition: ${orphanKeys.join(', ')}. Restore the configuration before changing custom values.`); return; }
    if (!editingEventId || eventValuesDirty) {
      const checked = parseSportEventValues(eventValues, { configured: true, terminology: { event: 'Event', participant: 'Participants', competition: 'Competition', venue: 'Venue', round: 'Round' }, fields: dynamicFields }, { newEvent: !editingEventId, previous: originalValues });
      if ('error' in checked) { setFormError(checked.error); return; }
    }
    const customPayload = !editingEventId || eventValuesDirty ? { sportSpecificValues: eventValues } : {};

    // PHASE R: a slug or sport change moves this event's URLs (old URLs redirect 301 automatically).
    if (originalEvent && (originalEvent.slug !== eventSlug || originalEvent.sportSlug !== eventSportSlug)
      && !confirm(`Change the URL from /${originalEvent.sportSlug}/${originalEvent.slug}/ to /${eventSportSlug}/${eventSlug}/? The event, its editions and its articles move; old URLs will redirect (301) to the new ones.`)) return;
    setEventSaving(true);
    let staleEventSave = false;
    const ok = editingEventId
      ? await updateEvent(editingEventId, {
          alternativeNames: eventAltNames,
          faqSchemaEnabled: eventFaqSchema,
          name: eventName,
          slug: eventSlug,
          shortName: eventShortName || eventName,
          sportSlug: eventSportSlug,
          description: eventDesc,
          // The server re-validates the document and derives `description` from it.
          descriptionBody: eventDesc.trim() ? eventDescDoc : null,
          history: eventHistory,
          defaultVenue: eventVenue.trim() || null,
          defaultLocation: eventLocation.trim() || null,
          frequency: eventFreq.trim() || null,
          ...(originalEvent && originalEvent.currentEditionYear !== selectedCurrentYear ? { currentEditionYear: selectedCurrentYear } : {}),
          eventType: eventType.trim(),
          officialSourceUrl: eventOfficialSourceUrl.trim(),
          ...(originalEvent && eventImage !== (originalEvent.featuredImage || '') ? { featuredImage: eventImage || null } : {}),
          seo,
          ...customPayload,
        }, { expectedVersion: eventAutosave.baseVersion(), onStale: () => { staleEventSave = true; } })
      : await addEvent({
          name: eventName,
          slug: eventSlug,
          shortName: eventShortName || eventName,
          sportSlug: eventSportSlug,
          description: eventDesc,
          // The server re-validates the document and derives `description` from it.
          descriptionBody: eventDesc.trim() ? eventDescDoc : null,
          history: eventHistory,
          defaultVenue: eventVenue.trim() || null,
          defaultLocation: eventLocation.trim() || null,
          frequency: eventFreq.trim() || null,
          eventType: eventType.trim() || undefined,
          officialSourceUrl: eventOfficialSourceUrl.trim() || undefined,
          featuredImage: eventImage || undefined,
          currentEditionYear: null,
          allEditionYears: [],
          featured: true,
          isVisible: true,
          alternativeNames: eventAltNames,
          faqSchemaEnabled: eventFaqSchema,
          seo,
          ...customPayload,
        });
    setEventSaving(false);
    if (staleEventSave) { setStaleEvent(true); return; }
    // On failure the server's message is shown and the form keeps what was typed.
    if (!ok) { setFormError('The event was not saved. Check the message above and try again.'); return; }
    await eventAutosave.applied(); // the working copy is now the event itself
    flash(`Permanent event "${eventName}" ${editingEventId ? 'updated' : 'created'}.`);
    resetEventForm();
  };

  const resetEditionForm = () => {
    setEditingEditionId(null);
    setIsCreatingEdition(false);
    setEditionEventSlug(events[0]?.slug || 'french-open');
    setEditionYear(0);
    setEditionTitle('');
    setEditionStart('');
    setEditionEnd('');
    setEditionVenue('');
    setEditionLocation('');
    setEditionPurse('');
    setEditionStatus('upcoming');
    setEditionDesc('');
    setEditionDescDoc(plainToDoc(''));
    setEditionDescKey((k) => k + 1);
    setEditionSourceUrl('');
    setEditionImage('');
    setEditionQualification('');
    setEditionParticipants('');
    setEditionFacts([]);
    setEditionChampions([]);
    setEditionFaqSchema(false);
    setEditionSeo(EMPTY_SEO_DRAFT);
    setEditionSeoExisting(null);
    setFormError(null);
  };

  const startCreateEdition = () => {
    resetEditionForm();
    setIsCreatingEdition(true);
    setEditionRecovery(null);
    setStaleEdition(false);
    editionAutosave.start({ entityId: null, baseVersion: null });
  };
  const openEdition = async (ed: EventEdition) => {
    if (isCreatingEdition) await editionAutosave.stop();
    setStaleEdition(false);
    setEditionRecovery(null);
    startEditEdition(ed);
    editionAutosave.start({ entityId: ed.id, baseVersion: null });
    const found = await findRecoverable<EditionDraftPayload>('edition', currentUser.id, ed.id);
    editionAutosave.setBaseVersion(found.currentVersion);
    if (found.recoverable) setEditionRecovery(found.recoverable);
  };
  const closeEdition = async () => { await editionAutosave.stop(); setEditionRecovery(null); setStaleEdition(false); resetEditionForm(); };
  const discardEdition = async () => {
    if (!window.confirm('Discard your unsaved changes? The saved edition itself is not changed.')) return;
    const ok = await editionAutosave.discard();
    editionAutosave.end(); setEditionRecovery(null); setStaleEdition(false); resetEditionForm();
    if (!ok) flash('Another editor changed the working copy meanwhile, so it was kept.');
  };
  const continueEditionDraft = () => {
    if (!editionRecovery) return;
    applyEditionPayload(editionRecovery.payload);
    editionAutosave.start(editionRecovery.start);
    if (editionRecovery.serverDraft) markRecovered(editionRecovery.serverDraft.id);
    setEditionRecovery(null);
  };
  const discardEditionRecovery = async () => {
    if (!editionRecovery || !window.confirm('Discard the unsaved working copy? The saved edition itself is not changed.')) return;
    if (editionRecovery.serverDraft && !(await discardDraft(editionRecovery.serverDraft.id, editionRecovery.serverDraft.revision))) { setFormError('The working copy changed meanwhile, so it was kept. Reopen the edition to see it.'); return; }
    forgetLocal(editionRecovery.localKey);
    setEditionRecovery(null);
  };
  /**
   * "Continue editing" from Unsaved Work, or the editor that was open before a page refresh.
   * After a refresh the CMS data may still be loading, so an existing Event/Edition is opened
   * as soon as it appears in the loaded lists.
   */
  const pendingOpen = useRef<{ kind: 'event' | 'edition'; entityId: string } | null>(null);
  useEffect(() => {
    const pending = pendingOpen.current;
    if (!pending) return;
    const target = pending.kind === 'event' ? events.find((x) => x.id === pending.entityId) : editions.find((x) => x.id === pending.entityId);
    if (!target) return;
    pendingOpen.current = null;
    void (pending.kind === 'event' ? openEvent(target as SportEvent) : openEdition(target as EventEdition));
  }, [events, editions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const req = takeOpenDraft(['event', 'edition']);
    if (!req) return;
    setActiveSubTab(req.kind === 'event' ? 'events' : 'editions');
    void (async () => {
      if (req.entityId) {
        if (req.kind === 'event') { const evt = events.find((x) => x.id === req.entityId); if (evt) await openEvent(evt); else pendingOpen.current = { kind: 'event', entityId: req.entityId }; }
        else { const ed = editions.find((x) => x.id === req.entityId); if (ed) await openEdition(ed); else pendingOpen.current = { kind: 'edition', entityId: req.entityId }; }
        return;
      }
      if (!req.draftId) return;
      if (req.kind === 'event') {
        const d = await loadNewDraft<EventDraftPayload>('event', currentUser.id, req.draftId);
        if (!d) return;
        resetEventForm(); setIsCreatingEvent(true); applyEventPayload(d.payload); eventAutosave.start(d.start);
      } else {
        const d = await loadNewDraft<EditionDraftPayload>('edition', currentUser.id, req.draftId);
        if (!d) return;
        resetEditionForm(); setIsCreatingEdition(true); applyEditionPayload(d.payload); editionAutosave.start(d.start);
      }
      if (req.draftId) markRecovered(req.draftId);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEditEdition = (ed: EventEdition) => {
    setFormError(null);
    setEditionSourceUrl(ed.officialSourceUrl || '');
    setEditionImage(ed.featuredImage || '');
    setEditionQualification(ed.qualificationInfo || '');
    setEditionParticipants(ed.participantsCount != null ? String(ed.participantsCount) : '');
    setEditionFacts((ed.quickFacts || []).map((f) => ({ label: f.label, value: f.value })));
    setEditionChampions((ed.defendingChampions || []).map((c) => ({ category: c.category, name: c.name })));
    setEditionSeo(seoToDraft(ed.seo));
    setEditionSeoExisting(ed.seo ?? null);
    setEditingEditionId(ed.id);
    setIsCreatingEdition(true);
    setEditionEventSlug(ed.eventSlug);
    setEditionYear(ed.year);
    setEditionTitle(ed.title);
    setEditionStart(ed.startDate || '');
    setEditionEnd(ed.endDate || '');
    setEditionVenue(ed.venue || '');
    setEditionLocation(ed.location || '');
    setEditionPurse(ed.prizeMoneyTotal || '');
    setEditionStatus(ed.status);
    const descriptionDoc = ed.descriptionBody ?? plainToDoc(ed.description);
    setEditionDescDoc(descriptionDoc);
    setEditionDesc(docToPlainText(descriptionDoc));
    setEditionDescKey((k) => k + 1);
    setEditionFaqSchema(!!ed.faqSchemaEnabled);
  };

  const handleSaveEdition = async (e: React.FormEvent) => {
    e.preventDefault();
    const parentEvent = events.find((ev) => ev.slug === editionEventSlug);
    if (!parentEvent || editionSaving) return;
    if (!editionTitle.trim() || !Number.isInteger(editionYear) || editionYear < 1900 || editionYear > 2200) {
      setFormError('Enter an edition title and a valid staging year (1900–2200).');
      return;
    }
    setFormError(null);
    const facts = cleanRecords(editionFacts, QUICK_FACT_FIELDS, 'Quick fact');
    const champions = cleanRecords(editionChampions, CHAMPION_FIELDS, 'Defending champion');
    if (!facts.ok || !champions.ok) { setFormError(((!facts.ok ? facts : champions) as { error: string }).error); return; }
    if (editionEnd && editionStart && editionEnd < editionStart) { setFormError('The end date cannot be before the start date.'); return; }
    const participants = editionParticipants.trim() === '' ? null : Number(editionParticipants);
    if (participants !== null && (!Number.isInteger(participants) || participants < 0 || participants > 100000)) { setFormError('Participants must be a whole number from 0 to 100000.'); return; }

    // PHASE H: every edition detail and SEO value is saved exactly as edited — nothing is regenerated.
    const details = {
      title: editionTitle.trim(),
      startDate: editionStart || null,
      endDate: editionEnd || null,
      venue: editionVenue.trim() || null,
      location: editionLocation.trim() || null,
      status: editionStatus,
      prizeMoneyTotal: editionPurse.trim() || undefined,
      description: editionDesc,
      // The server re-validates the document and derives `description` from it.
      descriptionBody: editionDesc.trim() ? editionDescDoc : null,
      officialSourceUrl: editionSourceUrl.trim() || undefined,
      qualificationInfo: editionQualification.trim() || undefined,
      participantsCount: participants ?? undefined,
      quickFacts: facts.value as { label: string; value: string }[],
      defendingChampions: champions.value as { category: string; name: string }[],
      seo: draftToSeo(editionSeo, editionSeoExisting),
      faqSchemaEnabled: editionFaqSchema,
    };
    setEditionSaving(true);
    let staleEditionSave = false;
    const ok = editingEditionId
      ? await updateEdition(editingEditionId, {
          ...details,
          // Clearing a field must clear it on the server (undefined would be ignored).
          prizeMoneyTotal: editionPurse.trim(),
          officialSourceUrl: editionSourceUrl.trim(),
          qualificationInfo: editionQualification.trim(),
          participantsCount: participants as number,
          ...(editionImage !== (editions.find((ed) => ed.id === editingEditionId)?.featuredImage || '') ? { featuredImage: editionImage || null } : {}),
        }, { expectedVersion: editionAutosave.baseVersion(), onStale: () => { staleEditionSave = true; } })
      : await addEdition({
          ...details,
          eventSlug: editionEventSlug,
          sportSlug: parentEvent.sportSlug,
          year: Number(editionYear),
          featuredImage: editionImage || null,
        });
    setEditionSaving(false);
    if (staleEditionSave) { setStaleEdition(true); return; }
    if (!ok) { setFormError('The edition was not saved. Check the message above and try again.'); return; }
    await editionAutosave.applied(); // the working copy is now the edition itself
    flash(editingEditionId ? `Edition ${editionYear} updated.` : `Edition ${editionYear} for ${parentEvent.name} staged.`);
    resetEditionForm();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800 gap-3">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Championships & Yearly Editions
          </h2>
          <p className="text-xs text-stone-500 mt-0.5 dark:text-stone-400">
            Preserve permanent event heritage while staging annual tournament editions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('events')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              activeSubTab === 'events' ? 'bg-amber-700 text-white font-semibold' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
            }`}
          >
            Permanent Events ({events.length})
          </button>
          <button
            onClick={() => setActiveSubTab('editions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              activeSubTab === 'editions' ? 'bg-amber-700 text-white font-semibold' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
            }`}
          >
            Staged Editions ({editions.length})
          </button>
        </div>
      </div>

      {feedback && (
        <div role="status" className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}
      {formError && (
        <div role="alert" className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-semibold text-rose-800 dark:text-rose-200">
          {formError}
        </div>
      )}

      {/* SUBTAB 1: PERMANENT EVENTS */}
      {activeSubTab === 'events' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {!isCreatingEvent && (
              <Button disabled={sports.length === 0} onClick={newEvent} size="sm">
                + New Permanent Event
              </Button>
            )}
          </div>

          {isCreatingEvent && (
            <form id="event-form" onSubmit={handleSaveEvent} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
              <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                {editingEventId ? 'Edit Permanent Event' : 'Register Permanent Event Institution'}
              </h3>
              <AutosaveStatus autosave={eventAutosave} onLoadNewer={eventAutosave.conflict ? () => { const c = eventAutosave.conflict!; applyEventPayload(c.payload as Partial<EventDraftPayload>); eventAutosave.start({ entityId: c.entityId, baseVersion: c.baseVersion, draft: c }); } : undefined} />
              {eventRecovery && <DraftRecoveryBanner offer={eventRecovery} onContinue={continueEventDraft} onDiscard={() => void discardEventRecovery()} />}
              {staleEvent && <StaleSaveWarning onDismiss={() => setStaleEvent(false)} onApplyAnyway={() => { eventAutosave.setBaseVersion(null); setStaleEvent(false); (document.getElementById('event-form') as HTMLFormElement | null)?.requestSubmit(); }} />}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="event-editor-field-1" className="block font-semibold mb-1">Event Name *</label>
                  <input id="event-editor-field-1"
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
                  <label htmlFor="event-editor-field-2" className="block font-semibold mb-1">URL Slug *</label>
                  <input id="event-editor-field-2"
                    type="text"
                    required
                    value={eventSlug}
                    onChange={(e) => setEventSlug(e.target.value)}
                    placeholder="us-open"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-3" className="block font-semibold mb-1">Sport Discipline *</label>
                  <select id="event-editor-field-3"
                    value={eventSportSlug}
                    onChange={(e) => changeEventSport(e.target.value)}
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

              {editingEventId && (
                <div className="text-xs">
                  <label htmlFor="event-current-edition" className="block font-semibold mb-1">Current edition (editor selected)</label>
                  <select id="event-current-edition" value={eventCurrentEditionYear} onChange={(e) => setEventCurrentEditionYear(e.target.value)} className="w-full sm:w-72 p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950">
                    <option value="">No current edition selected</option>
                    {eventCurrentEditionYear && !editions.some((ed) => ed.sportSlug === eventSportSlug && ed.eventSlug === eventSlug && String(ed.year) === eventCurrentEditionYear) && (
                      <option value={eventCurrentEditionYear}>{eventCurrentEditionYear} (existing selection; edition not found)</option>
                    )}
                    {editions.filter((ed) => ed.sportSlug === eventSportSlug && ed.eventSlug === eventSlug).map((ed) => <option key={ed.id} value={ed.year}>{ed.year} — {ed.title}</option>)}
                  </select>
                  <p className="mt-1 text-stone-500 dark:text-stone-400">Create an edition first, then choose it here. An existing unmatched selection is preserved until you change it.</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="event-editor-field-4" className="block font-semibold mb-1">Short Name</label>
                  <input id="event-editor-field-4"
                    type="text"
                    value={eventShortName}
                    onChange={(e) => setEventShortName(e.target.value)}
                    placeholder="e.g. US Open"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                  <label htmlFor="event-alt-names" className="mt-3 block font-semibold mb-1">Alternative names <span className="font-normal text-stone-500">(one per line — used by search)</span></label>
                  <textarea id="event-alt-names" rows={2} maxLength={1000} value={eventAltNames} onChange={(e) => setEventAltNames(e.target.value)} placeholder={'e.g. Roland Garros\nRoland-Garros'} className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" />
                </div>
                <div>
                  <label htmlFor="event-editor-field-5" className="block font-semibold mb-1">Default Venue Ground</label>
                  <input id="event-editor-field-5"
                    type="text"
                    value={eventVenue}
                    onChange={(e) => setEventVenue(e.target.value)}
                    placeholder="e.g. USTA Billie Jean King NTC"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-6" className="block font-semibold mb-1">Default Location</label>
                  <input id="event-editor-field-6"
                    type="text"
                    value={eventLocation}
                    onChange={(e) => setEventLocation(e.target.value)}
                    placeholder="e.g. New York, USA"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-7" className="block font-semibold mb-1">Event Type</label>
                  <input id="event-editor-field-7"
                    type="text"
                    value={eventType}
                    maxLength={80}
                    list="event-type-suggestions"
                    onChange={(e) => setEventType(e.target.value)}
                    placeholder="e.g. Grand Slam, League, Major, Grand Prix"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                  <datalist id="event-type-suggestions">
                    {Array.from(new Set(events.map((ev) => ev.eventType).filter(Boolean))).map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="event-frequency" className="block font-semibold mb-1">Frequency (if confirmed)</label>
                  <input id="event-frequency" type="text" maxLength={200} value={eventFreq} onChange={(e) => setEventFreq(e.target.value)} placeholder="e.g. Annual" className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" />
                </div>
                <div>
                  <label htmlFor="event-editor-field-8" className="block font-semibold mb-1">Official Website / Source</label>
                  <input id="event-editor-field-8"
                    type="url"
                    value={eventOfficialSourceUrl}
                    onChange={(e) => setEventOfficialSourceUrl(e.target.value)}
                    placeholder="https://www.rolandgarros.com/"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
              </div>

              <MediaImageField id="event-image" label="Event image (Media Library)" value={eventImage} onChange={setEventImage} items={mediaItems} />

              <div className="text-xs">
                <span id="event-overview-label" className="block font-semibold mb-1">Event Overview / Scope (optional)</span>
                <p className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">Permanent tournament identity and status. Formatting, links, lists and tables are kept; images belong in the Event image above.</p>
                <div className="rounded-lg border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-950" aria-labelledby="event-overview-label">
                  <RichTextEditor key={eventDescKey} initialDoc={eventDescDoc} inputId="event-editor-field-9" ariaLabel="Event Overview / Scope" allowMedia={false} onChange={(doc) => { setEventDescDoc(doc); setEventDesc(docToPlainText(doc)); }} />
                </div>
                {eventDesc.length > 5000 && <p className="mt-1 font-semibold text-rose-700 dark:text-rose-400">The overview is limited to 5,000 characters of text ({eventDesc.length.toLocaleString()} now).</p>}
              </div>

              {dynamicLoading && <p role="status" className="text-xs">Loading Sport-specific fields…</p>}
              {dynamicError && <p role="alert" className="text-xs text-rose-700">{dynamicError} Try selecting this Sport again or reopen the form.</p>}
              {!dynamicLoading && !dynamicError && <DynamicEventFields fields={dynamicFields} values={eventValues} legacyMissing={Boolean(editingEventId)} onChange={(values) => { setEventValues(values); setEventValuesDirty(true); }} />}
              {Object.keys(eventValues).some((key) => !dynamicFields.some((field) => field.key === key)) && !dynamicLoading && <p className="text-xs text-amber-700">This Event contains legacy values with no current field definition. Common-field edits preserve them. Restore the definition before changing custom values.</p>}
              <SeoFields idPrefix="event-seo" value={eventSeo} onChange={setEventSeo} defaults={eventSeoDefaults(eventName, eventDesc)} />
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={eventFaqSchema} onChange={(e) => setEventFaqSchema(e.target.checked)} className="mt-0.5" /><span><span className="font-semibold">FAQPage structured data</span> for this event&apos;s published FAQ (manage questions in FAQ; only output when they pass validation).</span></label>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => void discardEvent()} disabled={eventSaving}>
                  Discard changes
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void closeEvent()} disabled={eventSaving} title="Closes the editor. Unsaved changes stay in the working copy.">
                  Cancel
                </Button>
                <Button type="submit" size="sm" isLoading={eventSaving}>
                  {editingEventId ? 'Save Updates' : 'Save Event'}
                </Button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
                <tr>
                  <th className="p-3">Event Name</th>
                  <th className="p-3">Sport</th>
                  <th className="p-3">Active Edition</th>
                  <th className="p-3">Default Venue</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {events.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-stone-500 dark:text-stone-400">{sports.length ? 'No permanent events yet. Register the first event above.' : 'Create a sport before registering an event.'}</td></tr>}
                {events.map((evt) => {
                  const sp = sports.find((s) => s.slug === evt.sportSlug);
                  return (
                    <tr key={evt.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                      <td className="p-3 font-semibold text-stone-900 dark:text-stone-100">
                        {evt.name}{unsavedBadge(`event:${evt.id}`)}
                        <span className="block text-[11px] font-mono text-stone-500 dark:text-stone-400">/{evt.sportSlug}/{evt.slug}</span>
                      </td>
                      <td className="p-3">{sp?.name}</td>
                      <td className="p-3 font-mono tabular-nums">{evt.currentEditionYear ?? 'Not selected'}</td>
                      <td className="p-3 text-stone-500 dark:text-stone-400">{evt.defaultVenue || '—'}</td>
                      <td className="p-3 text-right space-x-2">
                        <button
                          onClick={() => navigate(`/${evt.sportSlug}/${evt.slug}`)}
                          className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold cursor-pointer"
                        >
                          View
                        </button>
                        <button
                          onClick={() => void openEvent(evt)}
                          className="text-amber-700 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
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
              <Button disabled={events.length === 0} onClick={startCreateEdition} size="sm">
                + Stage Yearly Edition
              </Button>
            )}
          </div>

          {isCreatingEdition && (
            <form id="edition-form" onSubmit={handleSaveEdition} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
              <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
                {editingEditionId ? 'Edit Tournament Edition' : 'Stage Yearly Tournament Edition (e.g. 2028)'}
              </h3>
              <AutosaveStatus autosave={editionAutosave} onLoadNewer={editionAutosave.conflict ? () => { const c = editionAutosave.conflict!; applyEditionPayload(c.payload as Partial<EditionDraftPayload>); editionAutosave.start({ entityId: c.entityId, baseVersion: c.baseVersion, draft: c }); } : undefined} />
              {editionRecovery && <DraftRecoveryBanner offer={editionRecovery} onContinue={continueEditionDraft} onDiscard={() => void discardEditionRecovery()} />}
              {staleEdition && <StaleSaveWarning onDismiss={() => setStaleEdition(false)} onApplyAnyway={() => { editionAutosave.setBaseVersion(null); setStaleEdition(false); (document.getElementById('edition-form') as HTMLFormElement | null)?.requestSubmit(); }} />}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label htmlFor="event-editor-field-10" className="block font-semibold mb-1">Parent Event *</label>
                  <select id="event-editor-field-10"
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
                  <label htmlFor="event-editor-field-11" className="block font-semibold mb-1">Staging Year *</label>
                  <input id="event-editor-field-11"
                    type="number"
                    required
                    disabled={!!editingEditionId}
                    value={editionYear || ''}
                    onChange={(e) => setEditionYear(Number(e.target.value))}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono disabled:opacity-60"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-12" className="block font-semibold mb-1">Edition Title *</label>
                  <input id="event-editor-field-12"
                    type="text"
                    required
                    value={editionTitle}
                    onChange={(e) => setEditionTitle(e.target.value)}
                    placeholder="e.g. 2028 French Open"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-13" className="block font-semibold mb-1">Status</label>
                  <select id="event-editor-field-13"
                    value={editionStatus}
                    onChange={(e) => setEditionStatus(e.target.value as any)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-semibold"
                  >
                    <option value="upcoming">Upcoming</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="event-editor-field-14" className="block font-semibold mb-1">Start Date</label>
                  <input id="event-editor-field-14"
                    type="date"
                    value={editionStart}
                    onChange={(e) => setEditionStart(e.target.value)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-15" className="block font-semibold mb-1">End Date</label>
                  <input id="event-editor-field-15"
                    type="date"
                    value={editionEnd}
                    onChange={(e) => setEditionEnd(e.target.value)}
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                  />
                </div>
                <div>
                  <label htmlFor="event-editor-field-16" className="block font-semibold mb-1">Total Prize Money / Purse</label>
                  <input id="event-editor-field-16"
                    type="text"
                    value={editionPurse}
                    onChange={(e) => setEditionPurse(e.target.value)}
                    placeholder="e.g. €56,000,000"
                    className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
                  />
                </div>
              </div>

              {/* PHASE H: edition details editors could not manage before. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label htmlFor="edition-venue" className="block font-semibold mb-1">Venue</label>
                  <input id="edition-venue" type="text" maxLength={200} value={editionVenue} onChange={(e) => setEditionVenue(e.target.value)} placeholder="Leave empty if not confirmed" className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" />
                </div>
                <div>
                  <label htmlFor="edition-location" className="block font-semibold mb-1">Location</label>
                  <input id="edition-location" type="text" maxLength={200} value={editionLocation} onChange={(e) => setEditionLocation(e.target.value)} placeholder="Leave empty if not confirmed" className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" />
                </div>
                <div>
                  <label htmlFor="edition-source" className="block font-semibold mb-1">Official source</label>
                  <input id="edition-source" type="url" maxLength={2048} value={editionSourceUrl} onChange={(e) => setEditionSourceUrl(e.target.value)} placeholder="https://" className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono" />
                </div>
              </div>

              <MediaImageField id="edition-image" label="Edition image (Media Library)" value={editionImage} onChange={setEditionImage} items={mediaItems} />

              <div className="text-xs">
                <div className="mb-1 flex flex-wrap justify-between gap-2">
                  <span id="edition-description-label" className="font-semibold">Short edition description</span>
                  <span className={`tabular-nums ${wordCount(editionDesc) && (wordCount(editionDesc) < 80 || wordCount(editionDesc) > 150) ? 'text-amber-700 dark:text-amber-400' : 'text-stone-500 dark:text-stone-400'}`}>{wordCount(editionDesc)} words · recommended 80–150 (about 100–120)</span>
                </div>
                <p className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">Describe this specific edition, give useful context and explain what SportingSpy covers. Do not keyword-stuff. Formatting, links, lists and tables are kept; images belong in the Edition image above.</p>
                <div className="rounded-lg border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-950" aria-labelledby="edition-description-label">
                  <RichTextEditor key={editionDescKey} initialDoc={editionDescDoc} inputId="edition-description" ariaLabel="Short edition description" allowMedia={false} onChange={(doc) => { setEditionDescDoc(doc); setEditionDesc(docToPlainText(doc)); }} />
                </div>
                {editionDesc.length > 5000 && <p className="mt-1 font-semibold text-rose-700 dark:text-rose-400">The description is limited to 5,000 characters of text ({editionDesc.length.toLocaleString()} now).</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem] gap-3 text-xs">
                <div>
                  <label htmlFor="edition-qualification" className="block font-semibold mb-1">Qualification</label>
                  <textarea id="edition-qualification" rows={2} maxLength={3000} value={editionQualification} onChange={(e) => setEditionQualification(e.target.value)} placeholder="How players or teams qualify (leave empty if not applicable)" className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" />
                </div>
                <div>
                  <label htmlFor="edition-participants" className="block font-semibold mb-1">Participants</label>
                  <input id="edition-participants" type="number" min={0} max={100000} step={1} inputMode="numeric" value={editionParticipants} onChange={(e) => setEditionParticipants(e.target.value)} placeholder="e.g. 128" className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                <RecordList legend="Quick facts" help="Sport-specific facts shown at the top of the edition page (surface, format, course, stadium…)." items={editionFacts} onChange={setEditionFacts} fields={QUICK_FACT_FIELDS} addLabel="+ Add quick fact" max={20} emptyText="No quick facts." />
                <RecordList legend="Defending champions" items={editionChampions} onChange={setEditionChampions} fields={CHAMPION_FIELDS} addLabel="+ Add champion" max={20} emptyText="No defending champions listed." />
              </div>

              <SeoFields idPrefix="edition-seo" value={editionSeo} onChange={setEditionSeo} defaults={editionSeoDefaults(editionTitle || `${editionYear} ${events.find((ev) => ev.slug === editionEventSlug)?.name ?? ''}`, editionDesc)} />
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={editionFaqSchema} onChange={(e) => setEditionFaqSchema(e.target.checked)} className="mt-0.5" /><span><span className="font-semibold">FAQPage structured data</span> for this edition&apos;s published FAQ (manage questions in FAQ; only output when they pass validation).</span></label>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => void discardEdition()} disabled={editionSaving}>
                  Discard changes
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void closeEdition()} disabled={editionSaving} title="Closes the editor. Unsaved changes stay in the working copy.">
                  Cancel
                </Button>
                <Button type="submit" size="sm" isLoading={editionSaving}>
                  {editingEditionId ? 'Save Changes' : 'Stage Edition'}
                </Button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
                <tr>
                  <th className="p-3">Edition Title</th>
                  <th className="p-3">Year</th>
                  <th className="p-3">Dates</th>
                  <th className="p-3">Venue</th>
                  <th className="p-3">
                    <select
                      aria-label="Filter editions by status"
                      value={editionStatusFilter}
                      onChange={(e) => setEditionStatusFilter(e.target.value as EditionStatus | '')}
                      className="p-1 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[10px] font-semibold uppercase"
                    >
                      <option value="">Status: All</option>
                      {EDITION_STATUSES.map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {!editions.some((ed) => !editionStatusFilter || ed.status === editionStatusFilter) && <tr><td colSpan={6} className="p-6 text-center text-stone-500 dark:text-stone-400">{editionStatusFilter ? 'No editions with this status.' : events.length ? 'No editions yet. Stage the first edition above.' : 'Register an event before staging an edition.'}</td></tr>}
                {editions.filter((ed) => !editionStatusFilter || ed.status === editionStatusFilter).map((ed) => (
                  <tr key={ed.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                    <td className="p-3 font-semibold text-stone-900 dark:text-stone-100">{ed.title}{unsavedBadge(`edition:${ed.id}`)}</td>
                    <td className="p-3 font-mono tabular-nums">{ed.year}</td>
                    <td className="p-3 text-stone-500 tabular-nums dark:text-stone-400">
                      {ed.startDate && ed.endDate ? `${ed.startDate} - ${ed.endDate}` : ed.startDate || ed.endDate || 'Not confirmed'}
                    </td>
                    <td className="p-3 text-stone-500 dark:text-stone-400">{ed.venue || '—'}</td>
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
                        onClick={() => void openEdition(ed)}
                        className="text-amber-700 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
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
