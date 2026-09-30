import type { SportEventFieldDefinition, SportEventFieldValue, SportEventFieldValues } from '../../types';

const formatDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function displayValue(field: SportEventFieldDefinition, value: SportEventFieldValue) {
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'date' && typeof value === 'string') return formatDate(value);
  return String(value);
}

function safeHttpUrl(value: SportEventFieldValue) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function DynamicPublicEventFields({ fields, values }: { fields: SportEventFieldDefinition[]; values: SportEventFieldValues }) {
  const visible = fields
    .filter((field) => field.publicVisible && Object.hasOwn(values, field.key) && values[field.key] !== '')
    .sort((a, b) => a.order - b.order);
  if (!visible.length) return null;

  return (
    <section aria-labelledby="event-specific-heading" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-[#121417] sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-500">Sport-specific information</p>
      <h2 id="event-specific-heading" className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Event facts</h2>
      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {visible.map((field) => {
          const value = values[field.key];
          const url = field.type === 'url' ? safeHttpUrl(value) : null;
          if (field.type === 'url' && !url) return null;
          return (
            <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <dt className="break-words text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{field.label}</dt>
              <dd className="mt-1 break-words text-sm leading-relaxed text-stone-900 dark:text-stone-100">
                {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">Visit official resource <span aria-hidden="true">↗</span></a> : displayValue(field, value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
