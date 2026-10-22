import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import { date, dateTime } from '../format';
import { Empty, ErrorNote, Loading, Section, Status, UserStatusLabel, VerificationLabel } from '../ui';

/**
 * Команда мастера или компании в карточке (раздел 18.2): участники с проверкой личности, приглашения и журнал
 * назначений. Для участника — в чьей он команде. Телефоны в журнале и приглашениях скрыты, кроме последних цифр.
 */
export function TeamSection({ workerId }: { workerId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['worker', workerId, 'team'], queryFn: () => api.workerTeam(workerId) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const data = q.data;
  if (!data || (!data.team && !data.memberOf)) return null;
  const name = (memberId: string | null) => data.team?.members.find((m) => m.id === memberId)?.name ?? '—';
  return (
    <>
      {data.memberOf ? (
        <Section title={t('teams.memberOf')}>
          <p style={{ margin: 0 }}>
            <Link to={`/workers/${data.memberOf.ownerId}`}>{data.memberOf.teamName}</Link> · {t(`teams.role.${data.memberOf.role}`)} ·{' '}
            {t('teams.since', { date: date(data.memberOf.joinedAt) })}
          </p>
          <p className="faint">{t('teams.memberNote')}</p>
        </Section>
      ) : null}
      {data.team ? (
        <Section title={t('teams.title', { name: data.team.name })} flush>
          <p className="faint" style={{ padding: '0 16px' }}>
            {t('teams.capacity', { count: data.team.capacity })}
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('teams.member')}</th>
                  <th>{t('teams.roleLabel')}</th>
                  <th>{t('teams.kyc')}</th>
                  <th>{t('people.status')}</th>
                  <th>{t('teams.period')}</th>
                </tr>
              </thead>
              <tbody>
                {data.team.members.map((m) => (
                  <tr key={m.id} className={m.isActive ? undefined : 'faint'}>
                    <td>
                      <Link to={`/workers/${m.userId}`}>{m.name ?? m.phone ?? m.userId.slice(0, 8)}</Link>
                      <div className="faint">{m.phone}</div>
                    </td>
                    <td>{t(`teams.role.${m.role}`)}</td>
                    <td>
                      <VerificationLabel status={m.kycStatus} />
                    </td>
                    <td>
                      <UserStatusLabel status={m.userStatus} />
                    </td>
                    <td>
                      {date(m.joinedAt)}
                      {m.leftAt ? ` — ${date(m.leftAt)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.team.invites.length > 0 ? (
            <>
              <h3 style={{ padding: '0 16px' }}>{t('teams.invites')}</h3>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {data.team.invites.map((i) => (
                      <tr key={i.id}>
                        <td>{i.phone}</td>
                        <td>{t(`teams.role.${i.role}`)}</td>
                        <td>
                          <Status tone={i.status === 'ACCEPTED' ? 'ok' : i.status === 'PENDING' ? 'warn' : 'none'}>{t(`teams.inviteStatus.${i.status}`)}</Status>
                        </td>
                        <td>{dateTime(i.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <h3 style={{ padding: '0 16px' }}>{t('teams.journal')}</h3>
          {data.team.events.length === 0 ? <Empty>{t('teams.journalEmpty')}</Empty> : null}
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {data.team.events.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.createdAt)}</td>
                    <td>{t(`teams.event.${e.type}`, { defaultValue: e.type })}</td>
                    <td>{e.memberId ? name(e.memberId) : ''}</td>
                    <td>{e.orderId ? <Link to={`/orders/${e.orderId}`}>{t('teams.openOrder')}</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </>
  );
}
