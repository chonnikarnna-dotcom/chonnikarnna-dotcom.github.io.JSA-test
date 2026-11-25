import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Ban, CheckCircle2, Copy, Download, Edit3, FileText, Flag, GitBranch, Printer, RotateCcw, ShieldCheck, Trash2, XCircle, Clock,
} from 'lucide-react';
import { api, ApiError, apiUrl } from '@/lib/api';
import type { JsaDetail } from '@/lib/types';
import { useLookups } from '@/hooks/useLookups';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { fmtBytes, fmtDateTime, fmtDuration, fmtRelative } from '@/lib/format';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, Field, Select, Spinner, Tabs, Textarea, useConfirm, useToast } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { RiskBadge, StatusBadge } from '@/components/jsa/badges';
import { WorkflowStepper } from '@/components/jsa/WorkflowStepper';
import { GeneralInfoView, KV, PermitsView, StepsView } from '@/components/jsa/ContentView';
import { cn } from '@/lib/utils';

export function JsaDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const version = params.get('version') ? Number(params.get('version')) : undefined;
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['jsa', id, version], queryFn: () => api.get<JsaDetail>(`/jsas/${id}${version ? `?version=${version}` : ''}`) });
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<null | 'cancel' | 'complete' | 'revise'>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isLoading || lookups.isLoading) return <Spinner label={t('common.loading')} />;
  if (q.error) return <Alert tone="danger">{errMsg(q.error)}</Alert>;
  const d = q.data!;
  const l = lookups.data!;
  const j = d.jsa;
  const levels = d.matrix?.levels ?? l.matrix.levels;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['jsa', id] }); qc.invalidateQueries({ queryKey: ['inbox'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const latestLocked = d.versions.filter((v) => v.locked).slice(-1)[0];
  const draftRevision = d.versions.find((v) => !v.locked && v.versionNo > 1);
  const lastReturn = [...d.approvalHistory].reverse().find((h) => h.decision === 'RETURNED' || h.decision === 'REJECTED');
  const now = Date.now();
  const notYet = j.status === 'APPROVED' && !!j.validFrom && new Date(j.validFrom).getTime() > now;
  const valid = j.status === 'APPROVED' && j.validUntil && new Date(j.validUntil).getTime() > now && (!j.validFrom || new Date(j.validFrom).getTime() <= now);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast('success', okMsg); setDialog(null); setText(''); refresh(); } catch (e) { toast('danger', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl pb-24 lg:pb-6">
      <Breadcrumbs items={[{ label: t('nav.register'), to: '/register' }, { label: j.referenceNo }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{j.referenceNo}<StatusBadge status={j.status} /><RiskBadge code={j.riskLevelCode} levels={levels} />{j.isHighRiskWork && <Badge tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />}>HIGH-RISK WORK</Badge>}</span>}
        subtitle={<span>{d.content.jobTitle} · {t('detail.viewingVersion', { version: d.version.versionNo })}{d.version.isApprovedVersion && ` (${t('detail.approvedVersion')})`}</span>}
        actions={<>
          {d.versions.length > 1 && (
            <Select aria-label={t('fields.version')} className="h-10 w-auto" value={d.version.versionNo} onChange={(e) => setParams((p) => { p.set('version', e.target.value); return p; })}>
              {d.versions.map((v) => <option key={v.versionNo} value={v.versionNo}>v{v.versionNo}{v.locked ? '' : ` (${t('status.DRAFT')})`}{v.versionNo === d.versions[d.versions.length - 1].versionNo ? ` — ${t('detail.latestVersion')}` : ''}</option>)}
            </Select>
          )}
          {d.permissions.canEdit && <Button onClick={() => nav(`/jsa/${j.id}/edit`)}><Edit3 className="h-4 w-4" />{t('detail.editDraft')}</Button>}
          {d.permissions.canRevise && <Button variant="outline" onClick={() => setDialog('revise')}><GitBranch className="h-4 w-4" />{t('detail.createRevision')}</Button>}
          {d.permissions.canDiscardRevision && <Button variant="outline" onClick={async () => { if (await confirm({ title: t('form.discardRevision'), message: t('form.discardConfirm'), tone: 'danger' })) act(() => api.del(`/jsas/${j.id}/revisions/current`)); }}><Trash2 className="h-4 w-4" />{t('form.discardRevision')}</Button>}
          {d.permissions.canComplete && <Button variant="success" onClick={() => setDialog('complete')}><Flag className="h-4 w-4" />{t('detail.completeWork')}</Button>}
          {d.permissions.canDownloadPdf && <a className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href={apiUrl(`/jsas/${j.id}/pdf?lang=${i18n.language}`)} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" />{t('detail.pdf')}</a>}
          <Button variant="outline" onClick={() => window.open(`/jsa/${j.id}/print${version ? `?version=${version}` : ''}`, '_blank')}><Printer className="h-4 w-4" />{t('detail.printView')}</Button>
          {d.permissions.canCopy && <Button variant="ghost" onClick={() => act(async () => { const r = await api.post<{ id: string }>(`/jsas/${j.id}/copy`); nav(`/jsa/${r.id}/edit`); }, t('form.copiedHint'))}><Copy className="h-4 w-4" />{t('detail.copyAsNew')}</Button>}
          {d.permissions.canCancel && <Button variant="ghost" className="text-red-700" onClick={() => setDialog('cancel')}><Ban className="h-4 w-4" />{t('detail.cancelJsa')}</Button>}
          {d.permissions.canDeleteDraft && <Button variant="ghost" className="text-red-700" onClick={async () => { if (await confirm({ title: t('detail.deleteDraft'), message: j.referenceNo, tone: 'danger' })) act(async () => { await api.del(`/jsas/${j.id}`); nav('/my'); }); }}><Trash2 className="h-4 w-4" />{t('detail.deleteDraft')}</Button>}
        </>}
      />

      <Card className="mb-4"><CardBody className="space-y-3">
        <WorkflowStepper status={j.status} submitted={!!j.submittedAt} />
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <KV label={t('detail.currentStage')}>{j.currentStage ? <span className="font-semibold">{t(`stage.${j.currentStage}`)}{j.currentReviewer && ` — ${j.currentReviewer.displayName}`}</span> : t(`status.${j.status}`)}</KV>
          <KV label={t('fields.submittedAt')}>{fmtDateTime(j.submittedAt)}</KV>
          <KV label={t('fields.approvedAt')}>{fmtDateTime(j.approvedAt)}</KV>
          <KV label={t('detail.validity')}>{j.validFrom ? `${fmtDateTime(j.validFrom)} – ${fmtDateTime(j.validUntil)}` : '—'}</KV>
        </div>
        {j.pendingSince && <p className="flex items-center gap-1 text-xs text-slate-600"><Clock className="h-3.5 w-3.5" />{t('inbox.waitingFor', { time: fmtDuration(now - new Date(j.pendingSince).getTime()) })}</p>}
      </CardBody></Card>

      {/* Validity / status banners */}
      {(j.status === 'APPROVED' || j.status === 'EXPIRED') && (
        <Alert tone={valid ? 'success' : notYet ? 'info' : 'danger'} className="mb-4" title={valid ? t('detail.validNow') : notYet ? t('detail.validFuture', { from: fmtDateTime(j.validFrom) }) : t('detail.notValid')}>
          {j.validUntil && <div>{t('fields.validUntil')}: <b>{fmtDateTime(j.validUntil)}</b> ({fmtRelative(j.validUntil)})</div>}
          <div className="mt-1 text-xs">{t('detail.approvalNotPermit')}</div>
        </Alert>
      )}
      {lastReturn && j.status === 'RETURNED' && <Alert tone="warning" className="mb-4" title={t('detail.returnedBanner', { name: lastReturn.actorName })}>{lastReturn.comment}</Alert>}
      {lastReturn && j.status === 'REJECTED' && <Alert tone="danger" className="mb-4" title={t('detail.rejectedBanner', { name: lastReturn.actorName })}>{lastReturn.comment}</Alert>}
      {j.status === 'CANCELLED' && <Alert tone="info" className="mb-4" title={t('status.CANCELLED')}>{t('detail.cancelReason')}: {j.cancelReason}</Alert>}
      {j.status === 'COMPLETED' && <Alert tone="success" className="mb-4" title={t('status.COMPLETED')}>{fmtDateTime(j.completedAt)} — {j.completionNote}</Alert>}
      {draftRevision && <Alert tone="info" className="mb-4" action={d.permissions.canEdit ? undefined : <Button size="sm" variant="outline" onClick={() => nav(`/jsa/${j.id}/edit`)}>{t('detail.editDraft')}</Button>}>{t('detail.draftRevisionExists', { version: draftRevision.versionNo })}</Alert>}
      {d.version.changeSummary && <ChangeSummaryBox cs={d.version.changeSummary} />}

      {d.permissions.review && <ReviewPanel d={d} onDone={refresh} />}

      <Tabs className="no-print mb-4 mt-2" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: t('detail.tabs.overview') }, { id: 'steps', label: t('detail.tabs.steps'), badge: <Badge>{d.content.steps.length}</Badge> },
        { id: 'permits', label: t('detail.tabs.permits'), badge: d.content.permits.length ? <Badge tone="red">{d.content.permits.length}</Badge> : undefined },
        { id: 'documents', label: t('detail.tabs.documents'), badge: <Badge>{d.attachments.length}</Badge> }, { id: 'history', label: t('detail.tabs.history') },
        { id: 'versions', label: t('detail.tabs.versions'), badge: <Badge>{d.versions.length}</Badge> },
      ]} />

      {tab === 'overview' && <Card><CardBody className="space-y-6">
        <GeneralInfoView c={d.content} lookups={l} requesterName={d.version.requesterName} requesterType={d.version.requesterType} contractorName={j.contractorCompany?.name} />
        {d.declaration && <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"><div className="mb-1 font-semibold">{t('detail.declaration')}</div><p className="italic">“{d.declaration.textSnapshot}”</p><p className="mt-1 text-xs text-slate-500">{t('detail.declaredBy', { name: d.version.requesterName, date: fmtDateTime(d.declaration.acceptedAt), version: d.declaration.declarationVersion })}</p></div>}
        {d.matrix && <p className="text-xs text-slate-500">{t('detail.matrixUsed', { name: d.matrix.name, version: d.matrix.versionNo })}{!d.matrix.isValidated && ` — ${t('admin.notValidated')}`}</p>}
      </CardBody></Card>}
      {tab === 'steps' && <Card><CardBody><StepsView c={d.content} matrix={d.matrix} /></CardBody></Card>}
      {tab === 'permits' && <Card><CardBody><PermitsView c={d.content} permitTypes={l.permitTypes} attachments={d.attachments} onOpenAttachment={(aid) => window.open(apiUrl(`/attachments/${aid}/download?inline=1`), '_blank')} /></CardBody></Card>}
      {tab === 'documents' && <Card><CardBody>
        {d.attachments.length === 0 ? <p className="text-sm text-slate-500">{t('common.none')}</p> : (
          <ul className="divide-y rounded-md border">{d.attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <FileText className="h-5 w-5 text-slate-500" />
              <a className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline" href={apiUrl(`/attachments/${a.id}/download?inline=1`)} target="_blank" rel="noopener noreferrer">{a.originalName}</a>
              <Badge>{t(`attachmentCategory.${a.category}`)}</Badge><span className="text-slate-500">{fmtBytes(a.sizeBytes)} · v{a.addedInVersion} · {fmtDateTime(a.uploadedAt)}</span>
              <a className="text-brand-700" href={apiUrl(`/attachments/${a.id}/download`)} aria-label={t('common.download')}><Download className="h-4 w-4" /></a>
            </li>))}
          </ul>
        )}
      </CardBody></Card>}
      {tab === 'history' && <HistoryView d={d} />}
      {tab === 'versions' && <Card><CardBody>
        <ul className="space-y-2">{[...d.versions].reverse().map((v) => (
          <li key={v.versionNo} className={cn('rounded-md border p-3 text-sm', v.versionNo === d.version.versionNo && 'border-brand-500 bg-brand-50')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link className="font-semibold text-brand-700 hover:underline" to={`/jsa/${j.id}?version=${v.versionNo}`}>v{v.versionNo}</Link>
              <span className="text-slate-500">{v.locked ? `${t('fields.submittedAt')}: ${fmtDateTime(v.submittedAt)}` : t('status.DRAFT')}{v.versionNo === latestLocked?.versionNo && j.approvedVersionId && d.version.isApprovedVersion && v.versionNo === d.version.versionNo ? ` · ${t('detail.approvedVersion')}` : ''}</span>
            </div>
            {v.revisionReason && <p className="mt-1 text-slate-600">{t('form.revisionReason')}: {v.revisionReason}</p>}
            {v.changeSummary && <p className="mt-1 text-xs text-slate-600">{t('detail.changeSummary', { version: v.changeSummary.comparedToVersion })}: {[...v.changeSummary.changedFields.map((f) => t(`fields.${f}`, { defaultValue: f })), v.changeSummary.steps.added.length ? `${t('detail.stepsAdded')} ${v.changeSummary.steps.added.join(', ')}` : '', v.changeSummary.steps.modified.length ? `${t('detail.stepsModified')} ${v.changeSummary.steps.modified.join(', ')}` : '', v.changeSummary.steps.removed.length ? `${t('detail.stepsRemoved')} ${v.changeSummary.steps.removed.join(', ')}` : ''].filter(Boolean).join(' · ') || t('detail.noChanges')}</p>}
          </li>))}
        </ul>
      </CardBody></Card>}

      <Dialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={t('detail.cancelJsa')}
        footer={<><Button variant="outline" onClick={() => setDialog(null)}>{t('common.close')}</Button><Button variant="danger" loading={busy} disabled={text.trim().length < 5} onClick={() => act(() => api.post(`/jsas/${j.id}/cancel`, { reason: text }), t('status.CANCELLED'))}>{t('detail.cancelJsa')}</Button></>}>
        <p className="mb-3 text-sm">{t('detail.confirmCancel', { ref: j.referenceNo })}</p>
        <Field label={t('detail.cancelReason')} required><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={dialog === 'complete'} onClose={() => setDialog(null)} title={t('detail.completeWork')}
        footer={<><Button variant="outline" onClick={() => setDialog(null)}>{t('common.close')}</Button><Button variant="success" loading={busy} onClick={() => act(() => api.post(`/jsas/${j.id}/complete`, { note: text }), t('status.COMPLETED'))}>{t('common.confirm')}</Button></>}>
        <p className="mb-3 text-sm">{t('detail.confirmComplete', { ref: j.referenceNo })}</p>
        <Field label={t('detail.completeNote')}><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={dialog === 'revise'} onClose={() => setDialog(null)} title={t('detail.createRevision')}
        footer={<><Button variant="outline" onClick={() => setDialog(null)}>{t('common.close')}</Button><Button loading={busy} onClick={() => act(async () => { await api.post(`/jsas/${j.id}/revisions`, { reason: text }); nav(`/jsa/${j.id}/edit`); })}>{t('detail.createRevision')}</Button></>}>
        {j.status === 'APPROVED' && <Alert tone="info" className="mb-3">{t('detail.revisionPendingApproved', { version: latestLocked?.versionNo })}</Alert>}
        <Field label={t('form.revisionReason')} hint={t('detail.revisionReasonHelp')}><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

function ChangeSummaryBox({ cs }: { cs: NonNullable<JsaDetail['version']['changeSummary']> }) {
  const { t } = useTranslation();
  return (
    <Alert tone={cs.criticalChange ? 'warning' : 'info'} className="mb-4" title={t('detail.changeSummary', { version: cs.comparedToVersion })}>
      <ul className="list-disc pl-5 text-sm">
        {cs.changedFields.length > 0 && <li>{t('detail.changedFields')}: {cs.changedFields.map((f) => t(`fields.${f}`, { defaultValue: f })).join(', ')}</li>}
        {cs.steps.added.length > 0 && <li>{t('detail.stepsAdded')}: {cs.steps.added.join(', ')}</li>}
        {cs.steps.modified.length > 0 && <li>{t('detail.stepsModified')}: {cs.steps.modified.join(', ')}</li>}
        {cs.steps.removed.length > 0 && <li>{t('detail.stepsRemoved')}: {cs.steps.removed.join(', ')}</li>}
        {cs.permitsChanged && <li>{t('detail.permitsChanged')}</li>}
        {cs.attachments.added.length > 0 && <li>{t('detail.attachmentsAdded')}: {cs.attachments.added.join(', ')}</li>}
        {cs.attachments.removed.length > 0 && <li>{t('detail.attachmentsRemoved')}: {cs.attachments.removed.join(', ')}</li>}
      </ul>
      {cs.criticalChange && <p className="mt-1 font-semibold">{t('detail.criticalChange')}</p>}
    </Alert>
  );
}

function HistoryView({ d }: { d: JsaDetail }) {
  const { t } = useTranslation();
  const icon = (dec: string) => dec === 'APPROVED' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : dec === 'REJECTED' ? <XCircle className="h-5 w-5 text-red-600" /> : dec === 'RETURNED' ? <RotateCcw className="h-5 w-5 text-amber-600" /> : dec === 'CANCELLED' ? <Ban className="h-5 w-5 text-slate-500" /> : <ShieldCheck className="h-5 w-5 text-brand-600" />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader title={t('detail.timeline')} /><CardBody>
        <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6">
          {d.approvalHistory.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[35px] top-0 rounded-full bg-white p-0.5">{icon(h.decision)}</span>
              <div className="flex flex-wrap items-baseline gap-2"><b>{t(`decision.${h.decision}`)}</b><span className="text-sm text-slate-600">{h.stage ? t(`stage.${h.stage}`) : t('stage.REQUESTER')} · v{h.versionNo}</span></div>
              <div className="text-sm">{h.actorName} — <span className="text-slate-500">{fmtDateTime(h.createdAt)}</span></div>
              {h.comment && <blockquote className="mt-1 rounded bg-slate-50 p-2 text-sm italic">{h.comment}</blockquote>}
            </li>
          ))}
          {d.approvalHistory.length === 0 && <li className="text-sm text-slate-500">{t('detail.notSubmitted')}</li>}
        </ol>
      </CardBody></Card>
      <Card><CardHeader title={t('detail.statusHistory')} /><CardBody>
        <ul className="space-y-2 text-sm">{d.statusHistory.map((s) => (
          <li key={s.id}><div>{s.fromStatus ? `${t(`status.${s.fromStatus}`)} → ` : ''}<b>{t(`status.${s.toStatus}`)}</b> <span className="text-xs text-slate-500">v{s.versionNo}</span></div><div className="text-xs text-slate-500">{fmtDateTime(s.createdAt)}{s.reason ? ` — ${s.reason}` : ''}</div></li>
        ))}</ul>
      </CardBody></Card>
    </div>
  );
}

