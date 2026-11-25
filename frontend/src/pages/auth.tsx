import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { LanguageSwitcher } from '@/components/Layout';
import { useErrorMessage } from '@/hooks/useErrorMessage';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 px-4 py-10">
      <div className="mb-6 flex items-center gap-3 text-white">
        <ShieldCheck className="h-10 w-10" aria-hidden />
        <div><div className="text-xl font-bold">{t('app.name')}</div><div className="text-sm text-brand-100">{t('app.fullName')}</div></div>
      </div>
      <Card className="w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between gap-2"><h1 className="text-lg font-semibold">{title}</h1><LanguageSwitcher /></div>
        {children}
      </Card>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { me, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const errMsg = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ identifier: z.string().min(1, t('validation.required')), password: z.string().min(1, t('validation.required')) });
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  if (me) return <Navigate to={from} replace />;
  return (
    <AuthShell title={t('auth.loginTitle')}>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        setError(null);
        try { await login(v.identifier, v.password); nav(from, { replace: true }); } catch (e) { setError(errMsg(e)); }
      })} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('auth.identifier')} htmlFor="identifier" error={formState.errors.identifier?.message}>
          <Input id="identifier" autoComplete="username" autoFocus {...register('identifier')} aria-invalid={!!formState.errors.identifier} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!formState.errors.password} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>{t('auth.login')}</Button>
        <div className="text-center text-sm"><Link className="text-brand-700 hover:underline" to="/forgot-password">{t('auth.forgot')}</Link></div>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const errMsg = useErrorMessage();
  const [done, setDone] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ identifier: string }>();
  return (
    <AuthShell title={t('auth.forgotTitle')}>
      <p className="mb-4 text-sm text-slate-600">{t('auth.forgotHelp')}</p>
      {done ? (
        <div className="space-y-3">
          <Alert tone="success">{t('auth.resetSent')}</Alert>
          {devToken && <Alert tone="info" title="DEV"><Link className="break-all underline" to={`/reset-password?token=${devToken}`}>reset link</Link></Alert>}
          <Link to="/login" className="text-sm text-brand-700 hover:underline">{t('auth.backToLogin')}</Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
          try { const r = await api.post<{ devToken?: string }>('/auth/forgot-password', v); setDevToken(r.devToken ?? null); setDone(true); } catch (e) { setError(errMsg(e)); }
        })}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t('auth.identifier')} htmlFor="fid"><Input id="fid" {...register('identifier', { required: true })} /></Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>{t('auth.sendReset')}</Button>
          <div className="text-center text-sm"><Link to="/login" className="text-brand-700 hover:underline">{t('auth.backToLogin')}</Link></div>
        </form>
      )}
    </AuthShell>
  );
}

function PasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (pw: string) => Promise<void> }) {
  const { t } = useTranslation();
  const schema = z.object({
    newPassword: z.string().min(10, t('auth.passwordPolicy')).regex(/[A-Za-z]/, t('auth.passwordPolicy')).regex(/\d/, t('auth.passwordPolicy')),
    confirm: z.string(),
  }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: t('auth.passwordMismatch') });
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <form className="space-y-4" onSubmit={handleSubmit((v) => onSubmit(v.newPassword))} noValidate>
      <Field label={t('auth.newPassword')} htmlFor="np" hint={t('auth.passwordPolicy')} error={formState.errors.newPassword?.message}>
        <Input id="np" type="password" autoComplete="new-password" {...register('newPassword')} aria-invalid={!!formState.errors.newPassword} />
      </Field>
      <Field label={t('auth.confirmPassword')} htmlFor="cp" error={formState.errors.confirm?.message}>
        <Input id="cp" type="password" autoComplete="new-password" {...register('confirm')} aria-invalid={!!formState.errors.confirm} />
      </Field>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>{submitLabel}</Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const errMsg = useErrorMessage();
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  return (
    <AuthShell title={t('auth.resetTitle')}>
      {state.ok ? <div className="space-y-3"><Alert tone="success">{t('auth.resetDone')}</Alert><Link to="/login" className="text-brand-700 hover:underline">{t('auth.backToLogin')}</Link></div> : (
        <>
          {state.error && <Alert tone="danger" className="mb-3">{state.error}</Alert>}
          <PasswordForm submitLabel={t('common.save')} onSubmit={async (pw) => {
            try { await api.post('/auth/reset-password', { token: params.get('token') ?? '', newPassword: pw }); setState({ ok: true }); } catch (e) { setState({ error: errMsg(e) }); }
          }} />
        </>
      )}
    </AuthShell>
  );
}

export function ActivatePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const errMsg = useErrorMessage();
  const [info, setInfo] = useState<{ email: string; displayName: string; contractorCompany: string | null } | null>(null);
  const [state, setState] = useState<{ ok?: boolean; error?: string }>({});
  useEffect(() => { api.get<typeof info>(`/auth/invitations/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setState({ error: errMsg(e) })); }, [token]);
  return (
    <AuthShell title={t('auth.activateTitle')}>
      {info && <p className="mb-3 text-sm text-slate-600">{t('auth.invitationFor', { email: info.email })}{info.contractorCompany && ` — ${info.contractorCompany}`}</p>}
      {state.ok ? <div className="space-y-3"><Alert tone="success">{t('auth.activated')}</Alert><Link to="/login" className="text-brand-700 hover:underline">{t('auth.backToLogin')}</Link></div> : (
        <>
          {state.error && <Alert tone="danger" className="mb-3">{state.error}</Alert>}
          {info && <><p className="mb-3 text-sm">{t('auth.activateHelp')}</p><PasswordForm submitLabel={t('auth.activate')} onSubmit={async (pw) => {
            try { await api.post('/auth/activate', { token, newPassword: pw }); setState({ ok: true }); } catch (e) { setState({ error: errMsg(e) }); }
          }} /></>}
        </>
      )}
    </AuthShell>
  );
}
