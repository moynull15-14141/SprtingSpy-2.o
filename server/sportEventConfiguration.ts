/** E2: validated Sport-level Event definitions and separate Event-level values. */
import type {
  SportEventConfiguration,
  SportEventFieldDefinition,
  SportEventFieldType,
  SportEventFieldValues,
  SportEventTerminology,
  SportEventTerminologyKey,
} from '../src/types';
import { validateIsoDate, validateSafeUrl } from './validation';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): Parsed<never> => ({ ok: false, error });
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const label = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001F\u007F]/.test(value);
const TYPES: readonly SportEventFieldType[] = ['text', 'textarea', 'number', 'boolean', 'date', 'select', 'url'];
const TERMS: readonly SportEventTerminologyKey[] = ['event', 'participant', 'competition', 'venue', 'round'];
const FIELD_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const COMMON_KEYS = new Set(['id', 'name', 'slug', 'sportslug', 'shortname', 'description', 'history', 'frequency', 'defaultvenue', 'defaultlocation', 'currenteditionyear', 'alleditionyears', 'featured', 'isvisible', 'featuredimage', 'officialsourceurl', 'eventtype', 'seo', 'sportspecificvalues']);

export const GENERIC_EVENT_CONFIGURATION: Readonly<{ terminology: SportEventTerminology; fields: readonly SportEventFieldDefinition[] }> = {
  terminology: { event: 'Event', participant: 'Participants', competition: 'Competition', venue: 'Venue', round: 'Round' },
  fields: [],
};

export function parseSportEventConfiguration(input: unknown): Parsed<SportEventConfiguration> {
  const raw = object(input);
  if (!raw || Object.keys(raw).some((key) => !['terminology', 'fields'].includes(key))) return fail('Configuration must contain only terminology and fields.');
  const terms = object(raw.terminology);
  if (!terms) return fail('terminology must be an object.');
  const unknownTerm = Object.keys(terms).find((key) => !TERMS.includes(key as SportEventTerminologyKey));
  if (unknownTerm) return fail(`Unknown terminology key: ${unknownTerm}.`);
  const terminology: Partial<SportEventTerminology> = {};
  const usedLabels = new Set<string>();
  for (const key of TERMS) {
    if (!(key in terms)) continue;
    const value = terms[key];
    if (!label(value, 80)) return fail(`${key} terminology must be a nonempty label of at most 80 characters.`);
    const clean = value.trim();
    if (usedLabels.has(clean.toLocaleLowerCase())) return fail('Terminology labels must not conflict.');
    usedLabels.add(clean.toLocaleLowerCase());
    terminology[key] = clean;
  }
  const resolvedLabels = Object.values({ ...GENERIC_EVENT_CONFIGURATION.terminology, ...terminology }).map((value) => value.toLocaleLowerCase());
  if (new Set(resolvedLabels).size !== resolvedLabels.length) return fail('Terminology labels conflict with another resolved label.');
  if (!Array.isArray(raw.fields) || raw.fields.length > 40) return fail('fields must be an array of at most 40 definitions.');
  const fields: SportEventFieldDefinition[] = [];
  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const [index, entry] of raw.fields.entries()) {
    const field = object(entry);
    if (!field || Object.keys(field).some((key) => !['key', 'label', 'type', 'required', 'order', 'helpText', 'adminVisible', 'publicVisible', 'options'].includes(key))) return fail(`Field ${index + 1} has unsupported properties.`);
    if (typeof field.key !== 'string' || !FIELD_KEY.test(field.key) || COMMON_KEYS.has(field.key.toLocaleLowerCase())) return fail(`Field ${index + 1} has an invalid or reserved key.`);
    if (keys.has(field.key.toLocaleLowerCase())) return fail(`Duplicate field key: ${field.key}.`);
    if (!label(field.label, 100)) return fail(`Field ${field.key} needs a nonempty label of at most 100 characters.`);
    if (typeof field.type !== 'string' || !TYPES.includes(field.type as SportEventFieldType)) return fail(`Field ${field.key} has an unsupported type.`);
    if (!Number.isInteger(field.order) || (field.order as number) < 0 || (field.order as number) > 1000 || orders.has(field.order as number)) return fail(`Field ${field.key} needs a unique order from 0 to 1000.`);
    if (typeof field.required !== 'boolean' || typeof field.adminVisible !== 'boolean' || typeof field.publicVisible !== 'boolean') return fail(`Field ${field.key} requires boolean required/adminVisible/publicVisible flags.`);
    if (field.required && !field.adminVisible) return fail(`Required field ${field.key} must be visible to administrators.`);
    if (field.helpText !== undefined && (typeof field.helpText !== 'string' || field.helpText.length > 300 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(field.helpText))) return fail(`Field ${field.key} has invalid help text.`);
    let options: string[] | undefined;
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 30 || !field.options.every((option) => label(option, 100))) return fail(`Select field ${field.key} needs 1–30 nonempty options.`);
      options = field.options.map((option: string) => option.trim());
      if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) return fail(`Select field ${field.key} has duplicate options.`);
    } else if (field.options !== undefined) return fail(`Only select fields may define options (${field.key}).`);
    keys.add(field.key.toLocaleLowerCase());
    orders.add(field.order as number);
    fields.push({ key: field.key, label: field.label.trim(), type: field.type as SportEventFieldType, required: field.required, order: field.order as number, ...(typeof field.helpText === 'string' && field.helpText.trim() ? { helpText: field.helpText.trim() } : {}), adminVisible: field.adminVisible, publicVisible: field.publicVisible, ...(options ? { options } : {}) });
  }
  fields.sort((a, b) => a.order - b.order);
  return { ok: true, value: { terminology, fields } };
}

