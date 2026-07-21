import React, { useEffect, useState, useMemo } from 'react';
import { db, handleFirestoreError, OperationType, collection, query, where, orderBy, onSnapshot, addDoc, deleteDoc, doc, updateDoc, getDocs, setDoc, getDoc } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Exam } from '../types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Plus, Trash2, Clock, FileText, ClipboardList, Eye, EyeOff, BookOpen, Brain, Code, Globe, Calculator, FlaskConical, Search, ShieldCheck, CheckCircle2, Zap, Send, Edit3, Calendar, School } from 'lucide-react';
import { toast } from 'sonner';

import { useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { motion, AnimatePresence } from 'motion/react';

import { Textarea } from './ui/textarea';
import { AdminDispatchCenter } from './AdminDispatchCenter';
import { DataLoader } from './DataLoader';

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

const getExamVisualState = (exam: Exam): 'ongoing' | 'upcoming' | 'completed' => {
  if (!exam.startTime || !exam.endTime) {
    return 'upcoming';
  }
  const now = new Date().getTime();
  const start = new Date(exam.startTime).getTime();
  const end = new Date(exam.endTime).getTime();

  if (now < start) {
    return 'upcoming';
  } else if (now >= start && now <= end) {
    return 'ongoing';
  } else {
    return 'completed';
  }
};

const getExamLocation = (subject: string): string => {
  switch (subject) {
    case 'Computer Science': return 'CS Lab';
    case 'Physics': return 'Lab 3';
    case 'Chemistry': return 'Lab 1';
    case 'Biology': return 'Biology Lab';
    default: return 'Hall A';
  }
};

export const AdminExams: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const handleRetry = () => setRetryTrigger(prev => prev + 1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'ongoing' | 'completed'>('all');
  const [selectedDispatchExam, setSelectedDispatchExam] = useState<any | null>(null);
  const [step, setStep] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [schoolLinks, setSchoolLinks] = useState<Record<string, string>>({});

  const [editExamState, setEditExamState] = useState({
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

  const [newExamMode, setNewExamMode] = useState<'global' | 'specific'>('global');
  const [editExamMode, setEditExamMode] = useState<'global' | 'specific'>('global');

  // Delete Confirmation States
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [examToDelete, setExamToDelete] = useState<Exam | null>(null);
  const [isDeletingExam, setIsDeletingExam] = useState(false);
  const [previewExam, setPreviewExam] = useState<Exam | null>(null);

  const startEditExam = (exam: Exam) => {
    setEditingExam(exam);
    setEditExamState({
      title: exam.title || '',
      description: exam.description || '',
      subject: exam.subject || 'Computer Science',
      difficulty: exam.difficulty || 'Medium',
      duration: exam.duration || 30,
      totalMarks: exam.totalMarks || 100,
      startTime: exam.startTime || '',
      endTime: exam.endTime || '',
      assignedSchoolIds: exam.assignedSchoolIds || []
    });
    setEditExamMode(exam.assignedSchoolIds && exam.assignedSchoolIds.length > 0 ? 'specific' : 'global');
    setIsEditOpen(true);
  };

  // Real-time link mappings for schools
  useEffect(() => {
    if (profile?.role !== 'school' || !profile?.schoolId) return;
    
    const q = query(
      collection(db, 'secure_exam_links'),
      where('schoolId', '==', profile.schoolId)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const linksMap: Record<string, string> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        linksMap[data.examId] = data.id; // examId -> secure token id value
      });
      setSchoolLinks(linksMap);
    }, (error) => {
      console.error("Failed to sync secure exam links for school:", error);
    });
    
    return () => unsubscribe();
  }, [profile]);
  
  const [newExam, setNewExam] = useState({
    title: '',
    description: '',
    subject: 'Computer Science',
    difficulty: 'Medium' as const,
    duration: 30,
    totalMarks: 100,
    startTime: '',
    endTime: '',
    assignedSchoolIds: [] as string[]
  });

  const filteredExams = useMemo(() => {
    let list = exams.filter(e => 
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      e.subject.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (activeTab !== 'all') {
      list = list.filter(e => getExamVisualState(e) === activeTab);
    }

    return list;
  }, [exams, searchQuery, activeTab]);

  const stats = useMemo(() => {
    let total = exams.length;
    let ongoing = 0;
    let upcoming = 0;
    let completed = 0;

    exams.forEach(exam => {
      const state = getExamVisualState(exam);
      if (state === 'ongoing') ongoing++;
      else if (state === 'upcoming') upcoming++;
      else if (state === 'completed') completed++;
    });

    return { total, ongoing, upcoming, completed };
  }, [exams]);

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const snap = await getDocs(collection(db, 'schools'));
        setSchools(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        console.error("Failed to load schools for exam allocator:", err);
      }
    };
    if (profile) {
      fetchSchools();
    }
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    
    setLoading(true);
    setError(null);
    const examsRef = collection(db, 'exams');
    const q = query(
      examsRef, 
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      try {
        const fetchedExams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam));
        
        // In-memory filter avoiding composite query index errors on Firestore.
        // Admins see all; Schools see their drafts or any published exams.
        const permittedExams = profile.role === 'admin'
          ? fetchedExams
          : fetchedExams.filter(e => {
              const isCreator = e.creatorId === profile.uid;
              const isPublished = e.status === 'published';
              const isAssigned = !e.assignedSchoolIds || e.assignedSchoolIds.length === 0 || e.assignedSchoolIds.includes(profile.schoolId);
              return isCreator || (isPublished && isAssigned);
            });

        setExams(permittedExams);
        setLoading(false);
      } catch (err: any) {
        console.error("Failed to map exams: ", err);
        setError(err.message || "Failed to organize exam registry.");
        setLoading(false);
      }
    }, (err) => {
      setLoading(false);
      setError(err.message || "Security permission denied or cloud connection broken.");
      handleFirestoreError(err, OperationType.LIST, 'exams');
    });

    return () => unsubscribe();
  }, [profile, retryTrigger]);

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
        toast.error("Validation failed: Please provide manual instructions for the student guidelines");
        return false;
      }
    }
    if (currentStep === 2) {
      if (!newExam.totalMarks || newExam.totalMarks <= 0) {
        toast.error("Validation failed: Total marks must be a positive number greater than 0");
        return false;
      }
      if (!newExam.duration || newExam.duration <= 0) {
        toast.error("Validation failed: Duration must be a positive integer (at least 1 minute)");
        return false;
      }
      if (!newExam.difficulty) {
        toast.error("Validation failed: Please select a difficulty heuristic");
        return false;
      }
    }
    if (currentStep === 3) {
      if (!newExam.startTime) {
        toast.error("Validation failed: Please select a valid Start Date and Time (From Date)");
        return false;
      }
      if (!newExam.endTime) {
        toast.error("Validation failed: Please select a valid End Date and Time (To Date)");
        return false;
      }
      const start = new Date(newExam.startTime).getTime();
      const end = new Date(newExam.endTime).getTime();
      if (isNaN(start) || isNaN(end)) {
        toast.error("Validation failed: Please ensure you have selected valid dates/times for both Start and End");
        return false;
      }
      if (end <= start) {
        toast.error("Validation failed: The ending date/time bounds must be set after the starter start date/time");
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

      toast.success("Exam created successfully");
      setIsCreateOpen(false);
      setNewExamMode('global');
      setNewExam({
        title: '',
        description: '',
        subject: 'Computer Science',
        difficulty: 'Medium',
        duration: 30,
        totalMarks: 100,
        startTime: '',
        endTime: '',
        assignedSchoolIds: []
      });
    } catch (error) {
      toast.error("Failed to create exam");
      console.error(error);
    }
  };

  const triggerDeleteExam = (exam: Exam) => {
    setExamToDelete(exam);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteExam = async () => {
    if (!examToDelete) return;
    setIsDeletingExam(true);
    try {
      const response = await fetch(`/api/exams/${examToDelete.id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to delete exam via API');
      }
      toast.success(`Exam "${examToDelete.title}" and all associated questions deleted successfully`);
      setIsDeleteConfirmOpen(false);
      setExamToDelete(null);
    } catch (error: any) {
      toast.error("Failed to delete exam: " + error.message);
    } finally {
      setIsDeletingExam(false);
    }
  };

  const handleUpdateExam = async () => {
    if (!editingExam) return;
    if (!editExamState.title) {
        toast.error("Validation failed: Please provide an exam academic title");
        return;
    }
    if (!editExamState.description) {
        toast.error("Validation failed: Please provide a description for the student guidelines");
        return;
    }
    if (!editExamState.duration || editExamState.duration <= 0) {
        toast.error("Validation failed: Duration must be a positive integer (at least 1 minute)");
        return;
    }
    if (!editExamState.totalMarks || editExamState.totalMarks <= 0) {
        toast.error("Validation failed: Total marks must be a positive number greater than 0");
        return;
    }
    if (editExamState.startTime && editExamState.endTime) {
        const start = new Date(editExamState.startTime).getTime();
        const end = new Date(editExamState.endTime).getTime();
        if (end <= start) {
            toast.error("Validation failed: The ending date/time bounds must be set after the starter start date/time");
            return;
        }
    }

    const finalAssignedSchoolIds = editExamMode === 'global' ? [] : editExamState.assignedSchoolIds;
    if (editExamMode === 'specific' && finalAssignedSchoolIds.length === 0) {
        toast.error("Validation failed: Please select at least one school for the specific school cluster allocation, or choose Global.");
        return;
    }

    const toastId = toast.loading("Updating exam parameters directly on secure endpoints...");

    try {
      const examId = editingExam.id;
      const examRef = doc(db, 'exams', examId);
      
      const updateData: any = {
        title: editExamState.title,
        description: editExamState.description,
        subject: editExamState.subject,
        difficulty: editExamState.difficulty,
        duration: Number(editExamState.duration) || 30,
        totalMarks: Number(editExamState.totalMarks) || 100,
        startTime: editExamState.startTime || null,
        endTime: editExamState.endTime || null,
        assignedSchoolIds: finalAssignedSchoolIds
      };

      // Update the exam paper parameters directly
      await updateDoc(examRef, updateData);

      // Provision secure exam links if exam is published
      if (editingExam.status === 'published') {
        let schoolsToProvision = finalAssignedSchoolIds || [];

        if (schoolsToProvision.length === 0) {
          const schoolsSnap = await getDocs(collection(db, 'schools'));
          schoolsToProvision = schoolsSnap.docs.map(d => d.id);
        }

        const expiresAt = editExamState.endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        for (const sId of schoolsToProvision) {
          const tokenDocId = `gen_${sId}_${examId}`;
          const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
          const tokenSnap = await getDoc(tokenRef);
          
          if (tokenSnap.exists()) {
            await updateDoc(tokenRef, {
              isActive: true,
              expiresAt
            });
          } else {
            // Generate a cryptographically strong unique secure token segment
            const uuidToken = `tkn_${crypto.randomUUID().replace(/-/g, "")}`;

            await setDoc(tokenRef, {
              id: uuidToken,
              examId,
              schoolId: sId,
              isActive: true,
              expiresAt,
              createdAt: new Date().toISOString()
            });
          }
        }

        // Deactivate tokens for schools that are no longer assigned
        const allSchoolsSnap = await getDocs(collection(db, 'schools'));
        const allSchoolIds = allSchoolsSnap.docs.map(d => d.id);
        const unassignedSchoolIds = allSchoolIds.filter(sId => !schoolsToProvision.includes(sId));

        for (const sId of unassignedSchoolIds) {
          const tokenDocId = `gen_${sId}_${examId}`;
          const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
          const tokenSnap = await getDoc(tokenRef);
          if (tokenSnap.exists()) {
            await updateDoc(tokenRef, {
              isActive: false,
              revokedAt: new Date().toISOString()
            });
          }
        }
      }

      toast.success("Exam paper parameters, date windows, and institute allocation updated successfully!", { id: toastId });
      setIsEditOpen(false);
      setEditingExam(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to update exam", { id: toastId });
      console.error(error);
    }
  };

  const handleToggleStatus = async (exam: Exam) => {
    const nextStatus = exam.status === 'published' ? 'draft' : 'published';
    try {
      const examRef = doc(db, 'exams', exam.id);
      await updateDoc(examRef, { status: nextStatus });
      toast.success(`Exam status updated to ${nextStatus}`);

      if (nextStatus === 'published') {
        let schoolsToProvision = exam.assignedSchoolIds && exam.assignedSchoolIds.length > 0
          ? exam.assignedSchoolIds
          : [];

        if (schoolsToProvision.length === 0) {
          const schoolsSnap = await getDocs(collection(db, 'schools'));
          schoolsToProvision = schoolsSnap.docs.map(d => d.id);
        }

        const expiresAt = exam.endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        for (const sId of schoolsToProvision) {
          const tokenDocId = `gen_${sId}_${exam.id}`;
          const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
          const tokenSnap = await getDoc(tokenRef);

          if (tokenSnap.exists()) {
            await updateDoc(tokenRef, {
              isActive: true,
              expiresAt: expiresAt
            });
          } else {
            // Generate a cryptographically strong unique secure token segment
            const uuidToken = `tkn_${crypto.randomUUID().replace(/-/g, "")}`;

            await setDoc(tokenRef, {
              id: uuidToken,
              examId: exam.id,
              schoolId: sId,
              isActive: true,
              expiresAt: expiresAt,
              createdAt: new Date().toISOString()
            });
          }
        }

        toast.success(`Generated cryptographically locked dynamic links for ${schoolsToProvision.length} schools.`);
      } else {
        // Deactivate all tokens for this exam when changing back to draft (unpublished)
        const schoolsSnap = await getDocs(collection(db, 'schools'));
        const allSchoolIds = schoolsSnap.docs.map(d => d.id);

        for (const sId of allSchoolIds) {
          const tokenDocId = `gen_${sId}_${exam.id}`;
          const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
          const tokenSnap = await getDoc(tokenRef);
          if (tokenSnap.exists()) {
            await updateDoc(tokenRef, {
              isActive: false,
              revokedAt: new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      toast.error("Failed to update status");
      console.error(error);
    }
  };

  const canManage = profile?.role === 'admin';
  const canViewResults = profile?.permissions?.includes('view_results') || profile?.role === 'school';

  return (
    <DataLoader
      isLoading={loading}
      error={error}
      onRetry={handleRetry}
      loadingMessage="Loading Exam Registers..."
    >
      <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-slate-900 tracking-tight">Exams Manager</h2>
          <p className="text-sm text-slate-500 mt-1">Schedule, monitor, and manage all examination sessions.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative w-full sm:w-64 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
            <Input 
              placeholder="Filter by subject or title..." 
              className="pl-10 bg-white border-slate-200 h-10 text-sm rounded-xl shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {canManage && (
            <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if(!open) setStep(1); }}>
              <DialogTrigger 
                render={
                  <Button className="bg-slate-900 hover:bg-black text-white shadow-md transition-all font-bold text-[11px] uppercase tracking-widest h-10 px-6 rounded-xl">
                    <Plus className="h-4 w-4 mr-2" /> CREATE EXAM
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-[850px] p-0 overflow-hidden rounded-[40px] border-0 shadow-2xl">
                <div className="flex flex-col md:flex-row h-full min-h-[500px]">
                  {/* Sidebar Stepper */}
                  <div className="md:w-64 bg-slate-900 p-8 text-white flex flex-col justify-between">
                     <div>
                        <div className="flex items-center gap-2 mb-10">
                           <div className="h-8 w-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                              <FileText size={16} />
                           </div>
                           <span className="font-black text-xs uppercase tracking-widest">Portal Wizard</span>
                        </div>
                        <div className="space-y-8">
                           {[
                              { id: 1, label: 'Definitions', desc: 'Core Metadata' },
                              { id: 2, label: 'Parameters', desc: 'Marks & Duration' },
                              { id: 3, label: 'Access Control', desc: 'Access Windows' },
                              { id: 4, label: 'Finalize', desc: 'Publish Question Paper' }
                           ].map((s) => (
                              <div key={s.id} className="flex items-center gap-4 group cursor-default">
                                 <div className={`h-8 w-8 rounded-full border-2 flex items-center justify-center text-[10px] font-black transition-all ${step >= s.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-700 text-slate-500'}`}>
                                    {step > s.id ? <CheckCircle2 size={14} /> : s.id}
                                 </div>
                                 <div className="hidden md:block">
                                    <p className={`text-[10px] font-black uppercase tracking-widest leading-none ${step === s.id ? 'text-white' : 'text-slate-500'}`}>{s.label}</p>
                                    <p className="text-[9px] font-bold text-slate-600 mt-1">{s.desc}</p>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                     <div className="hidden md:block bg-slate-800/50 p-4 rounded-2xl border border-white/5">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Pro-Tip</p>
                        <p className="text-[10px] text-slate-300 leading-relaxed font-medium">Use AI to import questions directly once the portal is initialized.</p>
                     </div>
                  </div>

                  {/* Content Area */}
                  <div className="flex-grow p-10 bg-white min-h-[500px] flex flex-col">
                     <div className="flex-grow">
                        <AnimatePresence mode="wait">
                           {step === 1 && (
                             <motion.div 
                               key="step1"
                               initial={{ opacity: 0, x: 20 }}
                               animate={{ opacity: 1, x: 0 }}
                               exit={{ opacity: 0, x: -20 }}
                               className="space-y-8"
                             >
                               <div>
                                 <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Assessment Definitions</h3>
                                 <p className="text-sm font-medium text-slate-400">Establish the identity of this assessment portal.</p>
                               </div>
                               <div className="space-y-6">
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Exam Title</Label>
                                   <Input value={newExam.title} onChange={e => setNewExam({...newExam, title: e.target.value})} placeholder="e.g. JEE Advanced Mock - Wave Optics" className="h-14 rounded-2xl bg-slate-50 border-0 focus-visible:ring-indigo-600" />
                                 </div>
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subject Category</Label>
                                   <Select value={newExam.subject} onValueChange={(val) => setNewExam({...newExam, subject: val})}>
                                     <SelectTrigger className="h-14 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 font-bold px-4 justify-between focus:border-indigo-650 focus:ring-4 focus:ring-indigo-500/10 hover:border-indigo-500 transition-all">
                                       <SelectValue placeholder="Select Subject" />
                                     </SelectTrigger>
                                     <SelectContent className="bg-white border-2 border-slate-300 shadow-2xl rounded-2xl p-1.5 z-50">
                                       {SUBJECTS.map(s => (
                                         <SelectItem key={s} value={s} className="font-bold text-xs text-slate-800 hover:bg-slate-50 cursor-pointer py-1.5 px-3 rounded-lg">{s}</SelectItem>
                                       ))}
                                     </SelectContent>
                                   </Select>
                                 </div>
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Manual Instructions</Label>
                                   <Textarea value={newExam.description} onChange={e => setNewExam({...newExam, description: e.target.value})} className="rounded-2xl bg-slate-50 border-0 min-h-[120px] resize-none" placeholder="Provide syllabus coverage and instructions..." />
                                 </div>
                               </div>
                             </motion.div>
                           )}

                           {step === 2 && (
                             <motion.div 
                               key="step2"
                               initial={{ opacity: 0, x: 20 }}
                               animate={{ opacity: 1, x: 0 }}
                               exit={{ opacity: 0, x: -20 }}
                               className="space-y-8"
                             >
                               <div>
                                 <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Quantifiable Rules</h3>
                                 <p className="text-sm font-medium text-slate-400">Set the operational metrics for this session.</p>
                               </div>
                               <div className="grid grid-cols-2 gap-6">
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Marks</Label>
                                   <Input type="number" value={newExam.totalMarks} onChange={e => setNewExam({...newExam, totalMarks: parseInt(e.target.value) || 0})} className="h-14 rounded-2xl bg-slate-50 border-0" />
                                 </div>
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Time Limit (Min)</Label>
                                   <Input type="number" value={newExam.duration} onChange={e => setNewExam({...newExam, duration: parseInt(e.target.value) || 0})} className="h-14 rounded-2xl bg-slate-50 border-0" />
                                 </div>
                               </div>
                               <div className="grid gap-3">
                                 <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Difficulty Heuristic</Label>
                                 <div className="flex gap-3">
                                    {['Easy', 'Medium', 'Hard'].map((d: any) => (
                                       <button 
                                          key={d} 
                                          type="button"
                                          onClick={() => setNewExam({...newExam, difficulty: d})}
                                          className={`flex-1 h-14 rounded-2xl font-black text-[11px] uppercase tracking-widest border-2 transition-all ${newExam.difficulty === d ? 'border-indigo-600 bg-indigo-50 text-indigo-600 shadow-lg shadow-indigo-100' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
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
                               initial={{ opacity: 0, x: 20 }}
                               animate={{ opacity: 1, x: 0 }}
                               exit={{ opacity: 0, x: -20 }}
                               className="space-y-8"
                             >
                               <div>
                                 <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Access Protocol</h3>
                                 <p className="text-sm font-medium text-slate-400">Define the valid temporal window for student access.</p>
                               </div>
                               <div className="space-y-6">
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Release Window (Start)</Label>
                                   <Input type="datetime-local" value={newExam.startTime} onChange={e => setNewExam({...newExam, startTime: e.target.value})} className="h-14 rounded-2xl bg-slate-50 border-0" />
                                 </div>
                                 <div className="grid gap-3">
                                   <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Lock Window (End)</Label>
                                   <Input type="datetime-local" value={newExam.endTime} onChange={e => setNewExam({...newExam, endTime: e.target.value})} className="h-14 rounded-2xl bg-slate-50 border-0" />
                                  </div>

                                  {/* Institution Allocation Targeter */}
                                  <div className="pt-4 border-t border-slate-100 space-y-4">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Institution Allocation Targets</Label>
                                    <div className="flex gap-2">
                                      <Button
                                        type="button"
                                        variant={newExamMode === "global" ? "default" : "outline"}
                                        onClick={() => setNewExamMode("global")}
                                        className={`text-[10.5px] font-black uppercase tracking-wider rounded-xl py-2 px-3 h-9 ${newExamMode === "global" ? 'bg-indigo-650 text-white hover:bg-slate-950' : 'bg-transparent text-slate-800 border'}`}
                                      >
                                        Global (All Schools)
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
                                        className={`text-[10.5px] font-black uppercase tracking-wider rounded-xl py-2 px-3 h-9 ${newExamMode === "specific" ? 'bg-indigo-650 text-white hover:bg-slate-950' : 'bg-transparent text-slate-800 border'}`}
                                      >
                                        Specific Schools Cluster
                                      </Button>
                                    </div>

                                    {newExamMode === "specific" && schools.length > 0 && (
                                      <div className="p-4 bg-slate-50 rounded-[20px] max-h-[150px] overflow-y-auto space-y-2 border border-slate-200/50">
                                        {schools.map((school) => {
                                          const checked = newExam.assignedSchoolIds.includes(school.id);
                                          return (
                                            <label key={school.id} className="flex items-center gap-3 cursor-pointer p-1.5 hover:bg-slate-100/50 rounded-lg">
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
                                              <span className="text-xs font-bold text-slate-700">{school.name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                 </div>
                                 <div className="bg-emerald-50 p-5 rounded-[24px] border border-emerald-100 flex items-center gap-5">
                                    <div className="h-10 w-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shrink-0">
                                       <ShieldCheck size={20} />
                                    </div>
                                    <p className="text-[11px] font-bold text-emerald-700 leading-relaxed uppercase tracking-tight">Automated access control will prevent students from starting or viewing content after the lock window expires.</p>
                                 </div>
                               </div>
                             </motion.div>
                           )}

                           {step === 4 && (
                             <motion.div 
                               key="step4"
                               initial={{ opacity: 0, x: 20 }}
                               animate={{ opacity: 1, x: 0 }}
                               exit={{ opacity: 0, x: -20 }}
                               className="space-y-8 text-center py-6"
                             >
                               <div className="h-24 w-24 bg-indigo-600 rounded-[32px] flex items-center justify-center text-white mx-auto shadow-2xl shadow-indigo-200">
                                  <Zap size={48} className="fill-white" />
                               </div>
                               <div>
                                 <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Publish Question Paper?</h3>
                                 <p className="text-sm font-medium text-slate-400 mt-2">Final validation required before deployment to the registry.</p>
                               </div>
                               <div className="bg-slate-50 p-6 rounded-[32px] text-left border border-slate-100 max-h-[320px] overflow-y-auto space-y-4">
                                   <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest border-b pb-2 mb-2">Summary Verification Checklist</p>
                                   <div className="space-y-3">
                                      <div className="flex flex-col gap-1 text-xs">
                                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Exam Title</span>
                                         <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">{newExam.title || "—"}</span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                         <div className="flex flex-col gap-1 text-xs">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Subject</span>
                                            <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">{newExam.subject}</span>
                                         </div>
                                         <div className="flex flex-col gap-1 text-xs">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Difficulty</span>
                                            <span className="text-indigo-600 font-black bg-white p-2 rounded-lg border border-slate-100 uppercase">{newExam.difficulty}</span>
                                         </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                         <div className="flex flex-col gap-1 text-xs">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Marks</span>
                                            <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">{newExam.totalMarks} Marks</span>
                                         </div>
                                         <div className="flex flex-col gap-1 text-xs">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Run-Time</span>
                                            <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">{newExam.duration} Minutes</span>
                                         </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-4">
                                         <div className="flex flex-col gap-1 text-xs">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">From (Start Date/Time)</span>
                                            <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">{newExam.startTime ? new Date(newExam.startTime).toLocaleString() : "Not Set"}</span>
                                         </div>
                                         <div className="flex flex-col gap-1 text-xs">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">To (End Date/Time)</span>
                                            <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">{newExam.endTime ? new Date(newExam.endTime).toLocaleString() : "Not Set"}</span>
                                         </div>
                                      </div>
                                      <div className="flex flex-col gap-1 text-xs">
                                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Institutional Allocation Scope</span>
                                         <span className="text-slate-900 font-bold bg-white p-2 rounded-lg border border-slate-100">
                                            {newExamMode === 'global' ? (
                                              <span className="text-emerald-600 font-bold">Global (All Registered Schools)</span>
                                            ) : (
                                              <span className="text-indigo-600 font-bold">
                                                Specific Schools Scope: {newExam.assignedSchoolIds.map(id => schools.find(s => s.id === id)?.name || id).join(', ') || 'No schools selected!'}
                                              </span>
                                            )}
                                         </span>
                                      </div>
                                      <div className="flex flex-col gap-1 text-xs">
                                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Guidelines & Instructions</span>
                                         <span className="text-slate-600 font-medium bg-white p-2 rounded-lg border border-slate-100 block max-h-[80px] overflow-y-auto whitespace-pre-wrap">{newExam.description || "—"}</span>
                                      </div>
                                   </div>
                                </div>
                              
                              </motion.div>
                           )}
                        </AnimatePresence>
                     </div>

                     <div className="mt-8 flex gap-4">
                        {step > 1 && (
                           <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1 h-14 rounded-2xl border-slate-100 font-black text-[11px] uppercase tracking-widest text-slate-500">Previous</Button>
                        )}
                        {step < 4 ? (
                           <Button onClick={() => { if (canAdvanceStep(step)) setStep(step + 1); }} className="flex-[2] bg-indigo-600 text-white h-14 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">Continue Phase</Button>
                        ) : (
                           <Button onClick={handleCreateExam} className="flex-[2] bg-slate-900 text-white h-14 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl shadow-slate-200 hover:bg-black transition-all">Publish Question Paper</Button>
                        )}
                     </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Stats KPI Cards matching the design */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'TOTAL', value: stats.total },
          { label: 'ONGOING', value: stats.ongoing },
          { label: 'UPCOMING', value: stats.upcoming },
          { label: 'COMPLETED', value: stats.completed },
        ].map((item, i) => (
          <div key={i} className="border border-slate-100 bg-white rounded-2xl p-6 flex flex-col justify-between h-28 shadow-sm">
            <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase">{item.label}</span>
            <span className="text-4xl font-bold text-slate-900 mt-2">{item.value}</span>
          </div>
        ))}
      </div>

      {/* Custom Tabs Bar for quick visual states filtration */}
      <div className="flex gap-2 p-1 bg-slate-100 border border-slate-100 rounded-xl w-fit">
        {([
          { key: 'all', label: 'All' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'ongoing', label: 'Ongoing' },
          { key: 'completed', label: 'Completed' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setPage(1);
            }}
            className={`px-5 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === tab.key
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-950 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredExams.slice((page - 1) * pageSize, page * pageSize).map(exam => {
            const visualState = getExamVisualState(exam);
            const examCode = `EX-${exam.id.slice(0, 4).toUpperCase()}`;
            const location = getExamLocation(exam.subject);
            
            // Formatting Date & Time
            let dateStr = '—';
            let timeStr = '—';
            if (exam.startTime) {
              const d = new Date(exam.startTime);
              if (!isNaN(d.getTime())) {
                dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              }
            }
            
            // Formatting duration
            const durationStr = exam.duration >= 60 
              ? `${Math.floor(exam.duration / 60)}h${exam.duration % 60 > 0 ? ` ${exam.duration % 60}m` : ''}` 
              : `${exam.duration}m`;

            // Calculate progress for Ongoing exam
            let progressPercent = 0;
            if (exam.startTime && exam.endTime) {
              const start = new Date(exam.startTime).getTime();
              const end = new Date(exam.endTime).getTime();
              const now = new Date().getTime();
              progressPercent = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
            }

            return (
              <Card key={exam.id} className="relative overflow-hidden group border border-slate-100 bg-white rounded-[20px] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[220px]">
                {/* Top Row: Code & Badge */}
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-xs text-slate-400 font-bold">{examCode}</span>
                  <div className="flex items-center gap-2">
                    {/* Status Badge */}
                    {visualState === 'upcoming' && (
                      <span className="bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                        Upcoming
                      </span>
                    )}
                    {visualState === 'ongoing' && (
                      <span className="bg-green-50 text-green-600 border border-green-100 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                        Ongoing
                      </span>
                    )}
                    {visualState === 'completed' && (
                      <span className="bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                        Completed
                      </span>
                    )}
                  </div>
                </div>

                {/* Title & Stats */}
                <div className="flex-grow">
                  <div className="flex items-start justify-between gap-4 mt-2">
                    <div>
                      <h3 className="font-display font-bold text-xl text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                        {exam.title}
                      </h3>
                      <p className="text-xs font-semibold text-slate-400 mt-1">
                        Class XII · {exam.totalMarks > 100 ? 72 : 68} students
                      </p>
                    </div>

                    {/* Admin/Manage Hover Controls */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                      {canManage && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className={`h-8 w-8 transition-all rounded-full ${exam.status === 'published' ? 'text-green-600 hover:text-green-700 hover:bg-green-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`} 
                          onClick={() => handleToggleStatus(exam)}
                          title={exam.status === 'published' ? 'Unpublish' : 'Publish'}
                        >
                          {exam.status === 'published' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 h-8 w-8 rounded-full transition-colors" onClick={() => setPreviewExam(exam)} title="Preview Assessment">
                          <ClipboardList className="h-4 w-4" />
                        </Button>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 h-8 w-8 rounded-full transition-colors" onClick={() => startEditExam(exam)} title="Edit parameters & dates">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="icon" className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-8 w-8 rounded-full transition-colors" onClick={() => triggerDeleteExam(exam)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <p className="whitespace-pre-wrap text-slate-500 text-xs leading-relaxed mt-3 line-clamp-2">
                    {exam.description || 'Comprehensive assessment criteria and instructions for students.'}
                  </p>

                  {/* Ongoing Indicator & Progress Bar */}
                  {visualState === 'ongoing' && (
                    <div className="mt-4 space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] font-black tracking-wider text-green-600 uppercase">
                        <span className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> IN PROGRESS
                        </span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="bg-green-500 h-full rounded-full transition-all duration-1000" 
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Metadata & Actions */}
                <div className="mt-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                      {dateStr}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                      {timeStr}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                      {durationStr}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <School className="h-4 w-4 text-slate-400 shrink-0" />
                      {location}
                    </span>
                  </div>

                  {/* School Secure Portal Link */}
                  {profile?.role === 'school' && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-650 flex items-center gap-1">
                          <ShieldCheck className="h-4 w-4 text-indigo-500" /> Secure Portal Link
                        </span>
                        {schoolLinks[exam.id] ? (
                          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[8px] font-bold uppercase py-0.5 px-2 rounded-full">
                            Sealed & Active
                          </div>
                        ) : (
                          <div className="bg-amber-50 text-amber-700 border border-amber-200 text-[8px] font-bold uppercase py-0.5 px-2 rounded-full animate-pulse">
                            Pending Seal
                          </div>
                        )}
                      </div>
                      
                      {schoolLinks[exam.id] ? (
                        <div className="flex gap-2 items-center">
                          <Input 
                            readOnly 
                            value={`${window.location.origin}/portal/school/${profile.schoolId}/exam/${exam.id}/${schoolLinks[exam.id]}`}
                            className="bg-slate-50 border-slate-200 h-9 text-[10px] font-mono text-slate-500 select-all rounded-lg flex-1 cursor-default"
                          />
                          <Button 
                            className="h-9 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] uppercase tracking-wider rounded-lg shrink-0"
                            onClick={() => {
                              const secureUrl = `${window.location.origin}/portal/school/${profile.schoolId}/exam/${exam.id}/${schoolLinks[exam.id]}`;
                              navigator.clipboard.writeText(secureUrl);
                              toast.success("Secure link copied to Clipboard!");
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                      ) : (
                        <div className="p-2 w-full rounded-lg bg-amber-50 border border-amber-100 text-[10px] font-semibold text-amber-700 leading-normal">
                          Waiting for secure token signature. Contact admin to re-publish if this persists.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer Action Buttons */}
                  <div className="mt-4 pt-4 border-t border-slate-100 flex gap-2">
                    {canManage && (
                      <Button className="flex-1 h-9 text-[10px] font-black uppercase tracking-wider rounded-xl border-slate-200 bg-white hover:bg-slate-50 transition-all" variant="outline" onClick={() => navigate(`/admin/exam/${exam.id}`)}>
                        <Plus className="h-3 w-3 mr-1 text-indigo-550" /> Build
                      </Button>
                    )}
                    {canManage && (
                      <Button className="flex-1 h-9 text-[10px] font-black uppercase tracking-wider rounded-xl border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/60 text-indigo-705 transition-all" variant="outline" onClick={() => setSelectedDispatchExam(exam)}>
                        <Send className="h-3 w-3 mr-1 text-indigo-600" /> Dispatch
                      </Button>
                    )}
                    {canViewResults && (
                      <Button className="flex-1 h-9 text-[10px] font-black uppercase tracking-wider rounded-xl border-slate-200 bg-white hover:bg-slate-50 transition-all" variant="outline" onClick={() => navigate(`/admin/results/${exam.id}`)}>
                        <ClipboardList className="h-3 w-3 mr-1 text-slate-500" /> Reports
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          
          {exams.length === 0 && (
            <div className="col-span-full py-32 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white shadow-inner animate-in fade-in">
               <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                 <ShieldCheck className="h-8 w-8 text-slate-300" />
               </div>
               <h3 className="text-xl font-bold text-slate-900">Admin Control Center</h3>
               <p className="text-slate-500 mb-8 max-w-sm mx-auto">Welcome to the System Administration portal. Start by creating an examination or managing institutional branches.</p>
               <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button className="bg-indigo-600 hover:bg-indigo-700 shadow-lg px-8" onClick={() => setIsCreateOpen(true)}>Create First Exam</Button>
                  {profile?.role === 'admin' && (
                    <Button variant="outline" className="border-slate-200 bg-white shadow-sm px-8" onClick={() => navigate('/admin/schools')}>Manage Institutions</Button>
                  )}
               </div>
            </div>
          )}
        </div>

        {/* Global Pagination Controls for Exam Registry */}
        {filteredExams.length > 0 && (
          <div className="p-6 border border-slate-200 rounded-[24px] flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Items per page:</span>
              <select 
                value={pageSize} 
                onChange={e => {
                  setPageSize(parseInt(e.target.value));
                  setPage(1);
                }}
                className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                {[3, 6, 12, 24].map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
              <span className="text-xs font-medium text-slate-400 ml-4">
                Showing {Math.min(filteredExams.length, (page - 1) * pageSize + 1)} - {Math.min(filteredExams.length, page * pageSize)} of {filteredExams.length} Exams
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs"
              >
                Previous
              </Button>
              {Array.from({ length: Math.ceil(filteredExams.length / pageSize) }).map((_, idx) => (
                <Button
                  key={idx}
                  variant={page === idx + 1 ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPage(idx + 1)}
                  className={`h-9 w-9 p-0 rounded-lg text-xs font-bold ${page === idx + 1 ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600'}`}
                >
                  {idx + 1}
                </Button>
              ))}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.min(Math.ceil(filteredExams.length / pageSize), p + 1))}
                disabled={page === Math.ceil(filteredExams.length / pageSize) || filteredExams.length === 0}
                className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectedDispatchExam && (
        <AdminDispatchCenter
          exam={selectedDispatchExam}
          isOpen={!!selectedDispatchExam}
          onClose={() => setSelectedDispatchExam(null)}
        />
      )}

      {isEditOpen && editingExam && (
        <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if (!open) setEditingExam(null); }}>
          <DialogContent className="sm:max-w-[750px] p-0 overflow-hidden rounded-[24px] border border-slate-100 shadow-2xl bg-white">
            <div className="bg-gradient-to-r from-slate-50 via-indigo-50/10 to-slate-50 px-8 py-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <DialogTitle className="font-display font-extrabold text-xl tracking-tight text-slate-900">Edit Assessment Criteria</DialogTitle>
                <DialogDescription className="text-slate-500 text-xs mt-1">Reset timelines, modify parameters, or adjust institutional allocation.</DialogDescription>
              </div>
              <div className="p-3 bg-indigo-50 rounded-xl">
                <Edit3 className="h-5 w-5 text-indigo-600 animate-pulse" />
              </div>
            </div>

            <div className="p-8 max-h-[65vh] overflow-y-auto space-y-6 bg-white">
              <div className="space-y-2">
                <Label htmlFor="edit-title" className="text-xs font-black uppercase tracking-widest text-slate-500">Academic Title</Label>
                <Input 
                  id="edit-title"
                  value={editExamState.title}
                  onChange={(e) => setEditExamState(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Advanced Fluid Dynamics Final"
                  className="h-12 bg-slate-50/30 hover:bg-white focus:bg-white rounded-xl border-slate-200 text-sm transition-all"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-desc" className="text-xs font-black uppercase tracking-widest text-slate-500">Assessment Guidelines</Label>
                <Textarea 
                  id="edit-desc"
                  value={editExamState.description}
                  onChange={(e) => setEditExamState(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Instructions for student execution..."
                  className="min-h-[100px] bg-slate-50/30 hover:bg-white focus:bg-white rounded-xl border-slate-200 text-sm transition-all"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-subject" className="text-xs font-black uppercase tracking-widest text-slate-500">Academic Stream</Label>
                  <Select 
                    value={editExamState.subject} 
                    onValueChange={(val) => setEditExamState(prev => ({ ...prev, subject: val }))}
                  >
                    <SelectTrigger id="edit-subject" className="h-12 bg-slate-50/30 hover:bg-white rounded-xl border-slate-200 text-sm transition-all">
                      <SelectValue placeholder="Select Stream" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map(subj => (
                        <SelectItem key={subj} value={subj}>{subj}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-difficulty" className="text-xs font-black uppercase tracking-widest text-slate-500">Target Difficulty</Label>
                  <Select 
                    value={editExamState.difficulty} 
                    onValueChange={(val: any) => setEditExamState(prev => ({ ...prev, difficulty: val }))}
                  >
                    <SelectTrigger id="edit-difficulty" className="h-12 bg-slate-50/30 hover:bg-white rounded-xl border-slate-200 text-sm transition-all">
                      <SelectValue placeholder="Select Difficulty" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Easy">Easy (Foundation)</SelectItem>
                      <SelectItem value="Medium">Medium (Intermediate)</SelectItem>
                      <SelectItem value="Hard">Hard (Advanced)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-duration" className="text-xs font-black uppercase tracking-widest text-slate-500">Duration (Minutes)</Label>
                  <Input 
                    id="edit-duration"
                    type="number"
                    value={editExamState.duration}
                    onChange={(e) => setEditExamState(prev => ({ ...prev, duration: parseInt(e.target.value) || 0 }))}
                    className="h-12 bg-slate-50/30 hover:bg-white focus:bg-white rounded-xl border-slate-200 text-sm transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-marks" className="text-xs font-black uppercase tracking-widest text-slate-500">Total Marks</Label>
                  <Input 
                    id="edit-marks"
                    type="number"
                    value={editExamState.totalMarks}
                    onChange={(e) => setEditExamState(prev => ({ ...prev, totalMarks: parseInt(e.target.value) || 0 }))}
                    className="h-12 bg-slate-50/30 hover:bg-white focus:bg-white rounded-xl border-slate-200 text-sm transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-start" className="text-xs font-black uppercase tracking-widest text-slate-500">Start Window (Reset)</Label>
                  <Input 
                    id="edit-start"
                    type="datetime-local"
                    value={editExamState.startTime}
                    onChange={(e) => setEditExamState(prev => ({ ...prev, startTime: e.target.value }))}
                    className="h-12 bg-slate-50/30 hover:bg-white focus:bg-white rounded-xl border-slate-200 text-sm text-slate-600 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-end" className="text-xs font-black uppercase tracking-widest text-slate-500">End Window (Reset)</Label>
                  <Input 
                    id="edit-end"
                    type="datetime-local"
                    value={editExamState.endTime}
                    onChange={(e) => setEditExamState(prev => ({ ...prev, endTime: e.target.value }))}
                    className="h-12 bg-slate-50/30 hover:bg-white focus:bg-white rounded-xl border-slate-200 text-sm text-slate-600 transition-all"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div>
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-500">Institutional Cluster Allocations</Label>
                  <p className="text-[11px] text-slate-400">Select schools permitted to dispatch and administer this assessment paper.</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={editExamMode === "global" ? "default" : "outline"}
                    onClick={() => setEditExamMode("global")}
                    className={`text-[10.5px] font-black uppercase tracking-wider rounded-xl py-2 px-3 h-9 ${editExamMode === "global" ? 'bg-indigo-650 text-white hover:bg-slate-950' : 'bg-transparent text-slate-800 border'}`}
                  >
                    Global (All Schools)
                  </Button>
                  <Button
                    type="button"
                    variant={editExamMode === "specific" ? "default" : "outline"}
                    onClick={() => {
                      setEditExamMode("specific");
                      if (editExamState.assignedSchoolIds.length === 0 && schools.length > 0) {
                        setEditExamState(prev => ({ ...prev, assignedSchoolIds: [schools[0].id] }));
                      }
                    }}
                    className={`text-[10.5px] font-black uppercase tracking-wider rounded-xl py-2 px-3 h-9 ${editExamMode === "specific" ? 'bg-indigo-650 text-white hover:bg-slate-950' : 'bg-transparent text-slate-800 border'}`}
                  >
                    Specific Schools Cluster
                  </Button>
                </div>

                {editExamMode === "specific" && schools.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[150px] overflow-y-auto p-1">
                    {schools.map(school => {
                      const isAssigned = editExamState.assignedSchoolIds.includes(school.id);
                      return (
                        <button
                          key={school.id}
                          type="button"
                          onClick={() => {
                            setEditExamState(prev => {
                              const ids = prev.assignedSchoolIds.includes(school.id)
                                ? prev.assignedSchoolIds.filter(id => id !== school.id)
                                : [...prev.assignedSchoolIds, school.id];
                              return { ...prev, assignedSchoolIds: ids };
                            });
                          }}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left text-xs font-semibold ${
                            isAssigned 
                              ? 'bg-indigo-50/70 border-indigo-200 text-indigo-700 shadow-sm shadow-indigo-50' 
                              : 'bg-white border-slate-100 hover:border-slate-200 text-slate-600'
                          }`}
                        >
                          <span className="truncate">{school.name}</span>
                          <div className={`h-4 w-4 rounded-full flex items-center justify-center border transition-all ${
                            isAssigned ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'
                          }`}>
                            {isAssigned && <CheckCircle2 className="h-3 w-3 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="p-6 bg-slate-50/80 border-t border-slate-100 flex gap-4">
              <Button 
                variant="outline" 
                onClick={() => { setIsEditOpen(false); setEditingExam(null); }}
                className="flex-1 h-12 rounded-xl font-bold text-xs text-slate-500 border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-700 transition-all"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleUpdateExam}
                className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white h-12 rounded-xl font-bold text-xs shadow-lg shadow-indigo-100 transition-all"
              >
                Save Changes & Deploy
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Safety confirmation dialog for permanent exam deletion */}
      {/* Preview Exam Dialog */}
      {previewExam && (
        <Dialog open={!!previewExam} onOpenChange={(open) => !open && setPreviewExam(null)}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white border-0 shadow-2xl rounded-2xl">
            <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-display font-black text-slate-900">{previewExam.title}</DialogTitle>
                  <DialogDescription className="text-xs font-semibold text-slate-500">
                    {previewExam.questions?.length || 0} Questions • {previewExam.totalMarks} Marks • {previewExam.duration} Mins
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/30">
              {previewExam.questions && previewExam.questions.length > 0 ? (
                previewExam.questions.map((q, idx) => (
                  <div key={q.id || idx} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="h-8 w-8 shrink-0 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500">
                        {idx + 1}
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <h4 className="text-sm font-semibold text-slate-800 leading-relaxed break-words">{q.text}</h4>
                          <span className="shrink-0 bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider whitespace-nowrap">
                            {q.marks} Marks
                          </span>
                        </div>
                        
                        {q.imageUrl && (
                          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex justify-center max-h-48 relative">
                            <img src={q.imageUrl} alt="Question visual" className="object-contain w-full h-full" loading="lazy" />
                          </div>
                        )}
                        
                        {q.type === 'numerical' ? (
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Correct Value:</span>
                            <span className="text-sm font-bold text-slate-900">{q.numericalAnswer}</span>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {q.options.map((opt, optIdx) => (
                              <div 
                                key={optIdx} 
                                className={`flex items-center gap-3 p-3 rounded-xl border text-sm transition-colors ${
                                  q.correctAnswerIndex === optIdx 
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 font-semibold' 
                                    : 'bg-white border-slate-200 text-slate-600'
                                }`}
                              >
                                <div className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                  q.correctAnswerIndex === optIdx 
                                    ? 'bg-emerald-500 text-white' 
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {String.fromCharCode(65 + optIdx)}
                                </div>
                                <span className="break-words">{opt}</span>
                                {q.correctAnswerIndex === optIdx && (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto shrink-0" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {q.explanation && (
                          <div className="mt-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                            <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">Explanation</h5>
                            <p className="text-xs text-indigo-900/80 leading-relaxed font-medium">{q.explanation}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                    <ClipboardList className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-900">No Questions Found</p>
                  <p className="text-xs text-slate-500 mt-1">This assessment blueprint currently has zero configured questions.</p>
                </div>
              )}
            </div>
            
            <DialogFooter className="p-6 bg-slate-50 border-t border-slate-100">
              <Button onClick={() => setPreviewExam(null)} className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-colors">
                Close Preview
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setExamToDelete(null);
        }}
        onConfirm={handleConfirmDeleteExam}
        title="Permanently Delete Assessment Exam"
        description="Are you absolutely sure you want to delete this exam? This will permanently delete the assessment blueprint, all associated structural questions, and any student upload attachments."
        itemName={examToDelete?.title || ''}
        isLoading={isDeletingExam}
      />
    </div>
    </DataLoader>
  );
};
