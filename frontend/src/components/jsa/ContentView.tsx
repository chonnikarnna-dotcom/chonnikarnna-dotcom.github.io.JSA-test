/** Read-only rendering of JSA content — shared by detail page, preview and print view. */
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, FileText } from 'lucide-react';
import type { Attachment, Content, Lookups, Matrix, PermitType } from '@/lib/types';
import { fmtDateTime, localName } from '@/lib/format';
import { RiskBadge } from './badges';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

export function KV({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">{children || '—'}</dd>
    </div>
  );
}

export function GeneralInfoView({ c, lookups, requesterName, requesterType, contractorName }: { c: Content; lookups?: Lookups; requesterName: string; requesterType: string; contractorName?: string | null }) {
  const { t } = useTranslation();
  const area = lookups?.areas.find((a) => a.id === c.areaId);
  const site = lookups?.sites.find((s) => s.id === (c.siteId ?? area?.siteId));
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      <KV label={t('fields.jobTitle')} className="sm:col-span-2 lg:col-span-3"><span className="text-base font-semibold">{c.jobTitle}</span></KV>
      <KV label={t('fields.jobDescription')} className="sm:col-span-2 lg:col-span-3">{c.jobDescription}</KV>
      <KV label={t('fields.requester')}>{requesterName}</KV>
      <KV label={t('fields.requesterType')}>{t(`userType.${requesterType}`)}</KV>
      <KV label={requesterType === 'CONTRACTOR' ? t('fields.contractor') : t('fields.department')}>
        {requesterType === 'CONTRACTOR' ? contractorName : localName(lookups?.departments.find((d) => d.id === c.departmentId))}
      </KV>
      <KV label={t('fields.contactPhone')}>{[c.contactPhone, c.contactEmail].filter(Boolean).join(' · ')}</KV>
      <KV label={t('fields.site')}>{localName(site)}</KV>
      <KV label={t('fields.area')}>{localName(area)}</KV>
      <KV label={t('fields.exactLocation')}>{c.exactLocation}</KV>
      <KV label={t('fields.jobType')}>{localName(lookups?.jobTypes.find((j) => j.id === c.jobTypeId))}</KV>
      <KV label={t('fields.workPeriod')}>{fmtDateTime(c.plannedStart)} – {fmtDateTime(c.plannedEnd)}</KV>
      <KV label={t('fields.workerCount')}>{c.workerCount}</KV>
      <KV label={t('fields.supervisorName')}>{[c.supervisorName, c.supervisorPhone].filter(Boolean).join(' · ')}</KV>
      <KV label={t('fields.emergencyContactName')}>{[c.emergencyContactName, c.emergencyContactPhone].filter(Boolean).join(' · ')}</KV>
      <KV label={t('fields.ppeRequired')} className="sm:col-span-2 lg:col-span-3">
        <div className="flex flex-wrap gap-1">{c.ppeRequired.length ? c.ppeRequired.map((p) => <Badge key={p}>{t(`ppe.${p}`, { defaultValue: p })}</Badge>) : '—'}</div>
      </KV>
      {c.additionalRequirements && <KV label={t('fields.additionalRequirements')} className="sm:col-span-2 lg:col-span-3">{c.additionalRequirements}</KV>}
    </dl>
  );
}

