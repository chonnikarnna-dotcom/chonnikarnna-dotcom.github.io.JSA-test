import i18n from '@/i18n';

let tz = 'Asia/Bangkok';
export const setTimezone = (t: string) => { tz = t; };
export const getTimezone = () => tz;
const locale = () => (i18n.language === 'th' ? 'th-TH' : 'en-GB');

export function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));
}
export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return '—';
  return new Intl.DateTimeFormat(locale(), { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(v));
}
export function fmtRelative(v: string | Date | null | undefined) {
  if (!v) return '—';
  const diff = new Date(v).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
export function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return i18n.t('common.hours', { count: h });
  return i18n.t('common.days', { count: Math.floor(h / 24) });
}
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Convert ISO UTC → value for <input type="datetime-local"> in the configured timezone. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}
/** Convert datetime-local value (interpreted in configured timezone) → ISO UTC. */
export function fromLocalInput(v: string) {
  if (!v) return null;
  const [d, t] = v.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  // offset of tz at that instant
  const asTz = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz }));
  const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - (asTz.getTime() - asUtc.getTime())).toISOString();
}

export const localName = (o: { nameEn?: string | null; nameTh?: string | null } | null | undefined) =>
  !o ? '—' : (i18n.language === 'th' ? o.nameTh : o.nameEn) ?? o.nameEn ?? '—';
