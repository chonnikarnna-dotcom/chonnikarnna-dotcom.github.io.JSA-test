import { useTranslation } from 'react-i18next';
import { Check, X, RotateCcw } from 'lucide-react';
import type { JsaStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Requester → Area Owner → Safety Officer → Approved, with the current stage highlighted (text + icon, not colour only). */
export function WorkflowStepper({ status, submitted }: { status: JsaStatus; submitted: boolean }) {
  const { t } = useTranslation();
  const steps = [
    { key: 'REQUESTER', label: t('stage.REQUESTER') },
    { key: 'AREA_OWNER', label: t('stage.AREA_OWNER') },
    { key: 'SAFETY_OFFICER', label: t('stage.SAFETY_OFFICER') },
    { key: 'APPROVED', label: t('status.APPROVED') },
  ];
  const idx = (() => {
    switch (status) {
      case 'DRAFT': return submitted ? 0 : 0;
      case 'RETURNED': return 0;
      case 'SUBMITTED': case 'PENDING_AREA_OWNER': return 1;
      case 'PENDING_SAFETY_OFFICER': return 2;
      case 'APPROVED': case 'COMPLETED': case 'EXPIRED': return 4;
      default: return -1;
    }
  })();
  const terminalBad = status === 'REJECTED' || status === 'CANCELLED';
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto text-xs sm:text-sm" aria-label={t('detail.timeline')}>
      {steps.map((s, i) => {
        const done = idx > i;
        const current = idx === i;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
              done && 'border-emerald-600 bg-emerald-600 text-white', current && !terminalBad && 'border-brand-700 bg-brand-50 text-brand-800 ring-4 ring-brand-100',
              !done && !current && 'border-slate-300 bg-white text-slate-400')}
              aria-current={current ? 'step' : undefined}>
              {done ? <Check className="h-4 w-4" aria-hidden /> : current && status === 'RETURNED' ? <RotateCcw className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span className={cn('truncate', current ? 'font-semibold text-brand-800' : done ? 'text-slate-700' : 'text-slate-400')}>
              {s.label}{current && <span className="sr-only"> (current)</span>}
            </span>
            {i < steps.length - 1 && <span className={cn('mx-1 h-0.5 min-w-[12px] flex-1', done ? 'bg-emerald-600' : 'bg-slate-200')} aria-hidden />}
          </li>
        );
      })}
      {terminalBad && <li className="ml-2 flex items-center gap-1 font-semibold text-red-700"><X className="h-4 w-4" aria-hidden />{t(`status.${status}`)}</li>}
    </ol>
  );
}
