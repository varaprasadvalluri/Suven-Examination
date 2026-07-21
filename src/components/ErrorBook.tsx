import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { ErrorBookEntry } from '../types';
import { useAuth } from '../lib/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  BookX, Search, Brain, AlertCircle, 
  ChevronRight, ArrowRight, RefreshCcw, BookOpen,
  PieChart, History, Lightbulb
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const ErrorBook: React.FC = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ErrorBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<string>('All');

  useEffect(() => {
    const fetchErrorBook = async () => {
      if (!user?.uid) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, 'error_books'),
          where('studentId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ErrorBookEntry));
        setEntries(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchErrorBook();
  }, [user]);

  const filteredEntries = entries.filter(e => 
    (selectedSubject === 'All' || e.subject === selectedSubject) &&
    (e.questionText.toLowerCase().includes(searchQuery.toLowerCase()) || e.subject.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const subjects = ['All', ...Array.from(new Set(entries.map(e => e.subject)))];

  return (
    <div className="space-y-11 animate-in fade-in duration-500">
      
      {/* Tracker Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <Badge className="bg-rose-50 border-2 border-rose-200 text-rose-600 px-3.5 py-1 font-black text-xs uppercase mb-3 select-none">
             Automated Weakness Tracker
          </Badge>
          <h2 className="text-3xl md:text-4xl font-black text-indigo-950 tracking-tight uppercase leading-none font-display">
             Digital Error Book 📖
          </h2>
          <p className="text-sm font-semibold text-slate-650 mt-2.5 max-w-2xl leading-relaxed">
             Every incorrect answer becomes a smart study route. Revise your logged answers and perfect your skills before the final quest!
          </p>
        </div>
        
        <div className="flex items-center gap-4 shrink-0">
           <div className="bg-[#14172E] border border-[#242953] p-6 rounded-[24px] shadow-2xl flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-300 shrink-0">
                 <BookX className="h-6 w-6" /> {/* Locked Icon 24x24 px */}
              </div>
              <div>
                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 leading-none">Items to Re-master</p>
                 <p className="text-2xl font-black text-white mt-1.5 leading-none font-display">{entries.length}</p>
              </div>
           </div>
        </div>
      </div>

      {/* Modern High-DPI Search and Filter Inputs Row */}
      <div className="flex flex-wrap gap-5 items-center w-full">
         <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-450 h-5 w-5" />
            <input 
              placeholder="Search concepts, questions, or subjects..."
              className="w-full h-14 pl-12 pr-6 rounded-2xl border border-[#20254C] bg-[#13162C] focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-950/40 outline-none font-semibold transition-all shadow-inner text-white placeholder:text-slate-500 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
         </div>
         
         <div className="flex p-1.5 bg-[#121429]/95 rounded-2xl border border-[#1E2342] shrink-0 overflow-x-auto max-w-full">
            {subjects.map(s => (
              <button
                key={s}
                onClick={() => setSelectedSubject(s)}
                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap ${
                  selectedSubject === s 
                    ? 'bg-indigo-650 text-white shadow-md' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
         </div>
      </div>

      {/* Error Books Cards List Stack */}
      <div className="grid grid-cols-1 gap-8">
        <AnimatePresence mode="popLayout">
          {filteredEntries.map((entry, idx) => (
            <motion.div
              layout
              key={entry.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: idx * 0.05 }}
              className="w-full"
            >
              <Card className="border border-[#20254C] shadow-2xl rounded-[32px] overflow-hidden bg-gradient-to-br from-[#13162C] to-[#121326] group hover:border-[#2C3362] transition-colors w-full min-w-[280px]">
                <div className="flex flex-col md:flex-row min-h-[220px]">
                   
                   {/* Left side card stats panel */}
                   <div className="md:w-64 bg-[#101224] p-8 flex flex-col justify-between shrink-0 border-b md:border-b-0 md:border-r border-[#1C2042]">
                      <div>
                        <Badge className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[10px] uppercase font-black px-2.5 py-1 mb-4">
                           {entry.subject}
                        </Badge>
                        <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest leading-none">Logged From</p>
                        <p className="text-white font-black mt-2 text-sm uppercase tracking-tight">Assessment Practice</p>
                      </div>
                      <div className="flex items-center gap-2 text-rose-400 text-[10px] font-black uppercase tracking-widest mt-6">
                         <History className="h-4 w-4 text-rose-450 animate-pulse shrink-0" /> Re-attempt Pending
                      </div>
                   </div>
                   
                   {/* Right side core question details */}
                   <div className="flex-1 p-8 space-y-6 flex flex-col justify-center">
                      <div className="flex items-start justify-between gap-4">
                         <h3 className="text-xl font-black text-slate-100 tracking-tight leading-snug uppercase font-display">
                            {entry.questionText}
                         </h3>
                         <div className="h-10 w-10 bg-[#161937] border border-[#20254C] rounded-xl flex items-center justify-center text-indigo-300 shrink-0">
                            <Lightbulb className="h-5 w-5" />
                         </div>
                      </div>
                      
                       {entry.imageUrl && (
                          <div className="rounded-xl overflow-hidden border border-[#242953] bg-[#101224] p-2 max-w-md shadow-inner mb-4">
                             <img 
                                src={entry.imageUrl} 
                                alt="Question diagram illustration" 
                                className="max-h-52 object-contain rounded-lg"
                                referrerPolicy="no-referrer"
                             />
                          </div>
                       )}

                      {/* Submissions discrepancy indicators */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/15">
                            <p className="text-[10px] font-black text-[#FF5A6A] tracking-wider uppercase mb-1">Your Submission</p>
                            <p className="text-sm font-bold text-slate-300 uppercase">Option {String.fromCharCode(65 + entry.selectedAnswer)}</p>
                         </div>
                         <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                            <p className="text-[10px] font-black text-emerald-400 tracking-wider uppercase mb-1">Correct Identity</p>
                            <p className="text-sm font-bold text-slate-200 uppercase">Option {String.fromCharCode(65 + entry.correctAnswer)}</p>
                         </div>
                      </div>

                      {/* Explanation summary block footer */}
                      <div className="pt-6 border-t border-[#1C2042] flex items-center justify-between flex-wrap gap-4">
                         <div className="flex items-center gap-3 text-sm text-slate-400 font-semibold">
                            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                               <Brain className="h-5 w-5" />
                            </div>
                            <span>Explanation mapped to Concept Mastery Module</span>
                         </div>
                         
                         <Button variant="ghost" className="h-10 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest text-[#B5F2D2] hover:text-white hover:bg-emerald-500/5 flex items-center gap-2 border border-transparent hover:border-emerald-500/15">
                            Self-Correct Concept <ArrowRight className="h-4 w-4" />
                         </Button>
                      </div>
                   </div>

                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Empty state representation when list is clear */}
        {filteredEntries.length === 0 && !loading && (
          <div className="text-center py-28 bg-[#111326]/40 border-2 border-dashed border-[#1E2342] rounded-[32px] p-8">
             <div className="h-20 w-20 bg-[#161937] border border-[#20254C] rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-300">
                <BookOpen className="h-8 w-8 text-indigo-300" />
             </div>
             <h3 className="text-xl font-black text-white tracking-tight uppercase leading-none font-display">Perfect Knowledge Base! ✨</h3>
             <p className="text-slate-400 mt-3 font-semibold text-sm max-w-md mx-auto leading-relaxed">
                No incorrect entries found in this topic track. Continue exploring assessments to refine your cognitive skills!
             </p>
          </div>
        )}
      </div>

      {/* Helpful educational features footer deck */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-6">
         {[
           { icon: Brain, label: 'Concept Mapping', desc: 'AI-driven analysis of why mistakes happen.', color: 'bg-indigo-600/10 border-indigo-500/20 text-indigo-300' },
           { icon: PieChart, label: 'Trend Analysis', desc: 'Repeat mistakes automatically flagged for high priority.', color: 'bg-[#FF5A6A]/10 border-[#FF5A6A]/20 text-[#FF5A6A]' },
           { icon: RefreshCcw, label: 'Adaptive Cycles', desc: 'Mistakes re-injected dynamically into mock practice runs.', color: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' }
         ].map((feat, i) => {
           const IconComp = feat.icon;
           return (
             <div key={i} className="p-8 bg-gradient-to-br from-[#13162C] to-[#121326] border border-[#20254C] rounded-[24px] relative overflow-hidden group">
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center mb-6 shadow-xl shrink-0 border border-white/5 bg-[#14172B]">
                   <IconComp className="h-6 w-6 text-indigo-300" /> {/* Locked Icon at 24x24 px */}
                </div>
                <h4 className="text-lg font-black uppercase text-white tracking-tight mb-2.5 leading-none">{feat.label}</h4>
                <p className="text-xs text-slate-450 leading-relaxed font-semibold">{feat.desc}</p>
             </div>
           );
         })}
      </div>

    </div>
  );
};
