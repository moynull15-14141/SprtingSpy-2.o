import assert from 'node:assert/strict';
import { selectRelatedEventRows } from '../services/public/content';

type Fixture = {
  id: string;
  sportSlug: string;
  slug: string;
  name: string;
  featured: boolean;
};

const row = (id: string, name: string, featured = false): Fixture => ({
  id,
  sportSlug: 'tennis',
  slug: id,
  name,
  featured,
});

const priority = [row('team-a', 'Alpha Team'), row('team-b', 'Beta Team', true)];
const fallback = [row('open-a', 'Australian Open', true), row('team-b', 'Beta Team', true), row('open-b', 'US Open')];

assert.deepEqual(
  selectRelatedEventRows(priority, fallback).map((event) => event.id),
  ['team-a', 'team-b', 'open-a'],
  'same-discipline candidates must precede same-sport fallback candidates',
);
assert.deepEqual(
  selectRelatedEventRows([row('a', 'Same Name'), row('b', 'Same Name')], []).map((event) => event.id),
  ['a', 'b'],
  'selection must preserve deterministic database ordering including id tie-breaks',
);
assert.deepEqual(
  selectRelatedEventRows([row('a', 'A')], [row('a', 'A'), row('b', 'B'), row('c', 'C'), row('d', 'D')]).map((event) => event.id),
  ['a', 'b', 'c'],
  'duplicate IDs must be removed and the result capped at three',
);
assert.deepEqual(selectRelatedEventRows([], []), [], 'no candidates must return an empty list');
assert.equal(selectRelatedEventRows([row('a', 'A')], []).length, 1, 'insufficient candidates must remain short');

console.log('Related event selection checks passed.');
