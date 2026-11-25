import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, FileEdit, FilePlus2, Hourglass, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { JsaStatus, Stage } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useLookups } from '@/hooks/useLookups';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/Layout';
import { RiskBadge, StatusBadge } from '@/components/jsa/badges';
import { HBar, VBar } from '@/components/charts';
import { cn } from '@/lib/utils';

type Row = { id: string; referenceNo: string; jobTitle: string; status: JsaStatus; riskLevelCode: string | null; plannedStart: string | null; plannedEnd: string | null; submittedAt: string | null; validUntil: string | null; areaNameEn: string | null; areaNameTh: string | null; requesterName: string; isHighRiskWork: boolean };
type Dash = {
  cards: Record<string, number>; expiringSoonHours: number; overdueReviewHours: number; recent: Row[]; upcoming: Row[]; highRiskList: Row[]; expiringList: Row[];
  myActions: { reviews: { taskId: string; jsaId: string; referenceNo: string; jobTitle: string; stage: Stage; taskCreatedAt: string }[]; reviewCount: number; returned: Row[]; drafts: Row[] };
  turnaround: { avgHours: number | null; approvedCount: number; byStage: { stage: Stage; avgHours: number | null; n: number }[] };
  byMonth: { month: string; n: number }[]; byDepartment: { nameEn: string; nameTh: string; n: number }[]; byJobType: { nameEn: string; nameTh: string; n: number }[];
  riskDistribution: { levelCode: string; n: number }[]; pendingByReviewer: { reviewerName: string | null; stage: Stage; n: number }[];
};

