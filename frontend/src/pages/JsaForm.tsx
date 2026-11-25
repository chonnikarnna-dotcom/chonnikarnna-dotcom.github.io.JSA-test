import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm, type Control, type UseFormRegister, type UseFormSetValue } from 'react-hook-form';
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Copy, Eye, FileText, Plus, Save, Send, Trash2, Upload, XCircle,
} from 'lucide-react';
import { api, ApiError, apiUrl } from '@/lib/api';
import type { Attachment, Content, JsaDetail, Lookups, Matrix, PermitType } from '@/lib/types';
import { useLookups } from '@/hooks/useLookups';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useAuth } from '@/lib/auth';
import { fmtBytes, fromLocalInput, localName, toLocalInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, Field, Input, Select, Spinner, Textarea, useConfirm, useToast } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { RiskBadge } from '@/components/jsa/badges';
import { GeneralInfoView, PermitsView, RiskMatrixGrid, StepsView } from '@/components/jsa/ContentView';

// ───────────────────────── Form model ─────────────────────────
type HazardForm = {
  hazard: string; consequence: string; hazardMasterId: string | null; initialSeverity: number | null; initialLikelihood: number | null;
  existingControls: string; additionalControls: string; controlOwner: string; residualSeverity: number | null; residualLikelihood: number | null;
};
type StepForm = { activity: string; hazards: HazardForm[] };
type PermitForm = { selected: boolean; referenceNo: string; answers: Record<string, string | boolean>; attachmentId: string; notes: string };
export type FormValues = {
  jobTitle: string; jobDescription: string; departmentId: string; contactPhone: string; contactEmail: string; areaId: string; exactLocation: string;
  plannedStart: string; plannedEnd: string; workerCount: string; supervisorName: string; supervisorPhone: string; jobTypeId: string;
  emergencyContactName: string; emergencyContactPhone: string; ppeRequired: string[]; additionalRequirements: string;
  steps: StepForm[]; permits: Record<string, PermitForm>; declarationAccepted: boolean;
};
type FieldError = { path: string; code: string; message: string; params?: Record<string, unknown> };

const emptyHazard = (): HazardForm => ({ hazard: '', consequence: '', hazardMasterId: null, initialSeverity: null, initialLikelihood: null, existingControls: '', additionalControls: '', controlOwner: '', residualSeverity: null, residualLikelihood: null });
const emptyStep = (): StepForm => ({ activity: '', hazards: [emptyHazard()] });

function defaults(l: Lookups, me: { departmentId: string | null }): FormValues {
  return {
    jobTitle: '', jobDescription: '', departmentId: me.departmentId ?? '', contactPhone: '', contactEmail: '', areaId: '', exactLocation: '',
    plannedStart: '', plannedEnd: '', workerCount: '', supervisorName: '', supervisorPhone: '', jobTypeId: '', emergencyContactName: '',
    emergencyContactPhone: '', ppeRequired: ['SAFETY_HELMET', 'SAFETY_SHOES'], additionalRequirements: '', steps: [emptyStep()],
    permits: Object.fromEntries(l.permitTypes.map((p) => [p.id, { selected: false, referenceNo: '', answers: {}, attachmentId: '', notes: '' }])), declarationAccepted: false,
  };
}

function fromContent(c: Content, l: Lookups): FormValues {
  const base = defaults(l, { departmentId: c.departmentId });
  return {
    ...base,
    jobTitle: c.jobTitle, jobDescription: c.jobDescription, departmentId: c.departmentId ?? '', contactPhone: c.contactPhone ?? '', contactEmail: c.contactEmail ?? '',
    areaId: c.areaId ?? '', exactLocation: c.exactLocation ?? '', plannedStart: toLocalInput(c.plannedStart), plannedEnd: toLocalInput(c.plannedEnd),
    workerCount: c.workerCount ? String(c.workerCount) : '', supervisorName: c.supervisorName ?? '', supervisorPhone: c.supervisorPhone ?? '', jobTypeId: c.jobTypeId ?? '',
    emergencyContactName: c.emergencyContactName ?? '', emergencyContactPhone: c.emergencyContactPhone ?? '', ppeRequired: c.ppeRequired, additionalRequirements: c.additionalRequirements ?? '',
    steps: c.steps.length ? c.steps.map((s) => ({
      activity: s.activity,
      hazards: s.hazards.map((h) => ({
        hazard: h.hazard, consequence: h.consequence, hazardMasterId: h.hazardMasterId, existingControls: h.existingControls, additionalControls: h.additionalControls,
        controlOwner: h.controlOwner ?? '', initialSeverity: h.initial?.severity ?? null, initialLikelihood: h.initial?.likelihood ?? null,
        residualSeverity: h.residual?.severity ?? null, residualLikelihood: h.residual?.likelihood ?? null,
      })),
    })) : [emptyStep()],
    permits: { ...base.permits, ...Object.fromEntries(c.permits.map((p) => [p.permitTypeId, { selected: true, referenceNo: p.referenceNo ?? '', answers: p.answers as Record<string, string | boolean>, attachmentId: p.attachmentId ?? '', notes: p.notes ?? '' }])) },
  };
}

/** Permits are sent in permit-type sort order so server error paths (permits.N) map back to the right type. */
function toPayload(v: FormValues, l: Lookups) {
  const n = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    jobTitle: v.jobTitle.trim(), jobDescription: v.jobDescription.trim(), departmentId: n(v.departmentId), contactPhone: n(v.contactPhone), contactEmail: n(v.contactEmail),
    areaId: n(v.areaId), exactLocation: n(v.exactLocation), plannedStart: fromLocalInput(v.plannedStart), plannedEnd: fromLocalInput(v.plannedEnd),
    workerCount: v.workerCount ? Number(v.workerCount) : null, supervisorName: n(v.supervisorName), supervisorPhone: n(v.supervisorPhone), jobTypeId: n(v.jobTypeId),
    emergencyContactName: n(v.emergencyContactName), emergencyContactPhone: n(v.emergencyContactPhone), ppeRequired: v.ppeRequired, additionalRequirements: n(v.additionalRequirements),
    steps: v.steps.map((s) => ({ activity: s.activity, hazards: s.hazards.map((h) => ({ ...h, controlOwner: n(h.controlOwner) })) })),
    permits: permitOrder(l.permitTypes).filter((pt) => v.permits[pt.id]?.selected).map((pt) => {
      const p = v.permits[pt.id];
      return { permitTypeId: pt.id, referenceNo: n(p.referenceNo), answers: p.answers, attachmentId: n(p.attachmentId), notes: n(p.notes) };
    }),
  };
}
const permitOrder = (pts: PermitType[]) => [...pts].sort((a, b) => a.sortOrder - b.sortOrder);

