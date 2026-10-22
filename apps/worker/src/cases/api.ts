import type { ConsentContext, LatLng } from '@masterio/shared';
import { client } from '../api';

/** Споры, инциденты, поддержка, юридические документы и персональные данные — одинаково в Masterio и Masterio Pro. */
const r = client.request;

export type DisputeStatus = 'OPEN' | 'AWAITING_RESPONSE' | 'UNDER_REVIEW' | 'ESCALATED' | 'SETTLED' | 'UNRESOLVED_REFERRED' | 'CLOSED';
export const FINAL_DISPUTE: DisputeStatus[] = ['SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'];

export interface DisputeView {
  id: string;
  orderId: string;
  orderNumber: number;
  reason: string;
  status: DisputeStatus;
  description: string;
  openedBy: 'client' | 'worker' | 'support';
  mine: boolean;
  isAutomatic: boolean;
  responseDueAt: string | null;
  createdAt: string;
  closedAt: string | null;
  outcome: { resolution?: string; summary?: string } | null;
  photos: Array<{ id: string; from: 'client' | 'worker' | 'support'; url: string | null; createdAt: string }>;
  timeline: Array<{ id: string; type: string; from: 'client' | 'worker' | 'support'; text: string | null; createdAt: string }>;
}

export interface TicketView {
  id: string;
  subject: string;
  status: 'OPEN' | 'PENDING_USER' | 'RESOLVED' | 'CLOSED';
  orderId: string | null;
  disputeId: string | null;
  createdAt: string;
  messages: Array<{ id: string; body: string; fromSupport: boolean; createdAt: string }>;
}

export interface TicketRow {
  id: string;
  subject: string;
  status: TicketView['status'];
  updatedAt: string;
  lastMessage: { body: string; fromSupport: boolean; createdAt: string } | null;
}

export interface LegalItem {
  versionId: string;
  documentId: string;
  audience: string;
  version: string;
  locale: string;
  publishedAt: string | null;
}

export interface UploadForm {
  key: string;
  url: string;
  fields: Record<string, string>;
}

export const cases = {
  uploadForm: (purpose: 'dispute_evidence' | 'incident', contentType: string, sizeBytes: number) => r<UploadForm>('POST', '/uploads', { purpose, contentType, sizeBytes }),

  openDispute: (orderId: string, body: { reason: string; description: string; photoKeys: string[] }) =>
    r<{ id: string; status: DisputeStatus }>('POST', `/orders/${orderId}/disputes`, body),
  noShow: (orderId: string, body: { location: LatLng; photoKey: string; comment?: string }) => r<{ id: string }>('POST', `/orders/${orderId}/no-show`, body),
  dispute: (id: string) => r<DisputeView>('GET', `/disputes/${id}`),
  respond: (id: string, body: { text: string; photoKeys: string[] }) => r<DisputeView>('POST', `/disputes/${id}/responses`, body),

  incident: (orderId: string, body: { type: string; description: string; emergencyCalled: boolean; location?: LatLng; photoKeys: string[] }) =>
    r<{ id: string; ticketId: string; emergencyNumber: string }>('POST', `/orders/${orderId}/incidents`, body),

  tickets: () => r<TicketRow[]>('GET', '/support/tickets'),
  ticket: (id: string) => r<TicketView>('GET', `/support/tickets/${id}`),
  createTicket: (body: { subject: string; body: string; orderId?: string }) => r<TicketView>('POST', '/support/tickets', body),
  postTicket: (id: string, body: string) => r<TicketView>('POST', `/support/tickets/${id}/messages`, { body }),

  required: (context: ConsentContext) =>
    r<{ countryCode: string; required: LegalItem[]; accepted: LegalItem[]; notices: LegalItem[] }>('GET', '/legal/required', undefined, { query: { context } }),
  legalText: (versionId: string) => r<{ versionId: string; audience: string; version: string; locale: string; body: string; publishedAt: string }>('GET', `/legal/versions/${versionId}`),
  accept: (context: ConsentContext, versionIds: string[]) => r<unknown>('POST', '/legal/consents', { context, versionIds }),

  exportData: () => r<{ id: string; url: string }>('POST', '/me/data-export'),
  dataRequests: () => r<Array<{ id: string; type: 'export' | 'delete'; status: string; createdAt: string; url: string | null }>>('GET', '/me/data-requests'),
  deleteAccount: (reason?: string) => r<{ status: string; retained: string[] }>('POST', '/me/delete-account', { confirm: true, ...(reason ? { reason } : {}) }),
};

/** Фото с камеры или из галереи → подписанная форма → прямо в закрытое хранилище. Возвращает ключ файла. */
export async function uploadPhoto(purpose: 'dispute_evidence' | 'incident', asset: { uri: string; fileName?: string | null; mimeType?: string; fileSize?: number }): Promise<string> {
  const type = asset.mimeType ?? 'image/jpeg';
  const form = await cases.uploadForm(purpose, type, asset.fileSize ?? 1);
  const body = new FormData();
  for (const [k, v] of Object.entries(form.fields)) body.append(k, v);
  body.append('file', { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type } as unknown as Blob);
  const res = await fetch(form.url, { method: 'POST', body });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return form.key;
}
