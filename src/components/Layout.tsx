import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { LogOut, Menu, X, Bell, Search, Globe, ChevronRight } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

// 3D Playful Icons with dimensional gradients and drop shadows for kids
const CuteDashboardIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 group-hover:rotate-6 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="dbGrad1" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FFE28A" />
        <stop offset="100%" stopColor="#FFC107" />
      </linearGradient>
      <linearGradient id="dbGrad2" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#B5F2D2" />
        <stop offset="100%" stopColor="#2EC4B6" />
      </linearGradient>
    </defs>
    {/* Base plate shadow representation */}
    <rect x="2" y="2" width="9" height="9" rx="2.5" fill="url(#dbGrad1)" stroke="#111222" strokeWidth="2" />
    <rect x="2" y="5" width="9" height="6" rx="1.5" fill="#FFF1C2" opacity="0.4" />
    <rect x="13" y="2" width="9" height="9" rx="2.5" fill="url(#dbGrad2)" stroke="#111222" strokeWidth="2" />
    <rect x="2" y="13" width="20" height="9" rx="2.5" fill="none" stroke="#111222" strokeWidth="2" />
    <circle cx="7" cy="18" r="1.5" fill="#FF5A6A" />
    <circle cx="12" cy="18" r="1.5" fill="#FFE28A" />
    <circle cx="17" cy="18" r="1.5" fill="#BAE6FD" />
  </svg>
);

const CuteExamsIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 group-hover:-translate-y-0.5 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="calcGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#B5F2D2" />
        <stop offset="100%" stopColor="#67DF8D" />
      </linearGradient>
    </defs>
    <rect x="3" y="2" width="18" height="20" rx="4" fill="url(#calcGrad)" stroke="#111222" strokeWidth="2" />
    <rect x="6" y="5" width="12" height="4" rx="1.5" fill="#111222" />
    <circle cx="9" cy="14" r="1.5" fill="#FFFFFF" />
    <circle cx="15" cy="14" r="1.5" fill="#FFFFFF" />
    <circle cx="9" cy="18" r="1.5" fill="#FFFFFF" />
    <rect x="13.5" y="17" width="3" height="2" rx="1" fill="#FF5A6A" />
  </svg>
);

const CuteAnalyticsIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 group-hover:rotate-12 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="anaGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#BAE6FD" />
        <stop offset="100%" stopColor="#38BDF8" />
      </linearGradient>
    </defs>
    <path d="M 3 20 L 9 11 L 15 15 L 21 5" stroke="#111222" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="11" r="3" fill="url(#anaGrad)" stroke="#111222" strokeWidth="2" />
    <circle cx="15" cy="15" r="3" fill="#FFE28A" stroke="#111222" strokeWidth="2" />
    <circle cx="21" cy="5" r="3.5" fill="#FFB2B8" stroke="#111222" strokeWidth="2" />
  </svg>
);

const CuteRoadmapIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 group-hover:-rotate-6 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="roadGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#E1CCFF" />
        <stop offset="100%" stopColor="#9E70FF" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#roadGrad)" stroke="#111222" strokeWidth="2" />
    <path d="M 8 12 Q 12 8 16 12 T 20 16" stroke="#FFFFFF" strokeWidth="2" strokeDasharray="3,3" />
    <circle cx="8" cy="12" r="2.5" fill="#FFE28A" stroke="#111222" strokeWidth="1.5" />
    <circle cx="16" cy="12" r="2.5" fill="#FFB2B8" stroke="#111222" strokeWidth="1.5" />
    <path d="M 12 6 V 18" stroke="#111222" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CuteErrorBookIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 group-hover:rotate-6 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="errorGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FFB2B8" />
        <stop offset="100%" stopColor="#FF3366" />
      </linearGradient>
    </defs>
    <rect x="4" y="3" width="16" height="18" rx="4" fill="url(#errorGrad)" stroke="#111222" strokeWidth="2" />
    <path d="M 10 9 L 14 13 M 14 9 L 10 13" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="12" cy="18" r="1" fill="#FFFFFF" />
  </svg>
);

const CuteSchoolIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="schGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#BAE6FD" />
        <stop offset="100%" stopColor="#0EA5E9" />
      </linearGradient>
    </defs>
    <path d="M 12 3 L 2 9 L 12 15 L 22 9 Z" fill="#FFE28A" stroke="#111222" strokeWidth="2" />
    <rect x="5" y="11" width="14" height="10" rx="2" fill="url(#schGrad)" stroke="#111222" strokeWidth="2" />
    <circle cx="12" cy="15" r="2" fill="#FFFFFF" stroke="#111222" strokeWidth="1.5" />
  </svg>
);

const CuteProctorsIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <path d="M 12 2 L 21 5 V 12 C 21 17.5 17 21.5 12 23 C 7 21.5 3 17.5 3 12 V 5 Z" fill="#FFF9DC" stroke="#111222" strokeWidth="2" />
    <circle cx="12" cy="11" r="3" fill="#FF5A6A" stroke="#111222" strokeWidth="2" />
    <path d="M 8 18 C 8 16 10 15 12 15 C 14 15 16 16 16 18" stroke="#111222" strokeWidth="2" />
  </svg>
);

const CuteTrophyIcon = () => (
  <svg className="h-6 w-6 shrink-0 transition-all duration-300 group-hover:scale-12 drop-shadow-[2px_3px_0px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none">
    <path d="M 6 4 H 18 V 11 C 18 14.5 15 17.5 11 17.5 C 7 17.5 4 14.5 4 11 Z" fill="#FFE28A" stroke="#111222" strokeWidth="2" />
    <path d="M 11 18 V 22 M 7 22 H 15" stroke="#111222" strokeWidth="2" strokeLinecap="round" />
    <circle cx="11" cy="9" r="2" fill="#FF5A6A" />
  </svg>
);

const CUTE_ICONS_MAPPING: Record<string, () => React.JSX.Element> = {
  'Intelligence Base': CuteDashboardIcon,
  'Intelligence Base (Admin)': CuteDashboardIcon,
  'Intelligence Base (School)': CuteDashboardIcon,
  'Intelligence-Based Assessments': CuteDashboardIcon,
  'Onboarding Student': CuteSchoolIcon,
  'Student Onboarding': CuteSchoolIcon,
  'Assigned Exams': CuteExamsIcon,
  'e-Exam Portal': CuteExamsIcon,
  'Ranker View': CuteAnalyticsIcon,
  'Roadmap Tracker': CuteRoadmapIcon,
  'Error Book': CuteErrorBookIcon,
  'Exams Manager': CuteExamsIcon,
  'School Registry': CuteSchoolIcon,
  'Security proctors': CuteProctorsIcon,
  'Syllabus Tracker': CuteExamsIcon,
  'Merit Scoreboard': CuteTrophyIcon,
  'System Analytics': CuteAnalyticsIcon,
  'Scale & Performance Hub': CuteAnalyticsIcon,
  'Interactive API Docs': CuteAnalyticsIcon,
};

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, profile, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C0D15]">
        {/* Generous luxurious background galaxy style */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/20 via-slate-950 to-black pointer-events-none" />
        <div className="flex flex-col items-center gap-5 relative z-10 p-8">
           <div className="relative h-20 w-20">
              <div className="absolute inset-0 rounded-full border-[5px] border-slate-800" />
              <div className="absolute inset-0 rounded-full border-[5px] border-t-yellow-400 border-r-pink-500 border-l-cyan-400 animate-spin" />
           </div>
           <p className="text-xs font-display font-black uppercase tracking-[0.25em] text-cyan-400 text-center">Spawning Premium Scholar Cosmos...</p>
           <p className="text-[10px] font-medium text-slate-500 max-w-[240px] text-center leading-relaxed">Configuring secure proctors & adaptive syllabus engine.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <main>{children}</main>;
  }

  const toggleSchoolContext = async () => {
    if (!profile) return;
    const isGlobal = !profile.schoolId;
    const nextSchoolId = isGlobal ? 'school-core-node-1' : null;
    try {
      const userRef = doc(db, 'users', profile.uid);
      await updateDoc(userRef, { schoolId: nextSchoolId });
      toast.success(isGlobal ? "Switched to Specific School Context" : "Switched to Global System Context");
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err) {
      console.error(err);
      toast.error("Failed to toggle school context.");
    }
  };

  // Sidebar Menu Config
  const menuItems = [
    { label: 'Intelligence Base', path: '/', roles: ['admin'] },
    { label: 'Intelligence Base', path: '/?tab=intelligence', roles: ['school'] },
    { label: 'Student Onboarding', path: '/?tab=onboarding', roles: ['school'] },
    { label: 'Assigned Exams', path: '/?tab=exams', roles: ['school'] },
    { label: 'School Registry', path: '/admin/schools', roles: ['admin'] },
    { label: 'Exams Manager', path: '/admin/exams', roles: ['admin'] },
    { label: 'Security proctors', path: '/admin/proctoring', roles: ['admin'] },
    { label: 'Syllabus Tracker', path: '/admin/syllabus', roles: ['admin'] },
    { label: 'Merit Scoreboard', path: '/admin/merit', roles: ['admin', 'school'] },
    { label: 'System Analytics', path: '/admin/analytics', roles: ['admin'] },
    { label: 'Scale & Performance Hub', path: '/admin/performance', roles: ['admin'] },
    { label: 'Interactive API Docs', path: '/admin/api-docs', roles: ['admin'] },
  ];

  // Filters items properly based on active user role to prevent clutter and overlapping UI
  const userRole = profile?.role || 'school';
  const filteredMenuItems = menuItems.filter(item => item.roles.includes(userRole));

  // Checks URL string matches as accurate markers for selected highlights
  const isLinkActive = (itemPath: string) => {
    const activeTab = new URLSearchParams(location.search).get('tab') || 'intelligence';
    
    if (itemPath === '/') {
      return location.pathname === '/' && activeTab === 'intelligence';
    }
    if (itemPath.includes('?')) {
      const [path, search] = itemPath.split('?');
      const paramValue = search.split('=')[1];
      return location.pathname === path && activeTab === paramValue;
    }
    return location.pathname === itemPath;
  };

  const isStudent = profile?.role === 'student';
  const isExamPage = location.pathname.startsWith('/exam/') || location.pathname.startsWith('/result/');

  if (isExamPage) {
    return (
      <div className="flex flex-col min-h-screen bg-[#F0F4FA] bg-[linear-gradient(to_right,#E1E8F2_1.5px,transparent_1.5px),linear-gradient(to_bottom,#E1E8F2_1.5px,transparent_1.5px)] bg-[size:3.5rem_3.5rem] font-sans text-slate-800 antialiased selection:bg-amber-200 selection:text-slate-900 overflow-y-auto">
        <main className="flex-1 w-full p-4 md:p-6 lg:p-10">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[1440px] mx-auto w-full"
          >
            {children}
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F0F4FA] bg-[linear-gradient(to_right,#E1E8F2_1.5px,transparent_1.5px),linear-gradient(to_bottom,#E1E8F2_1.5px,transparent_1.5px)] bg-[size:3.5rem_3.5rem] font-sans text-slate-800 antialiased selection:bg-amber-200 selection:text-slate-900">
      
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-45 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* FIXED PREMIUM VERTICAL SIDEBAR NAVIGATION RAIL (Left or Right Column: 280px, flex-shrink: 0) */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? 280 : 0, 
          x: isSidebarOpen ? 0 : (isStudent ? 280 : -280) 
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={`fixed inset-y-0 lg:relative w-[280px] bg-white text-slate-800 flex flex-col shrink-0 z-50 transition-all duration-300 ${
          isSidebarOpen 
            ? "p-5 shadow-[-4px_8px_30px_rgba(163,191,220,0.15)] bg-white" 
            : "p-0 overflow-hidden border-none! shadow-none!"
        } ${
          isStudent 
            ? `right-0 rounded-l-[32px] rounded-r-none lg:order-last ${isSidebarOpen ? "border-l-[4px] border-b-[8px] border-slate-300/80" : ""}` 
            : `left-0 rounded-r-[32px] rounded-l-none ${isSidebarOpen ? "border-r-[4px] border-b-[8px] border-slate-300/80" : ""}`
        }`}
      >
        {/* Sidebar Brand Header with 3D button indicator */}
        <div className="h-20 flex items-center px-2 border-b-[3px] border-dashed border-slate-200">
          <div className="w-12 h-12 bg-amber-400 border-2 border-b-[5px] border-slate-800 rounded-2xl flex items-center justify-center shadow-md text-slate-900 mr-3.5 shrink-0 transition-transform hover:rotate-12 duration-305 cursor-pointer">
             <span className="text-2xl filter drop-shadow">✨</span>
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-2xl font-black tracking-tight text-indigo-950 font-display uppercase select-none leading-none">SUVENEDU</span>
            <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest leading-none mt-1.5 font-sans">ACADEMY OF STARS</span>
          </div>
        </div>
        
        {/* Navigation Elements with generous vertical padding & large touch-friendly triggers */}
        <nav className="flex-1 px-1 py-6 space-y-4 overflow-y-auto">
          <div className="px-3 mb-3 select-none">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-450">
              {isStudent ? '🪐 Learning Base' : '🧙‍♂️ Teacher Base'}
            </p>
          </div>

          {filteredMenuItems.map((item) => {
            const active = isLinkActive(item.path);
            
            // Map each option to vibrant pastel playground gradients with clay/3D borders
            const themeColors: Record<string, { gradient: string; activeBorder: string; activeText: string; accentBg: string }> = {
              'Intelligence Base': { gradient: 'from-amber-100 to-amber-50', activeBorder: 'border-amber-400', activeText: 'text-amber-850', accentBg: 'bg-amber-400' },
              'Intelligence-Based Assessments': { gradient: 'from-amber-100 to-amber-50', activeBorder: 'border-amber-400', activeText: 'text-amber-850', accentBg: 'bg-indigo-400' },
              'Onboarding Student': { gradient: 'from-purple-100 to-purple-50', activeBorder: 'border-purple-400', activeText: 'text-purple-850', accentBg: 'bg-purple-400' },
              'Student Onboarding': { gradient: 'from-purple-100 to-purple-50', activeBorder: 'border-purple-400', activeText: 'text-purple-850', accentBg: 'bg-purple-400' },
              'Assigned Exams': { gradient: 'from-emerald-100 to-emerald-50', activeBorder: 'border-emerald-400', activeText: 'text-emerald-850', accentBg: 'bg-emerald-400' },
              'e-Exam Portal': { gradient: 'from-emerald-100 to-emerald-50', activeBorder: 'border-emerald-400', activeText: 'text-emerald-850', accentBg: 'bg-emerald-400' },
              'Ranker View': { gradient: 'from-sky-100 to-sky-50', activeBorder: 'border-sky-400', activeText: 'text-sky-850', accentBg: 'bg-sky-400' },
              'Roadmap Tracker': { gradient: 'from-purple-100 to-purple-50', activeBorder: 'border-purple-400', activeText: 'text-purple-855', accentBg: 'bg-purple-400' },
              'Error Book': { gradient: 'from-pink-100 to-pink-50', activeBorder: 'border-pink-400', activeText: 'text-pink-850', accentBg: 'bg-pink-400' },
              'Exams Manager': { gradient: 'from-emerald-100 to-emerald-50', activeBorder: 'border-emerald-400', activeText: 'text-emerald-850', accentBg: 'bg-emerald-400' },
              'School Registry': { gradient: 'from-sky-100 to-sky-50', activeBorder: 'border-sky-400', activeText: 'text-sky-850', accentBg: 'bg-sky-400' },
              'Security proctors': { gradient: 'from-amber-100 to-amber-50', activeBorder: 'border-amber-400', activeText: 'text-amber-850', accentBg: 'bg-amber-400' },
              'Syllabus Tracker': { gradient: 'from-emerald-100 to-emerald-50', activeBorder: 'border-emerald-400', activeText: 'text-emerald-850', accentBg: 'bg-emerald-400' },
              'Merit Scoreboard': { gradient: 'from-amber-100 to-amber-50', activeBorder: 'border-amber-400', activeText: 'text-amber-850', accentBg: 'bg-amber-400' },
              'System Analytics': { gradient: 'from-pink-100 to-pink-50', activeBorder: 'border-pink-400', activeText: 'text-pink-850', accentBg: 'bg-pink-400' },
              'Scale & Performance Hub': { gradient: 'from-purple-100 to-purple-50', activeBorder: 'border-purple-400', activeText: 'text-purple-850', accentBg: 'bg-purple-400' },
              'Interactive API Docs': { gradient: 'from-indigo-100 to-indigo-50', activeBorder: 'border-indigo-400', activeText: 'text-indigo-850', accentBg: 'bg-indigo-400' }
            };

            const colors = themeColors[item.label] || { gradient: 'from-sky-100 to-sky-50', activeBorder: 'border-sky-400', activeText: 'text-sky-800', accentBg: 'bg-sky-400' };
            const CuteIcon = CUTE_ICONS_MAPPING[item.label] || CuteDashboardIcon;

            return (
              <Link 
                key={item.path}
                to={item.path} 
                className={`flex items-center space-x-3.5 px-4.5 py-3.5 rounded-2xl transition-all duration-300 group relative border-2 ${
                  active 
                    ? `bg-gradient-to-br ${colors.gradient} ${colors.activeBorder} border-b-[5px] ${colors.activeText} font-black shadow-md scale-[1.02]` 
                    : 'bg-white border-slate-100 hover:border-slate-300 text-slate-600 hover:text-slate-900 duration-200'
                }`}
              >
                <div className="shrink-0 scale-95 origin-left transition-transform group-hover:scale-105">
                  <CuteIcon />
                </div>
                <span className={`text-[14px] tracking-wide truncate ${active ? 'font-black font-display text-indigo-950' : 'font-semibold'}`}>
                  {item.label}
                </span>
                
                {active && (
                  <ChevronRight className="ml-auto h-5 w-5 stroke-[3px] text-indigo-950" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer Details Info Panel */}
        <div className="p-1 mt-auto border-t-2 border-slate-100 bg-slate-50/50 rounded-2xl">
            <div className="p-4 rounded-xl bg-white border border-slate-200 border-b-[4px] border-slate-300 mb-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Security Shield</p>
                <span className="text-sm">🛡️</span>
              </div>
              <div className="flex items-center gap-2">
                 <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                 <span className="text-[10px] font-mono font-bold text-slate-600 uppercase tracking-wider">SECURE LINK</span>
              </div>
            </div>

            <Button 
              variant="ghost" 
              className="w-full justify-start text-rose-600 hover:text-white hover:bg-rose-500 border-2 border-transparent hover:border-rose-600 hover:border-b-[4px] rounded-2xl h-11 py-2.5 group transition-all" 
              onClick={() => {
                signOut();
                navigate('/login');
              }}
            >
              <LogOut className="h-5 w-5 mr-2.5 text-rose-500 transition-transform group-hover:translate-x-1" />
              <span className="font-extrabold text-[12px] uppercase tracking-wider font-display">Log Out</span>
            </Button>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className={`flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 transition-all ${
        isStudent ? "lg:order-first" : ""
      }`}>
        
        {/* Pure White Playful Header with custom drop-shadow and claymorphism traits */}
        <header className="h-20 bg-white border-b-[4px] border-slate-200 px-6 md:px-8 lg:px-10 flex items-center justify-between shrink-0 z-30">
          <div className="flex items-center space-x-4">
            {!isStudent && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="lg:hidden h-11 w-11 text-slate-700 hover:text-slate-900 bg-slate-50 border-2 border-b-[4px] border-slate-350 rounded-xl"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            )}
            
            <div className="hidden md:flex items-center bg-slate-50 rounded-2xl border-2 border-b-[4px] border-slate-200 px-4 py-2 w-96 transition-all focus-within:border-indigo-400 class-3d group">
              <Search className="h-5 w-5 text-slate-400 group-focus-within:text-indigo-500 shrink-0" />
              <input 
                type="text" 
                placeholder="Search subject track, milestones..." 
                className="bg-transparent border-none focus:outline-none text-xs w-full px-3 text-slate-800 placeholder:text-slate-400 font-bold"
              />
              <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-white px-2 font-mono text-[9px] font-bold text-slate-400 shadow-sm border-slate-200">
                /
              </kbd>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Global/Specific School Scope Switcher Button - always visible and clickable */}
            <Button
              onClick={toggleSchoolContext}
              variant="outline"
              className="h-11 px-4 bg-white hover:bg-slate-50 text-slate-700 border-2 border-b-[4px] border-slate-200 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase tracking-wider shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Globe className={`h-4 w-4 ${profile?.schoolId ? 'text-indigo-500 animate-pulse' : 'text-emerald-500'}`} />
              Scope: <span className="text-indigo-650">{profile?.schoolId ? "Specific School" : "Global System"}</span>
            </Button>

            {/* Active notifications indicator - customized for children's star themes */}
            <Button variant="ghost" size="icon" className="h-11 w-11 text-amber-500 hover:text-amber-600 bg-amber-50 hover:bg-amber-100 border-2 border-b-[4px] border-amber-200/80 rounded-xl relative transition-transform hover:scale-105">
              <Bell className="h-5 w-5" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-rose-500 animate-ping" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-rose-500" />
            </Button>

            {isStudent && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="lg:hidden h-11 w-11 text-slate-700 hover:text-slate-900 bg-slate-50 border-2 border-b-[4px] border-slate-350 rounded-xl"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            )}

            <div className="h-8 w-[2px] bg-slate-200 hidden sm:block" />

            <div className="flex items-center space-x-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-indigo-950 leading-none tracking-wide font-display">{profile?.name || "Awesome Explorer"}</p>
                <div className="flex items-center justify-end mt-1">
                  <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                     {profile?.role || "Student"} LEVEL 2
                  </span>
                </div>
              </div>
              <Avatar className="h-11 w-11 border-2 border-slate-200 shadow rounded-xl bg-slate-50 p-0.5">
                <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.email}`} />
                <AvatarFallback className="bg-indigo-600 text-white font-black text-xs font-display">{profile?.name?.charAt(0) || "S"}</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Page Content viewport wrapper - with gorgeous minimum padding to keep components balanced */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-10 bg-transparent">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[1440px] mx-auto w-full"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
};
