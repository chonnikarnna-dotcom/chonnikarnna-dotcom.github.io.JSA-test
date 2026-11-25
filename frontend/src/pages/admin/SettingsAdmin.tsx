import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Save, ShieldCheck } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Pagination, Select, Spinner, Table, Td, Textarea, Th, useToast } from '@/components/ui';

function useSave(invalidate: string[]) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const errMsg = useErrorMessage();
  return async (fn: () => Promise<unknown>) => {
    try { await fn(); toast('success', t('admin.savedOk')); invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); qc.invalidateQueries({ queryKey: ['admin'] }); }
    catch (e) { toast('danger', errMsg(e)); }
  };
}

type Validity = { mode: string; durationHours: number; maxWorkPeriodDays: number; expiryReminderHours: number; completionTrackingEnabled: boolean; minLeadTimeHours: number };
export function ValidityAdmin() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'validity'], queryFn: () => api.get<Validity>('/admin/validity') });
  const [v, setV] = useState<Validity | null>(null);
  const save = useSave(['lookups']);
  const toast = useToast();
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  if (!v) return <Spinner />;
  const num = (k: keyof Validity) => <Input type="number" value={v[k] as number} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />;
  return (
    <Card>
      <CardHeader title={t('admin.tabs.validity')} />
      <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t('admin.validityMode')}><Select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}><option value="END_OF_WORK">{t('admin.END_OF_WORK')}</option><option value="FIXED_DURATION">{t('admin.FIXED_DURATION')}</option></Select></Field>
        <Field label={t('admin.durationHours')}>{num('durationHours')}</Field>
        <Field label={t('admin.maxWorkPeriodDays')}>{num('maxWorkPeriodDays')}</Field>
        <Field label={t('admin.expiryReminderHours')}>{num('expiryReminderHours')}</Field>
        <Field label={t('admin.minLeadTimeHours')}>{num('minLeadTimeHours')}</Field>
        <Checkbox checked={v.completionTrackingEnabled} onChange={(e) => setV({ ...v, completionTrackingEnabled: e.target.checked })} label={t('admin.completionTracking')} className="self-end" />
        <div className="flex gap-2 md:col-span-2">
          <Button onClick={() => save(() => api.put('/admin/validity', v))}><Save className="h-4 w-4" />{t('common.save')}</Button>
          <Button variant="outline" onClick={async () => { try { const r = await api.post<{ expired: number; reminded: number }>('/admin/jobs/expiry'); toast('info', JSON.stringify(r)); } catch { /* */ } }}>{t('admin.runExpiry')}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

type Settings = { defaultLanguage: string; timezone: string; attachmentMaxMb: number; allowedExtensions: string[]; enforceValidatedRiskMatrix: boolean; declarationVersion: string; declarationTextEn: string; declarationTextTh: string; ppeOptions: string[]; dashboardExpiringSoonHours: number; overdueReviewHours: number };
export function SettingsAdmin() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<Settings>('/admin/settings') });
  const [v, setV] = useState<Settings | null>(null);
  const save = useSave(['lookups']);
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  if (!v) return <Spinner />;
  const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx'];
  return (
    <Card>
      <CardHeader title={t('admin.tabs.settings')} />
      <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t('admin.defaultLanguage')}><Select value={v.defaultLanguage} onChange={(e) => setV({ ...v, defaultLanguage: e.target.value })}><option value="th">ไทย</option><option value="en">English</option></Select></Field>
        <Field label={t('admin.timezone')}><Input value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} /></Field>
        <Field label={t('admin.attachmentMaxMb')}><Input type="number" value={v.attachmentMaxMb} onChange={(e) => setV({ ...v, attachmentMaxMb: Number(e.target.value) })} /></Field>
        <Field label={t('admin.allowedExtensions')}><div className="flex flex-wrap gap-3">{EXT.map((x) => <Checkbox key={x} checked={v.allowedExtensions.includes(x)} onChange={(e) => setV({ ...v, allowedExtensions: e.target.checked ? [...v.allowedExtensions, x] : v.allowedExtensions.filter((y) => y !== x) })} label={x} />)}</div></Field>
        <Field label={t('admin.expiringSoonHours')}><Input type="number" value={v.dashboardExpiringSoonHours} onChange={(e) => setV({ ...v, dashboardExpiringSoonHours: Number(e.target.value) })} /></Field>
        <Field label={t('admin.overdueHours')}><Input type="number" value={v.overdueReviewHours} onChange={(e) => setV({ ...v, overdueReviewHours: Number(e.target.value) })} /></Field>
        <Checkbox className="md:col-span-2" checked={v.enforceValidatedRiskMatrix} onChange={(e) => setV({ ...v, enforceValidatedRiskMatrix: e.target.checked })} label={t('admin.enforceMatrix')} />
        <Field label={t('admin.declarationVersion')}><Input value={v.declarationVersion} onChange={(e) => setV({ ...v, declarationVersion: e.target.value })} /></Field>
        <div />
        <Field label={t('admin.declarationEn')}><Textarea rows={4} value={v.declarationTextEn} onChange={(e) => setV({ ...v, declarationTextEn: e.target.value })} /></Field>
        <Field label={t('admin.declarationTh')}><Textarea rows={4} value={v.declarationTextTh} onChange={(e) => setV({ ...v, declarationTextTh: e.target.value })} /></Field>
        <Field label={t('fields.ppeRequired')} className="md:col-span-2"><Input value={v.ppeOptions.join(', ')} onChange={(e) => setV({ ...v, ppeOptions: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })} /></Field>
        <div className="md:col-span-2"><Button onClick={() => save(() => api.put('/admin/settings', v))}><Save className="h-4 w-4" />{t('common.save')}</Button></div>
      </CardBody>
    </Card>
  );
}

