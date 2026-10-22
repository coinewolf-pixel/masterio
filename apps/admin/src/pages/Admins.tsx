import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ADMIN_SUB_ROLES, adminCreateSchema, type AdminSubRoleName } from '@masterio/shared';
import { api } from '../api';
import type { AdminRow, TotpSetup } from '../api/types';
import { useSession } from '../auth/Session';
import { amount, date, parseAmount } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, PageHead, Section, UserStatusLabel } from '../ui';

/**
 * Админы и права (раздел 14): подроли support, moderator, finance, superadmin; дневной лимит начислений.
 * Вход — пароль и одноразовый код TOTP; секрет показывается один раз при создании или сбросе.
 */
export function AdminsPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const admins = useQuery({ queryKey: ['admins'], queryFn: api.admins });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [totp, setTotp] = useState<TotpSetup | null>(null);
  const reset = useMutation({ mutationFn: (id: string) => api.resetTotp(id), onSuccess: setTotp });

  return (
    <>
      <PageHead title={t('admins.title')} sub={t('admins.sub')}>
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          {t('admins.create')}
        </button>
      </PageHead>
      <ErrorNote error={reset.error} />
      <Section flush>
        {admins.isLoading ? <Loading /> : null}
        <ErrorNote error={admins.error} />
        {admins.data && admins.data.length === 0 ? <Empty>{t('admins.empty')}</Empty> : null}
        {admins.data && admins.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('admins.email')}</th>
                  <th>{t('admins.roles')}</th>
                  <th className="num">{t('admins.grantLimit')}</th>
                  <th>{t('people.status')}</th>
                  <th>{t('people.since')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {admins.data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.email}
                      {a.id === me?.id ? <span className="faint"> · {t('admins.you')}</span> : null}
                    </td>
                    <td>{a.subRoles.map((r) => t(`roles.${r}`)).join(', ')}</td>
                    <td className="num">{amount(a.dailyGrantLimitCents)}</td>
                    <td>
                      <UserStatusLabel status={a.status} />
                    </td>
                    <td>{date(a.createdAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="quiet" onClick={() => setEditing(a)}>
                          {t('common.change')}
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          disabled={reset.isPending}
                          onClick={() => {
                            if (window.confirm(t('admins.resetConfirm', { email: a.email ?? '' }))) reset.mutate(a.id);
                          }}
                        >
                          {t('admins.resetTotp')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setTotp(s);
          }}
        />
      ) : null}
      {editing ? <EditDialog admin={editing} onClose={() => setEditing(null)} /> : null}
      <TotpDialog setup={totp} onClose={() => setTotp(null)} />
    </>
  );
}

function RolesPicker({ value, onChange }: { value: AdminSubRoleName[]; onChange: (v: AdminSubRoleName[]) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}>
      <legend className="muted">{t('admins.roles')}</legend>
      {ADMIN_SUB_ROLES.map((r) => (
        <label key={r} className="check" style={{ display: 'flex' }}>
          <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          <span>
            <strong>{t(`roles.${r}`)}</strong> <span className="faint">— {t(`admins.roleHelp.${r}`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (s: TotpSetup) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<AdminSubRoleName[]>(['SUPPORT']);
  const [country, setCountry] = useState('');
  const [limit, setLimit] = useState('0');
  const limitCents = parseAmount(limit);
  const parsed = adminCreateSchema.safeParse({ email: email.trim(), password, subRoles: roles, countryCode: country || undefined, dailyGrantLimitCents: limitCents ?? -1 });
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return api.createAdmin(parsed.data);
    },
    onSuccess: async (s) => {
      await queryClient.invalidateQueries({ queryKey: ['admins'] });
      onCreated(s);
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('admins.create')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label={t('admins.email')}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus />
        </Field>
        <Field label={t('admins.password')} error={password && password.length < 12 ? t('admins.passwordShort') : null}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <RolesPicker value={roles} onChange={setRoles} />
        <div className="row">
          <Field label={t('people.country')}>
            <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="DE" style={{ width: 70 }} />
          </Field>
          <Field label={t('admins.grantLimit')}>
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} />
          </Field>
        </div>
        <p className="faint">{t('admins.passwordHint')}</p>
        <ErrorNote error={m.error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className="primary" disabled={!parsed.success || m.isPending}>
            {t('admins.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({ admin, onClose }: { admin: AdminRow; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<AdminSubRoleName[]>(admin.subRoles);
  const [limit, setLimit] = useState((admin.dailyGrantLimitCents / 100).toFixed(2));
  const [active, setActive] = useState(admin.status === 'ACTIVE');
  const limitCents = parseAmount(limit);
  const m = useMutation({
    mutationFn: () => api.updateAdmin(admin.id, { subRoles: roles, dailyGrantLimitCents: limitCents ?? 0, active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admins'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={admin.email ?? t('admins.title')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <RolesPicker value={roles} onChange={setRoles} />
        <Field label={t('admins.grantLimit')}>
          <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('admins.active')}
        </label>
        <p className="faint">{t('admins.editHint')}</p>
        <ErrorNote error={m.error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className="primary" disabled={roles.length === 0 || limitCents === null || m.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** QR для приложения-аутентификатора (Google Authenticator, 1Password, Authy). Показывается один раз. */
function TotpDialog({ setup, onClose }: { setup: TotpSetup | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!setup) {
      setQr(null);
      return;
    }
    void QRCode.toDataURL(setup.totpUri, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [setup]);
  return (
    <Dialog open={setup !== null} onClose={onClose} title={t('admins.totpTitle')}>
      <Note tone="warn">{t('admins.totpOnce')}</Note>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {qr ? <img className="qr" src={qr} width={220} height={220} alt={t('admins.qrAlt')} /> : null}
        <div className="stack">
          <p>{t('admins.totpSteps')}</p>
          <Field label={t('admins.secret')}>
            <input readOnly value={setup?.totpSecret ?? ''} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'monospace' }} />
          </Field>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={onClose}>
          {t('admins.totpDone')}
        </button>
      </div>
    </Dialog>
  );
}
