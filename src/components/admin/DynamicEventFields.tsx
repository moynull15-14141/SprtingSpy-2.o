import React from 'react';
import type { SportEventFieldDefinition, SportEventFieldValues } from '../../types';

export function DynamicEventFields({ fields, values, onChange, legacyMissing = false }: { fields: SportEventFieldDefinition[]; values: SportEventFieldValues; onChange: (values: SportEventFieldValues) => void; legacyMissing?: boolean }) {
  const visible = fields.filter((field) => field.adminVisible).sort((a, b) => a.order - b.order);
  if (!visible.length) return null;
  const update = (field: SportEventFieldDefinition, input: string | boolean) => {
    const next = { ...values };
    if (field.type === 'boolean') next[field.key] = input === true;
    else if (input === '') delete next[field.key];
    else if (field.type === 'number') next[field.key] = Number(input);
    else next[field.key] = input;
    onChange(next);
  };
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700"><legend className="px-1 font-semibold">Sport-specific Event details</legend><div className="grid gap-3 sm:grid-cols-2">
    {visible.map((field) => {
      const id = `event-dynamic-${field.key}`;
      const value = values[field.key];
      const required = field.required && !(legacyMissing && !(field.key in values));
      return <div key={field.key} className="min-w-0 text-xs"><label htmlFor={id} className="mb-1 block font-semibold break-words">{field.label}{required ? ' *' : ''}</label>
        {field.type === 'boolean' ? <select id={id} value={value === true ? 'true' : value === false ? 'false' : ''} required={required} onChange={(e) => { if (e.target.value === '') { const next = { ...values }; delete next[field.key]; onChange(next); } else update(field, e.target.value === 'true'); }} className="w-full min-w-0 rounded border border-stone-300 bg-white p-2 dark:border-stone-700 dark:bg-stone-950"><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>
          : field.type === 'select' ? <select id={id} required={required} value={typeof value === 'string' ? value : ''} onChange={(e) => update(field, e.target.value)} className="w-full min-w-0 rounded border border-stone-300 bg-white p-2 dark:border-stone-700 dark:bg-stone-950"><option value="">Choose an option</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>
          : field.type === 'textarea' ? <textarea id={id} required={required} maxLength={5000} rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => update(field, e.target.value)} className="w-full min-w-0 rounded border border-stone-300 bg-white p-2 dark:border-stone-700 dark:bg-stone-950" />
          : <input id={id} required={required} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'} maxLength={field.type === 'number' ? undefined : 500} value={value === undefined ? '' : String(value)} onChange={(e) => update(field, e.target.value)} className="w-full min-w-0 rounded border border-stone-300 bg-white p-2 dark:border-stone-700 dark:bg-stone-950" />}
        {field.helpText && <p className="mt-1 break-words text-stone-500 dark:text-stone-400">{field.helpText}</p>}
        {legacyMissing && field.required && !(field.key in values) && <p className="mt-1 text-amber-700">Existing Event has no value. Add one when available.</p>}
      </div>;
    })}
  </div></fieldset>;
}
