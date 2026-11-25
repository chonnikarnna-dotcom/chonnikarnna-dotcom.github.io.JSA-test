import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, FilePlus2, Search } from 'lucide-react';
import { api, downloadUrl, qs } from '@/lib/api';
import { ALL_STATUSES, type JsaRow, type Paged } from '@/lib/types';
import { useLookups } from '@/hooks/useLookups';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { fmtDateTime, fromLocalInput, localName } from '@/lib/format';
import { Alert, Button, Card, Checkbox, EmptyState, Input, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { RiskBadge, StatusBadge } from '@/components/jsa/badges';
import { cn } from '@/lib/utils';

type Mode = 'mine' | 'all';
const FILTER_KEYS = ['q', 'status', 'riskLevel', 'areaId', 'departmentId', 'contractorCompanyId', 'jobTypeId', 'reviewerId', 'requesterId', 'from', 'to', 'highRiskOnly', 'sort', 'order', 'page'] as const;

function JsaList({ mode }: { mode: Mode }) {
  const { t, i18n } = useTranslation();
  const th = i18n.language === 'th';
  const nav = useNavigate();
  const { hasRole, me } = useAuth();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const [q, setQ] = useState(f.q);
  const set = (patch: Partial<typeof f>) => setParams((p) => { for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); } if (!('page' in patch)) p.delete('page'); return p; }, { replace: true });
  const query = { ...f, scope: mode, page: f.page || 1, pageSize: 20, sort: f.sort || 'updatedAt', order: f.order || 'desc', from: f.from ? fromLocalInput(`${f.from}T00:00`) : '', to: f.to ? fromLocalInput(`${f.to}T23:59`) : '' };
  const list = useQuery({ queryKey: ['jsas', query], queryFn: () => api.get<Paged<JsaRow>>(`/jsas${qs(query)}`), placeholderData: keepPreviousData });
  const l = lookups.data;
  const levels = l?.matrix.levels;
  const sortBtn = (key: string, label: string) => (
    <button className="inline-flex items-center gap-1 uppercase" onClick={() => set({ sort: key, order: f.sort === key && f.order !== 'asc' ? 'asc' : 'desc' })}>
      {label}{f.sort === key && (f.order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
  const isInternal = me?.userType === 'EMPLOYEE';
  const overdueMs = (l?.settings.overdueReviewHours ?? 24) * 3600_000;

  return (
    <div className="mx-auto max-w-7xl">
      <Breadcrumbs items={[{ label: mode === 'mine' ? t('nav.mySubmissions') : t('nav.register') }]} />
      <PageHeader title={mode === 'mine' ? t('list.mySubmissionsTitle') : t('list.registerTitle')}
        subtitle={list.data && t('common.rows', { count: list.data.total })}
        actions={<>
          {hasRole('REQUESTER') && <Button onClick={() => nav('/jsa/new')}><FilePlus2 className="h-4 w-4" />{t('nav.newJsa')}</Button>}
          <Button variant="outline" onClick={() => downloadUrl(`/jsas/export${qs({ ...query, format: 'xlsx', lang: i18n.language })}`)}><Download className="h-4 w-4" />{t('list.exportXlsx')}</Button>
          <Button variant="outline" onClick={() => downloadUrl(`/jsas/export${qs({ ...query, format: 'csv', lang: i18n.language })}`)}><Download className="h-4 w-4" />{t('list.exportCsv')}</Button>
        </>} />
      <Card className="mb-4 p-3">
        <form className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); set({ q }); }}>
          <div className="relative sm:col-span-2"><Search className="absolute left-2.5 top-2.5 h-5 w-5 text-slate-400" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('list.searchPlaceholder')} aria-label={t('common.search')} /></div>
          <Select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label={t('common.status')}><option value="">{t('list.anyStatus')}</option>{ALL_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</Select>
          <Select value={f.riskLevel} onChange={(e) => set({ riskLevel: e.target.value })} aria-label={t('fields.riskLevel')}><option value="">{t('list.anyRisk')}</option>{levels?.map((x) => <option key={x.code} value={x.code}>{th ? x.nameTh : x.nameEn}</option>)}</Select>
          <Select value={f.areaId} onChange={(e) => set({ areaId: e.target.value })} aria-label={t('fields.area')}><option value="">{t('list.anyArea')}</option>{l?.areas.map((a) => <option key={a.id} value={a.id}>{localName(a)}</option>)}</Select>
          <Select value={f.jobTypeId} onChange={(e) => set({ jobTypeId: e.target.value })} aria-label={t('fields.jobType')}><option value="">{t('list.anyJobType')}</option>{l?.jobTypes.map((a) => <option key={a.id} value={a.id}>{localName(a)}</option>)}</Select>
          {mode === 'all' && isInternal && <>
            <Select value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })} aria-label={t('fields.department')}><option value="">{t('list.anyDepartment')}</option>{l?.departments.map((a) => <option key={a.id} value={a.id}>{localName(a)}</option>)}</Select>
            <Select value={f.contractorCompanyId} onChange={(e) => set({ contractorCompanyId: e.target.value })} aria-label={t('fields.contractor')}><option value="">{t('list.anyContractor')}</option>{l?.contractors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <Select value={f.reviewerId} onChange={(e) => set({ reviewerId: e.target.value })} aria-label={t('fields.currentReviewer')}><option value="">{t('list.anyReviewer')}</option>{l?.reviewers.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}</Select>
          </>}
          <div className="flex items-center gap-1 sm:col-span-2"><span className="whitespace-nowrap text-sm text-slate-600">{t('list.dateRange')}</span><Input className="min-w-0" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label={t('common.from')} /><span>–</span><Input className="min-w-0" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label={t('common.to')} /></div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <Checkbox checked={f.highRiskOnly === 'true'} onChange={(e) => set({ highRiskOnly: e.target.checked ? 'true' : '' })} label={t('list.highRiskOnly')} />
            <Button type="button" variant="ghost" size="sm" onClick={() => { setQ(''); setParams({}, { replace: true }); }}>{t('common.clear')}</Button>
          </div>
        </form>
      </Card>
      <Card>
        {list.error ? <Alert tone="danger" className="m-3">{errMsg(list.error)}</Alert> : list.isLoading ? <Spinner /> : !list.data?.items.length ? (
          <EmptyState title={mode === 'mine' && !Object.values(f).some(Boolean) ? t('list.emptyMine') : t('list.empty')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{sortBtn('referenceNo', t('fields.referenceNo'))}</Th><Th>{sortBtn('jobTitle', t('fields.jobTitle'))}</Th>
                {mode === 'all' && <Th>{t('fields.requester')}</Th>}{mode === 'all' && <Th>{t('fields.department')} / {t('fields.contractor')}</Th>}
                <Th>{t('fields.area')}</Th>{mode === 'all' && <Th>{t('fields.jobType')}</Th>}
                <Th>{sortBtn('plannedStart', t('fields.plannedWork'))}</Th><Th>{sortBtn('riskLevel', t('fields.riskLevel'))}</Th>
                <Th>{sortBtn('status', t('common.status'))}</Th><Th>{t('fields.currentReviewer')}</Th><Th>{sortBtn('updatedAt', t('fields.lastUpdated'))}</Th>
              </tr></thead>
              <tbody>
                {list.data.items.map((r) => {
                  const overdue = r.pendingSince && Date.now() - new Date(r.pendingSince).getTime() > overdueMs;
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/jsa/${r.id}`)}>
                      <Td className="whitespace-nowrap font-medium"><Link to={`/jsa/${r.id}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.referenceNo}</Link><div className="text-xs text-slate-500">v{r.version}</div></Td>
                      <Td className="min-w-[200px]">{r.jobTitle || '—'}</Td>
                      {mode === 'all' && <Td>{r.requesterName}</Td>}
                      {mode === 'all' && <Td>{r.contractorName ?? (th ? r.departmentNameTh : r.departmentNameEn) ?? '—'}</Td>}
                      <Td>{(th ? r.areaNameTh : r.areaNameEn) ?? '—'}</Td>
                      {mode === 'all' && <Td>{(th ? r.jobTypeNameTh : r.jobTypeNameEn) ?? '—'}</Td>}
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.plannedStart)}<br />{fmtDateTime(r.plannedEnd)}</Td>
                      <Td><RiskBadge code={r.riskLevelCode} score={r.maxResidualRiskScore} levels={levels} /></Td>
                      <Td><StatusBadge status={r.status} /></Td>
                      <Td className={cn('text-xs', overdue && 'font-semibold text-red-700')}>{r.currentReviewerName ?? '—'}{r.currentStage && <div className="text-slate-500">{t(`stage.${r.currentStage}`)}{overdue && ` · ${t('inbox.overdue')}`}</div>}</Td>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.updatedAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set({ page: String(p) })} label={(p, n) => t('common.page', { page: p, pages: n })} />
          </>
        )}
      </Card>
    </div>
  );
}

export const MySubmissionsPage = () => <JsaList mode="mine" />;
export const RegisterPage = () => <JsaList mode="all" />;
