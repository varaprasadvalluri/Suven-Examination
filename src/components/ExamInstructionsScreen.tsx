import React from 'react';
import { Button } from './ui/button';
import { Sparkles, GraduationCap, ArrowRight, ShieldCheck, Clock, BookOpen, UserCheck } from 'lucide-react';

// Shared "Before You Begin" screen — every student entry flow (secure roll-number/token link,
// school-generated single-use invite link, and the normal dashboard Start Exam button) routes
// through this same component so students always see identical exam structure/marking/rules
// information and the same rules/proctoring agreement checkbox before an attempt is created,
// regardless of which door they came in through.
export interface ExamInstructionsScreenProps {
  exam: any;
  questions?: any[];
  studentName?: string;
  rollNumber?: string;
  agreedToTerms: boolean;
  onAgreedChange: (checked: boolean) => void;
  onConfirm: () => void;
  onBack: () => void;
  isLaunching: boolean;
  confirmLabel?: string;
  confirmLoadingLabel?: string;
}

function getSectionsInfo(exam: any, questions: any[]) {
  if (!questions || questions.length === 0) {
    return [
      {
        name: exam?.subject || 'General Paper',
        count: 0,
        marks: exam?.totalMarks || 100,
        marking: '+4 / -1'
      }
    ];
  }

  const groups: Record<string, { count: number; marks: number }> = {};
  questions.forEach(q => {
    const sub = q.subject || exam?.subject || 'General';
    if (!groups[sub]) {
      groups[sub] = { count: 0, marks: 0 };
    }
    groups[sub].count += 1;
    groups[sub].marks += q.marks || 4;
  });

  return Object.entries(groups).map(([name, data]) => ({
    name,
    count: data.count,
    marks: data.marks,
    marking: '+4 / -1'
  }));
}