function ReviewPanel({ d, onDone }: { d: JsaDetail; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const [comment, setComment] = useState('');
  const [verified, setVerified] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const r = d.permissions.review!;
  const isSO = r.stage === 'SAFETY_OFFICER';
  const stageLabel = t(`stage.${r.stage}`);
  const permits = d.content.permits;
  const pts = lookups.data?.permitTypes ?? [];
  const residualMax = Math.max(0, ...d.content.steps.flatMap((s) => s.hazards.map((h) => h.residual?.score ?? 0)));
  const ruleMax = d.matrix?.rule?.maxAcceptableResidualScore;

  const decide = async (action: 'approve' | 'return' | 'reject') => {
    if (action !== 'approve' && comment.trim().length < 5) { setProblem(t('review.commentRequired')); return; }
    const msg = action === 'approve' ? t('review.confirmApprove', { stage: stageLabel, ref: d.jsa.referenceNo, version: d.version.versionNo }) : action === 'return' ? t('review.confirmReturn', { ref: d.jsa.referenceNo }) : t('review.confirmReject', { ref: d.jsa.referenceNo });
    const actionLabel = t(`review.${action === 'approve' ? (isSO ? 'approveFinal' : 'approve') : action}`);
    if (!(await confirm({ title: actionLabel, confirmLabel: actionLabel, message: msg, tone: action === 'approve' ? 'success' : action === 'reject' ? 'danger' : 'warning' }))) return;
    setBusy(action); setProblem(null);
    try {
      await api.post(`/approvals/tasks/${r.taskId}/${action}`, { versionId: r.versionId, comment: comment || null, verifiedPermitRefIds: verified });
      toast('success', t('review.done'));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_VERSION') { toast('warning', t('review.stale')); onDone(); }
      setProblem(errMsg(e));
    } finally { setBusy(null); }
  };

  return (
    <Card className="mb-4 border-2 border-brand-500">
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-700" />{t('review.title')} — {stageLabel}</span>} subtitle={t('review.youAreReviewer', { stage: stageLabel })} />
      <CardBody className="space-y-3">
        {ruleMax != null && residualMax > ruleMax && <Alert tone="danger">{t('prereq.RESIDUAL_RISK_NOT_ACCEPTABLE', { score: residualMax, max: ruleMax })}</Alert>}
        {isSO && permits.length > 0 && (
          <div className="rounded-md border border-purple-200 bg-purple-50 p-3">
            <p className="font-semibold">{t('review.verifyPermits')}</p>
            <p className="mb-2 text-xs text-slate-600">{t('review.verifyPermitsHelp')}</p>
            {permits.map((p) => {
              const pt = pts.find((x) => x.id === p.permitTypeId);
              return <Checkbox key={p.id} className="flex py-1" checked={verified.includes(p.id!)} onChange={(e) => setVerified((v) => e.target.checked ? [...v, p.id!] : v.filter((x) => x !== p.id))}
                label={<span>{i18n.language === 'th' ? pt?.nameTh : pt?.nameEn} — <b>{p.referenceNo ?? '—'}</b>{pt?.requiresSafetyVerification && <span className="text-red-600"> *</span>}</span>} />;
            })}
          </div>
        )}
        <Field label={t('common.comment')}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('review.commentPlaceholder')} rows={3} /></Field>
        {problem && <Alert tone="danger">{problem}</Alert>}
        {/* Sticky on mobile for shop-floor use */}
        <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-2 border-t bg-white p-2 shadow-lg lg:static lg:flex lg:border-0 lg:p-0 lg:shadow-none">
          <Button className="h-auto min-h-12 whitespace-normal px-2 py-2 text-xs sm:text-sm lg:h-12 lg:px-6 lg:text-base" size="lg" variant="success" loading={busy === 'approve'} onClick={() => decide('approve')}><CheckCircle2 className="h-5 w-5" />{isSO ? t('review.approveFinal') : t('review.approve')}</Button>
          <Button className="h-auto min-h-12 whitespace-normal px-2 py-2 text-xs sm:text-sm lg:h-12 lg:px-6 lg:text-base" size="lg" variant="warning" loading={busy === 'return'} onClick={() => decide('return')}><RotateCcw className="h-5 w-5" />{t('review.return')}</Button>
          <Button className="h-auto min-h-12 whitespace-normal px-2 py-2 text-xs sm:text-sm lg:h-12 lg:px-6 lg:text-base" size="lg" variant="danger" loading={busy === 'reject'} onClick={() => decide('reject')}><XCircle className="h-5 w-5" />{t('review.reject')}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
