import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Power, Save } from 'lucide-react';
import { api } from '@/lib/api';
import type { Level, Matrix, ScaleLabel } from '@/lib/types';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Spinner, Table, Td, Th, useConfirm, useToast } from '@/components/ui';
import { RiskMatrixGrid } from '@/components/jsa/ContentView';
import { ApiError } from '@/lib/api';

type M = Matrix & { status: 'DRAFT' | 'ACTIVE' | 'RETIRED'; validatedAt: string | null; scoreMethod: string };

export function RiskMatrixAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const errMsg = useErrorMessage();
  const q = useQuery({ queryKey: ['admin', 'matrices'], queryFn: () => api.get<{ items: M[] }>('/admin/risk-matrices') });
  const [selId, setSelId] = useState<string | null>(null);
  const sel = q.data?.items.find((m) => m.id === selId) ?? q.data?.items.find((m) => m.status === 'ACTIVE') ?? q.data?.items[0];
  const [draft, setDraft] = useState<M | null>(null);
  useEffect(() => { setDraft(sel ? structuredClone(sel) : null); }, [sel?.id, sel?.validatedAt, q.dataUpdatedAt]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'matrices'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); };
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); toast('success', t('admin.savedOk')); refresh(); }
    catch (e) {
      const probs = e instanceof ApiError ? ((e.details as { problems?: string[] })?.problems ?? []) : [];
      toast('danger', [errMsg(e), ...probs].join(' • '));
    }
  };
  if (q.isLoading || !draft || !sel) return <Spinner />;
  const editable = sel.status === 'DRAFT';
  const setLevel = (i: number, p: Partial<Level>) => setDraft({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const setLabel = (k: 'severityLabels' | 'likelihoodLabels', i: number, p: Partial<ScaleLabel>) => setDraft({ ...draft, [k]: draft[k].map((l, j) => (j === i ? { ...l, ...p } : l)) });
  return (
    <div className="space-y-4">
      <Alert tone="warning">{t('admin.matrixProvisionalWarn')}</Alert>
      <Card>
        <CardHeader title={t('admin.matrixVersions')} />
        <Table>
          <thead><tr><Th>v</Th><Th>{t('admin.name')}</Th><Th>{t('common.status')}</Th><Th>{t('admin.validate')}</Th><Th /></tr></thead>
          <tbody>{q.data!.items.map((m) => (
            <tr key={m.id} className={m.id === sel.id ? 'bg-brand-50' : ''}>
              <Td>{m.versionNo}</Td><Td>{m.name}</Td>
              <Td><Badge tone={m.status === 'ACTIVE' ? 'green' : m.status === 'DRAFT' ? 'amber' : 'slate'}>{m.status}</Badge></Td>
              <Td>{m.isValidated ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('admin.validatedBy', { date: fmtDateTime(m.validatedAt) })}</Badge> : <Badge tone="red">{t('admin.notValidated')}</Badge>}</Td>
              <Td><Button size="sm" variant="ghost" onClick={() => setSelId(m.id)}>{t('common.view')}</Button></Td>
            </tr>
          ))}</tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title={`v${sel.versionNo} — ${sel.status}`} action={<div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => run(async () => { const r = await api.post<{ id: string }>(`/admin/risk-matrices/${sel.id}/clone`); setSelId(r.id); })}><Copy className="h-4 w-4" />{t('admin.clone')}</Button>
          {editable && <Button size="sm" onClick={() => run(() => api.put(`/admin/risk-matrices/${sel.id}`, { name: draft.name, severityLabels: draft.severityLabels, likelihoodLabels: draft.likelihoodLabels, levels: draft.levels.map(({ id: _i, ...l }) => { void _i; return l; }), rule: draft.rule }))}><Save className="h-4 w-4" />{t('common.save')}</Button>}
          {sel.status !== 'RETIRED' && <Button size="sm" variant="success" onClick={async () => { if (await confirm({ title: t('admin.validate'), message: t('admin.matrixProvisionalWarn') })) run(() => api.post(`/admin/risk-matrices/${sel.id}/validate`, {})); }}><CheckCircle2 className="h-4 w-4" />{t('admin.validate')}</Button>}
          {editable && <Button size="sm" variant="warning" onClick={async () => { if (await confirm({ title: t('admin.activateMatrix'), message: `v${sel.versionNo}` })) run(() => api.post(`/admin/risk-matrices/${sel.id}/activate`, {})); }}><Power className="h-4 w-4" />{t('admin.activateMatrix')}</Button>}
        </div>} />
        <CardBody className="space-y-5">
          <Field label={t('admin.name')}><Input disabled={!editable} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <RiskMatrixGrid matrix={draft} />
          <div>
            <h3 className="mb-2 font-semibold">{t('admin.levels')}</h3>
            <Table><thead><tr><Th>Code</Th><Th>{t('admin.nameEn')}</Th><Th>{t('admin.nameTh')}</Th><Th>{t('admin.minScore')}</Th><Th>{t('admin.maxScore')}</Th><Th>{t('admin.color')}</Th><Th>{t('admin.escalation')}</Th></tr></thead>
              <tbody>{draft.levels.map((l, i) => (
                <tr key={i}>
                  <Td><Input disabled={!editable} value={l.code} onChange={(e) => setLevel(i, { code: e.target.value.toUpperCase() })} /></Td>
                  <Td><Input disabled={!editable} value={l.nameEn} onChange={(e) => setLevel(i, { nameEn: e.target.value })} /></Td>
                  <Td><Input disabled={!editable} value={l.nameTh} onChange={(e) => setLevel(i, { nameTh: e.target.value })} /></Td>
                  <Td><Input disabled={!editable} type="number" className="w-20" value={l.minScore} onChange={(e) => setLevel(i, { minScore: Number(e.target.value) })} /></Td>
                  <Td><Input disabled={!editable} type="number" className="w-20" value={l.maxScore} onChange={(e) => setLevel(i, { maxScore: Number(e.target.value) })} /></Td>
                  <Td><input disabled={!editable} type="color" value={l.color} onChange={(e) => setLevel(i, { color: e.target.value })} aria-label={t('admin.color')} /></Td>
                  <Td><Checkbox disabled={!editable} checked={l.requiresEscalation} onChange={(e) => setLevel(i, { requiresEscalation: e.target.checked })} /></Td>
                </tr>
              ))}</tbody></Table>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(['severityLabels', 'likelihoodLabels'] as const).map((k) => (
              <div key={k}><h3 className="mb-2 font-semibold">{t(`admin.${k}`)}</h3>
                {draft[k].map((s, i) => (
                  <div key={i} className="mb-1 flex items-center gap-1"><span className="w-6 font-bold">{s.value}</span>
                    <Input disabled={!editable} value={s.en} onChange={(e) => setLabel(k, i, { en: e.target.value })} aria-label="EN" />
                    <Input disabled={!editable} value={s.th} onChange={(e) => setLabel(k, i, { th: e.target.value })} aria-label="TH" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          {draft.rule && (
            <div className="rounded-md border p-3">
              <h3 className="mb-2 font-semibold">{t('admin.acceptance')}</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t('admin.maxResidual')}><Input disabled={!editable} type="number" value={draft.rule.maxAcceptableResidualScore} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule!, maxAcceptableResidualScore: Number(e.target.value) } })} /></Field>
                <div className="space-y-2">
                  <Checkbox disabled={!editable} checked={draft.rule.blockFinalApproval} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule!, blockFinalApproval: e.target.checked } })} label={t('admin.blockFinalApproval')} />
                  <Checkbox disabled={!editable} checked={draft.rule.blockSubmission} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule!, blockSubmission: e.target.checked } })} label={t('admin.blockSubmission')} />
                  <Checkbox disabled={!editable} checked={draft.rule.requireResidualLowerOrEqual} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule!, requireResidualLowerOrEqual: e.target.checked } })} label={t('admin.requireResidualLower')} />
                </div>
              </div>
              {draft.rule.description && <p className="mt-2 text-xs text-slate-600">{draft.rule.description}</p>}
            </div>
          )}
          <p className="text-xs text-slate-500">Score method: <Select disabled className="inline w-auto" value={sel.scoreMethod}><option>{sel.scoreMethod}</option></Select></p>
        </CardBody>
      </Card>
    </div>
  );
}