/** Stored overrides are optional; an invalid out-of-band document cannot break public rendering. */
export function resolveSportEventConfiguration(stored: unknown) {
  const parsed = stored == null ? null : parseSportEventConfiguration(stored);
  const overrides = parsed?.ok ? parsed.value : null;
  return {
    configured: overrides !== null,
    terminology: { ...GENERIC_EVENT_CONFIGURATION.terminology, ...overrides?.terminology },
    fields: overrides?.fields ?? [],
  };
}

function checkValue(field: SportEventFieldDefinition, input: unknown): Parsed<string | number | boolean> {
  if (field.type === 'boolean') return typeof input === 'boolean' ? { ok: true, value: input } : fail(`${field.key} must be true or false.`);
  if (field.type === 'number') return typeof input === 'number' && Number.isFinite(input) && Math.abs(input) <= 1e12 ? { ok: true, value: input } : fail(`${field.key} must be a finite number.`);
  if (typeof input !== 'string') return fail(`${field.key} must be text.`);
  const value = input.trim();
  if (!value) return fail(`${field.key} cannot be blank.`);
  if (field.type === 'textarea' ? value.length > 5000 : value.length > 500) return fail(`${field.key} is too long.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return fail(`${field.key} contains invalid control characters.`);
  if (field.type === 'date' && !validateIsoDate(value, field.key, true).valid) return fail(`${field.key} must be a real date (YYYY-MM-DD).`);
  if (field.type === 'url' && !validateSafeUrl(value, field.key, { allowRelative: false }).valid) return fail(`${field.key} must be an absolute http(s) URL.`);
  if (field.type === 'select' && !field.options?.includes(value)) return fail(`${field.key} must use a configured option.`);
  return { ok: true, value };
}

/** Values are a complete replacement when supplied; omission of the whole property preserves existing values. */
export function parseSportEventValues(input: unknown, configuration: ReturnType<typeof resolveSportEventConfiguration>, options: { newEvent: boolean; previous?: unknown }): Parsed<SportEventFieldValues> {
  const raw = input === null || input === undefined ? {} : object(input);
  if (!raw) return fail('sportSpecificValues must be an object or null.');
  const previous = object(options.previous) ?? {};
  const definitions = new Map(configuration.fields.map((field) => [field.key, field]));
  const values: SportEventFieldValues = {};
  for (const [key, inputValue] of Object.entries(raw)) {
    const field = definitions.get(key);
    if (!field) return fail(`Unknown sport-specific Event field: ${key}.`);
    if (inputValue === null || inputValue === '') continue;
    const checked = checkValue(field, inputValue);
    if ('error' in checked) return fail(checked.error);
    values[key] = checked.value;
  }
  for (const field of configuration.fields) {
    if (!field.required || field.key in values) continue;
    if (options.newEvent || field.key in previous) return fail(`${field.label} is required.`);
  }
  return { ok: true, value: values };
}

/** Reject definition changes that would orphan or reinterpret already-stored facts. */
export function existingValuesCompatible(input: unknown, configuration: ReturnType<typeof resolveSportEventConfiguration>): string | null {
  const raw = object(input);
  if (!raw || Object.keys(raw).length === 0) return null;
  const definitions = new Map(configuration.fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(raw)) {
    const field = definitions.get(key);
    if (!field) return `Existing Event value ${key} has no field definition in the proposed configuration.`;
    const checked = checkValue(field, value);
    if ('error' in checked) return `Existing Event value ${key} is incompatible: ${checked.error}`;
  }
  return null;
}

/** E4 can render only explicitly public fields; admin-only values stay out of public page data. */
export function publicSportEventValues(input: unknown, configuration: ReturnType<typeof resolveSportEventConfiguration>): SportEventFieldValues {
  const raw = object(input) ?? {};
  const values: SportEventFieldValues = {};
  for (const field of configuration.fields) {
    if (!field.publicVisible || !(field.key in raw)) continue;
    const checked = checkValue(field, raw[field.key]);
    if (checked.ok) values[field.key] = checked.value;
  }
  return values;
}
