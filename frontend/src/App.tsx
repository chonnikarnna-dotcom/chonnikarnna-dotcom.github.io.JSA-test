import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './lib/auth';
import { ConfirmProvider, Spinner, ToastProvider } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage, ActivatePage } from './pages/auth';
import { DashboardPage } from './pages/Dashboard';
import { JsaFormPage } from './pages/JsaForm';
import { JsaDetailPage } from './pages/JsaDetail';
import { PrintPage } from './pages/PrintView';
import { MySubmissionsPage, RegisterPage } from './pages/Lists';
import { InboxPage } from './pages/Inbox';
import { ReportsPage } from './pages/Reports';
import { NotificationsPage } from './pages/Notifications';
import { AccountPage } from './pages/Account';
import { AdminPage } from './pages/admin/Admin';
import type { Role } from './lib/types';

function RequireAuth({ roles }: { roles?: Role[] }) {
  const { me, loading, hasRole } = useAuth();
  const loc = useLocation();
  const { t } = useTranslation();
  if (loading) return <Spinner label={t('common.loading')} className="min-h-screen" />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (roles && !hasRole(...roles)) return <Navigate to="/" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/activate', element: <ActivatePage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/jsa/:id/print', element: <PrintPage /> },
      {
        element: <Layout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/jsa/:id', element: <JsaDetailPage /> },
          { path: '/my', element: <MySubmissionsPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/account', element: <AccountPage /> },
          { element: <RequireAuth roles={['REQUESTER']} />, children: [{ path: '/jsa/new', element: <JsaFormPage /> }, { path: '/jsa/:id/edit', element: <JsaFormPage /> }] },
          { element: <RequireAuth roles={['AREA_OWNER', 'SAFETY_OFFICER']} />, children: [{ path: '/inbox', element: <InboxPage /> }] },
          { element: <RequireAuth roles={['ADMIN', 'SAFETY_OFFICER']} />, children: [{ path: '/admin/*', element: <AdminPage /> }] },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

function Providers() {
  const { t } = useTranslation();
  return (
    <ToastProvider>
      <ConfirmProvider labels={{ confirm: t('common.confirm'), cancel: t('common.cancel') }}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
export const App = Providers;