function assessPreview(m: Matrix, s: number | null, l: number | null) {
  if (!s || !l) return null;
  const score = m.scoreMethod === 'ADD' ? s + l : s * l;
  const lvl = m.levels.find((x) => score >= x.minScore && score <= x.maxScore);
  return { severity: s, likelihood: l, score, levelCode: lvl?.code ?? '?' };
}

function previewContent(v: FormValues, l: Lookups): Content {
  const p = toPayload(v, l);
  return {
    ...p, siteId: l.areas.find((a) => a.id === p.areaId)?.siteId ?? null, ppeRequired: v.ppeRequired, jobDescription: p.jobDescription,
    steps: v.steps.map((s, i) => ({
      stepNo: i + 1, activity: s.activity,
      hazards: s.hazards.map((h) => ({ ...h, controlOwner: h.controlOwner || null, initial: assessPreview(l.matrix, h.initialSeverity, h.initialLikelihood), residual: assessPreview(l.matrix, h.residualSeverity, h.residualLikelihood) })),
    })),
    permits: p.permits.map((x) => ({ ...x, verificationStatus: 'MANUAL_REFERENCE' })),
  } as Content;
}

/** Client-side mirror of the server submission rules (server remains authoritative). */
function precheck(v: FormValues, l: Lookups, userType: string, attachmentIds: string[]): FieldError[] {
  const e: FieldError[] = [];
  const req = (path: string, val: unknown) => { if (val === null || val === undefined || String(val).trim() === '') e.push({ path, code: 'required', message: '' }); };
  ['jobTitle', 'jobDescription', 'areaId', 'exactLocation', 'jobTypeId', 'supervisorName', 'contactPhone', 'workerCount', 'plannedStart', 'plannedEnd'].forEach((f) => req(f, (v as unknown as Record<string, unknown>)[f]));
  if (userType === 'EMPLOYEE') req('departmentId', v.departmentId);
  const s = fromLocalInput(v.plannedStart); const en = fromLocalInput(v.plannedEnd);
  if (s && en && new Date(en) <= new Date(s)) e.push({ path: 'plannedEnd', code: 'end_before_start', message: '' });
  if (en && new Date(en) <= new Date()) e.push({ path: 'plannedEnd', code: 'in_past', message: '' });
  if (s && en && (new Date(en).getTime() - new Date(s).getTime()) / 86_400_000 > l.validity.maxWorkPeriodDays) e.push({ path: 'plannedEnd', code: 'period_too_long', message: '', params: { max: l.validity.maxWorkPeriodDays } });
  if (!v.steps.length) e.push({ path: 'steps', code: 'min_one_step', message: '' });
  const rule = l.matrix.rule;
  v.steps.forEach((st, i) => {
    req(`steps.${i}.activity`, st.activity);
    if (!st.hazards.length) e.push({ path: `steps.${i}.hazards`, code: 'min_one_hazard', message: '' });
    st.hazards.forEach((h, j) => {
      const p = `steps.${i}.hazards.${j}`;
      req(`${p}.hazard`, h.hazard); req(`${p}.consequence`, h.consequence);
      if (!h.existingControls.trim() && !h.additionalControls.trim()) e.push({ path: `${p}.controls`, code: 'control_required', message: '' });
      if (h.additionalControls.trim() && !h.controlOwner.trim()) e.push({ path: `${p}.controlOwner`, code: 'required', message: '' });
      const ini = assessPreview(l.matrix, h.initialSeverity, h.initialLikelihood); const res = assessPreview(l.matrix, h.residualSeverity, h.residualLikelihood);
      if (!ini) e.push({ path: `${p}.initial`, code: 'risk_required', message: '' });
      if (!res) e.push({ path: `${p}.residual`, code: 'risk_required', message: '' });
      if (ini && res && rule?.requireResidualLowerOrEqual && res.score > ini.score) e.push({ path: `${p}.residual`, code: 'residual_above_initial', message: '' });
      if (res && rule?.blockSubmission && res.score > rule.maxAcceptableResidualScore) e.push({ path: `${p}.residual`, code: 'residual_not_acceptable', message: '', params: { max: rule.maxAcceptableResidualScore } });
    });
  });
  const selected = permitOrder(l.permitTypes).filter((pt) => v.permits[pt.id]?.selected);
  selected.forEach((pt, i) => {
    const p = v.permits[pt.id];
    if (pt.requiresPermitReference && !p.referenceNo.trim()) e.push({ path: `permits.${i}.referenceNo`, code: 'required', message: '' });
    if (pt.requiresAttachment && (!p.attachmentId || !attachmentIds.includes(p.attachmentId))) e.push({ path: `permits.${i}.attachmentId`, code: 'evidence_required', message: '' });
    pt.followUpQuestions.filter((q) => q.required).forEach((q) => {
      const a = p.answers[q.key];
      if (q.type === 'boolean' ? a !== true : !(typeof a === 'string' && a.trim())) e.push({ path: `permits.${i}.answers.${q.key}`, code: q.type === 'boolean' ? 'must_confirm' : 'required', message: '' });
    });
  });
  if (selected.some((pt) => pt.isHighRisk)) { req('emergencyContactName', v.emergencyContactName); req('emergencyContactPhone', v.emergencyContactPhone); }
  if (!v.declarationAccepted) e.push({ path: 'declaration', code: 'required', message: '' });
  return e;
}