export const ExamInstructionsScreen: React.FC<ExamInstructionsScreenProps> = ({
  exam,
  questions = [],
  studentName,
  rollNumber,
  agreedToTerms,
  onAgreedChange,
  onConfirm,
  onBack,
  isLaunching,
  confirmLabel = 'I Agree and Start Exam',
  confirmLoadingLabel = 'Initiating Assessment...'
}) => {
  const sections = getSectionsInfo(exam, questions);
  const totalQs = questions.length || 30;
  const totalMarks = exam?.totalMarks || 120;
  const durationMin = exam?.duration || 180;

  return (
    <div className="min-h-screen bg-[#070B13] text-[#E2E8F0] flex flex-col md:flex-row relative overflow-hidden font-sans selection:bg-amber-500/20">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* LEFT COLUMN: Candidate Details & Exam Structure */}
      <div className="w-full md:w-[360px] bg-[#0E1424] border-r border-slate-800/80 p-8 flex flex-col gap-8 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-amber-500 rounded-xl flex items-center justify-center font-black text-black text-xl shadow-lg shadow-amber-500/20">
            S
          </div>
          <div>
            <div className="font-display font-black text-sm uppercase tracking-wider text-white">SUVENEDU</div>
            <div className="text-[9px] font-bold text-amber-500 uppercase tracking-widest leading-none mt-0.5">EXAMINATION PORTAL</div>
          </div>
        </div>

        <hr className="border-slate-800/60" />

        {(studentName || rollNumber) && (
          <div className="space-y-4">
            <p className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">Candidate Details</p>
            <div className="flex items-center gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800/60">
              <div className="h-14 w-14 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 border-2 border-amber-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/10 flex-shrink-0">
                {(studentName || 'A')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-base font-black text-white truncate">{studentName}</div>
                {rollNumber && <div className="text-xs font-bold font-mono text-amber-400/90 mt-0.5">Roll: {rollNumber}</div>}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Exam</span>
            <span className="text-white font-semibold text-right max-w-[200px] truncate">{exam?.title}</span>
          </div>
          <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Subject</span>
            <span className="text-white font-semibold">{exam?.subject || 'PCM Combined'}</span>
          </div>
          <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Date</span>
            <span className="text-white font-semibold">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Shift</span>
            <span className="text-white font-semibold">{exam?.shift || 'Morning — 9:00 AM'}</span>
          </div>
        </div>

        <div className="space-y-4 flex-grow">
          <p className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">Exam Structure</p>
          <div className="space-y-3">
            {sections.map((sec, idx) => {
              const colors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
              const dotColor = colors[idx % colors.length];
              return (
                <div key={idx} className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    <span className="text-slate-300 font-semibold">{sec.name}</span>
                  </div>
                  <span className="text-slate-400 font-medium">{sec.count || 10} Qs · <strong className="text-white font-mono">{sec.marking}</strong></span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#151D30] p-4 rounded-xl border border-slate-800 text-center text-xs font-bold text-white tracking-wide">
          Total: {totalQs} Qs • {durationMin} min • {totalMarks} marks
        </div>
      </div>

      {/* RIGHT COLUMN: Instructions, Checkbox, Start Button */}
      <div className="flex-grow overflow-y-auto p-6 md:p-12 flex flex-col gap-8 max-w-5xl">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-amber-500">
            📋 EXAMINATION INSTRUCTIONS — {exam?.title}
          </div>
          <h1 className="text-3xl md:text-5xl font-display font-black tracking-tight text-white leading-none">
            Before You Begin
          </h1>
          <p className="text-slate-400 text-sm md:text-base font-medium max-w-2xl leading-relaxed">
            Read all question paper guidelines carefully. Once the exam starts, the timer cannot be paused.
          </p>
        </div>

        {(exam?.description || exam?.instructions) && (
          <div className="bg-[#151D30] border-2 border-amber-500/30 p-6 rounded-2xl space-y-3 shadow-xl">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
              <Sparkles size={16} /> Question Paper Specific Guidelines
            </div>
            <div className="text-sm text-slate-200 font-medium leading-relaxed whitespace-pre-wrap">
              {exam?.description || exam?.instructions}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Clock size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Time Management</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Total duration is {durationMin} minutes. Each section has no individual time limit — allocate wisely.
              </p>
            </div>
          </div>

          <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <GraduationCap size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Marking Scheme</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                +4 marks for correct answer. -1 for incorrect. 0 for unattempted questions.
              </p>
            </div>
          </div>

          <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <BookOpen size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Navigation</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                You can move between questions and sections freely. Use the palette on the right to jump directly.
              </p>
            </div>
          </div>

          <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Mark for Review</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Flag uncertain answers. Marked questions with an answer will still be evaluated.
              </p>
            </div>
          </div>

          <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
            <div className="h-10 w-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ShieldCheck size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Integrity</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Do not switch browser tabs. Any violation will be logged and flagged to the proctor.
              </p>
            </div>
          </div>

          <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <UserCheck size={20} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Auto-Save</h3>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Answers are saved automatically every 30 seconds. Do not refresh the page.
              </p>
            </div>
          </div>
        </div>

        <hr className="border-slate-800/80 my-2" />

        <div className="space-y-6">
          <div className="flex items-start gap-3 bg-[#111827]/40 p-4 rounded-2xl border border-slate-800/50">
            <input
              type="checkbox"
              id="agree-checkbox"
              checked={agreedToTerms}
              onChange={e => onAgreedChange(e.target.checked)}
              className="h-5 w-5 rounded border-slate-800 bg-[#0E1424] text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900 cursor-pointer mt-0.5 accent-amber-500"
            />
            <label htmlFor="agree-checkbox" className="text-xs text-slate-300 select-none cursor-pointer leading-relaxed font-medium">
              I have read and understood all instructions. I agree to abide by the rules and regulations of the examination, and I acknowledge that any form of malpractice, window switching, or proctoring violation will be recorded and could lead to disqualification.
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Button
              variant="outline"
              className="h-12 px-6 rounded-xl text-xs font-bold uppercase tracking-wider border-slate-800 bg-[#0E1424] text-slate-300 hover:bg-slate-900"
              onClick={onBack}
              disabled={isLaunching}
            >
              Back to Details
            </Button>
            <Button
              className="h-12 px-8 rounded-xl text-xs font-black uppercase tracking-widest flex-grow sm:flex-grow-0 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2 group cursor-pointer border-0"
              onClick={onConfirm}
              disabled={isLaunching}
            >
              {isLaunching ? (
                <>
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  <span>{confirmLoadingLabel}</span>
                </>
              ) : (
                <>
                  <span>{confirmLabel}</span>
                  <ArrowRight className="h-4.5 w-4.5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
