import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JsaDetail } from '@/lib/types';
import { useLookups } from '@/hooks/useLookups';
import { fmtDateTime } from '@/lib/format';
import { Button, Spinner } from '@/components/ui';
import { GeneralInfoView, PermitsView, StepsView } from '@/components/jsa/ContentView';
import { StatusBadge } from '@/components/jsa/badges';

/** Print-friendly layout (browser print). The official approved document is the server-generated PDF. */
export function PrintPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const version = params.get('version');
  const q = useQuery({ queryKey: ['jsa', id, version, 'print'], queryFn: () => api.get<JsaDetail>(`/jsas/${id}${version ? `?version=${version}` : ''}`) });
  const lookups = useLookups();
  useEffect(() => { if (q.data && lookups.data) setTimeout(() => window.print(), 600); }, [q.data, lookups.data]);
  if (!q.data || !lookups.data) return <Spinner />;
  const d = q.data; const j = d.jsa;
  const validNow = j.status === 'APPROVED' && d.version.isApprovedVersion;
  return (
    <div className="mx-auto max-w-[1100px] bg-white p-6 text-[13px]">
      <div className="no-print mb-4 flex justify-end gap-2"><Button onClick={() => window.print()}>{t('common.print')}</Button></div>
      <header className="mb-4 flex items-start justify-between border-b-2 border-brand-800 pb-2">
        <div><h1 className="text-xl font-bold text-brand-800">{t('app.fullName')}</h1><div className="text-slate-600">{t('app.company')}</div></div>
        <div className="text-right text-sm">
          <div><b>{t('fields.referenceNo')}:</b> {j.referenceNo} · <b>{t('fields.version')}:</b> {d.version.versionNo}</div>
          <div className="flex items-center justify-end gap-1"><b>{t('common.status')}:</b> <StatusBadge status={j.status} /></div>
          <div><b>{t('fields.approvedAt')}:</b> {fmtDateTime(j.approvedAt)}</div>
          <div><b>{t('detail.validity')}:</b> {j.validFrom ? `${fmtDateTime(j.validFrom)} – ${fmtDateTime(j.validUntil)}` : '—'}</div>
        </div>
      </header>
      {!validNow && <div className="mb-3 rounded border-2 border-red-600 p-2 text-center font-bold text-red-700">{t('detail.notValid')} — {t(`status.${j.status}`)} (v{d.version.versionNo})</div>}
      <section className="mb-4"><h2 className="mb-2 bg-brand-800 px-2 py-1 font-semibold text-white">{t('form.sections.general')}</h2>
        <GeneralInfoView c={d.content} lookups={lookups.data} requesterName={d.version.requesterName} requesterType={d.version.requesterType} contractorName={j.contractorCompany?.name} /></section>
      <section className="mb-4 break-inside-avoid"><h2 className="mb-2 bg-brand-800 px-2 py-1 font-semibold text-white">{t('form.sections.permits')}</h2><PermitsView c={d.content} permitTypes={lookups.data.permitTypes} attachments={d.attachments} /></section>
      <section className="mb-4"><h2 className="mb-2 bg-brand-800 px-2 py-1 font-semibold text-white">{t('form.sections.steps')}</h2><StepsView c={d.content} matrix={d.matrix} /></section>
      {d.declaration && <section className="mb-4 break-inside-avoid"><h2 className="mb-2 bg-brand-800 px-2 py-1 font-semibold text-white">{t('detail.declaration')}</h2><p className="italic">“{d.declaration.textSnapshot}”</p><p className="text-xs">{t('detail.declaredBy', { name: d.version.requesterName, date: fmtDateTime(d.declaration.acceptedAt), version: d.declaration.declarationVersion })}</p></section>}
      <section className="mb-4 break-inside-avoid"><h2 className="mb-2 bg-brand-800 px-2 py-1 font-semibold text-white">{t('detail.timeline')}</h2>
        <table className="w-full border-collapse text-xs"><tbody>{d.approvalHistory.map((h) => (
          <tr key={h.id}><td className="border p-1">{fmtDateTime(h.createdAt)}</td><td className="border p-1">v{h.versionNo}</td><td className="border p-1">{h.stage ? t(`stage.${h.stage}`) : t('stage.REQUESTER')}</td><td className="border p-1">{t(`decision.${h.decision}`)}</td><td className="border p-1">{h.actorName}</td><td className="border p-1">{h.comment}</td></tr>
        ))}</tbody></table>
      </section>
      <p className="border-t pt-2 text-xs font-semibold text-red-700">{t('detail.approvalNotPermit')}</p>
      <p className="text-[10px] text-slate-500">{fmtDateTime(new Date())} · SHA-256 {d.version.contentHash?.slice(0, 16)}</p>
    </div>
  );
}
