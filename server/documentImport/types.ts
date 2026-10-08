export type DocumentSourceType = 'pdf' | 'docx' | 'manual-text';
export type ExtractionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';

export interface SourceLocation {
  page?: number;
  paragraph?: number;
  table?: number;
  row?: number;
  line?: number;
}

export interface SourceEvidence extends SourceLocation {
  field: DocumentFieldName | 'document' | 'faq';
  excerpt: string;
  sectionKind?: ExtractedSection['kind'];
  sourceType?: DocumentSourceType;
}

export interface ExtractedSection extends SourceLocation {
  kind: 'heading' | 'paragraph' | 'table' | 'page-break';
  text: string;
  level?: number;
  rows?: string[][];
}

export interface DetectedField<T = string> {
  value: T | null;
  confidence: ExtractionConfidence;
  evidence: SourceEvidence[];
}

export interface DocumentFields {
  title: DetectedField;
  sport: DetectedField;
  event: DetectedField;
  editionYear: DetectedField<number>;
  articleType: DetectedField;
  author: DetectedField;
  subtitle: DetectedField;
  excerpt: DetectedField;
  body: DetectedField;
  seoTitle: DetectedField;
  metaDescription: DetectedField;
  keywords: DetectedField<string[]>;
  startDate: DetectedField;
  endDate: DetectedField;
  venue: DetectedField;
}

export type DocumentFieldName = keyof DocumentFields;

export interface FaqCandidate {
  question: string;
  answer: string;
  confidence: ExtractionConfidence;
  evidence: SourceEvidence[];
}

export interface ExtractionProposal {
  sourceType: DocumentSourceType;
  text: string;
  sections: ExtractedSection[];
  fields: DocumentFields;
  faqs: FaqCandidate[];
  warnings: string[];
  sourceEvidence: SourceEvidence[];
}

export interface RawExtraction {
  sourceType: DocumentSourceType;
  sections: ExtractedSection[];
  warnings: string[];
}

export class DocumentImportError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'document_invalid') {
    super(message);
    this.name = 'DocumentImportError';
  }
}
