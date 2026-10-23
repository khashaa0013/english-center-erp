// Route-ууд ба эрхийн хамгаалалт
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';

import { Login, Home, Notifications, Profile } from './pages/core.jsx';
import { PublicLeadForm, VerifyCertificate } from './pages/public.jsx';
import { LeadsPage } from './pages/leads.jsx';
import { StudentsPage, StudentDetail } from './pages/students.jsx';
import { ParentsPage, EnrollmentsPage } from './pages/parents.jsx';
import { CatalogPage } from './pages/catalog.jsx';
import { ClassesPage, ClassDetail } from './pages/classes.jsx';
import { SessionsPage, SessionDetail } from './pages/sessions.jsx';
import { AssignmentsPage, AssignmentDetail } from './pages/assignments.jsx';
import { ExamsPage, ExamDetail, ExamBuilder } from './pages/exams.jsx';
import { InvoicesPage, InvoiceDetail, PaymentsPage, ReceivablesPage, CashPage, ExpensesPage, ImportPage, PayoutsPage, PayoutDetail } from './pages/finance.jsx';
import { TeachersPage, TeacherDetail, MyTeacherProfile, HoursPage } from './pages/teachers.jsx';
import { PortalPage, ScanPage, MyAssignments, MyExams, TakeExam, ParentRequests } from './pages/portal.jsx';
import { BranchesPage, UsersPage, AuditPage, ReportsPage, CertificatesPage, RequestsPage } from './pages/admin.jsx';

const ADMIN = ['SUPER_ADMIN', 'BRANCH_ADMIN'];
const OFFICE = [...ADMIN, 'FINANCE'];
const ADMIN_TEACHER = [...ADMIN, 'TEACHER'];

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (roles && !roles.includes(user.role)) return <div className="alert err">Энэ хуудсанд хандах эрхгүй байна.</div>;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;

  const r = (path, element, roles) => <Route key={path} path={path} element={<Guard roles={roles}>{element}</Guard>} />;

  return (
    <Routes>
      <Route path="/register" element={<PublicLeadForm />} />
      <Route path="/verify/:code?" element={<VerifyCertificate />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      {!user && <Route path="*" element={<Navigate to="/login" replace />} />}
      {user && (
        <Route element={<Layout />}>
          {r('/', <Home />)}
          {r('/notifications', <Notifications />)}
          {r('/profile', <Profile />)}

          {r('/leads', <LeadsPage />, ADMIN)}
          {r('/students', <StudentsPage />, [...OFFICE, 'TEACHER'])}
          {r('/students/:id', <StudentDetail />, [...OFFICE, 'TEACHER'])}
          {r('/parents', <ParentsPage />, ADMIN)}
          {r('/enrollments', <EnrollmentsPage />, OFFICE)}

          {r('/catalog', <CatalogPage />, ADMIN)}
          {r('/classes', <ClassesPage />, ADMIN_TEACHER)}
          {r('/classes/:id', <ClassDetail />, ADMIN_TEACHER)}
          {r('/sessions', <SessionsPage />, ADMIN_TEACHER)}
          {r('/sessions/:id', <SessionDetail />, ADMIN_TEACHER)}
          {r('/assignments', <AssignmentsPage />, ADMIN_TEACHER)}
          {r('/assignments/:id', <AssignmentDetail />)}
          {r('/exams', <ExamsPage />, ADMIN_TEACHER)}
          {r('/exams/new', <ExamBuilder />, ADMIN_TEACHER)}
          {r('/exams/:id', <ExamDetail />, ADMIN_TEACHER)}
          {r('/certificates', <CertificatesPage />, ADMIN)}

          {r('/finance/invoices', <InvoicesPage />, OFFICE)}
          {r('/finance/invoices/:id', <InvoiceDetail />, OFFICE)}
          {r('/finance/payments', <PaymentsPage />, OFFICE)}
          {r('/finance/receivables', <ReceivablesPage />, OFFICE)}
          {r('/finance/cash', <CashPage />, OFFICE)}
          {r('/finance/expenses', <ExpensesPage />, OFFICE)}
          {r('/finance/import', <ImportPage />, OFFICE)}
          {r('/finance/payouts', <PayoutsPage />, OFFICE)}
          {r('/finance/payouts/:id', <PayoutDetail />, OFFICE)}

          {r('/teachers', <TeachersPage />, OFFICE)}
          {r('/teachers/:id', <TeacherDetail />, OFFICE)}
          {r('/me/teacher', <MyTeacherProfile />, ['TEACHER'])}
          {r('/teaching-hours', <HoursPage />, [...OFFICE, 'TEACHER'])}

          {r('/portal/requests', <ParentRequests />, ['PARENT'])}
          {r('/portal/:tab?', <PortalPage />, ['STUDENT', 'PARENT'])}
          {r('/scan', <ScanPage />, ['STUDENT'])}
          {r('/my/assignments', <MyAssignments />, ['STUDENT'])}
          {r('/my/exams', <MyExams />, ['STUDENT'])}
          {r('/my/attempts/:id', <TakeExam />, ['STUDENT'])}

          {r('/requests', <RequestsPage />, ADMIN)}
          {r('/reports', <ReportsPage />, OFFICE)}
          {r('/branches', <BranchesPage />, ADMIN)}
          {r('/users', <UsersPage />, ADMIN)}
          {r('/audit', <AuditPage />, ADMIN)}
          <Route path="*" element={<div className="alert err">Хуудас олдсонгүй</div>} />
        </Route>
      )}
    </Routes>
  );
}
