import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';

/** Map API errors to translated, user-friendly messages using the stable error code. */
export function useErrorMessage() {
  const { t, i18n } = useTranslation();
  return (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.code === 'NETWORK') return t('errors.network');
      if (e.code === 'APPROVAL_PREREQUISITES_FAILED') {
        const probs = ((e.details as { problems?: { code: string; params?: Record<string, unknown> }[] })?.problems ?? []);
        return [t('errors.APPROVAL_PREREQUISITES_FAILED'), ...probs.map((p) => (i18n.exists(`prereq.${p.code}`) ? t(`prereq.${p.code}`, p.params as Record<string, string>) : p.code))].join(' • ');
      }
      const key = `errors.${e.code}`;
      return i18n.exists(key) ? t(key) : e.message || t('errors.generic');
    }
    return t('errors.generic');
  };
}
