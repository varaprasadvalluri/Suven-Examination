import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  Calendar, CheckCircle2, Circle, Clock, 
  Map, PlayCircle, BookOpen, BrainCircuit, 
  ChevronRight, Star, Zap 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const ROADMAP_DATA = [
  {
    day: 'Day 12',
    date: 'Wednesday, May 6',
    status: 'in-progress',
    topics: [
      { id: 1, title: 'Quantum Mechanics: Wave Particle Duality 🌌', type: 'study', completed: true, time: '45m' },
      { id: 2, title: 'Practice Test: Photoelectric Effect ⚡', type: 'practice', completed: false, time: '30m' },
      { id: 3, title: 'Deep Revision: Bohr\'s Atomic Model ⚛️', type: 'study', completed: false, time: '60m' },
    ],
    milestone: 'Physics Core Mastery 🪐'
  },
  {
    day: 'Day 13',
    date: 'Thursday, May 7',
    status: 'upcoming',
    topics: [
      { id: 4, title: 'Inorganic Chemistry: Periodicity 🧪', type: 'study', completed: false, time: '90m' },
      { id: 5, title: 'Calculus: Fundamental Theorem 📐', type: 'study', completed: false, time: '120m' },
    ],
    milestone: 'Multi-Subject Integration 🧠'
  }
];

