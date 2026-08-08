import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, collection, addDoc, getDocs } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { 
  ArrowLeft, 
  FileText, 
  CheckCircle2, 
  ShieldCheck, 
  Zap, 
  Calculator, 
  FlaskConical, 
  Code, 
  BookOpen, 
  Globe, 
  Brain,
  Layers
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

const SUBJECT_ICONS: Record<string, any> = {
  'Mathematics': <Calculator className="h-4 w-4" />,
  'Physics': <FlaskConical className="h-4 w-4" />,
  'Computer Science': <Code className="h-4 w-4" />,
  'English': <BookOpen className="h-4 w-4" />,
  'General Knowledge': <Globe className="h-4 w-4" />,
  'Psychology': <Brain className="h-4 w-4" />,
  'Other': <FileText className="h-4 w-4" />
};

const SUBJECTS = Object.keys(SUBJECT_ICONS);

export const AdminCreateExam: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [schools, setSchools] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [newExamMode, setNewExamMode] = useState<'global' | 'specific'>('global');

  const [newExam, setNewExam] = useState({
    title: '',
    description: '',
    subject: 'Computer Science',
    difficulty: 'Medium' as 'Easy' | 'Medium' | 'Hard',
    duration: 30,
    totalMarks: 100,
    startTime: '',
    endTime: '',
    assignedSchoolIds: [] as string[]
  });

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const snap = await getDocs(collection(db, 'schools'));
        setSchools(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        console.error("Failed to load schools for exam creator:", err);
      }
    };
    fetchSchools();
  }, []);

  const canAdvanceStep = (currentStep: number): boolean => {
    if (currentStep === 1) {
      if (!newExam.title.trim()) {
        toast.error("Validation failed: Please provide an exam academic title");
        return false;
      }
      if (!newExam.subject) {
        toast.error("Validation failed: Please select a subject category");
        return false;
      }
      if (!newExam.description.trim()) {
        toast.error("Validation failed: Please enter manual instructions / syllabus description");
        return false;
      }
    }
    if (currentStep === 2) {
      if (!newExam.totalMarks || newExam.totalMarks <= 0) {
        toast.error("Validation failed: Please set a valid total marks count (>0)");
        return false;
      }
      if (!newExam.duration || newExam.duration <= 0) {
        toast.error("Validation failed: Please set a valid time limit in minutes (>0)");
        return false;
      }
    }
    if (currentStep === 3) {
      if (!newExam.startTime || !newExam.endTime) {
        toast.error("Validation failed: Please set both release window start time and lock window end time");
        return false;
      }
      if (new Date(newExam.startTime) >= new Date(newExam.endTime)) {
        toast.error("Validation failed: Lock window end time must be after the release window start time");
        return false;
      }
      if (newExamMode === 'specific' && newExam.assignedSchoolIds.length === 0) {
        toast.error("Validation failed: Please select at least one school for the specific school cluster allocation, or choose Global.");
        return false;
      }
    }
    return true;
  };

  const handleCreateExam = async () => {
    if (!profile) return;
    if (!canAdvanceStep(1) || !canAdvanceStep(2) || !canAdvanceStep(3)) {
      return;
    }

    setIsSubmitting(true);
    const finalAssignedSchoolIds = newExamMode === 'global' ? [] : newExam.assignedSchoolIds;

    try {
      const examsRef = collection(db, 'exams');
      await addDoc(examsRef, {
        ...newExam,
        creatorId: profile.uid,
        createdAt: new Date().toISOString(),
        startTime: newExam.startTime || null,
        endTime: newExam.endTime || null,
        status: 'draft',
        assignedSchoolIds: finalAssignedSchoolIds
      });

      toast.success("Exam created successfully!");
      navigate('/admin/exams');
    } catch (error) {
      toast.error("Failed to create exam");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 animate-in fade-in duration-300">
      {/* Top Header Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-[28px] border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => navigate('/admin/exams')}
            className="h-11 px-4 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Assessment Hub
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-100">
                Standalone Module
              </span>
              <span className="text-xs font-bold text-slate-400">Step {step} of 4</span>
            </div>
            <h1 className="text-2xl font-display font-black text-slate-900 tracking-tight mt-0.5">
              Create Assessment Portal
            </h1>
          </div>
        </div>
      </div>

      {/* Main Form Container Card */}
      <div className="bg-white rounded-[32px] border border-slate-200/80 shadow-xl overflow-hidden">
        <div className="flex flex-col md:flex-row min-h-[580px]">
          {/* Stepper Sidebar */}
          <div className="md:w-72 bg-slate-900 p-8 text-white flex flex-col justify-between shrink-0">
            <div>
              <div className="flex items-center gap-3 mb-10 pb-6 border-b border-slate-800">
                <div className="h-10 w-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
                  <FileText size={20} />
                </div>
                <div>
                  <span className="font-black text-xs uppercase tracking-widest text-slate-200 block">Assessment Wizard</span>
                  <span className="text-[10px] font-medium text-slate-400">Institutional Scheduling</span>
                </div>
              </div>

              <div className="space-y-6">
                {[
                  { id: 1, label: 'Definitions', desc: 'Core Metadata & Title' },
                  { id: 2, label: 'Parameters', desc: 'Marks & Duration Rules' },
                  { id: 3, label: 'Access Control', desc: 'Schedules & Allocations' },
                  { id: 4, label: 'Finalize', desc: 'Verify & Publish Paper' }
                ].map((s) => (
                  <div 
                    key={s.id} 
                    onClick={() => {
                      if (s.id < step) setStep(s.id);
                    }}
                    className={`flex items-center gap-4 group transition-all ${s.id < step ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                  >
                    <div className={`h-9 w-9 rounded-xl border-2 flex items-center justify-center text-xs font-black transition-all ${step >= s.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'border-slate-800 text-slate-500 bg-slate-950/40'}`}>
                      {step > s.id ? <CheckCircle2 size={16} /> : s.id}
                    </div>
                    <div>
                      <p className={`text-xs font-black uppercase tracking-wider leading-none ${step === s.id ? 'text-white' : step > s.id ? 'text-slate-300' : 'text-slate-500'}`}>{s.label}</p>
                      <p className="text-[10px] font-medium text-slate-500 mt-1">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-800/80">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                <Layers size={14} className="text-indigo-400" />
                <span>Global Registry Direct Sync</span>
              </div>
            </div>
          </div>

          {/* Form Active Phase Content */}
          <div className="flex-grow p-8 md:p-12 bg-white flex flex-col justify-between">
            <div className="flex-grow">
              <AnimatePresence mode="wait">
                {step === 1 && (
                  <motion.div 
                    key="step1"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-8"
                  >
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Assessment Definitions</h3>
                      <p className="text-xs font-bold text-slate-400 mt-1">Establish the identity and metadata of this assessment portal.</p>
                    </div>

                    <div className="space-y-6">
                      <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Exam Title *</Label>
                        <Input 
                          value={newExam.title} 
                          onChange={e => setNewExam({...newExam, title: e.target.value})} 
                          placeholder="e.g. JEE Advanced Mock - Wave Optics & Electromagnetism" 
                          className="h-12 rounded-xl bg-slate-50 border-slate-200 text-sm font-semibold focus-visible:ring-indigo-600" 
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subject Category *</Label>
                        <Select value={newExam.subject} onValueChange={(val) => setNewExam({...newExam, subject: val})}>
                          <SelectTrigger className="h-12 rounded-xl bg-slate-50 border-slate-200 text-slate-900 font-bold px-4 justify-between focus:border-indigo-600 hover:border-indigo-500 transition-all text-sm">
                            <SelectValue placeholder="Select Subject" />
                          </SelectTrigger>
                          <SelectContent className="bg-white border border-slate-200 shadow-2xl rounded-2xl p-1.5 z-50">
                            {SUBJECTS.map(s => (
                              <SelectItem key={s} value={s} className="font-bold text-xs text-slate-800 hover:bg-slate-50 cursor-pointer py-2 px-3 rounded-lg">
                                <div className="flex items-center gap-2">
                                  {SUBJECT_ICONS[s]}
                                  <span>{s}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Instructions & Syllabus Description *</Label>
                        <Textarea 
                          value={newExam.description} 
                          onChange={e => setNewExam({...newExam, description: e.target.value})} 
                          className="rounded-xl bg-slate-50 border-slate-200 min-h-[130px] resize-none text-xs font-medium leading-relaxed" 
                          placeholder="Provide detailed instructions, negative marking rules, covered chapters, and candidate guidelines..." 
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div 
                    key="step2"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-8"
                  >
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Quantifiable Rules</h3>
                      <p className="text-xs font-bold text-slate-400 mt-1">Set operational metrics, duration, and score weighting for this exam.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Marks *</Label>
                        <Input 
                          type="number" 
                          value={newExam.totalMarks} 
                          onChange={e => setNewExam({...newExam, totalMarks: parseInt(e.target.value) || 0})} 
                          className="h-12 rounded-xl bg-slate-50 border-slate-200 font-bold text-sm" 
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Time Limit (Minutes) *</Label>
                        <Input 
                          type="number" 
                          value={newExam.duration} 
                          onChange={e => setNewExam({...newExam, duration: parseInt(e.target.value) || 0})} 
                          className="h-12 rounded-xl bg-slate-50 border-slate-200 font-bold text-sm" 
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Difficulty Level</Label>
                      <div className="grid grid-cols-3 gap-3">
                        {['Easy', 'Medium', 'Hard'].map((d) => (
                          <button 
                            key={d} 
                            type="button"
                            onClick={() => setNewExam({...newExam, difficulty: d as any})}
                            className={`h-12 rounded-xl font-black text-xs uppercase tracking-wider border-2 transition-all cursor-pointer ${newExam.difficulty === d ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div 
                    key="step3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-8"
                  >
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Access Protocol</h3>
                      <p className="text-xs font-bold text-slate-400 mt-1">Define the valid temporal window and institutional targeting for student access.</p>
                    </div>

                    <div className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="grid gap-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Release Window (Start Date/Time) *</Label>
                          <Input 
                            type="datetime-local" 
                            value={newExam.startTime} 
                            onChange={e => setNewExam({...newExam, startTime: e.target.value})} 
                            className="h-12 rounded-xl bg-slate-50 border-slate-200 text-xs font-semibold" 
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lock Window (End Date/Time) *</Label>
                          <Input 
                            type="datetime-local" 
                            value={newExam.endTime} 
                            onChange={e => setNewExam({...newExam, endTime: e.target.value})} 
                            className="h-12 rounded-xl bg-slate-50 border-slate-200 text-xs font-semibold" 
                          />
                        </div>
                      </div>

                      {/* Institution Allocation Targeter */}
                      <div className="pt-4 border-t border-slate-100 space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Institution Allocation Scope</Label>
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            variant={newExamMode === "global" ? "default" : "outline"}
                            onClick={() => setNewExamMode("global")}
                            className={`text-xs font-bold uppercase tracking-wider rounded-xl h-10 px-4 cursor-pointer ${newExamMode === "global" ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-transparent text-slate-700 border-slate-200'}`}
                          >
                            Global (All Registered Schools)
                          </Button>
                          <Button
                            type="button"
                            variant={newExamMode === "specific" ? "default" : "outline"}
                            onClick={() => {
                              setNewExamMode("specific");
                              if (newExam.assignedSchoolIds.length === 0 && schools.length > 0) {
                                setNewExam({ ...newExam, assignedSchoolIds: [schools[0].id] });
                              }
                            }}
                            className={`text-xs font-bold uppercase tracking-wider rounded-xl h-10 px-4 cursor-pointer ${newExamMode === "specific" ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-transparent text-slate-700 border-slate-200'}`}
                          >
                            Specific Schools Cluster
                          </Button>
                        </div>

                        {newExamMode === "specific" && (
                          <div className="p-4 bg-slate-50 rounded-2xl max-h-[160px] overflow-y-auto space-y-2 border border-slate-200">
                            {schools.length === 0 ? (
                              <p className="text-xs text-slate-400 font-medium italic">No schools registered yet. Please add schools in School Registry.</p>
                            ) : (
                              schools.map((school) => {
                                const checked = newExam.assignedSchoolIds.includes(school.id);
                                return (
                                  <label key={school.id} className="flex items-center gap-3 cursor-pointer p-1.5 hover:bg-slate-100/80 rounded-lg transition-colors">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        const current = [...newExam.assignedSchoolIds];
                                        if (checked) {
                                          const filtered = current.filter(id => id !== school.id);
                                          setNewExam({ ...newExam, assignedSchoolIds: filtered });
                                        } else {
                                          setNewExam({ ...newExam, assignedSchoolIds: [...current, school.id] });
                                        }
                                      }}
                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                                    />
                                    <span className="text-xs font-bold text-slate-800">{school.name}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>

                      <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 flex items-center gap-4">
                        <div className="h-9 w-9 bg-emerald-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm">
                          <ShieldCheck size={18} />
                        </div>
                        <p className="text-xs font-bold text-emerald-800 leading-relaxed uppercase tracking-tight">
                          Automated access control will enforce candidate authorization within the designated window.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 4 && (
                  <motion.div 
                    key="step4"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-600/30">
                        <Zap size={28} className="fill-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Publish Question Paper?</h3>
                        <p className="text-xs font-bold text-slate-400">Final verification required before deploying to the national examination database.</p>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4 max-h-[340px] overflow-y-auto">
                      <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b border-slate-200 pb-2">
                        Summary Verification Checklist
                      </p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Exam Title</span>
                          <span className="text-xs font-bold text-slate-900 bg-white p-2.5 rounded-xl border border-slate-200 block">{newExam.title || "—"}</span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Subject Category</span>
                          <span className="text-xs font-bold text-slate-900 bg-white p-2.5 rounded-xl border border-slate-200 block">{newExam.subject}</span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Difficulty Heuristic</span>
                          <span className="text-xs font-black text-indigo-600 uppercase bg-white p-2.5 rounded-xl border border-slate-200 block">{newExam.difficulty}</span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Total Marks & Duration</span>
                          <span className="text-xs font-bold text-slate-900 bg-white p-2.5 rounded-xl border border-slate-200 block">
                            {newExam.totalMarks} Marks | {newExam.duration} Minutes
                          </span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Start Release Window</span>
                          <span className="text-xs font-bold text-slate-900 bg-white p-2.5 rounded-xl border border-slate-200 block">
                            {newExam.startTime ? new Date(newExam.startTime).toLocaleString() : "Not set"}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">End Lock Window</span>
                          <span className="text-xs font-bold text-slate-900 bg-white p-2.5 rounded-xl border border-slate-200 block">
                            {newExam.endTime ? new Date(newExam.endTime).toLocaleString() : "Not set"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Institutional Target Allocation</span>
                        <span className="text-xs font-bold text-slate-900 bg-white p-2.5 rounded-xl border border-slate-200 block">
                          {newExamMode === 'global' ? (
                            <span className="text-emerald-600 font-black">Global Scope (All Schools)</span>
                          ) : (
                            <span className="text-indigo-600 font-bold">
                              Assigned Schools: {newExam.assignedSchoolIds.map(id => schools.find(s => s.id === id)?.name || id).join(', ') || 'None selected'}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Instructions & Guidelines</span>
                        <p className="text-xs font-medium text-slate-700 bg-white p-2.5 rounded-xl border border-slate-200 whitespace-pre-wrap">
                          {newExam.description || "—"}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom Wizard Actions */}
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
              {step > 1 ? (
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setStep(step - 1)} 
                  className="h-12 px-6 rounded-xl border-slate-200 font-bold text-xs uppercase tracking-wider text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Previous Step
                </Button>
              ) : (
                <div />
              )}

              {step < 4 ? (
                <Button 
                  type="button"
                  onClick={() => { if (canAdvanceStep(step)) setStep(step + 1); }} 
                  className="h-12 px-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-600/20 cursor-pointer"
                >
                  Next Step
                </Button>
              ) : (
                <Button 
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleCreateExam} 
                  className="h-12 px-10 rounded-xl bg-slate-900 hover:bg-black text-white font-black text-xs uppercase tracking-widest shadow-xl cursor-pointer"
                >
                  {isSubmitting ? "Publishing..." : "Publish Assessment"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
