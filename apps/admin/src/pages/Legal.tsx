import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGAL_AUDIENCES, LOCALES, legalVersionSchema } from '@masterio/shared';
import { api } from '../api';
import type { LegalDocRow } from '../api/types';
import { useSession } from '../auth/Session';
import { dateTime } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, PageHead, Section, Status } from '../ui';

const LANG: Record<(typeof LOCALES)[number], string> = { en: 'English', ru: 'Русский', de: 'Deutsch', es: 'Español', hy: 'Հայերեն' };

/**
 * Юридические документы (разделы 18.6, 19.5): редакции по странам на 5 языках, кто проверил, кто и когда
 * опубликовал, сколько согласий. Опубликованную редакцию изменить нельзя — только выпустить новую.
 */
export function LegalPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ['legal'], queryFn: api.legal });
  const [creating, setCreating] = useState<{ audience: string; countryCode: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const done = () => queryClient.invalidateQueries({ queryKey: ['legal'] });
  const publish = useMutation({ mutationFn: (v: { documentId: string; version: string }) => api.publishLegal(v.documentId, v.version), onSuccess: done });
  const remove = useMutation({ mutationFn: (v: { documentId: string; version: string }) => api.deleteLegalDraft(v.documentId, v.version), onSuccess: done });
  const editable = can('editLegal');

  return (
    <>
      <PageHead title={t('legal.title')} sub={t('legal.sub')}>
        {editable ? (
          <button type="button" className="primary" onClick={() => setCreating({ audience: 'CLIENT', countryCode: '' })}>
            {t('legal.newVersion')}
          </button>
        ) : null}
      </PageHead>
      <Note tone="warn">{t('legal.reviewWarning')}</Note>
      <ErrorNote error={publish.error ?? remove.error} />
      {docs.isLoading ? <Loading /> : null}
      <ErrorNote error={docs.error} />
      {docs.data && docs.data.length === 0 ? <Empty>{t('legal.empty')}</Empty> : null}
      <div className="stack">
        {(docs.data ?? []).map((d: LegalDocRow) => (
          <Section
            key={d.id}
            title={
              <>
                {t(`legal.audience.${d.audience}`)} <span className="faint">· {d.countryCode}</span>
              </>
            }
            actions={
              editable ? (
                <button type="button" className="quiet" onClick={() => setCreating({ audience: d.audience, countryCode: d.countryCode })}>
                  {t('legal.newVersion')}
                </button>
              ) : null
            }
            flush
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('legal.version')}</th>
                    <th>{t('orders.status')}</th>
                    <th>{t('legal.reviewedBy')}</th>
                    <th className="num">{t('legal.consents')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.versions.map((v) => (
                    <tr key={v.version}>
                      <td className="num">{v.version}</td>
                      <td>{v.publishedAt ? <Status tone="ok">{t('legal.published', { date: dateTime(v.publishedAt) })}</Status> : <Status tone="warn">{t('legal.draft')}</Status>}</td>
                      <td>{v.legalReviewedBy ?? '—'}</td>
                      <td className="num">{v.consents}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="quiet" onClick={() => setViewing(v.locales[0]?.id ?? null)}>
                            {t('legal.read')}
                          </button>
                          {editable && !v.publishedAt ? (
                            <>
                              <button type="button" className="danger" disabled={remove.isPending} onClick={() => remove.mutate({ documentId: d.id, version: v.version })}>
                                {t('legal.deleteDraft')}
                              </button>
                              <button
                                type="button"
                                className="primary"
                                disabled={publish.isPending}
                                onClick={() => {
                                  if (window.confirm(t('legal.publishConfirm', { version: v.version }))) publish.mutate({ documentId: d.id, version: v.version });
                                }}
                              >
                                {t('legal.publish')}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ))}
      </div>
      {creating ? <CreateDialog initial={creating} onClose={() => setCreating(null)} onDone={() => void done()} /> : null}
      <ViewDialog versionId={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function CreateDialog({ initial, onClose, onDone }: { initial: { audience: string; countryCode: string }; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [audience, setAudience] = useState(initial.audience);
  const [countryCode, setCountry] = useState(initial.countryCode);
  const [version, setVersion] = useState(new Date().toISOString().slice(0, 10));
  const [reviewedBy, setReviewedBy] = useState('');
  const [lang, setLang] = useState<(typeof LOCALES)[number]>('en');
  const [bodies, setBodies] = useState<Record<string, string>>({ en: '', ru: '', de: '', es: '', hy: '' });
  const parsed = legalVersionSchema.safeParse({ audience, countryCode, version, bodies, legalReviewedBy: reviewedBy });
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return api.createLegalVersion(parsed.data);
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('legal.newVersion')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('legal.document')}>
            <select value={audience} onChange={(e) => setAudience(e.target.value)}>
              {LEGAL_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`legal.audience.${a}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('catalog.countryCode')}>
            <input value={countryCode} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} style={{ width: 70 }} placeholder="DE" />
          </Field>
          <Field label={t('legal.version')}>
            <input value={version} onChange={(e) => setVersion(e.target.value)} style={{ width: 140 }} placeholder="2026-11-01" />
          </Field>
        </div>
        <Field label={t('legal.reviewedByLabel')}>
          <input value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} placeholder={t('legal.reviewedByHint')} />
        </Field>
        <div className="tabs" role="tablist">
          {LOCALES.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)}>
              {LANG[l]} {bodies[l]?.trim().length ? '✓' : ''}
            </button>
          ))}
        </div>
        <Field label={t('legal.text', { lang: LANG[lang] })}>
          <textarea value={bodies[lang]} onChange={(e) => setBodies((b) => ({ ...b, [lang]: e.target.value }))} rows={14} lang={lang} />
        </Field>
        <p className="faint">{t('legal.textHint')}</p>
        <ErrorNote error={m.error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className="primary" disabled={!parsed.success || m.isPending}>
            {t('legal.saveDraft')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ViewDialog({ versionId, onClose }: { versionId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['legalVersion', versionId], queryFn: () => api.legalVersion(versionId ?? ''), enabled: versionId !== null });
  const [lang, setLang] = useState<(typeof LOCALES)[number]>('en');
  return (
    <Dialog open={versionId !== null} onClose={onClose} title={q.data ? `${t(`legal.audience.${q.data.audience}`)} · ${q.data.countryCode} · ${q.data.version}` : t('legal.read')}>
      {q.isLoading ? <Loading /> : null}
      <ErrorNote error={q.error} />
      {q.data ? (
        <>
          <div className="tabs" role="tablist">
            {LOCALES.map((l) => (
              <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)}>
                {LANG[l]}
              </button>
            ))}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '55vh', overflow: 'auto', font: 'inherit' }} lang={lang}>
            {q.data.bodies[lang]?.body ?? '—'}
          </pre>
        </>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
