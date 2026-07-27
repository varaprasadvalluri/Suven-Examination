import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { Toaster } from './components/ui/sonner';
import { Layout } from './components/Layout';
import { RoleSelection } from './components/RoleSelection';
import { ExamInterface } from './components/ExamInterface';
import { ResultDetails } from './components/ResultDetails';
import { LoginPage } from './components/LoginPage';
import { SchoolDashboard } from './components/SchoolDashboard';
import { StudentLinkEntry } from './components/StudentLinkEntry';
import { GraduationCap } from 'lucide-react';
import { Button } from './components/ui/button';

// Admin/school-only screens are lazy-loaded — most traffic is students taking exams, who
// never touch any of these, so keeping them out of the main bundle means the student-facing
// path (login, link entry, exam interface, result) loads faster on exam day.
const AdminExams = lazy(() => import('./components/AdminExams').then(m => ({ default: m.AdminExams })));
const AdminCreateExam = lazy(() => import('./components/AdminCreateExam').then(m => ({ default: m.AdminCreateExam })));
const AdminOverview = lazy(() => import('./components/AdminOverview').then(m => ({ default: m.AdminOverview })));
const ExamQuestions = lazy(() => import('./components/ExamQuestions').then(m => ({ default: m.ExamQuestions })));
const AdminResults = lazy(() => import('./components/AdminResults').then(m => ({ default: m.AdminResults })));
const AdminSchoolManagement = lazy(() => import('./components/AdminSchoolManagement').then(m => ({ default: m.AdminSchoolManagement })));
const AdminSchoolOnboarding = lazy(() => import('./components/AdminSchoolOnboarding').then(m => ({ default: m.AdminSchoolOnboarding })));
const SchoolCandidateOnboarding = lazy(() => import('./components/SchoolCandidateOnboarding').then(m => ({ default: m.SchoolCandidateOnboarding })));
const LiveProctoringWall = lazy(() => import('./components/LiveProctoringWall').then(m => ({ default: m.LiveProctoringWall })));
const SyllabusTracker = lazy(() => import('./components/SyllabusTracker').then(m => ({ default: m.SyllabusTracker })));
const RankingEngine = lazy(() => import('./components/RankingEngine').then(m => ({ default: m.RankingEngine })));
const StudentExamHistory = lazy(() => import('./components/StudentExamHistory').then(m => ({ default: m.StudentExamHistory })));
const AdminAnalytics = lazy(() => import('./components/AdminAnalytics').then(m => ({ default: m.AdminAnalytics })));
const ScalePerformanceHub = lazy(() => import('./components/ScalePerformanceHub').then(m => ({ default: m.ScalePerformanceHub })));
const ApiDocs = lazy(() => import('./components/ApiDocs').then(m => ({ default: m.ApiDocs })));
const AdminCloudBilling = lazy(() => import('./components/AdminCloudBilling').then(m => ({ default: m.AdminCloudBilling })));

const RouteLoadingFallback: React.FC = () => (
  <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
    <div className="relative">
      <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
    </div>
    <p className="text-slate-400 font-mono text-[10px] tracking-widest uppercase animate-pulse">Loading module...</p>
  </div>
);

const Home: React.FC = () => {
  const { user, profile, signOut } = useAuth();

  if (!user) {
    return <LoginPage />;
  }

  if (!profile?.role) {
    return <RoleSelection />;
  }

  if (profile.role === 'admin') return <AdminOverview />;
  if (profile.role === 'school') return <SchoolDashboard />;
  
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500 max-w-md mx-auto">
      <div className="bg-indigo-50 border-2 border-indigo-200 p-6 rounded-3xl mb-6">
        <GraduationCap className="h-12 w-12 text-indigo-600" />
      </div>
      <h3 className="text-2xl font-display font-black text-rose-500 uppercase tracking-tight">Access Via Link Only</h3>
      <p className="text-slate-600 mt-3 font-semibold text-sm leading-relaxed">
        SuvenEdu Academy student dashboards are strictly session-based and link-based. Launch assessments directly from your unique institution link.
      </p>
      <div className="mt-8 flex gap-4 w-full justify-center">
        <Button variant="outline" className="border-slate-300 font-bold" onClick={() => signOut()}>
          Sign Out / Change Role
        </Button>
      </div>
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; roles?: string[] }> = ({ children, roles }) => {
  const { user, profile, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
        </div>
        <p className="text-slate-400 font-mono text-[10px] tracking-widest uppercase animate-pulse">Syncing Security Node...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" />;
  
  // Relax route level checks to allow testing any page by any role
  if (roles && profile && !roles.includes(profile.role) && false) {
    return <Navigate to="/" />;
  }
  
  return <>{children}</>;
};

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout><Home /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><AdminOverview /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/proctoring" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><LiveProctoringWall /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/syllabus" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><SyllabusTracker /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/merit" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><RankingEngine /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/student/:studentId" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><StudentExamHistory /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/exams" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><AdminExams /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/exams/create" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><AdminCreateExam /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/schools" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><AdminSchoolManagement /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/schools/onboard" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><AdminSchoolOnboarding /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/school/candidate-onboard" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><SchoolCandidateOnboarding /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/analytics" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><AdminAnalytics /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/exam/:examId" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><ExamQuestions /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/performance" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><ScalePerformanceHub /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/api-docs" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><ApiDocs /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/gcp-billing" element={
            <ProtectedRoute roles={['admin']}>
              <Layout><AdminCloudBilling /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/results/:examId" element={
            <ProtectedRoute roles={['admin', 'school']}>
              <Layout><AdminResults /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/student/exam-entry" element={<StudentLinkEntry />} />
          <Route path="/portal/school/:routeSchoolId/exam/:routeExamId/:routeToken" element={<StudentLinkEntry />} />
          <Route path="/exam/:attemptId" element={
            <ProtectedRoute roles={['student']}>
              <Layout><ExamInterface /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/result/:attemptId" element={
            <ProtectedRoute>
              <Layout><ResultDetails /></Layout>
            </ProtectedRoute>
          } />
        </Routes>
        </Suspense>
        <Toaster position="top-right" />
      </AuthProvider>
    </Router>
  );
}
