import type { DocumentFieldName, DocumentFields, DetectedField, ExtractedSection, ExtractionProposal, FaqCandidate, RawExtraction, SourceEvidence } from './types';

const FIELD_LABELS: Record<string, DocumentFieldName> = {
  TITLE: 'title', SUBTITLE: 'subtitle', SPORT: 'sport', EVENT: 'event', YEAR: 'editionYear', EDITION: 'editionYear',
  'ARTICLE TYPE': 'articleType', AUTHOR: 'author', CONTENT: 'body',
  'SEO TITLE': 'seoTitle', 'META DESCRIPTION': 'metaDescription', KEYWORDS: 'keywords',
  'START DATE': 'startDate', 'END DATE': 'endDate', VENUE: 'venue',
};
const LABEL = new RegExp(`^(${Object.keys(FIELD_LABELS).sort((a, b) => b.length - a.length).join('|').replace(/ /g, '\\s+')})\\s*:\\s*(.*)$`, 'i');
const FAQ_LABEL = /^(Q(?:UESTION)?|A(?:NSWER)?)(\d*)\s*:\s*(.*)$/i;

export function normalizeText(value: string): string {
  return value.normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u00ad/g, '')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unresolved<T = string>(): DetectedField<T> {
  return { value: null, confidence: 'UNRESOLVED', evidence: [] };
}

function emptyFields(): DocumentFields {
  return {
    title: unresolved(), sport: unresolved(), event: unresolved(), editionYear: unresolved<number>(),
    articleType: unresolved(), author: unresolved(), subtitle: unresolved(), excerpt: unresolved(),
    body: unresolved(), seoTitle: unresolved(), metaDescription: unresolved(), keywords: unresolved<string[]>(),
    startDate: unresolved(), endDate: unresolved(), venue: unresolved(),
  };
}

const locationOf = (section: ExtractedSection) => ({
  ...(section.page ? { page: section.page } : {}),
  ...(section.paragraph ? { paragraph: section.paragraph } : {}),
  ...(section.table ? { table: section.table } : {}),
  ...(section.row ? { row: section.row } : {}),
  ...(section.line ? { line: section.line } : {}),
});

function extractFaqs(sections: ExtractedSection[], sourceType: RawExtraction['sourceType'], warnings: string[]): FaqCandidate[] {
  type Token = { kind: 'question' | 'answer'; number: string; value: string; evidence: SourceEvidence };
  const tokens: Token[] = [];
  for (const section of sections) {
    if (section.kind === 'page-break') continue;
    if (section.kind === 'table') {
      for (const [rowIndex, row] of (section.rows ?? []).entries()) {
        if (row.length !== 2) continue;
        const match = normalizeText(row[0]).match(/^(Q(?:UESTION)?|A(?:NSWER)?)(\d*)\s*:?$/i);
        if (!match) continue;
        tokens.push({
          kind: /^Q/i.test(match[1]) ? 'question' : 'answer', number: match[2], value: normalizeText(row[1]),
          evidence: { field: 'faq', excerpt: `${row[0]} | ${row[1]}`.slice(0, 500), sectionKind: 'table', sourceType, ...locationOf(section), row: rowIndex + 1 },
        });
      }
      continue;
    }
    const lines = section.text.split('\n');
    for (const [lineIndex, line] of lines.entries()) {
      const match = line.match(FAQ_LABEL);
      if (!match) {
        const previous = tokens[tokens.length - 1];
        if (previous?.kind === 'answer' && line.trim() && !LABEL.test(line) && !/^FAQS?$/i.test(line.trim())) previous.value = normalizeText(`${previous.value}\n${line}`);
        continue;
      }
      tokens.push({
        kind: /^Q/i.test(match[1]) ? 'question' : 'answer', number: match[2], value: normalizeText(match[3]),
        evidence: {
          field: 'faq', excerpt: line.slice(0, 500), sectionKind: section.kind, sourceType, ...locationOf(section),
          ...(section.line ? { line: section.line + lineIndex } : {}),
        },
      });
    }
  }

  const candidates: FaqCandidate[] = [];
  let question: Token | null = null;
  for (const token of tokens) {
    if (token.kind === 'question') {
      if (question) warnings.push(`FAQ question “${question.value.slice(0, 80)}” has no complete answer.`);
      question = token;
      continue;
    }
    if (!question) { warnings.push('An FAQ answer was found without a preceding question.'); continue; }
    if (!question.value || !token.value) { warnings.push('An incomplete FAQ question/answer pair was ignored.'); question = null; continue; }
    if (question.number && token.number && question.number !== token.number) {
      warnings.push(`FAQ labels Q${question.number} and A${token.number} do not match; review the source.`);
      question = null;
      continue;
    }
    if (candidates.length < 50) candidates.push({ question: question.value, answer: token.value, confidence: 'HIGH', evidence: [question.evidence, token.evidence] });
    else warnings.push('Only the first 50 complete FAQ candidates are included in one source proposal.');
    question = null;
  }
  if (question) warnings.push(`FAQ question “${question.value.slice(0, 80)}” has no complete answer.`);
  const seen = new Map<string, number>();
  for (const faq of candidates) {
    const key = faq.question.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [questionKey, count] of seen) if (count > 1) warnings.push(`Duplicate FAQ question detected (${count} occurrences): “${questionKey.slice(0, 80)}”.`);
  return candidates;
}

