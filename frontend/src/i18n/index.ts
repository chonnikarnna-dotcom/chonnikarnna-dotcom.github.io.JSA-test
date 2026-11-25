import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import th from './th';

const LS_KEY = 'jsa.lang';
export function storedLanguage(): 'th' | 'en' | null {
  try { const v = localStorage.getItem(LS_KEY); return v === 'en' || v === 'th' ? v : null; } catch { return null; }
}
export function rememberLanguage(lang: 'th' | 'en') {
  try { localStorage.setItem(LS_KEY, lang); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, th: { translation: th } },
  lng: storedLanguage() ?? 'th',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});
if (typeof document !== "undefined") document.documentElement.lang = i18n.language;
export default i18n;
