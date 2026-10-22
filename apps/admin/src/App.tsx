import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { api } from './api';
import { useSession } from './auth/Session';
import type { Section } from './auth/permissions';
import { ADMIN_LANGUAGES, currentLanguage, setLanguage, type AdminLanguage } from './i18n';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { RealtimeProvider } from './realtime';
import { Loading } from './ui';

// Разделы грузятся по требованию: карта (Leaflet), финансы и настройки не нужны для входа и сводки.
const AdminsPage = lazy(() => import('./pages/Admins').then((m) => ({ default: m.AdminsPage })));
const AuditPage = lazy(() => import('./pages/Audit').then((m) => ({ default: m.AuditPage })));
const CatalogPage = lazy(() => import('./pages/Catalog').then((m) => ({ default: m.CatalogPage })));
const ClientCardPage = lazy(() => import('./pages/Clients').then((m) => ({ default: m.ClientCardPage })));
const ClientsPage = lazy(() => import('./pages/Clients').then((m) => ({ default: m.ClientsPage })));
const DocumentsPage = lazy(() => import('./pages/Documents').then((m) => ({ default: m.DocumentsPage })));
const FinancePage = lazy(() => import('./pages/Finance').then((m) => ({ default: m.FinancePage })));
const FraudPage = lazy(() => import('./pages/Fraud').then((m) => ({ default: m.FraudPage })));
const GrantsPage = lazy(() => import('./pages/Grants').then((m) => ({ default: m.GrantsPage })));
const LiveMapPage = lazy(() => import('./pages/LiveMap').then((m) => ({ default: m.LiveMapPage })));
const OrderCardPage = lazy(() => import('./pages/OrderCard').then((m) => ({ default: m.OrderCardPage })));
const OrdersPage = lazy(() => import('./pages/Orders').then((m) => ({ default: m.OrdersPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const WorkerCardPage = lazy(() => import('./pages/WorkerCard').then((m) => ({ default: m.WorkerCardPage })));
const WorkersPage = lazy(() => import('./pages/Workers').then((m) => ({ default: m.WorkersPage })));
const DisputesPage = lazy(() => import('./pages/Disputes').then((m) => ({ default: m.DisputesPage })));
const DisputeCardPage = lazy(() => import('./pages/Disputes').then((m) => ({ default: m.DisputeCardPage })));
const SupportPage = lazy(() => import('./pages/Support').then((m) => ({ default: m.SupportPage })));
const TicketPage = lazy(() => import('./pages/Support').then((m) => ({ default: m.TicketPage })));
const IncidentsPage = lazy(() => import('./pages/Support').then((m) => ({ default: m.IncidentsPage })));
const IncidentPage = lazy(() => import('./pages/Support').then((m) => ({ default: m.IncidentPage })));
const LegalPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.LegalPage })));
const InsurancePage = lazy(() => import('./pages/Insurance').then((m) => ({ default: m.InsurancePage })));
const BonusesPage = lazy(() => import('./pages/Bonuses').then((m) => ({ default: m.BonusesPage })));
const BonusRunPage = lazy(() => import('./pages/Bonuses').then((m) => ({ default: m.BonusRunPage })));
const PrivacyPage = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.PrivacyPage })));

export function App() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <RealtimeProvider enabled>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Guard section="dashboard"><DashboardPage /></Guard>} />
          <Route path="map" element={<Guard section="map"><LiveMapPage /></Guard>} />
          <Route path="orders" element={<Guard section="orders"><OrdersPage /></Guard>} />
          <Route path="orders/:id" element={<Guard section="orders"><OrderCardPage /></Guard>} />
          <Route path="documents" element={<Guard section="documents"><DocumentsPage /></Guard>} />
          <Route path="workers" element={<Guard section="workers"><WorkersPage /></Guard>} />
          <Route path="workers/:id" element={<Guard section="workers"><WorkerCardPage /></Guard>} />
          <Route path="clients" element={<Guard section="clients"><ClientsPage /></Guard>} />
          <Route path="clients/:id" element={<Guard section="clients"><ClientCardPage /></Guard>} />
          <Route path="grants" element={<Guard section="grants"><GrantsPage /></Guard>} />
          <Route path="finance" element={<Guard section="finance"><FinancePage /></Guard>} />
          <Route path="fraud" element={<Guard section="fraud"><FraudPage /></Guard>} />
          <Route path="settings" element={<Guard section="settings"><SettingsPage /></Guard>} />
          <Route path="catalog" element={<Guard section="catalog"><CatalogPage /></Guard>} />
          <Route path="admins" element={<Guard section="admins"><AdminsPage /></Guard>} />
          <Route path="audit" element={<Guard section="audit"><AuditPage /></Guard>} />
          <Route path="disputes" element={<Guard section="disputes"><DisputesPage /></Guard>} />
          <Route path="disputes/:id" element={<Guard section="disputes"><DisputeCardPage /></Guard>} />
          <Route path="support" element={<Guard section="support"><SupportPage /></Guard>} />
          <Route path="support/:id" element={<Guard section="support"><TicketPage /></Guard>} />
          <Route path="incidents" element={<Guard section="incidents"><IncidentsPage /></Guard>} />
          <Route path="incidents/:id" element={<Guard section="incidents"><IncidentPage /></Guard>} />
          <Route path="legal" element={<Guard section="legal"><LegalPage /></Guard>} />
          <Route path="insurance" element={<Guard section="insurance"><InsurancePage /></Guard>} />
          <Route path="bonuses" element={<Guard section="bonuses"><BonusesPage /></Guard>} />
          <Route path="bonuses/:id" element={<Guard section="bonuses"><BonusRunPage /></Guard>} />
          <Route path="privacy" element={<Guard section="privacy"><PrivacyPage /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </RealtimeProvider>
  );
}

