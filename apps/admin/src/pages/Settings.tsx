import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingKey } from '@masterio/shared';
import { api } from '../api';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { dateTime, localized } from '../format';
import { formatSetting, fromDraft, isFinanceKey, keysOf, SETTING_GROUPS, SETTING_META, toDraft } from '../settingsMeta';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, PageHead, Section, Status } from '../ui';

type Scope = 'GLOBAL' | 'COUNTRY' | 'CITY' | 'CATEGORY' | 'CITY_CATEGORY';
const SCOPES: Scope[] = ['GLOBAL', 'COUNTRY', 'CITY', 'CATEGORY', 'CITY_CATEGORY'];

/**
 * Настройки без релиза (раздел 14). Значение действует сразу на всех серверах.
 * Порядок поиска: город+услуга → услуга → город → страна → глобально → значение по умолчанию.
 * Финансовые ключи меняет finance или superadmin, остальные — только superadmin. Каждое изменение — в истории.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const catalog = useCatalog();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [edit, setEdit] = useState<{ key: SettingKey; scope: Scope; scopeRef: string } | null>(null);
  const [historyKey, setHistoryKey] = useState<SettingKey | null>(null);
  const [filter, setFilter] = useState('');

  const canEdit = (key: SettingKey) => can('editSettings') || (isFinanceKey(key) && can('editFinanceSettings'));
  const refLabel = (scope: string, ref: string) => {
    if (scope === 'CITY') return catalog.cityName(ref);
    if (scope === 'CATEGORY') return catalog.categoryName(ref);
    if (scope === 'CITY_CATEGORY') {
      const [city, cat] = ref.split(':');
      return `${catalog.cityName(city)} · ${catalog.categoryName(cat)}`;
    }
    return ref;
  };
  const needle = filter.trim().toLowerCase();
  const matches = (key: SettingKey) => !needle || key.toLowerCase().includes(needle) || t(`settings.key.${key}.label`).toLowerCase().includes(needle);

  if (settings.isLoading) return <Loading />;
  if (!settings.data) return <ErrorNote error={settings.error} />;
  const { effective, overrides } = settings.data;

  return (
    <>
      <PageHead title={t('settings.title')} sub={t('settings.sub')}>
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('settings.filter')} aria-label={t('settings.filter')} />
      </PageHead>
      <Note>{t('settings.order')}</Note>

      <div className="stack">
        {SETTING_GROUPS.map((g) => {
          const keys = keysOf(g).filter(matches);
          if (keys.length === 0) return null;
          return (
            <Section key={g} title={t(`settings.group.${g}`)} flush>
              <div className="table-wrap">
                <table className="data" style={{ tableLayout: 'fixed', minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '40%' }}>{t('settings.setting')}</th>
                      <th style={{ width: '20%' }}>{t('settings.global')}</th>
                      <th style={{ width: '22%' }}>{t('settings.overrides')}</th>
                      <th style={{ width: '18%' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => {
                      const own = overrides.filter((o) => o.key === key && o.scope !== 'GLOBAL');
                      return (
                        <tr key={key}>
                          <td>
                            <strong>{t(`settings.key.${key}.label`)}</strong>
                            {isFinanceKey(key) ? (
                              <>
                                {' '}
                                <Status tone="none">{t('settings.finance')}</Status>
                              </>
                            ) : null}
                            <div className="faint">{t(`settings.key.${key}.help`)}</div>
                            <code className="faint">{key}</code>
                          </td>
                          <td>{formatSetting(key, effective[key], t)}</td>
                          <td>
                            {own.length === 0 ? <span className="faint">—</span> : null}
                            {own.map((o) => (
                              <div key={`${o.scope}|${o.scopeRef}`} className="row" style={{ gap: 6 }}>
                                <span className="faint">
                                  {t(`settings.scope.${o.scope}`)}: {refLabel(o.scope, o.scopeRef)}
                                </span>
                                <span className="num">{formatSetting(key, o.value, t)}</span>
                                {canEdit(key) ? (
                                  <button type="button" className="quiet" onClick={() => setEdit({ key, scope: o.scope as Scope, scopeRef: o.scopeRef })}>
                                    {t('common.change')}
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </td>
                          <td>
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                              <button type="button" className="quiet" onClick={() => setHistoryKey(key)}>
                                {t('settings.history')}
                              </button>
                              {canEdit(key) ? (
                                <button type="button" onClick={() => setEdit({ key, scope: 'GLOBAL', scopeRef: '' })}>
                                  {t('common.change')}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          );
        })}
      </div>

      {edit ? <EditDialog key={`${edit.key}|${edit.scope}|${edit.scopeRef}`} initial={edit} onClose={() => setEdit(null)} /> : null}
      <HistoryDialog settingKey={historyKey} onClose={() => setHistoryKey(null)} refLabel={refLabel} />
    </>
  );
}

function EditDialog({ initial, onClose }: { initial: { key: SettingKey; scope: Scope; scopeRef: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { key } = initial;
  const meta = SETTING_META[key];
  const [scope, setScope] = useState<Scope>(initial.scope);
  const [country, setCountry] = useState(initial.scope === 'COUNTRY' ? initial.scopeRef : '');
  const [cityId, setCityId] = useState(initial.scope === 'CITY' ? initial.scopeRef : initial.scope === 'CITY_CATEGORY' ? (initial.scopeRef.split(':')[0] ?? '') : '');
  const [categoryId, setCategoryId] = useState(initial.scope === 'CATEGORY' ? initial.scopeRef : initial.scope === 'CITY_CATEGORY' ? (initial.scopeRef.split(':')[1] ?? '') : '');
  const scopeRef = scope === 'GLOBAL' ? '' : scope === 'COUNTRY' ? country.trim().toUpperCase() : scope === 'CITY' ? cityId : scope === 'CATEGORY' ? categoryId : cityId && categoryId ? `${cityId}:${categoryId}` : '';
  const existing = settings.data?.overrides.find((o) => o.key === key && o.scope === scope && o.scopeRef === scopeRef);
  const startValue = existing ? existing.value : settings.data?.effective[key];
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(key, startValue));
  const [comment, setComment] = useState('');
  const parsed = fromDraft(key, draft);
  const refOk = scope === 'GLOBAL' || (scope === 'COUNTRY' ? /^[A-Z]{2}$/.test(scopeRef) : scopeRef.length > 0);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
    await queryClient.invalidateQueries({ queryKey: ['settingHistory', key] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api.setSetting(key, { value: parsed.ok ? parsed.value : null, scope, scopeRef, comment: comment.trim() || undefined }),
    onSuccess: done,
  });
  const reset = useMutation({
    mutationFn: () => api.resetSetting(key, { scope, scopeRef, comment: comment.trim() || undefined }),
    onSuccess: done,
  });

  const categories = catalog.data?.groups.flatMap((g) => g.categories) ?? [];
  const countries = [...new Set((catalog.data?.cities ?? []).map((c) => c.countryCode))].sort();
  const kind = meta.kind;

  return (
    <Dialog open onClose={onClose} title={t(`settings.key.${key}.label`)}>
      <p className="muted">{t(`settings.key.${key}.help`)}</p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('settings.scopeLabel')}>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`settings.scope.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        {scope === 'COUNTRY' ? (
          <Field label={t('settings.country')}>
            <input list="countries" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} style={{ width: 80 }} />
            <datalist id="countries">
              {countries.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        ) : null}
        {scope === 'CITY' || scope === 'CITY_CATEGORY' ? (
          <Field label={t('orders.city')}>
            <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">—</option>
              {(catalog.data?.cities ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c.names)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {scope === 'CATEGORY' || scope === 'CITY_CATEGORY' ? (
          <Field label={t('orders.category')}>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c.names, c.code)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      {kind.type === 'bool' ? (
        <label className="check">
          <input type="checkbox" checked={draft.value === 'true'} onChange={(e) => setDraft({ value: e.target.checked ? 'true' : 'false' })} />
          {t('settings.enabled')}
        </label>
      ) : kind.type === 'enum' ? (
        <Field label={t('settings.value')}>
          <select value={draft.value} onChange={(e) => setDraft({ value: e.target.value })}>
            {kind.options.map((o) => (
              <option key={o} value={o}>
                {t(`settings.enum.${o}`, { defaultValue: o })}
              </option>
            ))}
          </select>
        </Field>
      ) : kind.type === 'object' ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {Object.entries(kind.fields).map(([f, fk]) => (
            <Field key={f} label={`${t(`settings.field.${f}`, { defaultValue: f })}${fk === 'fraction' ? ', %' : ''}`}>
              <input inputMode="decimal" value={draft[f] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} style={{ width: 110 }} />
            </Field>
          ))}
        </div>
      ) : (
        <Field label={`${t('settings.value')}${valueSuffix(kind, t)}`}>
          <input inputMode="decimal" value={draft.value ?? ''} onChange={(e) => setDraft({ value: e.target.value })} />
        </Field>
      )}
      {!parsed.ok ? <p className="field-error">{t('settings.invalid')}</p> : null}
      {parsed.ok ? <p className="faint">{t('settings.willBe', { value: formatSetting(key, parsed.value, t) })}</p> : null}

      <Field label={t('settings.comment')}>
        <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder={t('settings.commentHint')} />
      </Field>
      <ErrorNote error={save.error ?? reset.error} />
      <div className="actions">
        {existing && scope !== 'GLOBAL' ? (
          <button type="button" className="danger" disabled={reset.isPending} onClick={() => reset.mutate()}>
            {t('settings.reset')}
          </button>
        ) : null}
        <div className="spacer" />
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <button type="button" className="primary" disabled={!parsed.ok || !refOk || save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}

function valueSuffix(kind: (typeof SETTING_META)[SettingKey]['kind'], t: (k: string) => string): string {
  switch (kind.type) {
    case 'money':
      return `, ${t('settings.unit.money')}`;
    case 'moneyList':
      return `, ${t('settings.unit.moneyList')}`;
    case 'percent':
    case 'bp':
      return ', %';
    case 'int':
      return kind.unit === 'count' ? '' : `, ${t(`settings.unit.${kind.unit}`)}`;
    default:
      return '';
  }
}

function HistoryDialog({ settingKey, onClose, refLabel }: { settingKey: SettingKey | null; onClose: () => void; refLabel: (scope: string, ref: string) => string }) {
  const { t } = useTranslation();
  const history = useQuery({ queryKey: ['settingHistory', settingKey], queryFn: () => api.settingHistory(settingKey ?? ''), enabled: settingKey !== null });
  return (
    <Dialog open={settingKey !== null} onClose={onClose} title={settingKey ? `${t('settings.history')}: ${t(`settings.key.${settingKey}.label`)}` : ''}>
      {history.isLoading ? <Loading /> : null}
      <ErrorNote error={history.error} />
      {history.data && history.data.length === 0 ? <Empty>{t('settings.noHistory')}</Empty> : null}
      {settingKey && history.data && history.data.length > 0 ? (
        <div className="table-wrap" style={{ maxHeight: '60vh' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('settings.when')}</th>
                <th>{t('settings.scopeLabel')}</th>
                <th>{t('settings.change')}</th>
                <th>{t('settings.comment')}</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((h) => (
                <tr key={h.id}>
                  <td>
                    {dateTime(h.createdAt)}
                    <div className="faint">{h.changedById.slice(0, 8)}</div>
                  </td>
                  <td>
                    {t(`settings.scope.${h.setting.scope}`)}
                    {h.setting.scopeRef ? <div className="faint">{refLabel(h.setting.scope, h.setting.scopeRef)}</div> : null}
                  </td>
                  <td className="num">
                    {formatSetting(settingKey, h.oldValue, t)} → {h.newValue === null ? t('settings.removed') : formatSetting(settingKey, h.newValue, t)}
                  </td>
                  <td>{h.comment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
