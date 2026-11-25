import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { Breadcrumbs, LanguageSwitcher, PageHeader } from '@/components/Layout';
import { useErrorMessage } from '@/hooks/useErrorMessage';

export function AccountPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const errMsg = useErrorMessage();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const { register, handleSubmit, reset, formState } = useForm<{ currentPassword: string; newPassword: string }>();
  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs items={[{ label: t('nav.profile') }]} />
      <PageHeader title={t('nav.profile')} />
      <Card className="mb-4"><CardBody className="space-y-2 text-sm">
        <div className="text-lg font-semibold">{me?.displayName}</div>
        <div className="text-slate-600">{me?.email} · {me?.username}</div>
        <div className="flex flex-wrap gap-1">{me?.roles.map((r) => <Badge key={r} tone="blue">{t(`roles.${r}`)}</Badge>)}<Badge>{t(`userType.${me?.userType}`)}</Badge></div>
        <div className="flex items-center gap-2 pt-2"><span>{t('common.language')}:</span><LanguageSwitcher /></div>
      </CardBody></Card>
      <Card>
        <CardHeader title={t('auth.changePassword')} />
        <CardBody>
          <form className="space-y-3" onSubmit={handleSubmit(async (v) => {
            try { await api.post('/auth/change-password', v); setMsg({ tone: 'success', text: t('auth.passwordChanged') }); reset(); } catch (e) { setMsg({ tone: 'danger', text: errMsg(e) }); }
          })}>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Field label={t('auth.currentPassword')} htmlFor="cur"><Input id="cur" type="password" autoComplete="current-password" {...register('currentPassword', { required: true })} /></Field>
            <Field label={t('auth.newPassword')} htmlFor="new" hint={t('auth.passwordPolicy')}><Input id="new" type="password" autoComplete="new-password" {...register('newPassword', { required: true })} /></Field>
            <Button type="submit" loading={formState.isSubmitting}>{t('common.save')}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