function Guard({ section, children }: { section: Section; children: ReactNode }) {
  const { canSee } = useSession();
  const { t } = useTranslation();
  if (!canSee(section)) return <p className="note" data-tone="warn">{t('common.noAccess')}</p>;
  return <>{children}</>;
}

type NavItem = { to: string; section: Section; label: string; badge?: number };

function Shell() {
  const { t } = useTranslation();
  const { me, canSee, signOut } = useSession();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLang] = useState<AdminLanguage>(currentLanguage());
  // очереди для значков в меню; обновляются раз в минуту
  const counters = useQuery({ queryKey: ['dashboard', 'counters'], queryFn: () => api.dashboard(Intl.DateTimeFormat().resolvedOptions().timeZone), refetchInterval: 60_000, enabled: canSee('dashboard') });
  const q = counters.data?.queues;

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const groups: Array<{ title: string; items: NavItem[] }> = [
    {
      title: t('nav.operations'),
      items: [
        { to: '/', section: 'dashboard', label: t('nav.dashboard') },
        { to: '/map', section: 'map', label: t('nav.map') },
        { to: '/orders', section: 'orders', label: t('nav.orders') },
      ],
    },
    {
      title: t('nav.cases'),
      items: [
        { to: '/disputes', section: 'disputes', label: t('nav.disputes'), badge: q?.disputes },
        { to: '/support', section: 'support', label: t('nav.support'), badge: q?.tickets },
        { to: '/incidents', section: 'incidents', label: t('nav.incidents') },
      ],
    },
    {
      title: t('nav.people'),
      items: [
        { to: '/documents', section: 'documents', label: t('nav.documents'), badge: q?.documents },
        { to: '/workers', section: 'workers', label: t('nav.workers') },
        { to: '/clients', section: 'clients', label: t('nav.clients') },
      ],
    },
    {
      title: t('nav.money'),
      items: [
        { to: '/finance', section: 'finance', label: t('nav.finance') },
        { to: '/grants', section: 'grants', label: t('nav.grants'), badge: q?.grants },
        { to: '/bonuses', section: 'bonuses', label: t('nav.bonuses') },
      ],
    },
    {
      title: t('nav.control'),
      items: [
        { to: '/fraud', section: 'fraud', label: t('nav.fraud'), badge: q?.fraudFlags },
        { to: '/settings', section: 'settings', label: t('nav.settings') },
        { to: '/catalog', section: 'catalog', label: t('nav.catalog') },
        { to: '/insurance', section: 'insurance', label: t('nav.insurance') },
        { to: '/legal', section: 'legal', label: t('nav.legal') },
        { to: '/privacy', section: 'privacy', label: t('nav.privacy') },
        { to: '/admins', section: 'admins', label: t('nav.admins') },
        { to: '/audit', section: 'audit', label: t('nav.audit') },
      ],
    },
  ];

  return (
    <div className="shell">
      <nav className="rail" data-open={menuOpen} aria-label={t('nav.label')}>
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#1F4E79" />
            <path d="M9 23V10l7 8 7-8v13" fill="none" stroke="#FFC43D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Masterio CRM
        </div>
        {groups.map((g) => {
          const items = g.items.filter((i) => canSee(i.section));
          if (items.length === 0) return null;
          return (
            <div className="navgroup" key={g.title}>
              <div className="navgroup-title">{g.title}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'}>
                  <span>{i.label}</span>
                  {i.badge ? <span className="badge num">{i.badge}</span> : null}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="rail-foot">
          <span>{me?.email}</span>
          <span className="faint">{me?.subRoles.map((r) => t(`roles.${r}`)).join(', ')}</span>
          <label className="field">
            {t('common.language')}
            <select
              value={lang}
              onChange={(e) => {
                const next = e.target.value as AdminLanguage;
                setLang(next);
                setLanguage(next);
              }}
            >
              {ADMIN_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l === 'ru' ? 'Русский' : 'English'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="quiet" onClick={() => void signOut()}>
            {t('common.signOut')}
          </button>
        </div>
      </nav>
      <main className="main">
        <div className="row menu-toggle">
          <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            {t('nav.menu')}
          </button>
        </div>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