type Tpl = { id: string; type: string; channel: string; language: string; title: string; body: string; isEnabled: boolean };
export function NotificationTemplatesAdmin() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'templates'], queryFn: () => api.get<{ items: Tpl[] }>('/admin/notification-templates') });
  const save = useSave([]);
  const [edits, setEdits] = useState<Record<string, Partial<Tpl>>>({});
  if (q.isLoading) return <Spinner />;
  return (
    <Card>
      <CardHeader title={t('admin.tabs.notifications')} subtitle={`${t('admin.placeholders')}: {{ref}} {{title}} {{actor}} {{comment}} {{validUntil}}`} />
      <CardBody className="space-y-3">
        <Alert tone="info">{t('admin.externalChannels')}</Alert>
        {q.data?.items.map((tp) => {
          const e = { ...tp, ...edits[tp.id] };
          return (
            <div key={tp.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-12">
              <div className="md:col-span-3"><Badge tone="blue">{tp.type}</Badge> <Badge>{tp.language.toUpperCase()}</Badge> <Badge>{tp.channel}</Badge></div>
              <Input className="md:col-span-3" aria-label={t('admin.templateTitle')} value={e.title} onChange={(x) => setEdits({ ...edits, [tp.id]: { ...edits[tp.id], title: x.target.value } })} />
              <Input className="md:col-span-4" aria-label={t('admin.templateBody')} value={e.body} onChange={(x) => setEdits({ ...edits, [tp.id]: { ...edits[tp.id], body: x.target.value } })} />
              <Checkbox className="md:col-span-1" checked={e.isEnabled} onChange={(x) => setEdits({ ...edits, [tp.id]: { ...edits[tp.id], isEnabled: x.target.checked } })} label={t('admin.enabled')} />
              <Button className="md:col-span-1" size="sm" disabled={!edits[tp.id]} onClick={() => save(() => api.put(`/admin/notification-templates/${tp.id}`, { title: e.title, body: e.body, isEnabled: e.isEnabled }))}>{t('common.save')}</Button>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

export function WorkflowAdmin() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'workflow'], queryFn: () => api.get<{ items: { code: string; name: string; steps: { stepOrder: number; stage: string }[] }[] }>('/admin/workflow') });
  return (
    <Card>
      <CardHeader title={t('admin.tabs.workflow')} />
      <CardBody className="space-y-3">
        <Alert tone="info">{t('admin.workflowNote')}</Alert>
        {q.data?.items.map((w) => (
          <div key={w.code} className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Badge>{t('stage.REQUESTER')}</Badge>
            {[...w.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((s) => <span key={s.stepOrder} className="flex items-center gap-2"><ArrowRight className="h-4 w-4" /><Badge tone="blue">{t(`stage.${s.stage}`)}</Badge></span>)}
            <ArrowRight className="h-4 w-4" /><Badge tone="green">{t('status.APPROVED')}</Badge>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

type Log = { id: number; occurredAt: string; actorId: string | null; actorLabel: string | null; action: string; entityType: string; entityId: string | null; result: string; reason: string | null; requestId: string | null; ip: string | null; metadata: unknown };
export function AuditAdmin() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const [f, setF] = useState({ action: '', entityType: '', result: '', entityId: '', page: 1 });
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => api.get<{ items: Log[]; total: number; page: number; pageSize: number }>(`/audit-logs${qs({ ...f, pageSize: 50 })}`), placeholderData: keepPreviousData });
  const [chain, setChain] = useState<{ ok: boolean; checked: number; brokenAtId: number | null } | null>(null);
  return (
    <Card>
      <CardHeader title={t('admin.tabs.audit')} action={hasRole('ADMIN') && <Button size="sm" variant="outline" onClick={async () => setChain(await api.get('/audit-logs/verify'))}><ShieldCheck className="h-4 w-4" />{t('admin.auditVerify')}</Button>} />
      {chain && <Alert tone={chain.ok ? 'success' : 'danger'} className="m-3">{chain.ok ? t('admin.chainOk', { count: chain.checked }) : t('admin.chainBroken', { id: chain.brokenAtId })}</Alert>}
      <div className="flex flex-wrap gap-2 p-3">
        <Input className="max-w-[180px]" placeholder={t('admin.action')} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })} />
        <Select className="max-w-[180px]" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value, page: 1 })}><option value="">{t('admin.entity')}</option>{['JSA', 'USER', 'REPORT', 'RISK_MATRIX', 'SYSTEM_SETTINGS', 'VALIDITY_SETTINGS', 'AREA_OWNER_ASSIGNMENT', 'SAFETY_OFFICER_ASSIGNMENT', 'ROUTE', 'ATTACHMENT'].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select className="max-w-[160px]" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value, page: 1 })}><option value="">{t('admin.result')}</option><option>SUCCESS</option><option>DENIED</option><option>FAILURE</option></Select>
        <Input className="max-w-[300px]" placeholder="Entity ID" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value, page: 1 })} />
      </div>
      {q.isLoading ? <Spinner /> : (
        <>
          <Table>
            <thead><tr><Th>#</Th><Th>{t('admin.time')}</Th><Th>{t('admin.actor')}</Th><Th>{t('admin.action')}</Th><Th>{t('admin.entity')}</Th><Th>{t('admin.result')}</Th><Th>{t('admin.metadata')}</Th></tr></thead>
            <tbody>{q.data?.items.map((l) => (
              <tr key={l.id} className="align-top text-xs">
                <Td>{l.id}</Td><Td className="whitespace-nowrap">{fmtDateTime(l.occurredAt)}</Td><Td>{l.actorLabel ?? 'system'}<div className="text-slate-400">{l.ip}</div></Td>
                <Td className="font-mono">{l.action}</Td>
                <Td>{l.entityType}{l.entityId && <div>{l.entityType === 'JSA' ? <Link className="text-brand-700 underline" to={`/jsa/${l.entityId}`}>{l.entityId.slice(0, 8)}…</Link> : <span className="text-slate-500">{l.entityId.slice(0, 36)}</span>}</div>}</Td>
                <Td><Badge tone={l.result === 'SUCCESS' ? 'green' : l.result === 'DENIED' ? 'red' : 'amber'}>{l.result}</Badge></Td>
                <Td className="max-w-md"><div className="truncate" title={JSON.stringify(l.metadata)}>{l.reason && <b>{l.reason} </b>}{l.metadata ? JSON.stringify(l.metadata) : ''}</div><div className="text-slate-400">req {l.requestId?.slice(0, 8)}</div></Td>
              </tr>
            ))}</tbody>
          </Table>
          {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ ...f, page: p })} label={(p, n) => t('common.page', { page: p, pages: n })} />}
        </>
      )}
    </Card>
  );
}
