import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import i18n, { rememberLanguage, storedLanguage } from '@/i18n';
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from './api';
import type { Me, Role } from './types';

type AuthState = {
  me: Me | null; loading: boolean;
  login: (identifier: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasRole: (...r: Role[]) => boolean;
  setLanguage: (l: 'th' | 'en') => void;
};
const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const applySession = (r: { user: Me; csrfToken: string }) => {
    setCsrfToken(r.csrfToken);
    setMe(r.user);
    if (!storedLanguage() && r.user.preferredLanguage) { i18n.changeLanguage(r.user.preferredLanguage); rememberLanguage(r.user.preferredLanguage); }
  };

  const refresh = useCallback(async () => {
    try { applySession(await api.get<{ user: Me; csrfToken: string }>('/auth/me')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { setMe(null); setCsrfToken(null); } }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => { setMe(null); setCsrfToken(null); qc.clear(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (identifier: string, password: string) => {
    const r = await api.post<{ user: Me; csrfToken: string }>('/auth/login', { identifier, password });
    qc.clear();
    applySession(r);
    return r.user;
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } finally { setMe(null); setCsrfToken(null); qc.clear(); }
  };
  const hasRole = (...r: Role[]) => !!me && r.some((x) => me.roles.includes(x));
  const setLanguage = (l: 'th' | 'en') => {
    i18n.changeLanguage(l);
    rememberLanguage(l);
    if (me) api.patch('/auth/me/preferences', { preferredLanguage: l }).catch(() => undefined);
  };
  return <Ctx.Provider value={{ me, loading, login, logout, refresh, hasRole, setLanguage }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
