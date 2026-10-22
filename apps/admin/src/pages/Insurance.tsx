import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { insuranceRuleSchema } from '@masterio/shared';
import { api } from '../api';
import type { InsuranceRule } from '../api/types';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { dateTime, localized } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, PageHead, Section, Status } from '../ui';

/**
 * Правила страхования по стране, услуге и типу исполнителя (разделы 18.3, 19.4). Действует самое точное правило;
 * если правил нет — флаг «нужна страховка» у услуги. Без подходящего действующего полиса мастер заказы не получает.
 */
export function InsurancePage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ['insuranceRules'], queryFn: api.insuranceRules });
  const [editing, setEditing] = useState<InsuranceRule | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => api.deleteInsuranceRule(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['insuranceRules'] }) });
  const editable = can('editInsurance');

  return (
    <>
      <PageHead title={t('insurance.title')} sub={t('insurance.sub')}>
        {editable ? (
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            {t('insurance.add')}
          </button>
        ) : null}
      </PageHead>
      <Note>{t('insurance.order')}</Note>
      <Note tone="warn">{t('insurance.noGuarantee')}</Note>
      <ErrorNote error={remove.error} />
      <Section flush>
        {rules.isLoading ? <Loading /> : null}
        <ErrorNote error={rules.error} />
        {rules.data && rules.data.length === 0 ? <Empty>{t('insurance.empty')}</Empty> : null}
        {rules.data && rules.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('people.country')}</th>
                  <th>{t('orders.category')}</th>
                  <th>{t('insurance.workerType')}</th>
                  <th>{t('insurance.requirement')}</th>
                  <th>{t('insurance.risks')}</th>
                  <th>{t('insurance.updated')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.countryCode}</td>
                    <td>{r.categoryId ? catalog.categoryName(r.categoryId) : <span className="faint">{t('insurance.anyCategory')}</span>}</td>
                    <td>{r.workerType ? t(`insurance.type.${r.workerType}`) : <span className="faint">{t('insurance.anyType')}</span>}</td>
                    <td>{r.required ? <Status tone="warn">{t('insurance.required')}</Status> : <Status tone="none">{t('insurance.notRequired')}</Status>}</td>
                    <td>{r.requiredRisks.join(', ') || '—'}</td>
                    <td>{dateTime(r.updatedAt)}</td>
                    <td>
                      {editable ? (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="quiet" onClick={() => setEditing(r)}>
                            {t('common.change')}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => {
                              if (window.confirm(t('insurance.deleteConfirm'))) remove.mutate(r.id);
                            }}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
      {editing ? <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RuleDialog({ rule, onClose }: { rule: InsuranceRule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const [countryCode, setCountry] = useState(rule?.countryCode ?? '');
  const [categoryId, setCategory] = useState(rule?.categoryId ?? '');
  const [workerType, setType] = useState<string>(rule?.workerType ?? '');
  const [required, setRequired] = useState(rule?.required ?? true);
  const [risks, setRisks] = useState((rule?.requiredRisks ?? []).join(', '));
  const [noteEn, setNoteEn] = useState(rule?.note?.en ?? '');
  const [noteRu, setNoteRu] = useState(rule?.note?.ru ?? '');
  const body = {
    countryCode,
    categoryId: categoryId || null,
    workerType: (workerType || null) as 'INDEPENDENT' | 'COMPANY' | null,
    required,
    requiredRisks: risks.split(',').map((x) => x.trim()).filter(Boolean),
    ...(noteEn || noteRu ? { note: { ...(noteEn ? { en: noteEn } : {}), ...(noteRu ? { ru: noteRu } : {}) } } : {}),
  };
  const parsed = insuranceRuleSchema.safeParse(body);
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return api.saveInsuranceRule(parsed.data, rule?.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['insuranceRules'] });
      onClose();
    },
  });
  const categories = catalog.data?.groups.flatMap((g) => g.categories) ?? [];
  return (
    <Dialog open onClose={onClose} title={rule ? t('insurance.edit') : t('insurance.add')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('catalog.countryCode')}>
            <input value={countryCode} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} style={{ width: 70 }} placeholder="DE" />
          </Field>
          <Field label={t('orders.category')}>
            <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('insurance.anyCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c.names, c.code)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('insurance.workerType')}>
            <select value={workerType} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('insurance.anyType')}</option>
              <option value="INDEPENDENT">{t('insurance.type.INDEPENDENT')}</option>
              <option value="COMPANY">{t('insurance.type.COMPANY')}</option>
            </select>
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          {t('insurance.requiredLong')}
        </label>
        <Field label={t('insurance.risksLabel')}>
          <input value={risks} onChange={(e) => setRisks(e.target.value)} placeholder="liability, property" />
        </Field>
        <p className="faint">{t('insurance.risksHint')}</p>
        <Field label={t('insurance.noteEn')}>
          <input value={noteEn} onChange={(e) => setNoteEn(e.target.value)} maxLength={500} />
        </Field>
        <Field label={t('insurance.noteRu')}>
          <input value={noteRu} onChange={(e) => setNoteRu(e.target.value)} maxLength={500} />
        </Field>
        <ErrorNote error={m.error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className="primary" disabled={!parsed.success || m.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
