/**
 * Event FAQ SUGGESTIONS (PHASE E5, changed in PHASE R).
 *
 * Questions are derived only from facts stored on the Event and its explicitly
 * selected current Edition. A question appears only when its answer exists;
 * nothing is estimated, defaulted or invented.
 *
 * PHASE R (v2.2 FAQ & Reader Questions: "human/editor approval is mandatory"):
 * derived questions are NO LONGER published automatically. They are offered
 * to editors in Admin → FAQ as suggestions; accepting one creates a DRAFT
 * entry that an editor must review and publish. Public pages show only
 * published editor entries.
 */

import type { EventEdition, Sport, SportEvent, SportEventTerminology } from '../types';
import { longDate } from './eventDates';
import { answerParagraphs } from './faq';
import { editionTiming } from './eventTiming';

export interface EventFaqItem {
  id: string;
  question: string;
  answer: string;
  source: 'editor' | 'event-data';
}

interface EventFaqInput {
  event: Pick<SportEvent, 'name' | 'eventType' | 'frequency' | 'defaultVenue' | 'defaultLocation'>;
  sport: Pick<Sport, 'name'>;
  terminology: Pick<SportEventTerminology, 'event' | 'participant'>;
  currentEdition?: Pick<EventEdition, 'title' | 'status' | 'startDate' | 'endDate' | 'venue' | 'location' | 'participantsCount' | 'defendingChampions'>;
  editorFaqs: { id: string; question: string; answer: string }[];
  today: string;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const place = (venue?: string | null, location?: string | null) => [venue, location].filter((v): v is string => !!v?.trim()).join(', ');
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function dateSpan(startDate?: string | null, endDate?: string | null): string | null {
  if (startDate && endDate && startDate !== endDate) return `from ${longDate(startDate)} to ${longDate(endDate)}`;
  const single = startDate || endDate;
  return single ? `on ${longDate(single)}` : null;
}

export function buildEventFaq({ event, sport, terminology, currentEdition, editorFaqs, today }: EventFaqInput): EventFaqItem[] {
  // Suggestions only (see header); callers must not publish these without an editor.
  const derived: EventFaqItem[] = [];
  const ed = currentEdition;
  const timing = ed ? editionTiming(ed, today) : null;

  const when = ed ? dateSpan(ed.startDate, ed.endDate) : null;
  if (ed && when) {
    const verb = timing === 'past' ? 'took place' : timing === 'ongoing' ? 'is taking place' : 'is scheduled to take place';
    derived.push({ id: 'event-faq-when', source: 'event-data', question: `${timing === 'past' ? 'When was' : 'When is'} ${ed.title}?`, answer: `${ed.title} ${verb} ${when}.` });
  }

  const editionPlace = ed ? place(ed.venue, ed.location) : '';
  const defaultPlace = place(event.defaultVenue, event.defaultLocation);
  if (ed && editionPlace) {
    const verb = timing === 'past' ? 'was held' : timing === 'ongoing' ? 'is being held' : 'will be held';
    derived.push({ id: 'event-faq-where', source: 'event-data', question: `${timing === 'past' ? 'Where was' : 'Where is'} ${ed.title} held?`, answer: `${ed.title} ${verb} at ${editionPlace}.` });
  } else if (defaultPlace) {
    derived.push({ id: 'event-faq-where', source: 'event-data', question: `Where is ${event.name} held?`, answer: `${event.name} is held at ${defaultPlace}.` });
  }

  const champions = (ed?.defendingChampions ?? []).filter((c) => c?.name?.trim());
  if (ed && champions.length) {
    const named = champions.map((c) => (c.category?.trim() ? `${c.name.trim()} (${c.category.trim()})` : c.name.trim()));
    derived.push({ id: 'event-faq-champions', source: 'event-data', question: `${timing === 'past' ? 'Who were' : 'Who are'} the defending champions at ${ed.title}?`, answer: `The defending champions listed for ${ed.title} are ${list(named)}.` });
  }

  if (ed && typeof ed.participantsCount === 'number' && ed.participantsCount > 0) {
    const noun = terminology.participant.toLowerCase();
    derived.push({ id: 'event-faq-participants', source: 'event-data', question: `How many ${noun} ${timing === 'past' ? 'took' : 'take'} part in ${ed.title}?`, answer: `${ed.title} lists ${ed.participantsCount.toLocaleString('en-GB')} ${noun}.` });
  }

  if (event.frequency?.trim()) {
    derived.push({ id: 'event-faq-frequency', source: 'event-data', question: `How often is ${event.name} held?`, answer: `${event.name} is held on this schedule: ${event.frequency.trim()}.` });
  }

  // The sport question is only useful alongside real event facts; on its own it would be filler.
  if (derived.length) {
    const kind = event.eventType?.trim() || terminology.event;
    derived.push({ id: 'event-faq-sport', source: 'event-data', question: `What sport is ${event.name}?`, answer: `${event.name} is a ${sport.name} ${kind.toLowerCase()}.` });
  }

  const editor: EventFaqItem[] = editorFaqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer, source: 'editor' }));
  const editorQuestions = new Set(editor.map((f) => normalize(f.question)));
  return [...editor, ...derived.filter((f) => !editorQuestions.has(normalize(f.question)))];
}

/** Derived suggestions only (no editor entries), for the CMS suggestion list. */
export function eventFaqSuggestions(input: Omit<EventFaqInput, 'editorFaqs'> & { existingQuestions: string[] }): EventFaqItem[] {
  const existing = new Set(input.existingQuestions.map(normalize));
  return buildEventFaq({ ...input, editorFaqs: [] }).filter((f) => f.source === 'event-data' && !existing.has(normalize(f.question)));
}
