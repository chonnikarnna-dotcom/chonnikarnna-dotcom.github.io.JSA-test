import { useTranslation } from 'react-i18next';
import { AlertOctagon, CheckCircle2, Clock, FileEdit, RotateCcw, ShieldAlert, XCircle, Ban, Hourglass, Flag, Send } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { JsaStatus, Level } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<JsaStatus, { tone: Parameters<typeof Badge>[0]['tone']; Icon: typeof Clock }> = {
  DRAFT: { tone: 'gray', Icon: FileEdit }, SUBMITTED: { tone: 'blue', Icon: Send }, PENDING_AREA_OWNER: { tone: 'blue', Icon: Clock },
  PENDING_SAFETY_OFFICER: { tone: 'purple', Icon: ShieldAlert }, RETURNED: { tone: 'amber', Icon: RotateCcw }, REJECTED: { tone: 'red', Icon: XCircle },
  APPROVED: { tone: 'green', Icon: CheckCircle2 }, CANCELLED: { tone: 'slate', Icon: Ban }, EXPIRED: { tone: 'orange', Icon: Hourglass }, COMPLETED: { tone: 'slate', Icon: Flag },
};

export function StatusBadge({ status, className }: { status: JsaStatus; className?: string }) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT;
  return <Badge tone={s.tone} className={className} icon={<s.Icon className="h-3.5 w-3.5" aria-hidden />}>{t(`status.${status}`)}</Badge>;
}

/** Risk level: colour + text label + (optional) score — never colour alone. */
export function RiskBadge({ code, score, levels, className }: { code: string | null | undefined; score?: number | null; levels?: Level[]; className?: string }) {
  const { i18n } = useTranslation();
  if (!code) return <span className="text-slate-400">—</span>;
  const l = levels?.find((x) => x.code === code);
  const name = l ? (i18n.language === 'th' ? l.nameTh : l.nameEn) : code;
  const color = l?.color ?? '#64748b';
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', className)}
      style={{ borderColor: color, color: '#0f172a', backgroundColor: `${color}1f` }}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {l?.requiresEscalation && <AlertOctagon className="h-3.5 w-3.5" style={{ color }} aria-hidden />}
      {name}{score != null && <span className="font-normal text-slate-600">({score})</span>}
    </span>
  );
}
