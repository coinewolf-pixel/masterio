import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { categoryGroupInputSchema, categoryInputSchema, cityInputSchema, LOCALES, type LocalizedNames } from '@masterio/shared';
import { api } from '../api';
import type { Category, CategoryGroup, City } from '../api/types';
import { useSession } from '../auth/Session';
import { localized } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, PageHead, Section, Status } from '../ui';

const LANGUAGE_NAMES: Record<(typeof LOCALES)[number], string> = { en: 'English', ru: 'Русский', de: 'Deutsch', es: 'Español', hy: 'Հայերեն' };
const emptyNames = (): LocalizedNames => ({ en: '', ru: '', de: '', es: '', hy: '' });
const namesFrom = (n: Record<string, string> | undefined): LocalizedNames => ({ ...emptyNames(), ...Object.fromEntries(LOCALES.map((l) => [l, n?.[l] ?? ''])) });

type Editing =
  | { kind: 'group'; item: CategoryGroup | null }
  | { kind: 'category'; item: Category | null; groupId: string }
  | { kind: 'city'; item: City | null }
  | { kind: 'cityCategories'; item: City };

/**
 * Справочники (раздел 8): группы услуг, услуги с флагами «срочно», «нужна лицензия», «нужна страховка», города
 * с валютой, часовым поясом и экстренным номером, и какие услуги заказываются в каждом городе. Названия — на 5 языках.
 * Меняет только superadmin; остальные видят справочник для работы.
 */