export const MicroscheduleDashboard: React.FC = () => {
  const [activeDay, setActiveDay] = useState(0);

  return (
    <div className="space-y-11 animate-in fade-in duration-500">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <Badge className="bg-orange-50 border-2 border-orange-250 text-orange-650 px-3.5 py-1 font-black text-xs uppercase mb-3 select-none">
             Academic Roadmap
          </Badge>
          <h2 className="text-3xl md:text-4xl font-black text-indigo-950 tracking-tight uppercase leading-none font-display">
             Microschedule 🗺️
          </h2>
          <p className="text-sm font-semibold text-slate-650 mt-2.5 max-w-2xl leading-relaxed">
             Get a personalized, step-by-step roadmap tailored to make learning interactive and match the official calendar.
          </p>
        </div>
        
        <div className="flex items-center gap-4 bg-[#14172E] border border-[#242953] p-6 rounded-[24px] shadow-2xl shrink-0">
           <div className="h-12 w-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Zap className="h-6 w-6" fill="currentColor" /> {/* Locked Icon 24x24 px */}
           </div>
           <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#FF5A6A] leading-none">Target Benchmark</p>
              <p className="text-lg font-black text-white mt-1 uppercase tracking-tight">99.8th Percentile 🚀</p>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-11 items-start">
        
        {/* Day Selector Options Left Panel (4 items span) */}
        <div className="lg:col-span-4 space-y-4 w-full min-w-[280px]">
           {ROADMAP_DATA.map((day, idx) => (
             <button 
               key={idx}
               onClick={() => setActiveDay(idx)}
               className={`w-full text-left p-6.5 rounded-[24px] border transition-all duration-300 relative overflow-hidden group ${
                 activeDay === idx 
                   ? 'border-[#2E356A] bg-gradient-to-br from-[#181B38] to-[#121326] shadow-2xl scale-[1.02] z-10' 
                   : 'border-transparent bg-[#111326]/60 text-slate-300 hover:bg-[#151730] hover:border-[#1E2342]'
               }`}
             >
               {activeDay === idx && (
                 <div className="absolute top-0 right-0 p-4">
                    <div className="h-3 w-3 rounded-full bg-indigo-400 animate-ping" />
                 </div>
               )}
               <div className="flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-xl flex flex-col items-center justify-center font-display transition-all shrink-0 ${
                    activeDay === idx ? 'bg-indigo-600 text-white' : 'bg-[#181A32] text-slate-400 group-hover:bg-[#202344]'
                  }`}>
                     <span className="text-[9px] font-black uppercase leading-none opacity-70 mb-1">{day.day.split(' ')[0]}</span>
                     <span className="text-xl font-black leading-none">{day.day.split(' ')[1]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={`font-black text-base leading-tight transition-colors ${activeDay === idx ? 'text-white' : 'text-slate-400'}`}>{day.date}</h3>
                    <p className={`text-[10px] font-black uppercase tracking-widest mt-1.5 truncate ${activeDay === idx ? 'text-indigo-400' : 'text-slate-500'}`}>{day.milestone}</p>
                  </div>
               </div>
             </button>
           ))}
        </div>

        {/* Task Details Right Panel (8 items span) */}
        <div className="lg:col-span-8 w-full">
           <Card className="bg-gradient-to-br from-[#13162C] to-[#121326] border border-[#20254C] rounded-[32px] overflow-hidden shadow-2xl min-h-[500px] flex flex-col w-full">
              <CardHeader className="bg-[#121429]/95 p-8 border-b border-[#1E2342]">
                 <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1.5 leading-none">{ROADMAP_DATA[activeDay].milestone}</p>
                      <CardTitle className="text-2xl font-black text-white tracking-tight uppercase leading-none font-display">{ROADMAP_DATA[activeDay].date}</CardTitle>
                    </div>
                    <div className="text-right shrink-0">
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Expected Effort</p>
                       <p className="text-xl font-black text-white uppercase tracking-tight">4.5 Hours ⏳</p>
                    </div>
                 </div>
              </CardHeader>
              
              <CardContent className="p-8 flex-1 space-y-6">
                 {ROADMAP_DATA[activeDay].topics.map((topic, i) => (
                   <motion.div 
                     key={topic.id}
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ delay: i * 0.1 }}
                     className={`group p-6 rounded-[24px] border border-[#1E2342] bg-[#121429]/65 hover:border-indigo-500/30 transition-all duration-300 flex items-center justify-between flex-wrap gap-4 ${
                       topic.completed ? 'opacity-50' : ''
                     }`}
                   >
                     <div className="flex items-center gap-5 min-w-0 flex-1">
                        <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                          topic.type === 'study' ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20' : 'bg-orange-500/10 text-orange-300 border border-orange-500/20 shadow-sm'
                        }`}>
                           {topic.type === 'study' ? <BookOpen className="h-6 w-6" /> : <BrainCircuit className="h-6 w-6" />} {/* Locked icons 24x24 px */}
                        </div>
                        <div className="min-w-0 flex-1">
                           <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <Badge className="bg-indigo-500/10 border-none text-indigo-300 text-[9px] font-black uppercase tracking-wider px-2 py-0.5">{topic.type}</Badge>
                              <span className="text-[10px] font-mono text-slate-450 font-bold">{topic.time} ALLOCATED</span>
                           </div>
                           <h4 className="text-lg font-black text-white group-hover:text-indigo-400 transition-colors uppercase tracking-tight truncate">{topic.title}</h4>
                        </div>
                     </div>
                     
                     <div className="flex items-center gap-4 shrink-0">
                        {topic.completed ? (
                          <div className="h-11 px-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center gap-2 font-bold text-xs uppercase tracking-wider select-none">
                             <CheckCircle2 className="h-5 w-5 text-emerald-300 shrink-0" /> Completed
                          </div>
                        ) : (
                          <Button className="h-11 px-6 rounded-xl bg-[#0F1121] hover:bg-indigo-600 text-white font-extrabold flex items-center gap-1.5 hover:shadow-lg transition-all border border-[#2E356A]">
                             {topic.type === 'study' ? 'Launch Module' : 'Start Practice'} <ChevronRight className="h-5 w-5" />
                          </Button>
                        )}
                     </div>
                   </motion.div>
                 ))}

                 {/* Daily Goals peer row */}
                 <div className="mt-8 p-6.5 bg-[#121429]/40 rounded-[24px] border border-[#1E2342] flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                       <div className="h-11 w-11 rounded-xl bg-orange-500/15 border border-orange-500/20 text-orange-300 flex items-center justify-center shadow-lg shrink-0">
                          <Star className="h-6 w-6" fill="currentColor" /> {/* Locked Icon at 24x24 px */}
                       </div>
                       <div>
                          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest leading-none">Daily Micro-Goal</p>
                          <p className="text-base font-black text-slate-100 mt-2 uppercase tracking-tight leading-none">Master 3 Complex Physics Heuristics 🌟</p>
                       </div>
                    </div>
                    
                    <div className="flex -space-x-3 select-none">
                       {[1, 2, 3].map(i => (
                         <div key={i} className="h-9 w-9 rounded-full border-2 border-[#1E2342] bg-[#14172B] overflow-hidden shrink-0">
                           <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=student-${i + 2}`} alt="Peer avatar" referrerPolicy="no-referrer" />
                         </div>
                       ))}
                       <div className="h-9 w-9 rounded-full border-2 border-[#1E2342] bg-indigo-600 flex items-center justify-center text-[9px] font-black text-white shrink-0">+42</div>
                    </div>
                 </div>
              </CardContent>
           </Card>
        </div>

      </div>
    </div>
  );
};