export function buildProposal(raw: RawExtraction): ExtractionProposal {
  const sections = raw.sections.map((section) => ({ ...section, text: normalizeText(section.text), ...(section.rows ? { rows: section.rows.map((row) => row.map(normalizeText)) } : {}) }))
    .filter((section) => section.kind === 'page-break' || section.text || section.rows?.some((row) => row.some(Boolean)));
  const fields = emptyFields();
  const warnings = [...raw.warnings];
  const faqs = extractFaqs(sections, raw.sourceType, warnings);
  const found = new Map<DocumentFieldName, { value: string; evidence: SourceEvidence }[]>();
  let activeContent: { evidence: SourceEvidence; lines: string[] } | null = null;

  const addCandidate = (field: DocumentFieldName, value: string, evidence: SourceEvidence) => {
    const list = found.get(field) ?? [];
    list.push({ value: normalizeText(value), evidence });
    found.set(field, list);
  };

  for (const section of sections) {
    if (section.kind === 'page-break') continue;
    if (section.kind === 'table') {
      for (const [rowIndex, row] of (section.rows ?? []).entries()) {
        if (row.length !== 2) continue;
        const normalizedLabel = normalizeText(row[0]).replace(/\s*:\s*$/, '').toUpperCase().replace(/\s+/g, ' ');
        const field = FIELD_LABELS[normalizedLabel];
        if (!field) continue;
        const value = normalizeText(row[1]);
        const evidence: SourceEvidence = {
          field, excerpt: `${row[0]} | ${row[1]}`.slice(0, 500), sectionKind: 'table', sourceType: raw.sourceType,
          ...locationOf(section), row: rowIndex + 1,
        };
        addCandidate(field, value, evidence);
      }
      continue;
    }
    const lines = section.text.split('\n');
    for (const line of lines) {
      if (FAQ_LABEL.test(line) || /^FAQS?$/i.test(line.trim())) { activeContent = null; continue; }
      const match = line.match(LABEL);
      if (match) {
        if (activeContent) activeContent = null;
        const normalizedLabel = match[1].toUpperCase().replace(/\s+/g, ' ');
        const field = FIELD_LABELS[normalizedLabel];
        const evidence: SourceEvidence = { field, excerpt: line.slice(0, 500), sectionKind: section.kind, sourceType: raw.sourceType, ...locationOf(section) };
        addCandidate(field, match[2], evidence);
        if (field === 'body') activeContent = { evidence, lines: match[2] ? [match[2]] : [] };
      } else if (activeContent) {
        activeContent.lines.push(line);
        const body = found.get('body')!;
        body[body.length - 1].value = normalizeText(activeContent.lines.join('\n'));
      }
    }
  }

  for (const [field, candidates] of found) {
    const nonempty = candidates.filter((candidate) => candidate.value);
    const values = [...new Set(nonempty.map((candidate) => candidate.value))];
    if (candidates.length > 1) warnings.push(values.length > 1 ? `Conflicting ${field} labels were found; review the alternatives.` : `Duplicate ${field} labels were found.`);
    if (!nonempty.length || values.length !== 1) {
      fields[field] = { value: null, confidence: 'UNRESOLVED', evidence: candidates.map((candidate) => candidate.evidence) } as never;
      continue;
    }
    const rawValue = values[0];
    let value: string | number | string[] = rawValue;
    if (field === 'editionYear') {
      const year = /^\d{4}$/.test(rawValue) ? Number(rawValue) : NaN;
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        warnings.push('YEAR is not a valid staging year from 1900 to 2200.');
        fields.editionYear = { value: null, confidence: 'UNRESOLVED', evidence: nonempty.map((candidate) => candidate.evidence) };
        continue;
      }
      value = year;
    } else if (field === 'keywords') {
      value = rawValue.split(/[,;\n]/).map(normalizeText).filter(Boolean).slice(0, 30);
    }
    fields[field] = { value, confidence: 'HIGH', evidence: nonempty.map((candidate) => candidate.evidence) } as never;
  }

  if (!fields.title.value) {
    const heading = sections.find((section) => section.kind === 'heading' && section.text && !/^FAQS?$/i.test(section.text));
    if (heading) fields.title = { value: heading.text, confidence: 'MEDIUM', evidence: [{ field: 'title', excerpt: heading.text.slice(0, 500), sectionKind: 'heading', sourceType: raw.sourceType, ...locationOf(heading) }] };
  }
  if (!fields.body.value) {
    const firstHeading = sections.find((item) => item.kind === 'heading' && !/^FAQS?$/i.test(item.text));
    const bodySections = sections.filter((section) => section.kind === 'paragraph' || section.kind === 'table' || (section.kind === 'heading' && section !== firstHeading));
    let insideFaq = false;
    const body = normalizeText(bodySections.map((section) => {
      if (section.kind === 'heading') {
        if (/^FAQS?$/i.test(section.text)) { insideFaq = true; return ''; }
        insideFaq = false;
        return `## ${section.text}`;
      }
      if (section.kind !== 'table') return section.text.split('\n').filter((line) => {
        if (/^FAQS?$/i.test(line.trim()) || FAQ_LABEL.test(line)) { insideFaq = true; return false; }
        if (LABEL.test(line)) insideFaq = false;
        return !insideFaq;
      }).join('\n');
      const remainingRows = (section.rows ?? []).filter((row) => {
        if (row.length !== 2) return true;
        const label = normalizeText(row[0]).replace(/\s*:\s*$/, '').toUpperCase().replace(/\s+/g, ' ');
        return !FIELD_LABELS[label] && !/^(Q(?:UESTION)?|A(?:NSWER)?)\d*$/.test(label);
      });
      return remainingRows.map((row) => row.filter(Boolean).join(' | ')).filter(Boolean).join('\n');
    }).join('\n\n'));
    if (body) fields.body = { value: body, confidence: 'MEDIUM', evidence: bodySections.slice(0, 20).map((section) => ({ field: 'body', excerpt: section.text.slice(0, 500), sectionKind: section.kind, sourceType: raw.sourceType, ...locationOf(section) })) };
  }

  const text = normalizeText(sections.map((section) => section.kind === 'page-break' ? '\n\f\n' : section.text).join('\n\n'));
  const sourceEvidence = Object.values(fields).flatMap((field) => field.evidence);
  return { sourceType: raw.sourceType, text, sections, fields, faqs, warnings: [...new Set(warnings)], sourceEvidence: [...sourceEvidence, ...faqs.flatMap((faq) => faq.evidence)] };
}