export function CatalogPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: api.catalog });
  const [tab, setTab] = useState<'services' | 'cities'>('services');
  const [editing, setEditing] = useState<Editing | null>(null);
  const editable = can('editCatalog');

  if (catalog.isLoading) return <Loading />;
  if (!catalog.data) return <ErrorNote error={catalog.error} />;
  const { groups, cities } = catalog.data;
  const allCategories = groups.flatMap((g) => g.categories);

  return (
    <>
      <PageHead title={t('catalog.title')} sub={editable ? t('catalog.sub') : t('catalog.readOnly')}>
        {editable && tab === 'services' ? (
          <button type="button" onClick={() => setEditing({ kind: 'group', item: null })}>
            {t('catalog.addGroup')}
          </button>
        ) : null}
        {editable && tab === 'cities' ? (
          <button type="button" className="primary" onClick={() => setEditing({ kind: 'city', item: null })}>
            {t('catalog.addCity')}
          </button>
        ) : null}
      </PageHead>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'services'} onClick={() => setTab('services')}>
          {t('catalog.services')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'cities'} onClick={() => setTab('cities')}>
          {t('catalog.cities')}
        </button>
      </div>

      {tab === 'services' ? (
        <div className="stack">
          {groups.length === 0 ? <Empty>{t('catalog.noGroups')}</Empty> : null}
          {groups.map((g) => (
            <Section
              key={g.id}
              title={
                <>
                  {localized(g.names, g.code)} <code className="faint">{g.code}</code>
                </>
              }
              actions={
                editable ? (
                  <div className="row">
                    <button type="button" className="quiet" onClick={() => setEditing({ kind: 'group', item: g })}>
                      {t('common.change')}
                    </button>
                    <button type="button" onClick={() => setEditing({ kind: 'category', item: null, groupId: g.id })}>
                      {t('catalog.addCategory')}
                    </button>
                  </div>
                ) : null
              }
              flush
            >
              {g.categories.length === 0 ? <Empty>{t('catalog.noCategories')}</Empty> : null}
              {g.categories.length > 0 ? (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('catalog.name')}</th>
                        <th>{t('catalog.code')}</th>
                        <th>{t('catalog.flags')}</th>
                        <th className="num">{t('catalog.inCities')}</th>
                        <th>{t('orders.status')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {g.categories.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {localized(c.names, c.code)}
                            <div className="faint">{LOCALES.filter((l) => l !== 'en').map((l) => c.names[l]).filter(Boolean).join(' · ')}</div>
                          </td>
                          <td>
                            <code>{c.code}</code>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                              {c.isUrgent ? <Status tone="alert">{t('catalog.urgent')}</Status> : null}
                              {c.requiresLicense ? <Status tone="warn">{t('catalog.license')}</Status> : null}
                              {c.requiresInsurance ? <Status tone="warn">{t('catalog.insurance')}</Status> : null}
                            </div>
                          </td>
                          <td className="num">{cities.filter((city) => city.categoryIds.includes(c.id)).length}</td>
                          <td>{c.isActive ? <Status tone="ok">{t('catalog.active')}</Status> : <Status tone="none">{t('catalog.inactive')}</Status>}</td>
                          <td>
                            {editable ? (
                              <button type="button" className="quiet" onClick={() => setEditing({ kind: 'category', item: c, groupId: g.id })}>
                                {t('common.change')}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Section>
          ))}
        </div>
      ) : (
        <Section flush>
          {cities.length === 0 ? <Empty>{t('catalog.noCities')}</Empty> : null}
          {cities.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('catalog.name')}</th>
                    <th>{t('people.country')}</th>
                    <th>{t('catalog.currency')}</th>
                    <th>{t('catalog.timezone')}</th>
                    <th>{t('catalog.emergency')}</th>
                    <th className="num">{t('catalog.servicesCount')}</th>
                    <th>{t('orders.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cities.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {localized(c.names)}
                        {c.center ? (
                          <div className="faint num">
                            {c.center.lat.toFixed(4)}, {c.center.lng.toFixed(4)}
                          </div>
                        ) : null}
                      </td>
                      <td>{c.countryCode}</td>
                      <td>{c.currency}</td>
                      <td>{c.timezone}</td>
                      <td className="num">{c.emergencyNumber}</td>
                      <td className="num">
                        {c.categoryIds.length} / {allCategories.length}
                      </td>
                      <td>{c.isActive ? <Status tone="ok">{t('catalog.active')}</Status> : <Status tone="none">{t('catalog.inactive')}</Status>}</td>
                      <td>
                        {editable ? (
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="quiet" onClick={() => setEditing({ kind: 'cityCategories', item: c })}>
                              {t('catalog.cityServices')}
                            </button>
                            <button type="button" className="quiet" onClick={() => setEditing({ kind: 'city', item: c })}>
                              {t('common.change')}
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
      )}

      {editing?.kind === 'group' ? <GroupDialog item={editing.item} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === 'category' ? <CategoryDialog item={editing.item} groupId={editing.groupId} groups={groups} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === 'city' ? <CityDialog item={editing.item} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === 'cityCategories' ? <CityCategoriesDialog city={editing.item} groups={groups} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function NamesFields({ names, onChange }: { names: LocalizedNames; onChange: (n: LocalizedNames) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="muted">{t('catalog.namesAll')}</legend>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {LOCALES.map((l) => (
          <Field key={l} label={LANGUAGE_NAMES[l]}>
            <input value={names[l]} onChange={(e) => onChange({ ...names, [l]: e.target.value })} maxLength={80} lang={l} />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

function useSave(onClose: () => void) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['catalog'] });
    onClose();
  };
}

function Actions({ onClose, disabled, pending, error }: { onClose: () => void; disabled: boolean; pending: boolean; error: unknown }) {
  const { t } = useTranslation();
  return (
    <>
      <ErrorNote error={error} />
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <button type="submit" className="primary" disabled={disabled || pending}>
          {t('common.save')}
        </button>
      </div>
    </>
  );
}

function GroupDialog({ item, onClose }: { item: CategoryGroup | null; onClose: () => void }) {
  const { t } = useTranslation();
  const done = useSave(onClose);
  const [code, setCode] = useState(item?.code ?? '');
  const [names, setNames] = useState(namesFrom(item?.names));
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const parsed = categoryGroupInputSchema.safeParse({ code, names, sortOrder: Number(sortOrder) });
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return item ? api.updateGroup(item.id, parsed.data) : api.createGroup(parsed.data);
    },
    onSuccess: done,
  });
  return (
    <Dialog open onClose={onClose} title={item ? t('catalog.editGroup') : t('catalog.addGroup')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="row">
          <Field label={t('catalog.code')}>
            <input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="home" />
          </Field>
          <Field label={t('catalog.sortOrder')}>
            <input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, ''))} style={{ width: 90 }} />
          </Field>
        </div>
        <p className="faint">{t('catalog.codeHint')}</p>
        <NamesFields names={names} onChange={setNames} />
        <Actions onClose={onClose} disabled={!parsed.success} pending={m.isPending} error={m.error} />
      </form>
    </Dialog>
  );
}

function CategoryDialog({ item, groupId, groups, onClose }: { item: Category | null; groupId: string; groups: CategoryGroup[]; onClose: () => void }) {
  const { t } = useTranslation();
  const done = useSave(onClose);
  const [form, setForm] = useState({
    code: item?.code ?? '',
    groupId: item?.groupId ?? groupId,
    names: namesFrom(item?.names),
    icon: item?.icon ?? '',
    isUrgent: item?.isUrgent ?? false,
    requiresLicense: item?.requiresLicense ?? false,
    requiresInsurance: item?.requiresInsurance ?? false,
    isActive: item?.isActive ?? true,
    sortOrder: String(item?.sortOrder ?? 0),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const parsed = categoryInputSchema.safeParse({ ...form, icon: form.icon.trim() || null, sortOrder: Number(form.sortOrder) });
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return item ? api.updateCategory(item.id, parsed.data) : api.createCategory(parsed.data);
    },
    onSuccess: done,
  });
  return (
    <Dialog open onClose={onClose} title={item ? t('catalog.editCategory') : t('catalog.addCategory')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('catalog.code')}>
            <input value={form.code} onChange={(e) => set('code', e.target.value.toLowerCase())} placeholder="locksmith" />
          </Field>
          <Field label={t('catalog.group')}>
            <select value={form.groupId} onChange={(e) => set('groupId', e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {localized(g.names, g.code)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('catalog.icon')}>
            <input value={form.icon} onChange={(e) => set('icon', e.target.value)} placeholder="key-outline" style={{ width: 150 }} />
          </Field>
          <Field label={t('catalog.sortOrder')}>
            <input inputMode="numeric" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value.replace(/\D/g, ''))} style={{ width: 90 }} />
          </Field>
        </div>
        <NamesFields names={form.names} onChange={(n) => set('names', n)} />
        <div className="row" style={{ flexWrap: 'wrap', margin: '8px 0' }}>
          <label className="check">
            <input type="checkbox" checked={form.isUrgent} onChange={(e) => set('isUrgent', e.target.checked)} />
            {t('catalog.urgent')}
          </label>
          <label className="check">
            <input type="checkbox" checked={form.requiresLicense} onChange={(e) => set('requiresLicense', e.target.checked)} />
            {t('catalog.licenseLong')}
          </label>
          <label className="check">
            <input type="checkbox" checked={form.requiresInsurance} onChange={(e) => set('requiresInsurance', e.target.checked)} />
            {t('catalog.insuranceLong')}
          </label>
          <label className="check">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            {t('catalog.active')}
          </label>
        </div>
        {form.requiresLicense ? <p className="faint">{t('catalog.licenseHint')}</p> : null}
        <Actions onClose={onClose} disabled={!parsed.success} pending={m.isPending} error={m.error} />
      </form>
    </Dialog>
  );
}

function CityDialog({ item, onClose }: { item: City | null; onClose: () => void }) {
  const { t } = useTranslation();
  const done = useSave(onClose);
  const [form, setForm] = useState({
    countryCode: item?.countryCode ?? '',
    names: namesFrom(item?.names),
    timezone: item?.timezone ?? '',
    currency: item?.currency ?? 'EUR',
    lat: item?.center ? String(item.center.lat) : '',
    lng: item?.center ? String(item.center.lng) : '',
    emergencyNumber: item?.emergencyNumber ?? '112',
    isActive: item?.isActive ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const parsed = cityInputSchema.safeParse({
    countryCode: form.countryCode,
    names: form.names,
    timezone: form.timezone,
    currency: form.currency,
    center: { lat: Number(form.lat.replace(',', '.')), lng: Number(form.lng.replace(',', '.')) },
    emergencyNumber: form.emergencyNumber,
    isActive: form.isActive,
  });
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return item ? api.updateCity(item.id, parsed.data) : api.createCity(parsed.data);
    },
    onSuccess: done,
  });
  return (
    <Dialog open onClose={onClose} title={item ? t('catalog.editCity') : t('catalog.addCity')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <NamesFields names={form.names} onChange={(n) => set('names', n)} />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('catalog.countryCode')}>
            <input value={form.countryCode} onChange={(e) => set('countryCode', e.target.value.toUpperCase().slice(0, 2))} placeholder="DE" style={{ width: 70 }} />
          </Field>
          <Field label={t('catalog.currency')}>
            <input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase().slice(0, 3))} placeholder="EUR" style={{ width: 80 }} />
          </Field>
          <Field label={t('catalog.timezone')}>
            <input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Europe/Berlin" />
          </Field>
          <Field label={t('catalog.emergency')}>
            <input inputMode="numeric" value={form.emergencyNumber} onChange={(e) => set('emergencyNumber', e.target.value.replace(/\D/g, ''))} style={{ width: 80 }} />
          </Field>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('catalog.lat')}>
            <input inputMode="decimal" value={form.lat} onChange={(e) => set('lat', e.target.value)} placeholder="52.5200" style={{ width: 120 }} />
          </Field>
          <Field label={t('catalog.lng')}>
            <input inputMode="decimal" value={form.lng} onChange={(e) => set('lng', e.target.value)} placeholder="13.4050" style={{ width: 120 }} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            {t('catalog.active')}
          </label>
        </div>
        <p className="faint">{item ? t('catalog.currencyLocked') : t('catalog.cityHint')}</p>
        <Actions onClose={onClose} disabled={!parsed.success} pending={m.isPending} error={m.error} />
      </form>
    </Dialog>
  );
}

function CityCategoriesDialog({ city, groups, onClose }: { city: City; groups: CategoryGroup[]; onClose: () => void }) {
  const { t } = useTranslation();
  const done = useSave(onClose);
  const [selected, setSelected] = useState<Set<string>>(new Set(city.categoryIds));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const m = useMutation({ mutationFn: () => api.setCityCategories(city.id, [...selected]), onSuccess: done });
  return (
    <Dialog open onClose={onClose} title={t('catalog.cityServicesTitle', { city: localized(city.names) })}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <p className="muted">{t('catalog.cityServicesHint')}</p>
        <div className="stack" style={{ maxHeight: '55vh', overflow: 'auto' }}>
          {groups.map((g) => (
            <fieldset key={g.id} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>
                <strong>{localized(g.names, g.code)}</strong>
              </legend>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {g.categories.map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    {localized(c.names, c.code)}
                    {!c.isActive ? <span className="faint"> ({t('catalog.inactive')})</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <Actions onClose={onClose} disabled={false} pending={m.isPending} error={m.error} />
      </form>
    </Dialog>
  );
}
