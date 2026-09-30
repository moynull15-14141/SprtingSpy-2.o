/** Contact message limits and shapes shared by the public form, the CMS inbox and the server (PHASE H). */

export const CONTACT_LIMITS = {
  name: { min: 2, max: 100 },
  email: { min: 5, max: 200 },
  subject: { min: 3, max: 150 },
  message: { min: 10, max: 5000 },
} as const;

export const CONTACT_STATUSES = ['open', 'resolved', 'spam'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: ContactStatus;
  readAt: string | null;
  createdAt: string;
}
