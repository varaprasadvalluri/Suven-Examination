import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, collection, query, where, limit, onSnapshot, orderBy } from '../lib/firebase';
import { Attempt, ProctoringLog } from '../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  ShieldAlert, 
  Eye, 
  Users, 
  Monitor, 
  Terminal, 
  AlertTriangle,
  Radio,
  Maximize2,
  Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import { toast } from 'sonner';

export const LiveProctoringWall: React.FC = () => {
  const { profile } = useAuth();
    const [activeAttempts, setActiveAttempts] = useState<Attempt[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    const logsQuery = query(collection(db, 'proctoring_logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubLogs();
  }, [profile]);


  useEffect(() => {
    if (!profile) return;

    let q;
    if (profile.role === 'school') {
      q = query(
        collection(db, 'attempts'),
        where('schoolId', '==', profile.schoolId || ''),
        where('status', '==', 'in-progress'),
        limit(12)
      );
    } else {
      q = query(
        collection(db, 'attempts'),
        where('status', '==', 'in-progress'),
        limit(12)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const attempts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attempt));
      setActiveAttempts(attempts);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'attempts');
    });

    return () => unsubscribe();
  }, [profile]);

  const getRiskColor = (violations: number = 0) => {
    if (violations === 0) return 'text-emerald-500 bg-emerald-50 border-emerald-100';
    if (violations === 1) return 'text-amber-500 bg-amber-50 border-amber-100';
    return 'text-rose-600 bg-rose-50 border-rose-100';
  };

  const getRiskPulse = (violations: number = 0) => {
    if (violations === 0) return 'bg-emerald-500';
    if (violations === 1) return 'bg-amber-500 animate-pulse';
    return 'bg-rose-600 animate-ping';
  };

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
        <div>
           <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-100 font-black text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider">Live Monitoring</Badge>
              <div className="h-2 w-2 rounded-full bg-rose-600 animate-pulse" />
           </div>
          <h2 className="text-4xl font-display font-black text-slate-900 tracking-tight flex items-center gap-3">
            Security Wall <ShieldAlert className="text-rose-600" size={32} />
          </h2>
          <p className="text-slate-500 font-medium mt-1">Real-time heuristic integrity monitoring & anomaly detection.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="border-slate-200 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
             <Bell size={14} /> Alerts Log
          </Button>
          <Button className="bg-slate-900 text-white h-12 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
             <Terminal size={14} /> System Console
          </Button>
        </div>
      </header>

      {/* Proctoring Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
         {activeAttempts.map((attempt) => (
            <motion.div
               key={attempt.id}
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               whileHover={{ y: -5 }}
            >
               <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[32px] overflow-hidden bg-white border border-slate-100 group">
                  <div className="aspect-video bg-slate-100 relative overflow-hidden flex items-center justify-center">
                     {/* Simulated Video Feed */}
                     <div className="absolute inset-0 bg-gradient-to-br from-slate-900/40 to-transparent z-10" />
                     <img 
                        src={`https://images.unsplash.com/photo-1544717297-fa154daaf762?w=400&auto=format&fit=crop&q=60`} 
                        className="w-full h-full object-cover filter grayscale contrast-125 opacity-80"
                        alt="proctor-feed"
                     />
                     <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
                        <Badge className={`${getRiskColor(attempt.violationsCount)} font-black text-[9px] uppercase border px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm`}>
                           <div className={`h-1.5 w-1.5 rounded-full ${getRiskPulse(attempt.violationsCount)}`} />
                           {attempt.violationsCount && attempt.violationsCount > 0 ? 'Anomaly Detected' : 'Secure'}
                        </Badge>
                     </div>
                     <div className="absolute bottom-4 right-4 z-20">
                        <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white cursor-pointer hover:bg-white/40 transition-colors">
                           <Maximize2 size={14} />
                        </div>
                     </div>
                  </div>
                  <CardContent className="p-6">
                     <div className="flex items-center justify-between mb-4">
                        <div>
                           <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{attempt.studentName}</p>
                           <p className="text-[10px] font-bold text-slate-400 mt-0.5">{attempt.examTitle || 'Entrance Prep'}</p>
                        </div>
                        <div className="text-right">
                           <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{Math.round((attempt.score / 100) * 100)}% Match</p>
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-500 font-black uppercase tracking-widest">
                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center gap-2">
                           <Eye size={10} className="text-slate-400" /> Focus: 98%
                        </div>
                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center gap-2">
                           <Monitor size={10} className="text-slate-400" /> Tab: {attempt.violationsCount || 0}
                        </div>
                     </div>
                     <div className="mt-6 flex gap-2">
                        <Button variant="outline" className="flex-grow border-slate-100 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-colors">
                           Flag Student
                        </Button>
                        <Button className="flex-grow bg-indigo-600 text-white shadow-lg shadow-indigo-100 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest">
                           Watch Live
                        </Button>
                     </div>
                  </CardContent>
               </Card>
            </motion.div>
         ))}

         {activeAttempts.length === 0 && !loading && (
            <div className="col-span-full h-80 bg-slate-50 rounded-[40px] border border-dashed border-slate-200 flex flex-col items-center justify-center text-center p-10">
               <div className="h-16 w-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-slate-300 mb-4">
                  <Radio size={32} />
               </div>
               <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">No Active Sessions</h3>
               <p className="text-slate-400 font-medium max-w-sm mt-2">There are currently no students engaged in live assessments requiring proctoring oversight.</p>
            </div>
         )}
      </div>

      {/* Global Alerts Feed */}
      <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-slate-900 text-white">
         <CardHeader className="p-10 border-b border-white/5 flex flex-row items-center justify-between">
            <div>
               <CardTitle className="text-xl font-black uppercase tracking-tighter">Heuristic Anomaly Log</CardTitle>
               <CardDescription className="text-slate-500 font-semibold">Real-time system events categorized by severity levels.</CardDescription>
            </div>
            <Badge className="bg-indigo-600 text-white font-black text-[10px] uppercase">Processing Live</Badge>
         </CardHeader>
         <CardContent className="p-0 max-h-[300px] overflow-y-auto custom-scrollbar">
                        <div className="divide-y divide-white/5">
                {logs.length === 0 ? (
                  <div className="p-10 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">No anomalies detected yet.</div>
                ) : logs.map((log, i) => {
                  const isCritical = log.type === 'copy_paste' || log.type === 'tab_switch';
                  const isWarning = log.type === 'blur' || log.type === 'fullscreen_exit';
                  return (
                  <div key={log.id || i} className="px-10 py-6 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-default">
                     <div className="flex items-center gap-6">
                        <span className="font-mono text-xs text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <div className={`h-2 w-2 rounded-full ${isCritical ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' : isWarning ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]' : 'bg-indigo-400'}`} />
                        <div>
                           <p className="text-sm font-bold tracking-tight">{log.description || log.type}</p>
                           <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">Student: {log.studentId} • Attempt: {log.attemptId}</p>
                        </div>
                     </div>
                  </div>
                )})}
            </div>
         </CardContent>
      </Card>
    </div>
  );
};
