import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, BarChart3, ClipboardList, FilePlus2, Inbox, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Table2, UserCircle2, X, ScrollText,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useLookups } from '@/hooks/useLookups';
import { Alert, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const { setLanguage } = useAuth();
  return (
    <div className={cn('inline-flex overflow-hidden rounded-md border border-slate-300 text-xs font-semibold', className)} role="group" aria-label={t('common.language')}>
      {(['th', 'en'] as const).map((l) => (
        <button key={l} onClick={() => setLanguage(l)} aria-pressed={i18n.language === l}
          className={cn('px-2.5 py-1.5', i18n.language === l ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
          {l === 'th' ? 'ไทย' : 'EN'}
        </button>
      ))}
    </div>
  );
}

type NavItem = { to: string; label: string; icon: typeof Bell; roles?: Role[]; badge?: number };

export function Layout() {
  const { t } = useTranslation();
  const { me, logout, hasRole } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const lookups = useLookups();
  useEffect(() => setOpen(false), [loc.pathname]);

  const notif = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get<{ unread: number }>('/notifications?limit=1'), refetchInterval: 60_000 });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<{ items: unknown[] }>('/approvals/inbox'), enabled: hasRole('AREA_OWNER', 'SAFETY_OFFICER'), refetchInterval: 60_000 });

  const all: NavItem[] = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/jsa/new', label: t('nav.newJsa'), icon: FilePlus2, roles: ['REQUESTER'] },
    { to: '/my', label: t('nav.mySubmissions'), icon: ClipboardList, roles: ['REQUESTER'] },
    { to: '/inbox', label: t('nav.inbox'), icon: Inbox, roles: ['AREA_OWNER', 'SAFETY_OFFICER'], badge: inbox.data?.items.length },
    { to: '/register', label: t('nav.register'), icon: Table2 },
    { to: '/reports', label: t('nav.reports'), icon: BarChart3 },
    { to: '/admin', label: t('nav.admin'), icon: Settings, roles: ['ADMIN'] },
    { to: '/admin/audit', label: t('nav.audit'), icon: ScrollText, roles: ['SAFETY_OFFICER'] },
  ];
  const items = all.filter((i) => !i.roles || hasRole(...i.roles)).filter((i) => !(i.to === '/admin/audit' && hasRole('ADMIN')));

  const sidebar = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium', isActive ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100')}>
          <i.icon className="h-5 w-5 shrink-0" aria-hidden />
          <span className="flex-1">{i.label}</span>
          {!!i.badge && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${i.badge} pending`}>{i.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 shadow-sm">
        <button className="rounded p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/" className="flex items-center gap-2 font-semibold text-brand-800">
          <ShieldCheck className="h-6 w-6" aria-hidden /><span className="hidden sm:inline">{t('app.name')}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <Button variant="ghost" size="icon" className="relative" onClick={() => nav('/notifications')} aria-label={t('nav.notifications')}>
            <Bell className="h-5 w-5" />
            {!!notif.data?.unread && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">{notif.data.unread}</span>}
          </Button>
          <div className="hidden text-right text-xs leading-tight md:block">
            <div className="font-medium text-slate-800">{me?.displayName}</div>
            <div className="text-slate-500">{me?.roles.map((r) => t(`roles.${r}`)).join(', ')}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => nav('/account')} aria-label={t('nav.profile')}><UserCircle2 className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" onClick={async () => { await logout(); nav('/login'); }} aria-label={t('nav.logout')}><LogOut className="h-5 w-5" /></Button>
        </div>
      </header>
      <div className="flex">
        <aside className="no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
        {open && (
          <div className="no-print fixed inset-0 top-14 z-20 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
            <aside className="h-full w-72 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-3 sm:p-6">
          {lookups.data && !lookups.data.matrix.isValidated && hasRole('ADMIN', 'SAFETY_OFFICER') && (
            <Alert tone="warning" className="no-print mb-4">{t('form.matrixProvisional')}</Alert>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label="Breadcrumb" className="no-print mb-2 text-xs text-slate-500">
      <ol className="flex flex-wrap items-center gap-1">
        <li><Link to="/" className="hover:underline">{t('nav.home')}</Link></li>
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center gap-1"><span aria-hidden>/</span>{i.to ? <Link to={i.to} className="hover:underline">{i.label}</Link> : <span aria-current="page" className="text-slate-700">{i.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>{subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}</div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