function StatCard({ label, value, icon, tone, to }: { label: string; value: number; icon: React.ReactNode; tone: string; to?: string }) {
  const body = (
    <Card className={cn('flex h-full items-center gap-3 p-3 transition-shadow', to && 'hover:shadow-md')}>
      <div className={cn('rounded-lg p-2.5', tone)}>{icon}</div>
      <div className="min-w-0"><div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div><div className="truncate text-xs font-medium text-slate-600">{label}</div></div>
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const th = i18n.language === 'th';
  const { me, hasRole } = useAuth();
  const nav = useNavigate();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/reports/dashboard'), refetchInterval: 120_000 });
  if (q.isLoading) return <Spinner label={t('common.loading')} />;
  if (q.error) return <Alert tone="danger">{errMsg(q.error)}</Alert>;
  const d = q.data!;
  const c = d.cards;
  const levels = lookups.data?.matrix.levels ?? [];
  const area = (r: Row) => (th ? r.areaNameTh : r.areaNameEn) ?? '—';
  const MiniList = ({ rows, empty, extra }: { rows: Row[]; empty?: string; extra?: (r: Row) => React.ReactNode }) => rows.length ? (
    <ul className="divide-y">{rows.map((r) => (
      <li key={r.id}><Link to={`/jsa/${r.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
        <span className="font-semibold text-brand-700">{r.referenceNo}</span><span className="min-w-0 flex-1 truncate">{r.jobTitle}</span>
        <RiskBadge code={r.riskLevelCode} levels={levels} /><StatusBadge status={r.status} />
        {extra && <span className="w-full text-xs text-slate-500">{extra(r)}</span>}
      </Link></li>
    ))}</ul>
  ) : <p className="px-4 py-6 text-center text-sm text-slate-500">{empty ?? t('common.noData')}</p>;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title={t('dashboard.title')} subtitle={t('auth.welcome', { name: me?.displayName })}
        actions={hasRole('REQUESTER') && <Button size="lg" onClick={() => nav('/jsa/new')}><FilePlus2 className="h-5 w-5" />{t('nav.newJsa')}</Button>} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={t('dashboard.total')} value={c.total} icon={<ClipboardList className="h-5 w-5 text-slate-700" />} tone="bg-slate-100" to="/register" />
        <StatCard label={t('dashboard.drafts')} value={c.draft} icon={<FileEdit className="h-5 w-5 text-gray-600" />} tone="bg-gray-100" to="/register?status=DRAFT" />
        <StatCard label={t('dashboard.pendingAO')} value={c.pendingAreaOwner} icon={<Clock className="h-5 w-5 text-blue-700" />} tone="bg-blue-50" to="/register?status=PENDING_AREA_OWNER" />
        <StatCard label={t('dashboard.pendingSO')} value={c.pendingSafetyOfficer} icon={<ShieldAlert className="h-5 w-5 text-violet-700" />} tone="bg-violet-50" to="/register?status=PENDING_SAFETY_OFFICER" />
        <StatCard label={t('dashboard.approved')} value={c.approved} icon={<CheckCircle2 className="h-5 w-5 text-emerald-700" />} tone="bg-emerald-50" to="/register?status=APPROVED" />
        <StatCard label={t('dashboard.returned')} value={c.returned} icon={<RotateCcw className="h-5 w-5 text-amber-700" />} tone="bg-amber-50" to="/register?status=RETURNED" />
        <StatCard label={t('dashboard.rejected')} value={c.rejected} icon={<XCircle className="h-5 w-5 text-red-700" />} tone="bg-red-50" to="/register?status=REJECTED" />
        <StatCard label={t('dashboard.expiring')} value={c.expired + c.expiringSoon} icon={<Hourglass className="h-5 w-5 text-orange-700" />} tone="bg-orange-50" to="/register?status=EXPIRED" />
        <StatCard label={t('dashboard.highRisk')} value={c.highRiskAttention} icon={<AlertTriangle className="h-5 w-5 text-red-700" />} tone="bg-red-100" to="/register?highRiskOnly=true" />
        <StatCard label={t('status.COMPLETED')} value={c.completed} icon={<CheckCircle2 className="h-5 w-5 text-slate-700" />} tone="bg-slate-100" to="/register?status=COMPLETED" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('dashboard.myActions')} />
          {d.myActions.reviewCount + d.myActions.returned.length + d.myActions.drafts.length === 0 ? <EmptyState icon={<CheckCircle2 className="h-10 w-10" />} title={t('dashboard.nothing')} /> : (
            <div className="divide-y">
              {d.myActions.reviewCount > 0 && <div className="py-2"><p className="px-4 text-xs font-semibold uppercase text-brand-700">{t('dashboard.reviewsWaiting', { count: d.myActions.reviewCount })}</p>
                <ul>{d.myActions.reviews.map((r) => {
                  const wait = Date.now() - new Date(r.taskCreatedAt).getTime(); const overdue = wait > d.overdueReviewHours * 3600_000;
                  return <li key={r.taskId}><Link to={`/jsa/${r.jsaId}`} className={cn('flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50', overdue && 'text-red-700')}><b>{r.referenceNo}</b><span className="flex-1 truncate">{r.jobTitle}</span><span className="text-xs">{t(`stage.${r.stage}`)} · {fmtDuration(wait)}{overdue && ` ⚠ ${t('inbox.overdue')}`}</span></Link></li>;
                })}</ul></div>}
              {d.myActions.returned.length > 0 && <div className="py-2"><p className="px-4 text-xs font-semibold uppercase text-amber-700">{t('dashboard.myReturned')}</p><MiniList rows={d.myActions.returned} /></div>}
              {d.myActions.drafts.length > 0 && <div className="py-2"><p className="px-4 text-xs font-semibold uppercase text-slate-600">{t('dashboard.myDrafts')}</p><MiniList rows={d.myActions.drafts} /></div>}
            </div>
          )}
        </Card>
        <Card><CardHeader title={t('dashboard.highRisk')} /><MiniList rows={d.highRiskList} extra={(r) => `${area(r)} · ${fmtDateTime(r.plannedStart)}`} /></Card>
        <Card><CardHeader title={t('dashboard.upcoming')} /><MiniList rows={d.upcoming} extra={(r) => `${area(r)} · ${fmtDateTime(r.plannedStart)} – ${fmtDateTime(r.plannedEnd)}`} /></Card>
        <Card><CardHeader title={t('dashboard.expiringSoonList', { hours: d.expiringSoonHours })} subtitle={t('dashboard.expiredCount', { count: c.expired })} /><MiniList rows={d.expiringList} extra={(r) => `${t('fields.validUntil')}: ${fmtDateTime(r.validUntil)}`} /></Card>
        <Card className="lg:col-span-2"><CardHeader title={t('dashboard.recent')} /><MiniList rows={d.recent} extra={(r) => `${r.requesterName} · ${area(r)} · ${t('fields.submittedAt')} ${fmtDateTime(r.submittedAt)}`} /></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card><CardHeader title={t('dashboard.turnaround')} /><CardBody className="space-y-3">
          <div><div className="text-3xl font-bold tabular-nums">{d.turnaround.avgHours ?? '—'}<span className="text-base font-medium text-slate-500"> h</span></div><div className="text-xs text-slate-600">{t('dashboard.overallAvg')} (n={d.turnaround.approvedCount})</div></div>
          <ul className="space-y-1 text-sm">{d.turnaround.byStage.map((s) => <li key={s.stage} className="flex justify-between"><span>{t(`stage.${s.stage}`)}</span><span className="tabular-nums">{s.avgHours ?? '—'} h (n={s.n})</span></li>)}</ul>
        </CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader title={t('dashboard.byMonth')} /><CardBody><VBar data={d.byMonth} xKey="month" series={[{ key: 'n', label: t('reports.submitted') }]} /></CardBody></Card>
        <Card><CardHeader title={t('dashboard.riskDistribution')} /><CardBody>
          <HBar valueLabel="JSA" labelKey="label" valueKey="n" colorKey="color" data={[...levels].sort((a, b) => a.sortOrder - b.sortOrder).map((lv) => ({ label: th ? lv.nameTh : lv.nameEn, n: d.riskDistribution.find((r) => r.levelCode === lv.code)?.n ?? 0, color: lv.color }))} />
        </CardBody></Card>
        <Card><CardHeader title={t('dashboard.byDepartment')} /><CardBody><HBar valueLabel="JSA" labelKey="name" valueKey="n" data={d.byDepartment.map((x) => ({ name: th ? x.nameTh : x.nameEn, n: x.n }))} /></CardBody></Card>
        <Card><CardHeader title={t('dashboard.byJobType')} /><CardBody><HBar valueLabel="JSA" labelKey="name" valueKey="n" data={d.byJobType.map((x) => ({ name: th ? x.nameTh : x.nameEn, n: x.n }))} /></CardBody></Card>
        {d.pendingByReviewer.length > 0 && <Card className="lg:col-span-3"><CardHeader title={t('dashboard.pendingByReviewer')} /><CardBody>
          <HBar valueLabel={t('inbox.title')} labelKey="name" valueKey="n" data={d.pendingByReviewer.map((x) => ({ name: `${x.reviewerName ?? '—'} (${t(`stage.${x.stage}`)})`, n: x.n }))} />
        </CardBody></Card>}
      </div>
    </div>
  );
}
