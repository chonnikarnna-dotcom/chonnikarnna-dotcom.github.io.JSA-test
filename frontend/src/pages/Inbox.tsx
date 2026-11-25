import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Inbox as InboxIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useLookups } from '@/hooks/useLookups';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { Alert, Badge, Button, Card, EmptyState, Spinner, Table, Td, Th } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { RiskBadge } from '@/components/jsa/badges';
import { cn } from '@/lib/utils';
import type { JsaStatus, Stage } from '@/lib/types';

type Item = { taskId: string; stage: Stage; taskCreatedAt: string; jsaId: string; referenceNo: string; version: number; jobTitle: string; status: JsaStatus; plannedStart: string; plannedEnd: string; riskLevelCode: string | null; maxResidualRiskScore: number | null; isHighRiskWork: boolean; submittedAt: string; requesterName: string; contractorName: string | null; areaNameEn: string | null; areaNameTh: string | null };

export function InboxPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<{ items: Item[] }>('/approvals/inbox'), refetchInterval: 60_000 });
  const overdueMs = (lookups.data?.settings.overdueReviewHours ?? 24) * 3600_000;
  const levels = lookups.data?.matrix.levels;
  return (
    <div className="mx-auto max-w-7xl">
      <Breadcrumbs items={[{ label: t('nav.inbox') }]} />
      <PageHeader title={t('inbox.title')} subtitle={q.data && t('common.rows', { count: q.data.items.length })} />
      {q.error && <Alert tone="danger">{errMsg(q.error)}</Alert>}
      <Card>
        {q.isLoading ? <Spinner /> : !q.data?.items.length ? <EmptyState icon={<InboxIcon className="h-12 w-12" />} title={t('inbox.empty')} /> : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead><tr><Th>{t('fields.referenceNo')}</Th><Th>{t('fields.jobTitle')}</Th><Th>{t('fields.requester')}</Th><Th>{t('fields.area')}</Th><Th>{t('fields.plannedWork')}</Th><Th>{t('fields.riskLevel')}</Th><Th>{t('fields.stage')}</Th><Th>{t('fields.submittedAt')}</Th><Th>{t('fields.waiting')}</Th><Th /></tr></thead>
                <tbody>{q.data.items.map((r) => {
                  const wait = Date.now() - new Date(r.taskCreatedAt).getTime();
                  const overdue = wait > overdueMs;
                  return (
                    <tr key={r.taskId} className={cn('cursor-pointer hover:bg-slate-50', overdue && 'bg-red-50/60')} onClick={() => nav(`/jsa/${r.jsaId}`)}>
                      <Td className="font-medium text-brand-700">{r.referenceNo}<div className="text-xs text-slate-500">v{r.version}</div></Td>
                      <Td className="min-w-[200px]">{r.jobTitle}{r.isHighRiskWork && <Badge tone="red" className="ml-1" icon={<AlertTriangle className="h-3 w-3" />}>HIGH-RISK</Badge>}</Td>
                      <Td>{r.requesterName}<div className="text-xs text-slate-500">{r.contractorName ?? t('inbox.internal')}</div></Td>
                      <Td>{i18n.language === 'th' ? r.areaNameTh : r.areaNameEn}</Td>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.plannedStart)}<br />{fmtDateTime(r.plannedEnd)}</Td>
                      <Td><RiskBadge code={r.riskLevelCode} score={r.maxResidualRiskScore} levels={levels} /></Td>
                      <Td><Badge tone={r.stage === 'AREA_OWNER' ? 'blue' : 'purple'}>{t(`stage.${r.stage}`)}</Badge></Td>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.submittedAt)}</Td>
                      <Td className={cn('whitespace-nowrap', overdue && 'font-bold text-red-700')}>{fmtDuration(wait)}{overdue && <div className="text-xs">⚠ {t('inbox.overdue')}</div>}</Td>
                      <Td><Button size="sm">{t('inbox.review')}</Button></Td>
                    </tr>
                  );
                })}</tbody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">{q.data.items.map((r) => {
              const wait = Date.now() - new Date(r.taskCreatedAt).getTime();
              const overdue = wait > overdueMs;
              return (
                <li key={r.taskId}><button className={cn('flex w-full items-center gap-3 p-4 text-left', overdue && 'bg-red-50')} onClick={() => nav(`/jsa/${r.jsaId}`)}>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><b className="text-brand-700">{r.referenceNo}</b><Badge tone={r.stage === 'AREA_OWNER' ? 'blue' : 'purple'}>{t(`stage.${r.stage}`)}</Badge><RiskBadge code={r.riskLevelCode} levels={levels} /></div>
                    <div className="text-sm">{r.jobTitle}</div>
                    <div className="text-xs text-slate-500">{r.requesterName} · {i18n.language === 'th' ? r.areaNameTh : r.areaNameEn}</div>
                    <div className={cn('text-xs', overdue ? 'font-bold text-red-700' : 'text-slate-500')}>{t('inbox.waitingFor', { time: fmtDuration(wait) })}{overdue && ` · ${t('inbox.overdue')}`}</div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </button></li>
              );
            })}</ul>
          </>
        )}
      </Card>
    </div>
  );
}
