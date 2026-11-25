import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Link2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useLookups } from '@/hooks/useLookups';
import { fmtDateTime, localName } from '@/lib/format';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, Field, Input, Select, Spinner, Table, Td, Textarea, Th, useConfirm, useToast } from '@/components/ui';
import { Breadcrumbs, PageHeader } from '@/components/Layout';
import { cn } from '@/lib/utils';
import { RiskMatrixAdmin } from './RiskMatrixAdmin';
import { AuditAdmin, NotificationTemplatesAdmin, SettingsAdmin, ValidityAdmin, WorkflowAdmin } from './SettingsAdmin';

const TABS = ['users', 'contractors', 'departments', 'sites', 'areas', 'areaOwners', 'safetyOfficers', 'jobTypes', 'hazards', 'controls', 'permitTypes', 'riskMatrix', 'validity', 'notifications', 'settings', 'workflow', 'audit'] as const;

export function AdminPage() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const tabs = hasRole('ADMIN') ? TABS : (['audit'] as const);
  return (
    <div className="mx-auto max-w-7xl">
      <Breadcrumbs items={[{ label: t('nav.admin') }]} />
      <PageHeader title={hasRole('ADMIN') ? t('admin.title') : t('nav.audit')} />
      <div className="flex flex-col gap-4 lg:flex-row">
        {tabs.length > 1 && (
          <nav className="flex gap-1 overflow-x-auto lg:w-60 lg:shrink-0 lg:flex-col" aria-label={t('admin.title')}>
            {tabs.map((k) => (
              <NavLink key={k} to={`/admin/${k}`} className={({ isActive }) => cn('whitespace-nowrap rounded-md px-3 py-2 text-sm', isActive ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100')}>{t(`admin.tabs.${k}`)}</NavLink>
            ))}
          </nav>
        )}
        <div className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to={hasRole('ADMIN') ? 'users' : 'audit'} replace />} />
            <Route path="audit" element={<AuditAdmin />} />
            {hasRole('ADMIN') && <>
              <Route path="users" element={<UsersAdmin />} />
              <Route path="contractors" element={<MasterData kind="contractors" />} />
              <Route path="departments" element={<MasterData kind="departments" />} />
              <Route path="sites" element={<MasterData kind="sites" />} />
              <Route path="areas" element={<MasterData kind="areas" />} />
              <Route path="jobTypes" element={<MasterData kind="jobTypes" />} />
              <Route path="hazards" element={<MasterData kind="hazards" />} />
              <Route path="controls" element={<MasterData kind="controls" />} />
              <Route path="permitTypes" element={<MasterData kind="permitTypes" />} />
              <Route path="areaOwners" element={<AssignmentsAdmin kind="area" />} />
              <Route path="safetyOfficers" element={<AssignmentsAdmin kind="site" />} />
              <Route path="riskMatrix" element={<RiskMatrixAdmin />} />
              <Route path="validity" element={<ValidityAdmin />} />
              <Route path="notifications" element={<NotificationTemplatesAdmin />} />
              <Route path="settings" element={<SettingsAdmin />} />
              <Route path="workflow" element={<WorkflowAdmin />} />
            </>}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Generic master data ─────────────────────────
type FieldDef = { key: string; label: string; type?: 'text' | 'textarea' | 'checkbox' | 'number' | 'select' | 'csv' | 'questions'; options?: { value: string; label: string }[]; required?: boolean };
type Kind = 'contractors' | 'departments' | 'sites' | 'areas' | 'jobTypes' | 'hazards' | 'controls' | 'permitTypes';
type Row = Record<string, unknown> & { id: string };

function useKindConfig(kind: Kind) {
  const { t } = useTranslation();
  const sites = useQuery({ queryKey: ['admin', 'sites'], queryFn: () => api.get<{ items: Row[] }>('/admin/sites'), enabled: kind === 'areas' });
  const base: FieldDef[] = [{ key: 'code', label: t('admin.code'), required: true }, { key: 'nameEn', label: t('admin.nameEn'), required: true }, { key: 'nameTh', label: t('admin.nameTh'), required: true }];
  const active: FieldDef = { key: 'isActive', label: t('common.active'), type: 'checkbox' };
  const cfg: Record<Kind, { path: string; fields: FieldDef[]; cols: string[] }> = {
    departments: { path: '/admin/departments', fields: [...base, active], cols: ['code', 'nameEn', 'nameTh'] },
    sites: { path: '/admin/sites', fields: [...base, active], cols: ['code', 'nameEn', 'nameTh'] },
    contractors: { path: '/admin/contractor-companies', fields: [{ key: 'code', label: t('admin.code'), required: true }, { key: 'name', label: t('admin.name'), required: true }, { key: 'taxId', label: t('admin.taxId') }, { key: 'contactName', label: t('admin.contactName') }, { key: 'contactPhone', label: t('admin.contactPhone') }, { key: 'contactEmail', label: t('admin.contactEmail') }, active], cols: ['code', 'name', 'contactName', 'contactPhone'] },
    areas: { path: '/admin/areas', fields: [{ key: 'siteId', label: t('admin.site'), type: 'select', required: true, options: (sites.data?.items ?? []).map((s) => ({ value: s.id, label: localName(s as never) })) }, ...base, { key: 'building', label: t('admin.building') }, active], cols: ['code', 'nameEn', 'nameTh', 'building'] },
    jobTypes: { path: '/admin/job-types', fields: [...base, { key: 'defaultPermitCodes', label: t('admin.defaultPermits'), type: 'csv' }, active], cols: ['code', 'nameEn', 'nameTh', 'defaultPermitCodes'] },
    hazards: { path: '/admin/hazards', fields: [{ key: 'code', label: t('admin.code'), required: true }, { key: 'category', label: t('admin.category'), required: true }, { key: 'nameEn', label: t('admin.nameEn'), required: true }, { key: 'nameTh', label: t('admin.nameTh'), required: true }, active], cols: ['code', 'category', 'nameEn', 'nameTh'] },
    controls: { path: '/admin/controls', fields: [{ key: 'code', label: t('admin.code'), required: true }, { key: 'hierarchy', label: t('admin.hierarchy'), type: 'select', required: true, options: ['ELIMINATION', 'SUBSTITUTION', 'ENGINEERING', 'ADMINISTRATIVE', 'PPE'].map((v) => ({ value: v, label: v })) }, { key: 'nameEn', label: t('admin.nameEn'), required: true }, { key: 'nameTh', label: t('admin.nameTh'), required: true }, active], cols: ['code', 'hierarchy', 'nameEn', 'nameTh'] },
    permitTypes: { path: '/admin/permit-types', fields: [...base, { key: 'sortOrder', label: t('admin.sortOrder'), type: 'number' }, { key: 'isHighRisk', label: t('admin.isHighRisk'), type: 'checkbox' }, { key: 'requiresPermitReference', label: t('admin.requiresPermitReference'), type: 'checkbox' }, { key: 'requiresAttachment', label: t('admin.requiresAttachment'), type: 'checkbox' }, { key: 'requiresSafetyVerification', label: t('admin.requiresSafetyVerification'), type: 'checkbox' }, { key: 'guidanceEn', label: t('admin.guidanceEn'), type: 'textarea' }, { key: 'guidanceTh', label: t('admin.guidanceTh'), type: 'textarea' }, { key: 'followUpQuestions', label: t('admin.followUps'), type: 'questions' }, active], cols: ['code', 'nameEn', 'nameTh', 'requiresPermitReference', 'requiresAttachment', 'requiresSafetyVerification'] },
  };
  return cfg[kind];
}

function MasterData({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = useKindConfig(kind);
  const q = useQuery({ queryKey: ['admin', kind], queryFn: () => api.get<{ items: Row[] }>(cfg.path) });
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  return (
    <Card>
      <CardHeader title={t(`admin.tabs.${kind}`)} action={<Button size="sm" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{t('common.add')}</Button>} />
      {q.isLoading ? <Spinner /> : (
        <Table>
          <thead><tr>{cfg.cols.map((c) => <Th key={c}>{cfg.fields.find((f) => f.key === c)?.label ?? c}</Th>)}<Th>{t('common.status')}</Th><Th /></tr></thead>
          <tbody>{q.data?.items.map((r) => (
            <tr key={r.id} className={cn(!r.isActive && 'text-slate-400')}>
              {cfg.cols.map((c) => <Td key={c}>{typeof r[c] === 'boolean' ? (r[c] ? '✓' : '—') : Array.isArray(r[c]) ? (r[c] as string[]).join(', ') : String(r[c] ?? '')}</Td>)}
              <Td>{r.isActive ? <Badge tone="green">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</Td>
              <Td><Button size="icon" variant="ghost" onClick={() => setEdit(r)} aria-label={t('common.edit')}><Pencil className="h-4 w-4" /></Button></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <EditDialog fields={cfg.fields} row={edit === 'new' ? null : edit} path={cfg.path} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', kind] }); qc.invalidateQueries({ queryKey: ['lookups'] }); setEdit(null); }} />}
    </Card>
  );
}

function EditDialog({ fields, row, path, onClose, onSaved }: { fields: FieldDef[]; row: Row | null; path: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const init: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, row?.[f.key] ?? (f.type === 'checkbox' ? f.key === 'isActive' : f.type === 'csv' || f.type === 'questions' ? [] : f.type === 'number' ? 0 : '')]));
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, f.type === 'number' ? Number(v[f.key]) : f.type === 'text' || !f.type ? (v[f.key] === '' && !f.required ? null : v[f.key]) : v[f.key]]));
      if (row) await api.put(`${path}/${row.id}`, body); else await api.post(path, body);
      toast('success', t('admin.savedOk')); onSaved();
    } catch (e) { toast('danger', errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={row ? t('common.edit') : t('common.add')} size="lg" footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{t('common.save')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const val = v[f.key];
          const set = (x: unknown) => setV((p) => ({ ...p, [f.key]: x }));
          if (f.type === 'checkbox') return <Checkbox key={f.key} checked={!!val} onChange={(e) => set(e.target.checked)} label={f.label} />;
          if (f.type === 'select') return <Field key={f.key} label={f.label} required={f.required}><Select value={String(val ?? '')} onChange={(e) => set(e.target.value)}><option value="">—</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>;
          if (f.type === 'textarea') return <Field key={f.key} label={f.label} className="sm:col-span-2"><Textarea value={String(val ?? '')} onChange={(e) => set(e.target.value)} /></Field>;
          if (f.type === 'csv') return <Field key={f.key} label={f.label} className="sm:col-span-2"><Input value={(val as string[]).join(', ')} onChange={(e) => set(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>;
          if (f.type === 'questions') return <QuestionsEditor key={f.key} label={f.label} value={val as Q[]} onChange={set} />;
          return <Field key={f.key} label={f.label} required={f.required}><Input type={f.type === 'number' ? 'number' : 'text'} value={String(val ?? '')} onChange={(e) => set(e.target.value)} /></Field>;
        })}
      </div>
    </Dialog>
  );
}

type Q = { key: string; en: string; th: string; type: 'boolean' | 'text'; required: boolean };
function QuestionsEditor({ label, value, onChange }: { label: string; value: Q[]; onChange: (q: Q[]) => void }) {
  const { t } = useTranslation();
  const upd = (i: number, patch: Partial<Q>) => onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex items-center justify-between"><span className="text-sm font-medium">{label}</span><Button size="sm" variant="outline" onClick={() => onChange([...value, { key: `q${value.length + 1}`, en: '', th: '', type: 'boolean', required: true }])}><Plus className="h-3.5 w-3.5" />{t('admin.addQuestion')}</Button></div>
      {value.map((q, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded border p-2 sm:grid-cols-6">
          <Input aria-label={t('admin.questionKey')} value={q.key} onChange={(e) => upd(i, { key: e.target.value })} />
          <Input aria-label="EN" className="sm:col-span-2" placeholder="EN" value={q.en} onChange={(e) => upd(i, { en: e.target.value })} />
          <Input aria-label="TH" className="sm:col-span-2" placeholder="TH" value={q.th} onChange={(e) => upd(i, { th: e.target.value })} />
          <Select aria-label={t('admin.questionType')} value={q.type} onChange={(e) => upd(i, { type: e.target.value as Q['type'] })}><option value="boolean">{t('admin.boolean')}</option><option value="text">{t('admin.text')}</option></Select>
          <Checkbox checked={q.required} onChange={(e) => upd(i, { required: e.target.checked })} label={t('common.required')} />
          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('common.delete')}</Button>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Users ─────────────────────────
type UserRow = { id: string; email: string; username: string; displayName: string; phone: string | null; userType: 'EMPLOYEE' | 'CONTRACTOR'; departmentId: string | null; contractorCompanyId: string | null; isActive: boolean; roles: string[]; lastLoginAt: string | null; invitationPending: boolean; department: { nameEn: string; nameTh: string } | null; contractorCompany: { name: string } | null; preferredLanguage: string };
const ROLES = ['REQUESTER', 'AREA_OWNER', 'SAFETY_OFFICER', 'ADMIN'];

function UsersAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const errMsg = useErrorMessage();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const q = useQuery({ queryKey: ['admin', 'users', search, role], queryFn: () => api.get<{ items: UserRow[] }>(`/admin/users?q=${encodeURIComponent(search)}${role ? `&role=${role}` : ''}`) });
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const toggle = async (u: UserRow) => {
    if (!(await confirm({ title: u.isActive ? t('admin.deactivate') : t('admin.activate'), message: u.displayName, tone: u.isActive ? 'danger' : 'primary' }))) return;
    try { await api.put(`/admin/users/${u.id}`, { isActive: !u.isActive }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); } catch (e) { toast('danger', errMsg(e)); }
  };
  return (
    <Card>
      <CardHeader title={t('admin.tabs.users')} action={<Button size="sm" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{t('admin.newUser')}</Button>} />
      <div className="flex flex-wrap gap-2 p-3"><Input className="max-w-xs" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} /><Select className="max-w-xs" value={role} onChange={(e) => setRole(e.target.value)}><option value="">{t('common.all')}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</Select></div>
      {q.isLoading ? <Spinner /> : (
        <Table>
          <thead><tr><Th>{t('admin.name')}</Th><Th>Email / username</Th><Th>{t('fields.requesterType')}</Th><Th>{t('fields.department')} / {t('fields.contractor')}</Th><Th>Roles</Th><Th>{t('common.status')}</Th><Th>{t('admin.lastLogin')}</Th><Th /></tr></thead>
          <tbody>{q.data?.items.map((u) => (
            <tr key={u.id} className={cn(!u.isActive && 'text-slate-400')}>
              <Td className="font-medium">{u.displayName}</Td><Td className="text-xs">{u.email}<br />{u.username}</Td><Td>{t(`userType.${u.userType}`)}</Td>
              <Td>{u.contractorCompany?.name ?? localName(u.department)}</Td>
              <Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="blue">{t(`roles.${r}`)}</Badge>)}</div></Td>
              <Td>{!u.isActive ? <Badge>{t('common.inactive')}</Badge> : u.invitationPending ? <Badge tone="amber">{t('admin.invitationPending')}</Badge> : <Badge tone="green">{t('common.active')}</Badge>}</Td>
              <Td className="text-xs">{fmtDateTime(u.lastLoginAt)}</Td>
              <Td className="whitespace-nowrap">
                <Button size="icon" variant="ghost" onClick={() => setEdit(u)} aria-label={t('common.edit')}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" title={t('admin.resetLink')} aria-label={t('admin.resetLink')} onClick={async () => { try { const r = await api.post<{ link: string }>(`/admin/users/${u.id}/invitation`); setLink(r.link); } catch (e) { toast('danger', errMsg(e)); } }}><Link2 className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.isActive ? t('admin.deactivate') : t('admin.activate')}</Button>
              </Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <UserDialog user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(l) => { setEdit(null); if (l) setLink(l); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); }} />}
      <Dialog open={!!link} onClose={() => setLink(null)} title={t('admin.inviteLink')} footer={<Button onClick={() => { navigator.clipboard?.writeText(link!); toast('success', t('common.copied')); }}>{t('common.copy')}</Button>}>
        <Alert tone="info" className="mb-2">{t('admin.inviteLinkHelp')}</Alert><code className="block break-all rounded bg-slate-100 p-2 text-xs">{link}</code>
      </Dialog>
    </Card>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: (link?: string) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const contractors = useQuery({ queryKey: ['admin', 'contractors'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/admin/contractor-companies') });
  const [v, setV] = useState({
    email: user?.email ?? '', username: user?.username ?? '', displayName: user?.displayName ?? '', phone: user?.phone ?? '', userType: user?.userType ?? 'EMPLOYEE',
    departmentId: user?.departmentId ?? '', contractorCompanyId: user?.contractorCompanyId ?? '', roles: user?.roles ?? ['REQUESTER'], preferredLanguage: user?.preferredLanguage ?? 'th', password: '', usePassword: false,
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { email: v.email, username: v.username, displayName: v.displayName, phone: v.phone || null, userType: v.userType, departmentId: v.departmentId || null, contractorCompanyId: v.contractorCompanyId || null, roles: v.roles, preferredLanguage: v.preferredLanguage };
      if (user) { await api.put(`/admin/users/${user.id}`, body); onSaved(); }
      else { const r = await api.post<{ activationLink?: string }>('/admin/users', { ...body, ...(v.usePassword ? { password: v.password } : {}) }); onSaved(r.activationLink); }
      toast('success', t('admin.savedOk'));
    } catch (e) { toast('danger', errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={user ? user.displayName : t('admin.newUser')} size="lg" footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{user ? t('common.save') : v.usePassword ? t('common.create') : t('admin.invite')}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('admin.name')} required><Input value={v.displayName} onChange={(e) => set({ displayName: e.target.value })} /></Field>
        <Field label="Email" required><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Username" required><Input value={v.username} onChange={(e) => set({ username: e.target.value })} /></Field>
        <Field label={t('fields.contactPhone')}><Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label={t('fields.requesterType')}><Select value={v.userType} onChange={(e) => set({ userType: e.target.value as 'EMPLOYEE' | 'CONTRACTOR', roles: e.target.value === 'CONTRACTOR' ? ['REQUESTER'] : v.roles })}><option value="EMPLOYEE">{t('userType.EMPLOYEE')}</option><option value="CONTRACTOR">{t('userType.CONTRACTOR')}</option></Select></Field>
        {v.userType === 'CONTRACTOR'
          ? <Field label={t('fields.contractor')} required><Select value={v.contractorCompanyId} onChange={(e) => set({ contractorCompanyId: e.target.value })}><option value="">—</option>{contractors.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          : <Field label={t('fields.department')}><Select value={v.departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">—</option>{lookups.data?.departments.map((d) => <option key={d.id} value={d.id}>{localName(d)}</option>)}</Select></Field>}
        <Field label="Roles" className="sm:col-span-2"><div className="flex flex-wrap gap-4">{ROLES.map((r) => <Checkbox key={r} disabled={v.userType === 'CONTRACTOR' && r !== 'REQUESTER'} checked={v.roles.includes(r)} onChange={(e) => set({ roles: e.target.checked ? [...v.roles, r] : v.roles.filter((x) => x !== r) })} label={t(`roles.${r}`)} />)}</div></Field>
        {!user && <div className="space-y-2 sm:col-span-2">
          <Checkbox checked={v.usePassword} onChange={(e) => set({ usePassword: e.target.checked })} label={t('admin.setPassword')} />
          {v.usePassword && <Field label={t('auth.password')} hint={t('auth.passwordPolicy')}><Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => set({ password: e.target.value })} /></Field>}
        </div>}
      </div>
    </Dialog>
  );
}

// ───────────────────────── Assignments ─────────────────────────
type Assign = { id: string; isBackup: boolean; isActive: boolean; createdAt: string; user: { id: string; displayName: string; email: string; isActive: boolean }; area?: { id: string; nameEn: string; nameTh: string; site: { nameEn: string; nameTh: string } }; site?: { id: string; nameEn: string; nameTh: string } | null };
function AssignmentsAdmin({ kind }: { kind: 'area' | 'site' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const lookups = useLookups();
  const path = kind === 'area' ? '/admin/area-owners' : '/admin/safety-officers';
  const role = kind === 'area' ? 'AREA_OWNER' : 'SAFETY_OFFICER';
  const q = useQuery({ queryKey: ['admin', path], queryFn: () => api.get<{ items: Assign[] }>(path) });
  const users = useQuery({ queryKey: ['admin', 'users', '', role], queryFn: () => api.get<{ items: UserRow[] }>(`/admin/users?role=${role}&active=true`) });
  const [form, setForm] = useState({ target: '', userId: '', isBackup: false });
  const add = async () => {
    try {
      await api.post(path, kind === 'area' ? { areaId: form.target, userId: form.userId, isBackup: form.isBackup } : { siteId: form.target || null, userId: form.userId, isBackup: form.isBackup });
      qc.invalidateQueries({ queryKey: ['admin', path] }); toast('success', t('admin.savedOk'));
    } catch (e) { toast('danger', errMsg(e)); }
  };
  const upd = async (id: string, body: Record<string, boolean>) => { try { await api.put(`${path}/${id}`, body); qc.invalidateQueries({ queryKey: ['admin', path] }); } catch (e) { toast('danger', errMsg(e)); } };
  return (
    <Card>
      <CardHeader title={t(kind === 'area' ? 'admin.tabs.areaOwners' : 'admin.tabs.safetyOfficers')} />
      <CardBody className="flex flex-wrap items-end gap-2 border-b">
        <Field label={kind === 'area' ? t('fields.area') : t('admin.site')}>
          <Select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
            {kind === 'area' ? <><option value="">—</option>{lookups.data?.areas.map((a) => <option key={a.id} value={a.id}>{localName(a)}</option>)}</> : <><option value="">{t('common.allSites')}</option>{lookups.data?.sites.map((s) => <option key={s.id} value={s.id}>{localName(s)}</option>)}</>}
          </Select>
        </Field>
        <Field label={t('admin.user')}><Select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">—</option>{users.data?.items.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</Select></Field>
        <Checkbox checked={form.isBackup} onChange={(e) => setForm({ ...form, isBackup: e.target.checked })} label={t('admin.isBackup')} className="mb-2" />
        <Button disabled={!form.userId || (kind === 'area' && !form.target)} onClick={add}><Plus className="h-4 w-4" />{t('common.add')}</Button>
      </CardBody>
      {q.isLoading ? <Spinner /> : (
        <Table>
          <thead><tr><Th>{kind === 'area' ? t('fields.area') : t('admin.site')}</Th><Th>{t('admin.user')}</Th><Th>{t('common.primary')} / {t('common.backup')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
          <tbody>{q.data?.items.map((a) => (
            <tr key={a.id} className={cn(!a.isActive && 'text-slate-400')}>
              <Td>{kind === 'area' ? <>{localName(a.area)}<div className="text-xs text-slate-500">{localName(a.area?.site)}</div></> : a.site ? localName(a.site) : <Badge tone="purple">{t('common.allSites')}</Badge>}</Td>
              <Td>{a.user.displayName}{!a.user.isActive && <Badge className="ml-1">{t('common.inactive')}</Badge>}</Td>
              <Td><Badge tone={a.isBackup ? 'slate' : 'blue'}>{a.isBackup ? t('common.backup') : t('common.primary')}</Badge></Td>
              <Td>{a.isActive ? <Badge tone="green">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</Td>
              <Td className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => upd(a.id, { isBackup: !a.isBackup })}>{a.isBackup ? t('common.primary') : t('common.backup')}</Button><Button size="sm" variant="ghost" onClick={() => upd(a.id, { isActive: !a.isActive })}>{a.isActive ? t('admin.deactivate') : t('admin.activate')}</Button></Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </Card>
  );
}
export { ShieldCheck };
