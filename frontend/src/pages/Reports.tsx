import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, downloadUrl, qs } from '@/lib/api';
import type { JsaStatus, Stage } from '@/lib/types';
import { useLookups } from '@/hooks/useLookups';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { fmtDateTime, fromLocalInput } from '@/lib/format';
import { Alert, Button, Card, CardBody, CardHeader, Input, Spinner, Table, Td, Th } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { StatusBadge } from '@/components/jsa/badges';
import { HBar, VBar } from '@/components/charts';

type R = {
  trends: { month: string; submitted: number; approved: number; rejected: number; cancelled: number }[];
  turnaround: { overall: { n: number; avgHours: number | null }; byStage: { stage: Stage; n: number; avgHours: number | null; medianHours: number | null; maxHours: number | null }[] };
  pendingByRole: { stage: Stage; n: number; overdue: number }[]; overdueReviewHours: number;
  byDepartment: { nameEn: string; nameTh: string; n: number }[]; byContractor: { name: string; n: number }[];
  byArea: { nameEn: string; nameTh: string; siteEn: string | null; n: number }[]; byJobType: { nameEn: string; nameTh: string; n: number }[];
  risk: { residual: { levelCode: string; n: number }[]; initial: { levelCode: string; n: number }[] };
  rejectedReturned: { jsaId: string; referenceNo: string; jobTitle: string; versionNo: number; stage: Stage | null; decision: string; actorName: string; comment: string | null; createdAt: string }[];
  expiry: { jsaId: string; referenceNo: string; jobTitle: string; status: JsaStatus; validUntil: string; areaNameEn: string; areaNameTh: string; requesterName: string }[];
  completed: { jsaId: string; referenceNo: string; jobTitle: string; completedAt: string; completionNote: string | null; areaNameEn: string; areaNameTh: string; requesterName: string }[];
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const th = i18n.language === 'th';
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 180 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const range = { from: fromLocalInput(`${from}T00:00`), to: fromLocalInput(`${to}T23:59`) };
  const q = useQuery({ queryKey: ['reports', range], queryFn: () => api.get<R>(`/reports/summary${qs(range)}`), placeholderData: keepPreviousData });
  const preset = (days: number | 'year') => { const now = new Date(); setTo(isoDay(now)); setFrom(days === 'year' ? `${now.getFullYear()}-01-01` : isoDay(new Date(now.getTime() - days * 86_400_000))); };
  const exp = (type: string) => (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={() => downloadUrl(`/reports/export${qs({ ...range, type, format: 'xlsx', lang: i18n.language })}`)} aria-label={`${type} xlsx`}><Download className="h-3.5 w-3.5" />XLSX</Button>
      <Button size="sm" variant="ghost" onClick={() => downloadUrl(`/reports/export${qs({ ...range, type, format: 'csv', lang: i18n.language })}`)} aria-label={`${type} csv`}>CSV</Button>
    </div>
  );
  const levels = lookups.data?.matrix.levels ?? [];
  const r = q.data;
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Breadcrumbs items={[{ label: t('nav.reports') }]} />
      <PageHeader title={t('reports.title')} />
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <label className="text-sm">{t('common.from')}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">{t('common.to')}<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button variant="outline" size="sm" onClick={() => preset(30)}>{t('reports.last30')}</Button>
        <Button variant="outline" size="sm" onClick={() => preset(90)}>{t('reports.last90')}</Button>
        <Button variant="outline" size="sm" onClick={() => preset(180)}>{t('reports.last180')}</Button>
        <Button variant="outline" size="sm" onClick={() => preset('year')}>{t('reports.thisYear')}</Button>
      </Card>
      {q.error && <Alert tone="danger">{errMsg(q.error)}</Alert>}
      {!r ? <Spinner /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2"><CardHeader title={t('reports.trends')} action={exp('trends')} /><CardBody>
            <VBar data={r.trends} xKey="month" series={[{ key: 'submitted', label: t('reports.submitted') }, { key: 'approved', label: t('reports.approved') }, { key: 'rejected', label: t('reports.rejected') }]} height={260} />
          </CardBody></Card>
          <Card><CardHeader title={t('reports.turnaround')} subtitle={`${t('dashboard.overallAvg')}: ${r.turnaround.overall.avgHours ?? '—'} h (n=${r.turnaround.overall.n})`} action={exp('turnaround')} />
            <Table><thead><tr><Th>{t('fields.stage')}</Th><Th>N</Th><Th>{t('reports.avg')}</Th><Th>{t('reports.median')}</Th><Th>{t('reports.max')}</Th></tr></thead>
              <tbody>{r.turnaround.byStage.map((s) => <tr key={s.stage}><Td>{t(`stage.${s.stage}`)}</Td><Td>{s.n}</Td><Td>{s.avgHours ?? '—'}</Td><Td>{s.medianHours ?? '—'}</Td><Td>{s.maxHours ?? '—'}</Td></tr>)}</tbody></Table>
          </Card>
          <Card><CardHeader title={t('reports.pending')} subtitle={`${t('reports.overdue')} > ${r.overdueReviewHours} h`} action={exp('pending')} />
            <Table><thead><tr><Th>{t('fields.stage')}</Th><Th>{t('inbox.title')}</Th><Th>{t('reports.overdue')}</Th></tr></thead>
              <tbody>{r.pendingByRole.length ? r.pendingByRole.map((s) => <tr key={s.stage}><Td>{t(`stage.${s.stage}`)}</Td><Td>{s.n}</Td><Td className={s.overdue ? 'font-bold text-red-700' : ''}>{s.overdue}</Td></tr>) : <tr><Td colSpan={3} className="text-slate-500">{t('common.noData')}</Td></tr>}</tbody></Table>
          </Card>
          <Card><CardHeader title={t('reports.department')} action={exp('department')} /><CardBody><HBar valueLabel="JSA" labelKey="name" valueKey="n" data={r.byDepartment.map((x) => ({ name: th ? x.nameTh : x.nameEn, n: x.n }))} /></CardBody></Card>
          <Card><CardHeader title={t('reports.contractor')} action={exp('contractor')} /><CardBody><HBar valueLabel="JSA" labelKey="name" valueKey="n" data={r.byContractor} /></CardBody></Card>
          <Card><CardHeader title={t('reports.area')} action={exp('area')} /><CardBody><HBar valueLabel="JSA" labelKey="name" valueKey="n" data={r.byArea.map((x) => ({ name: th ? x.nameTh : x.nameEn, n: x.n }))} /></CardBody></Card>
          <Card><CardHeader title={t('reports.jobType')} action={exp('jobType')} /><CardBody><HBar valueLabel="JSA" labelKey="name" valueKey="n" data={r.byJobType.map((x) => ({ name: th ? x.nameTh : x.nameEn, n: x.n }))} /></CardBody></Card>
          <Card className="lg:col-span-2"><CardHeader title={t('reports.risk')} action={exp('risk')} /><CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(['initial', 'residual'] as const).map((ph) => (
              <div key={ph}><p className="mb-1 text-sm font-semibold">{t(`reports.${ph}`)}</p>
                <HBar valueLabel="JSA" labelKey="label" valueKey="n" colorKey="color" data={[...levels].sort((a, b) => a.sortOrder - b.sortOrder).map((lv) => ({ label: th ? lv.nameTh : lv.nameEn, n: r.risk[ph].find((x) => x.levelCode === lv.code)?.n ?? 0, color: lv.color }))} />
              </div>
            ))}
          </CardBody></Card>
          <Card className="lg:col-span-2"><CardHeader title={t('reports.rejectedReturned')} action={exp('rejectedReturned')} />
            <Table><thead><tr><Th>JSA</Th><Th>{t('fields.jobTitle')}</Th><Th>{t('fields.stage')}</Th><Th>{t('common.status')}</Th><Th>{t('admin.actor')}</Th><Th>{t('common.comment')}</Th><Th>{t('admin.time')}</Th></tr></thead>
              <tbody>{r.rejectedReturned.length ? r.rejectedReturned.map((x, i) => <tr key={i}><Td><Link className="text-brand-700 hover:underline" to={`/jsa/${x.jsaId}?version=${x.versionNo}`}>{x.referenceNo} v{x.versionNo}</Link></Td><Td>{x.jobTitle}</Td><Td>{x.stage ? t(`stage.${x.stage}`) : ''}</Td><Td>{t(`decision.${x.decision}`)}</Td><Td>{x.actorName}</Td><Td className="max-w-md">{x.comment}</Td><Td className="whitespace-nowrap text-xs">{fmtDateTime(x.createdAt)}</Td></tr>) : <tr><Td colSpan={7} className="text-slate-500">{t('common.noData')}</Td></tr>}</tbody></Table>
          </Card>
          <Card><CardHeader title={t('reports.expiry')} action={exp('expiry')} />
            <Table><thead><tr><Th>JSA</Th><Th>{t('common.status')}</Th><Th>{t('fields.validUntil')}</Th><Th>{t('fields.area')}</Th></tr></thead>
              <tbody>{r.expiry.length ? r.expiry.map((x) => <tr key={x.jsaId}><Td><Link className="text-brand-700 hover:underline" to={`/jsa/${x.jsaId}`}>{x.referenceNo}</Link><div className="text-xs">{x.jobTitle}</div></Td><Td><StatusBadge status={x.status} /></Td><Td className="text-xs">{fmtDateTime(x.validUntil)}</Td><Td>{th ? x.areaNameTh : x.areaNameEn}</Td></tr>) : <tr><Td colSpan={4} className="text-slate-500">{t('common.noData')}</Td></tr>}</tbody></Table>
          </Card>
          <Card><CardHeader title={t('reports.completed')} action={exp('completed')} />
            <Table><thead><tr><Th>JSA</Th><Th>{t('admin.time')}</Th><Th>{t('fields.area')}</Th><Th>{t('common.note')}</Th></tr></thead>
              <tbody>{r.completed.length ? r.completed.map((x) => <tr key={x.jsaId}><Td><Link className="text-brand-700 hover:underline" to={`/jsa/${x.jsaId}`}>{x.referenceNo}</Link><div className="text-xs">{x.jobTitle}</div></Td><Td className="text-xs">{fmtDateTime(x.completedAt)}</Td><Td>{th ? x.areaNameTh : x.areaNameEn}</Td><Td className="text-xs">{x.completionNote}</Td></tr>) : <tr><Td colSpan={4} className="text-slate-500">{t('common.noData')}</Td></tr>}</tbody></Table>
          </Card>
        </div>
      )}
    </div>
  );
}