export function PermitsView({ c, permitTypes, attachments, onOpenAttachment }: { c: Content; permitTypes: PermitType[]; attachments: Attachment[]; onOpenAttachment?: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  if (!c.permits.length) return <p className="text-sm text-slate-500">{t('common.none')}</p>;
  return (
    <div className="space-y-3">
      {c.permits.map((p) => {
        const pt = permitTypes.find((x) => x.id === p.permitTypeId);
        const att = attachments.find((a) => a.id === p.attachmentId);
        return (
          <div key={p.permitTypeId} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{localName(pt)}{pt?.isHighRisk && <Badge tone="red" className="ml-2">HIGH-RISK</Badge>}</div>
              {p.verified
                ? <Badge tone="green" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>{t('verification.VERIFIED')}</Badge>
                : <Badge tone="amber" icon={<Clock className="h-3.5 w-3.5" />}>{t(`verification.${p.verificationStatus}`, { defaultValue: t('verification.MANUAL_REFERENCE') })}</Badge>}
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <KV label={t('form.permitRef')}>{p.referenceNo}</KV>
              <KV label={t('form.permitEvidence')}>{att ? <button className="inline-flex items-center gap-1 text-brand-700 underline" onClick={() => onOpenAttachment?.(att.id)}><FileText className="h-4 w-4" />{att.originalName}</button> : '—'}</KV>
              <KV label={t('form.permitNotes')}>{p.notes}</KV>
            </dl>
            {!!pt?.followUpQuestions.length && (
              <ul className="mt-2 space-y-1 text-sm">
                {pt.followUpQuestions.map((q) => {
                  const a = p.answers[q.key];
                  return <li key={q.key} className="flex gap-2"><span className="font-medium">{a === true ? '☑' : typeof a === 'string' && a ? '•' : '☐'}</span><span>{i18n.language === 'th' ? q.th : q.en}{typeof a === 'string' && a ? `: ${a}` : ''}</span></li>;
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StepsView({ c, matrix }: { c: Content; matrix: Matrix | null | undefined }) {
  const { t } = useTranslation();
  const levels = matrix?.levels;
  const risk = (r: Content['steps'][number]['hazards'][number]['initial']) => r ? (
    <div className="space-y-1"><div className="text-xs text-slate-500">{r.severity} × {r.likelihood} = <b className="text-slate-900">{r.score}</b></div><RiskBadge code={r.levelCode} levels={levels} /></div>
  ) : <span className="text-xs text-slate-400">{t('form.notAssessed')}</span>;
  if (!c.steps.length) return <p className="text-sm text-slate-500">{t('form.noSteps')}</p>;
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block print:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase text-slate-600">
              <th className="border p-2">#</th><th className="border p-2">{t('form.activity')}</th><th className="border p-2">{t('form.hazard')} / {t('form.consequence')}</th>
              <th className="border p-2">{t('form.initialRisk')}</th><th className="border p-2">{t('form.existingControls')} / {t('form.additionalControls')}</th>
              <th className="border p-2">{t('form.controlOwner')}</th><th className="border p-2">{t('form.residualRisk')}</th>
            </tr>
          </thead>
          <tbody>
            {c.steps.map((s) => s.hazards.length ? s.hazards.map((h, i) => (
              <tr key={`${s.stepNo}-${i}`} className="align-top">
                {i === 0 && <td className="border p-2 font-semibold" rowSpan={s.hazards.length}>{s.stepNo}</td>}
                {i === 0 && <td className="border p-2" rowSpan={s.hazards.length}>{s.activity}</td>}
                <td className="border p-2"><div className="font-medium">{h.hazard}</div><div className="text-slate-600">→ {h.consequence}</div></td>
                <td className="border p-2">{risk(h.initial)}</td>
                <td className="border p-2 whitespace-pre-wrap">{h.existingControls && <div>• {h.existingControls}</div>}{h.additionalControls && <div className="text-brand-800">+ {h.additionalControls}</div>}</td>
                <td className="border p-2">{h.controlOwner}</td>
                <td className="border p-2">{risk(h.residual)}</td>
              </tr>
            )) : (
              <tr key={s.stepNo}><td className="border p-2 font-semibold">{s.stepNo}</td><td className="border p-2" colSpan={6}>{s.activity}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden print:hidden">
        {c.steps.map((s) => (
          <div key={s.stepNo} className="rounded-md border border-slate-200">
            <div className="border-b bg-slate-50 px-3 py-2 text-sm font-semibold">{t('form.step', { n: s.stepNo })}: {s.activity}</div>
            {s.hazards.map((h, i) => (
              <div key={i} className="space-y-2 border-b px-3 py-2 text-sm last:border-0">
                <div><b>{h.hazard}</b> → {h.consequence}</div>
                <div className="grid grid-cols-2 gap-2"><div><div className="text-xs text-slate-500">{t('form.initialRisk')}</div>{risk(h.initial)}</div><div><div className="text-xs text-slate-500">{t('form.residualRisk')}</div>{risk(h.residual)}</div></div>
                {h.existingControls && <div>• {h.existingControls}</div>}{h.additionalControls && <div className="text-brand-800">+ {h.additionalControls}</div>}
                {h.controlOwner && <div className="text-xs text-slate-500">{t('form.controlOwner')}: {h.controlOwner}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** 5×5 (configurable) matrix grid showing level per cell with text labels. */
export function RiskMatrixGrid({ matrix, highlight }: { matrix: Matrix; highlight?: { s: number; l: number }[] }) {
  const { t, i18n } = useTranslation();
  const th = i18n.language === 'th';
  const score = (s: number, l: number) => (matrix.scoreMethod === 'ADD' ? s + l : s * l);
  const lvl = (sc: number) => matrix.levels.find((x) => sc >= x.minScore && sc <= x.maxScore);
  const sev = [...matrix.severityLabels].sort((a, b) => b.value - a.value);
  const lik = [...matrix.likelihoodLabels].sort((a, b) => a.value - b.value);
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <thead>
          <tr><th className="p-1 text-left">{t('form.severity')} ↓ / {t('form.likelihood')} →</th>{lik.map((l) => <th key={l.value} className="w-20 p-1 text-center font-medium">{l.value}<div className="font-normal text-slate-500">{th ? l.th : l.en}</div></th>)}</tr>
        </thead>
        <tbody>
          {sev.map((s) => (
            <tr key={s.value}>
              <th className="max-w-[180px] p-1 text-left font-medium">{s.value} <span className="font-normal text-slate-500">{th ? s.th : s.en}</span></th>
              {lik.map((l) => {
                const sc = score(s.value, l.value); const L = lvl(sc);
                const hl = highlight?.some((h) => h.s === s.value && h.l === l.value);
                return (
                  <td key={l.value} className={cn('h-12 border border-white p-1 text-center align-middle', hl && 'outline outline-2 outline-slate-900')} style={{ backgroundColor: L ? `${L.color}38` : undefined }}>
                    <div className="font-bold">{sc}</div><div className="text-[10px]">{L ? (th ? L.nameTh : L.nameEn) : '?'}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
