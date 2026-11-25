import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, EmptyState, Spinner, Tabs } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { cn } from '@/lib/utils';

type N = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState('all');
  const q = useQuery({ queryKey: ['notifications', tab, i18n.language], queryFn: () => api.get<{ unread: number; items: N[] }>(`/notifications?limit=100&lang=${i18n.language}${tab === 'unread' ? '&unreadOnly=true' : ''}`) });
  const mark = async (ids: string[] | 'ALL') => { await api.post('/notifications/read', { ids }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs items={[{ label: t('nav.notifications') }]} />
      <PageHeader title={t('notifications.title')} actions={<Button variant="outline" onClick={() => mark('ALL')}><CheckCheck className="h-4 w-4" />{t('notifications.markAll')}</Button>} />
      <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[{ id: 'all', label: t('notifications.all') }, { id: 'unread', label: `${t('notifications.unread')} (${q.data?.unread ?? 0})` }]} />
      <Card>
        {q.isLoading ? <Spinner /> : !q.data?.items.length ? <EmptyState icon={<Bell className="h-10 w-10" />} title={t('notifications.empty')} /> : (
          <ul className="divide-y">{q.data.items.map((n) => (
            <li key={n.id} className={cn('flex gap-3 p-3', !n.readAt && 'bg-brand-50')}>
              <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-label={n.readAt ? undefined : t('notifications.unread')} />
              <div className="min-w-0 flex-1">
                {n.link ? <Link to={n.link} onClick={() => !n.readAt && mark([n.id])} className="font-semibold text-brand-800 hover:underline">{n.title}</Link> : <span className="font-semibold">{n.title}</span>}
                <p className="text-sm text-slate-700">{n.body}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(n.createdAt)}</p>
              </div>
              {!n.readAt && <Button size="sm" variant="ghost" onClick={() => mark([n.id])} aria-label="mark read"><CheckCheck className="h-4 w-4" /></Button>}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
