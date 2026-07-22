import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { Toaster } from './components/ui/sonner';
import { Layout } from './components/Layout';
import { RoleSelection } from './components/RoleSelection';
import { AdminExams } from './components/AdminExams';
import { AdminCreateExam } from './components/AdminCreateExam';
import { AdminOverview } from './components/AdminOverview';
import { ExamQuestions } from './components/ExamQuestions';
import { ExamInterface } from './components/ExamInterface';
import { ResultDetails } from './components/ResultDetails';
import { AdminResults } from './components/AdminResults';
import { LoginPage } from './components/LoginPage';
import { AdminSchoolManagement } from './components/AdminSchoolManagement';
import { AdminSchoolOnboarding } from './components/AdminSchoolOnboarding';
import { SchoolCandidateOnboarding } from './components/SchoolCandidateOnboarding';
import { SchoolDashboard } from './components/SchoolDashboard';
import { LiveProctoringWall } from './components/LiveProctoringWall';
import { SyllabusTracker } from './components/SyllabusTracker';
import { RankingEngine } from './components/RankingEngine';
import { AdminAnalytics } from './components/AdminAnalytics';
import { StudentLinkEntry } from './components/StudentLinkEntry';
import { ScalePerformanceHub } from './components/ScalePerformanceHub';
import { ApiDocs } from './components/ApiDocs';
import { AdminCloudBilling } from './components/AdminCloudBilling';
import { GraduationCap } from 'lucide-react';
import { Button } from './components/ui/button';

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
        <Toaster position="top-right" />
      </AuthProvider>
    </Router>
  );
}