const SECTIONS = ['general', 'work', 'permits', 'steps', 'risk', 'documents', 'declaration'] as const;
type Section = (typeof SECTIONS)[number];
function sectionOf(path: string): Section {
  if (/^steps\.\d+\.hazards\.\d+\.(initial|residual)/.test(path)) return 'risk';
  if (path.startsWith('steps')) return 'steps';
  if (path.startsWith('permits')) return 'permits';
  if (['jobDescription', 'areaId', 'exactLocation', 'plannedStart', 'plannedEnd', 'workerCount', 'jobTypeId'].includes(path)) return 'work';
  if (path === 'declaration') return 'declaration';
  return 'general';
}

// ───────────────────────── Page ─────────────────────────
export function JsaFormPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const detail = useQuery({ queryKey: ['jsa', id], queryFn: () => api.get<JsaDetail>(`/jsas/${id}`), enabled: !!id });
  const section = (SECTIONS.includes(params.get('section') as Section) ? params.get('section') : 'general') as Section;
  const setSection = (s: Section) => { setParams((p) => { p.set('section', s); return p; }, { replace: true }); window.scrollTo({ top: 0 }); };

  const form = useForm<FormValues>({ mode: 'onBlur' });
  const { register, control, handleSubmit, reset, formState, getValues, setValue } = form;
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState<'draft' | 'continue' | 'submit' | null>(null);
  const [preview, setPreview] = useState(false);
  const rowVersion = useRef<number | undefined>(undefined);
  const allowNav = useRef(false);
  const initialized = useRef<string | null>(null);

  useEffect(() => {
    if (!lookups.data || !me) return;
    const key = id ? `${id}:${detail.data?.version.id ?? ''}` : 'new';
    if (initialized.current === key) return;
    if (id && !detail.data) return;
    if (id && detail.data && !detail.data.permissions.canEdit) { nav(`/jsa/${id}`, { replace: true }); return; }
    reset(detail.data ? fromContent(detail.data.content, lookups.data) : defaults(lookups.data, me));
    rowVersion.current = detail.data?.jsa.rowVersion;
    initialized.current = key;
  }, [lookups.data, detail.data, id, me, reset, nav]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => !allowNav.current && formState.isDirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (formState.isDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [formState.isDirty]);

  const values = form.watch(); // subscribes at render time, so a reset() from the init effect is always observed
  const attachments = detail.data?.attachments ?? [];
  const checks = useMemo(() => (lookups.data && values?.steps ? precheck(values, lookups.data, me?.userType ?? 'EMPLOYEE', attachments.map((a) => a.id)) : []), [values, lookups.data, me, attachments]);
  const allErrors = serverErrors.length ? serverErrors : [];
  const errText = (fe: FieldError) => t(`validation.${fe.code}`, { ...(fe.params ?? {}), defaultValue: fe.message || fe.code });
  const errFor = (path: string) => { const f = allErrors.find((x) => x.path === path); return f ? errText(f) : null; };
  const sectionErrorCount = (s: Section) => allErrors.filter((x) => sectionOf(x.path) === s).length;

  if (lookups.isLoading || (id && detail.isLoading) || !values?.steps) return <Spinner label={t('common.loading')} />;
  if (lookups.error || detail.error) return <Alert tone="danger">{errMsg(lookups.error ?? detail.error)}</Alert>;
  const l = lookups.data!;
  const d = detail.data;

  async function save(kind: 'draft' | 'continue'): Promise<string | null> {
    setSaving(kind);
    try {
      const payload = toPayload(getValues(), l);
      let jsaId = id;
      if (!id) {
        const r = await api.post<{ id: string; referenceNo: string }>('/jsas', payload);
        jsaId = r.id;
        toast('success', t('form.draftCreated', { ref: r.referenceNo }));
      } else {
        const r = await api.put<{ rowVersion: number }>(`/jsas/${id}`, { ...payload, expectedRowVersion: rowVersion.current });
        rowVersion.current = r.rowVersion;
        if (kind === 'draft') toast('success', t('form.saved'));
      }
      reset(getValues());
      setServerErrors([]);
      await qc.invalidateQueries({ queryKey: ['jsa', jsaId] });
      if (!id) {
        allowNav.current = true;
        const next = kind === 'continue' ? SECTIONS[Math.min(SECTIONS.indexOf(section) + 1, SECTIONS.length - 1)] : section;
        nav(`/jsa/${jsaId}/edit?section=${next}`, { replace: true });
        setTimeout(() => { allowNav.current = false; }, 0);
      } else if (kind === 'continue') setSection(SECTIONS[Math.min(SECTIONS.indexOf(section) + 1, SECTIONS.length - 1)]);
      return jsaId!;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR') setServerErrors((e.details as FieldError[]) ?? []);
      toast('danger', errMsg(e));
      return null;
    } finally { setSaving(null); }
  }

  async function submit() {
    if (checks.length) { setServerErrors(checks); setSection(sectionOf(checks[0].path)); toast('danger', t('form.validationSummary', { count: checks.length })); return; }
    const ok = await confirm({ title: t('form.submit'), message: t('form.declarationTitle') + ': ' + (i18n.language === 'th' ? l.settings.declarationTextTh : l.settings.declarationTextEn), confirmLabel: t('form.submit') });
    if (!ok) return;
    const jsaId = await save('draft');
    if (!jsaId) return;
    setSaving('submit');
    try {
      await api.post(`/jsas/${jsaId}/submit`, { declarationAccepted: true, language: i18n.language, expectedRowVersion: rowVersion.current });
      toast('success', t('form.submitted'));
      allowNav.current = true;
      qc.invalidateQueries();
      nav(`/jsa/${jsaId}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SUBMISSION_INVALID') {
        const fe = (e.details as FieldError[]) ?? [];
        setServerErrors(fe);
        if (fe[0]) setSection(sectionOf(fe[0].path));
      }
      toast('danger', errMsg(e));
    } finally { setSaving(null); }
  }

  const title = !id ? t('form.newTitle') : d && d.version.versionNo > 1 ? t('form.revisionTitle', { version: d.version.versionNo, ref: d.jsa.referenceNo }) : t('form.editTitle', { ref: d?.jsa.referenceNo });
  const idx = SECTIONS.indexOf(section);

  return (
    <div className="mx-auto max-w-6xl pb-28">
      <Breadcrumbs items={[{ label: t('nav.mySubmissions'), to: '/my' }, ...(d ? [{ label: d.jsa.referenceNo, to: `/jsa/${d.jsa.id}` }] : []), { label: id ? t('common.edit') : t('nav.newJsa') }]} />
      <PageHeader title={title} subtitle={d && <span className="flex items-center gap-2">{d.jsa.referenceNo} · v{d.version.versionNo}{formState.isDirty && <Badge tone="amber">{t('form.leaveWarning')}</Badge>}</span>} />

      {d && d.version.versionNo > 1 && (() => {
        const last = [...d.approvalHistory].reverse().find((h) => h.decision === 'RETURNED');
        return last ? <Alert tone="warning" className="mb-4" title={t('detail.returnedBanner', { name: last.actorName })}>{last.comment}</Alert> : null;
      })()}
      {d?.jsa.status === 'APPROVED' && <Alert tone="info" className="mb-4">{t('detail.revisionPendingApproved', { version: d.versions.filter((v) => v.locked).slice(-1)[0]?.versionNo })}</Alert>}

      {/* Progress / section navigation */}
      <nav aria-label="Form sections" className="no-print mb-4 overflow-x-auto">
        <ol className="flex min-w-max gap-1">
          {SECTIONS.map((s, i) => {
            const n = sectionErrorCount(s);
            return (
              <li key={s}>
                <button type="button" onClick={() => setSection(s)} aria-current={s === section ? 'step' : undefined}
                  className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', s === section ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                  <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold', s === section ? 'bg-white text-brand-800' : i < idx ? 'bg-emerald-600 text-white' : 'bg-slate-200')}>{i + 1}</span>
                  {t(`form.sections.${s}`)}
                  {n > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs font-bold text-white" aria-label={`${n} errors`}>{n}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200" aria-hidden><div className="h-full bg-brand-600 transition-all" style={{ width: `${((idx + 1) / SECTIONS.length) * 100}%` }} /></div>
      </nav>

      {allErrors.length > 0 && <Alert tone="danger" className="mb-4" title={t('form.validationSummary', { count: allErrors.length })} />}

      <form onSubmit={handleSubmit(() => save('continue'))} noValidate>
        {section === 'general' && <GeneralSection register={register} l={l} errFor={errFor} me={me!} d={d} />}
        {section === 'work' && <WorkSection register={register} l={l} errFor={errFor} values={values} />}
        {section === 'permits' && <PermitsSection control={control} register={register} l={l} errFor={errFor} values={values} attachments={attachments} setValue={setValue} />}
        {section === 'steps' && <StepsSection control={control} register={register} l={l} errFor={errFor} setValue={setValue} getValues={getValues} />}
        {section === 'risk' && <RiskSection control={control} l={l} errFor={errFor} values={values} />}
        {section === 'documents' && <DocumentsSection jsaId={id} attachments={attachments} l={l} onChanged={() => qc.invalidateQueries({ queryKey: ['jsa', id] })} />}
        {section === 'declaration' && <DeclarationSection register={register} l={l} checks={checks} errText={errText} onGo={(s) => setSection(s)} />}

        {/* Sticky action bar — large touch targets for shop-floor tablets */}
        <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={idx === 0} onClick={() => setSection(SECTIONS[idx - 1])}>{t('common.previous')}</Button>
              <Button type="button" variant="outline" onClick={() => setPreview(true)}><Eye className="h-4 w-4" />{t('form.preview')}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" loading={saving === 'draft'} onClick={() => save('draft')}><Save className="h-4 w-4" />{t('form.saveDraft')}</Button>
              {section !== 'declaration'
                ? <Button type="submit" loading={saving === 'continue'}>{t('form.saveContinue')}</Button>
                : <Button type="button" variant="success" loading={saving === 'submit'} onClick={submit}><Send className="h-4 w-4" />{t('form.submit')}</Button>}
            </div>
          </div>
        </div>
      </form>

      <Dialog open={preview} onClose={() => setPreview(false)} title={t('form.previewTitle')} size="xl">
        <div className="space-y-6">
          <GeneralInfoView c={previewContent(values, l)} lookups={l} requesterName={me!.displayName} requesterType={me!.userType} contractorName={l.contractors.find((c) => c.id === me!.contractorCompanyId)?.name} />
          <PermitsView c={previewContent(values, l)} permitTypes={l.permitTypes} attachments={attachments} />
          <StepsView c={previewContent(values, l)} matrix={l.matrix} />
        </div>
      </Dialog>

      <Dialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title={t('form.leaveWarning')} size="sm"
        footer={<><Button variant="outline" onClick={() => blocker.reset?.()}>{t('common.stay')}</Button><Button variant="danger" onClick={() => blocker.proceed?.()}>{t('common.leave')}</Button></>}>
        {t('common.unsavedChanges')}
      </Dialog>
    </div>
  );
}

// ───────────────────────── Sections ─────────────────────────
type ErrFor = (p: string) => string | null;

function GeneralSection({ register, l, errFor, me, d }: { register: UseFormRegister<FormValues>; l: Lookups; errFor: ErrFor; me: NonNullable<ReturnType<typeof useAuth>['me']>; d?: JsaDetail }) {
  const { t } = useTranslation();
  const contractor = l.contractors.find((c) => c.id === me.contractorCompanyId);
  return (
    <Card>
      <CardHeader title={t('form.sections.general')} subtitle={t('form.requesterAuto')} />
      <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t('fields.referenceNo')}><Input value={d?.jsa.referenceNo ?? '—'} disabled /></Field>
        <Field label={t('fields.version')}><Input value={d?.version.versionNo ?? 1} disabled /></Field>
        <Field label={t('fields.requester')} htmlFor="requesterName"><Input id="requesterName" value={me.displayName} disabled /></Field>
        <Field label={t('fields.requesterType')}><Input value={t(`userType.${me.userType}`)} disabled /></Field>
        {me.userType === 'CONTRACTOR'
          ? <Field label={t('fields.contractor')}><Input value={contractor?.name ?? '—'} disabled /></Field>
          : <Field label={t('fields.department')} required htmlFor="departmentId" error={errFor('departmentId')}>
            <Select id="departmentId" {...register('departmentId')} aria-invalid={!!errFor('departmentId')}><option value="">—</option>{l.departments.map((x) => <option key={x.id} value={x.id}>{localName(x)}</option>)}</Select>
          </Field>}
        <Field label={t('fields.jobTitle')} required htmlFor="jobTitle" error={errFor('jobTitle')} className="md:col-span-2">
          <Input id="jobTitle" maxLength={200} {...register('jobTitle')} aria-invalid={!!errFor('jobTitle')} />
        </Field>
        <Field label={t('fields.contactPhone')} required htmlFor="contactPhone" error={errFor('contactPhone')}><Input id="contactPhone" type="tel" {...register('contactPhone')} aria-invalid={!!errFor('contactPhone')} /></Field>
        <Field label={t('fields.contactEmail')} htmlFor="contactEmail" error={errFor('contactEmail')}><Input id="contactEmail" type="email" {...register('contactEmail')} /></Field>
        <Field label={t('fields.supervisorName')} required htmlFor="supervisorName" error={errFor('supervisorName')}><Input id="supervisorName" {...register('supervisorName')} aria-invalid={!!errFor('supervisorName')} /></Field>
        <Field label={t('fields.supervisorPhone')} htmlFor="supervisorPhone"><Input id="supervisorPhone" type="tel" {...register('supervisorPhone')} /></Field>
        <Field label={t('fields.emergencyContactName')} htmlFor="emergencyContactName" error={errFor('emergencyContactName')}><Input id="emergencyContactName" {...register('emergencyContactName')} aria-invalid={!!errFor('emergencyContactName')} /></Field>
        <Field label={t('fields.emergencyContactPhone')} htmlFor="emergencyContactPhone" error={errFor('emergencyContactPhone')}><Input id="emergencyContactPhone" type="tel" {...register('emergencyContactPhone')} aria-invalid={!!errFor('emergencyContactPhone')} /></Field>
      </CardBody>
    </Card>
  );
}

function WorkSection({ register, l, errFor, values }: { register: UseFormRegister<FormValues>; l: Lookups; errFor: ErrFor; values: FormValues }) {
  const { t } = useTranslation();
  const area = l.areas.find((a) => a.id === values.areaId);
  return (
    <Card>
      <CardHeader title={t('form.sections.work')} />
      <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t('fields.jobDescription')} required htmlFor="jobDescription" error={errFor('jobDescription')} className="md:col-span-2">
          <Textarea id="jobDescription" rows={4} maxLength={5000} {...register('jobDescription')} aria-invalid={!!errFor('jobDescription')} />
        </Field>
        <Field label={t('fields.area')} required htmlFor="areaId" error={errFor('areaId')} hint={t('form.areaOwnerHint')}>
          <Select id="areaId" {...register('areaId')} aria-invalid={!!errFor('areaId')}>
            <option value="">—</option>
            {l.sites.map((s) => <optgroup key={s.id} label={localName(s)}>{l.areas.filter((a) => a.siteId === s.id).map((a) => <option key={a.id} value={a.id}>{localName(a)}{a.building ? ` (${a.building})` : ''}</option>)}</optgroup>)}
          </Select>
        </Field>
        <Field label={t('fields.site')}><Input value={localName(l.sites.find((s) => s.id === area?.siteId))} disabled /></Field>
        <Field label={t('fields.exactLocation')} required htmlFor="exactLocation" error={errFor('exactLocation')} className="md:col-span-2"><Input id="exactLocation" {...register('exactLocation')} aria-invalid={!!errFor('exactLocation')} /></Field>
        <Field label={t('fields.jobType')} required htmlFor="jobTypeId" error={errFor('jobTypeId')}>
          <Select id="jobTypeId" {...register('jobTypeId')} aria-invalid={!!errFor('jobTypeId')}><option value="">—</option>{l.jobTypes.map((x) => <option key={x.id} value={x.id}>{localName(x)}</option>)}</Select>
        </Field>
        <Field label={t('fields.workerCount')} required htmlFor="workerCount" error={errFor('workerCount')}><Input id="workerCount" type="number" min={1} max={1000} inputMode="numeric" {...register('workerCount')} aria-invalid={!!errFor('workerCount')} /></Field>
        <Field label={t('fields.plannedStart')} required htmlFor="plannedStart" error={errFor('plannedStart')}><Input id="plannedStart" type="datetime-local" {...register('plannedStart')} aria-invalid={!!errFor('plannedStart')} /></Field>
        <Field label={t('fields.plannedEnd')} required htmlFor="plannedEnd" error={errFor('plannedEnd')} hint={`≤ ${l.validity.maxWorkPeriodDays} ${t('common.days', { count: l.validity.maxWorkPeriodDays }).replace(/^\d+\s*/, '')}`}>
          <Input id="plannedEnd" type="datetime-local" {...register('plannedEnd')} aria-invalid={!!errFor('plannedEnd')} />
        </Field>
        <Field label={t('fields.ppeRequired')} className="md:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {l.settings.ppeOptions.map((p) => <Checkbox key={p} value={p} {...register('ppeRequired')} label={t(`ppe.${p}`, { defaultValue: p })} />)}
          </div>
        </Field>
        <Field label={t('fields.additionalRequirements')} htmlFor="additionalRequirements" className="md:col-span-2"><Textarea id="additionalRequirements" rows={2} {...register('additionalRequirements')} /></Field>
      </CardBody>
    </Card>
  );
}

function PermitsSection({ register, l, errFor, values, attachments, setValue }: { control: Control<FormValues>; register: UseFormRegister<FormValues>; l: Lookups; errFor: ErrFor; values: FormValues; attachments: Attachment[]; setValue: UseFormSetValue<FormValues> }) {
  const { t, i18n } = useTranslation();
  const th = i18n.language === 'th';
  const ordered = permitOrder(l.permitTypes);
  const selectedOrder = ordered.filter((pt) => values.permits[pt.id]?.selected);
  const jobType = l.jobTypes.find((j) => j.id === values.jobTypeId);
  const suggested = jobType?.defaultPermitCodes ?? [];
  return (
    <Card>
      <CardHeader title={t('form.highRiskTitle')} subtitle={t('form.highRiskHelp')} />
      <CardBody className="space-y-4">
        <Alert tone="info">{t('form.permitDisclaimer')}</Alert>
        {suggested.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">{localName(jobType)}:</span>
            {suggested.map((code) => {
              const pt = l.permitTypes.find((p) => p.code === code);
              if (!pt || values.permits[pt.id]?.selected) return null;
              return <Button key={code} type="button" size="sm" variant="outline" onClick={() => setValue(`permits.${pt.id}.selected`, true, { shouldDirty: true })}><Plus className="h-3.5 w-3.5" />{localName(pt)}</Button>;
            })}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((pt) => (
            <label key={pt.id} className={cn('flex cursor-pointer items-center gap-3 rounded-md border p-3', values.permits[pt.id]?.selected ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:bg-slate-50')}>
              <input type="checkbox" className="h-5 w-5" {...register(`permits.${pt.id}.selected`)} />
              <span className="text-sm font-medium">{localName(pt)}</span>
              {pt.isHighRisk && <AlertTriangle className="ml-auto h-4 w-4 text-red-600" aria-label="high risk" />}
            </label>
          ))}
        </div>
        {selectedOrder.map((pt) => {
          const i = selectedOrder.indexOf(pt);
          const base = `permits.${pt.id}` as const;
          return (
            <div key={pt.id} className="rounded-lg border-2 border-red-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{localName(pt)}</h3>
                {pt.requiresPermitReference && <Badge tone="red">{t('form.requiresRef')}</Badge>}
                {pt.requiresAttachment && <Badge tone="red">{t('form.requiresAttachment')}</Badge>}
                {pt.requiresSafetyVerification && <Badge tone="purple">{t('form.requiresVerification')}</Badge>}
              </div>
              {(th ? pt.guidanceTh : pt.guidanceEn) && <p className="mb-3 text-sm text-slate-600">{th ? pt.guidanceTh : pt.guidanceEn}</p>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label={t('form.permitRef')} required={pt.requiresPermitReference} error={errFor(`permits.${i}.referenceNo`)}><Input {...register(`${base}.referenceNo`)} aria-invalid={!!errFor(`permits.${i}.referenceNo`)} /></Field>
                <Field label={t('form.permitEvidence')} required={pt.requiresAttachment} error={errFor(`permits.${i}.attachmentId`)} hint={!attachments.length ? t('form.uploadAfterSave') : undefined}>
                  <Select {...register(`${base}.attachmentId`)} aria-invalid={!!errFor(`permits.${i}.attachmentId`)}><option value="">{t('form.selectAttachment')}</option>{attachments.map((a) => <option key={a.id} value={a.id}>{a.originalName}</option>)}</Select>
                </Field>
                <Field label={t('form.permitNotes')}><Input {...register(`${base}.notes`)} /></Field>
              </div>
              {pt.followUpQuestions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {pt.followUpQuestions.map((q) => {
                    const err = errFor(`permits.${i}.answers.${q.key}`);
                    return q.type === 'boolean' ? (
                      <div key={q.key}><Checkbox {...register(`${base}.answers.${q.key}` as never)} label={<>{th ? q.th : q.en}{q.required && <span className="text-red-600"> *</span>}</>} />{err && <p className="ml-6 text-xs text-red-700">{err}</p>}</div>
                    ) : (
                      <Field key={q.key} label={th ? q.th : q.en} required={q.required} error={err}><Input {...register(`${base}.answers.${q.key}` as never)} /></Field>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function StepsSection({ control, register, l, errFor, setValue, getValues }: { control: Control<FormValues>; register: UseFormRegister<FormValues>; l: Lookups; errFor: ErrFor; setValue: UseFormSetValue<FormValues>; getValues: () => FormValues }) {
  const { t } = useTranslation();
  const steps = useFieldArray({ control, name: 'steps' });
  return (
    <Card>
      <CardHeader title={t('form.sections.steps')} action={<Button type="button" size="sm" onClick={() => steps.append(emptyStep())}><Plus className="h-4 w-4" />{t('form.addStep')}</Button>} />
      <CardBody className="space-y-4">
        {errFor('steps') && <Alert tone="danger">{errFor('steps')}</Alert>}
        {steps.fields.length === 0 && <p className="text-sm text-slate-500">{t('form.noSteps')}</p>}
        {steps.fields.map((f, i) => (
          <div key={f.id} className="rounded-lg border border-slate-300 bg-slate-50/50">
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-100 px-3 py-2">
              <span className="mr-auto font-semibold">{t('form.step', { n: i + 1 })}</span>
              <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => steps.move(i, i - 1)} aria-label={t('form.moveUp')} title={t('form.moveUp')}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={i === steps.fields.length - 1} onClick={() => steps.move(i, i + 1)} aria-label={t('form.moveDown')} title={t('form.moveDown')}><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => steps.insert(i + 1, structuredClone(getValues().steps[i]))} aria-label={t('form.copyStep')} title={t('form.copyStep')}><Copy className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => steps.remove(i)} aria-label={t('form.deleteStep')} title={t('form.deleteStep')}><Trash2 className="h-4 w-4 text-red-600" /></Button>
            </div>
            <div className="space-y-3 p-3">
              <Field label={t('form.activity')} required error={errFor(`steps.${i}.activity`)}><Textarea rows={2} {...register(`steps.${i}.activity`)} aria-invalid={!!errFor(`steps.${i}.activity`)} /></Field>
              <HazardList control={control} register={register} stepIndex={i} l={l} errFor={errFor} setValue={setValue} getValues={getValues} />
            </div>
          </div>
        ))}
        {steps.fields.length > 0 && <Button type="button" variant="outline" className="w-full" onClick={() => steps.append(emptyStep())}><Plus className="h-4 w-4" />{t('form.addStep')}</Button>}
      </CardBody>
    </Card>
  );
}

function HazardList({ control, register, stepIndex, l, errFor, setValue, getValues }: { control: Control<FormValues>; register: UseFormRegister<FormValues>; stepIndex: number; l: Lookups; errFor: ErrFor; setValue: UseFormSetValue<FormValues>; getValues: () => FormValues }) {
  const { t } = useTranslation();
  const hz = useFieldArray({ control, name: `steps.${stepIndex}.hazards` });
  const appendControl = (j: number, field: 'existingControls' | 'additionalControls', text: string) => {
    const cur = getValues().steps[stepIndex].hazards[j][field];
    setValue(`steps.${stepIndex}.hazards.${j}.${field}`, cur ? `${cur}\n${text}` : text, { shouldDirty: true });
  };
  return (
    <div className="space-y-3">
      {errFor(`steps.${stepIndex}.hazards`) && <p className="text-xs text-red-700">{errFor(`steps.${stepIndex}.hazards`)}</p>}
      {hz.fields.map((f, j) => {
        const p = `steps.${stepIndex}.hazards.${j}` as const;
        return (
          <div key={f.id} className="rounded-md border border-orange-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Select aria-label={t('form.hazardLibrary')} className="h-8 max-w-xs text-xs" value="" onChange={(e) => {
                const h = l.hazards.find((x) => x.id === e.target.value);
                if (h) { setValue(`${p}.hazard`, localName(h), { shouldDirty: true }); setValue(`${p}.hazardMasterId`, h.id, { shouldDirty: true }); }
              }}>
                <option value="">{t('form.hazardLibrary')}…</option>
                {l.hazards.map((h) => <option key={h.id} value={h.id}>[{h.category}] {localName(h)}</option>)}
              </Select>
              <Button type="button" size="sm" variant="ghost" onClick={() => hz.remove(j)}><XCircle className="h-4 w-4 text-red-600" />{t('form.removeHazard')}</Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={t('form.hazard')} required error={errFor(`${p}.hazard`)}><Textarea rows={2} {...register(`${p}.hazard`)} aria-invalid={!!errFor(`${p}.hazard`)} /></Field>
              <Field label={t('form.consequence')} required error={errFor(`${p}.consequence`)}><Textarea rows={2} {...register(`${p}.consequence`)} aria-invalid={!!errFor(`${p}.consequence`)} /></Field>
              <Field label={t('form.existingControls')} error={errFor(`${p}.controls`)}>
                <Textarea rows={3} {...register(`${p}.existingControls`)} aria-invalid={!!errFor(`${p}.controls`)} />
                <ControlPicker l={l} onPick={(txt) => appendControl(j, 'existingControls', txt)} />
              </Field>
              <Field label={t('form.additionalControls')}>
                <Textarea rows={3} {...register(`${p}.additionalControls`)} />
                <ControlPicker l={l} onPick={(txt) => appendControl(j, 'additionalControls', txt)} />
              </Field>
              <Field label={t('form.controlOwner')} error={errFor(`${p}.controlOwner`)}><Input {...register(`${p}.controlOwner`)} aria-invalid={!!errFor(`${p}.controlOwner`)} /></Field>
            </div>
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" onClick={() => hz.append(emptyHazard())}><Plus className="h-4 w-4" />{t('form.addHazard')}</Button>
    </div>
  );
}

function ControlPicker({ l, onPick }: { l: Lookups; onPick: (t: string) => void }) {
  const { t } = useTranslation();
  return (
    <Select aria-label={t('form.controlLibrary')} className="mt-1 h-8 text-xs" value="" onChange={(e) => { const c = l.controls.find((x) => x.id === e.target.value); if (c) onPick(localName(c)); }}>
      <option value="">+ {t('form.controlLibrary')}…</option>
      {l.controls.map((c) => <option key={c.id} value={c.id}>[{c.hierarchy}] {localName(c)}</option>)}
    </Select>
  );
}

function RiskSection({ control, l, errFor, values }: { control: Control<FormValues>; l: Lookups; errFor: ErrFor; values: FormValues }) {
  const { t, i18n } = useTranslation();
  const m = l.matrix;
  const th = i18n.language === 'th';
  const highlights = values.steps.flatMap((s) => s.hazards.flatMap((h) => [h.initialSeverity && h.initialLikelihood ? { s: Number(h.initialSeverity), l: Number(h.initialLikelihood) } : null, h.residualSeverity && h.residualLikelihood ? { s: Number(h.residualSeverity), l: Number(h.residualLikelihood) } : null])).filter(Boolean) as { s: number; l: number }[];
  const pick = (name: `steps.${number}.hazards.${number}.${'initialSeverity' | 'initialLikelihood' | 'residualSeverity' | 'residualLikelihood'}`, labels: typeof m.severityLabels, label: string, invalid: boolean) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Field label={label}>
        <Select name={field.name} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} aria-invalid={invalid}>
          <option value="">—</option>{labels.map((x) => <option key={x.value} value={x.value}>{x.value} – {th ? x.th : x.en}</option>)}
        </Select>
      </Field>
    )} />
  );
  return (
    <div className="space-y-4">
      {!m.isValidated && <Alert tone="warning">{t('form.matrixProvisional')}</Alert>}
      <Card>
        <CardHeader title={t('form.sections.risk')} subtitle={t('form.scoresServer', { version: m.versionNo })} />
        <CardBody className="space-y-4">
          {values.steps.map((s, i) => s.hazards.map((h, j) => {
            const p = `steps.${i}.hazards.${j}`;
            const ini = assessPreview(m, h.initialSeverity, h.initialLikelihood);
            const res = assessPreview(m, h.residualSeverity, h.residualLikelihood);
            const above = ini && res && res.score > ini.score;
            const notAcceptable = res && m.rule && res.score > m.rule.maxAcceptableResidualScore;
            return (
              <div key={`${i}-${j}`} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 text-sm"><b>{t('form.step', { n: i + 1 })}</b>: {s.activity || '—'} — <span className="text-orange-800">{h.hazard || '—'}</span></div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded border border-slate-100 bg-slate-50 p-2">
                    <div className="mb-1 flex items-center justify-between text-sm font-semibold">{t('form.initialRisk')}{ini ? <RiskBadge code={ini.levelCode} score={ini.score} levels={m.levels} /> : <span className="text-xs text-slate-400">{t('form.notAssessed')}</span>}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {pick(`steps.${i}.hazards.${j}.initialSeverity`, m.severityLabels, t('form.severity'), !!errFor(`${p}.initial`))}
                      {pick(`steps.${i}.hazards.${j}.initialLikelihood`, m.likelihoodLabels, t('form.likelihood'), !!errFor(`${p}.initial`))}
                    </div>
                    {errFor(`${p}.initial`) && <p className="mt-1 text-xs text-red-700">{errFor(`${p}.initial`)}</p>}
                  </div>
                  <div className="rounded border border-slate-100 bg-slate-50 p-2">
                    <div className="mb-1 flex items-center justify-between text-sm font-semibold">{t('form.residualRisk')}{res ? <RiskBadge code={res.levelCode} score={res.score} levels={m.levels} /> : <span className="text-xs text-slate-400">{t('form.notAssessed')}</span>}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {pick(`steps.${i}.hazards.${j}.residualSeverity`, m.severityLabels, t('form.severity'), !!errFor(`${p}.residual`))}
                      {pick(`steps.${i}.hazards.${j}.residualLikelihood`, m.likelihoodLabels, t('form.likelihood'), !!errFor(`${p}.residual`))}
                    </div>
                    {errFor(`${p}.residual`) && <p className="mt-1 text-xs text-red-700">{errFor(`${p}.residual`)}</p>}
                    {above && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700"><AlertTriangle className="h-3.5 w-3.5" />{t('form.residualAboveInitial')}</p>}
                    {notAcceptable && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700"><AlertTriangle className="h-3.5 w-3.5" />{t('form.residualNotAcceptable', { max: m.rule!.maxAcceptableResidualScore })}</p>}
                  </div>
                </div>
              </div>
            );
          }))}
        </CardBody>
      </Card>
      <Card><CardHeader title={t('form.riskMatrixTitle')} subtitle={m.name} /><CardBody><RiskMatrixGrid matrix={m} highlight={highlights} />
        <div className="mt-3 flex flex-wrap gap-2">{m.levels.map((lv) => <span key={lv.code} className="flex items-center gap-1 text-xs"><RiskBadge code={lv.code} levels={m.levels} />{lv.minScore}–{lv.maxScore}{lv.requiresEscalation && ` · ${t('form.escalation')}`}</span>)}</div>
      </CardBody></Card>
    </div>
  );
}

function DocumentsSection({ jsaId, attachments, l, onChanged }: { jsaId?: string; attachments: Attachment[]; l: Lookups; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const errMsg = useErrorMessage();
  const [category, setCategory] = useState('PHOTO');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!jsaId) return <Card><CardBody><Alert tone="info">{t('form.uploadAfterSave')}</Alert></CardBody></Card>;
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      const fd = new FormData(); fd.append('category', category); fd.append('file', f);
      try { await api.upload(`/jsas/${jsaId}/attachments`, fd); } catch (e) { toast('danger', `${f.name}: ${errMsg(e)}`); }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    onChanged();
  };
  return (
    <Card>
      <CardHeader title={t('form.sections.documents')} subtitle={t('form.uploadHelp', { types: l.settings.allowedExtensions.join(', '), mb: l.settings.attachmentMaxMb })} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('admin.category')}><Select value={category} onChange={(e) => setCategory(e.target.value)}>{l.attachmentCategories.map((c) => <option key={c} value={c}>{t(`attachmentCategory.${c}`)}</option>)}</Select></Field>
          <input ref={fileRef} type="file" multiple className="hidden" accept={l.settings.allowedExtensions.map((e) => `.${e}`).join(',')} onChange={(e) => upload(e.target.files)} />
          <Button type="button" loading={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />{t('common.upload')}</Button>
        </div>
        {attachments.length === 0 ? <p className="text-sm text-slate-500">{t('common.none')}</p> : (
          <ul className="divide-y rounded-md border">
            {attachments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <FileText className="h-5 w-5 text-slate-500" />
                <a className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline" href={apiUrl(`/attachments/${a.id}/download?inline=1`)} target="_blank" rel="noopener noreferrer">{a.originalName}</a>
                <Badge>{t(`attachmentCategory.${a.category}`)}</Badge><span className="text-slate-500">{fmtBytes(a.sizeBytes)}</span>
                <Button type="button" size="icon" variant="ghost" aria-label={t('common.delete')} onClick={async () => {
                  if (!(await confirm({ title: t('common.delete'), message: a.originalName, tone: 'danger' }))) return;
                  try { await api.del(`/attachments/${a.id}`); onChanged(); } catch (e) { toast('danger', errMsg(e)); }
                }}><Trash2 className="h-4 w-4 text-red-600" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function DeclarationSection({ register, l, checks, errText, onGo }: { register: UseFormRegister<FormValues>; l: Lookups; checks: FieldError[]; errText: (f: FieldError) => string; onGo: (s: Section) => void }) {
  const { t, i18n } = useTranslation();
  const bySection = SECTIONS.map((s) => ({ s, items: checks.filter((c) => sectionOf(c.path) === s) })).filter((x) => x.items.length);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('form.checkBeforeSubmit')} />
        <CardBody>
          {checks.length === 0 ? <Alert tone="success">{t('form.allGood')}</Alert> : (
            <div className="space-y-2">
              <Alert tone="warning" title={t('form.validationSummary', { count: checks.length })} />
              {bySection.map(({ s, items }) => (
                <div key={s} className="rounded border border-slate-200 p-2">
                  <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => onGo(s)}>{t(`form.sections.${s}`)} ({items.length})</button>
                  <ul className="ml-4 list-disc text-xs text-slate-700">{items.slice(0, 8).map((c, i) => <li key={i}><code className="text-slate-500">{c.path}</code> — {errText(c)}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('form.declarationTitle')} subtitle={l.settings.declarationVersion} />
        <CardBody className="space-y-3">
          <blockquote className="rounded-md border-l-4 border-brand-700 bg-brand-50 p-3 text-sm leading-relaxed">{i18n.language === 'th' ? l.settings.declarationTextTh : l.settings.declarationTextEn}</blockquote>
          <Checkbox {...register('declarationAccepted')} label={<b>{t('form.declarationAccept')}</b>} />
          <p className="flex items-center gap-1 text-xs text-slate-500"><CheckCircle2 className="h-3.5 w-3.5" />{t('detail.approvalNotPermit')}</p>
        </CardBody>
      </Card>
    </div>
  );
}
