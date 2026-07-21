import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { 
  BookOpen, 
  CheckCircle2, 
  Circle, 
  AlertCircle, 
  PlayCircle, 
  Plus, 
  Trash2, 
  Edit, 
  Save, 
  X, 
  Loader2, 
  Calendar,
  Check,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  db, 
  handleFirestoreError, 
  OperationType,
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp, 
  setDoc,
  getDocs
} from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { toast } from 'sonner';
import { DataLoader } from './DataLoader';

interface Topic {
  name: string;
  status: 'completed' | 'in-progress' | 'pending';
  coverage: number;
  testsConducted: number;
}

interface SubjectSyllabus {
  id: string;
  subject: string;
  schoolId: string;
  status: 'On Track' | 'Behind' | 'Critical';
  topics: Topic[];
  createdAt?: any;
}

const SEED_SYLLABUS = [
  {
    subject: 'Mathematics',
    status: 'On Track',
    topics: [
      { name: 'Calculus', status: 'completed', coverage: 100, testsConducted: 4 },
      { name: 'Probability', status: 'in-progress', coverage: 65, testsConducted: 2 },
      { name: 'Matrices', status: 'completed', coverage: 100, testsConducted: 3 },
      { name: 'Vectors', status: 'pending', coverage: 0, testsConducted: 0 }
    ]
  },
  {
    subject: 'Physics',
    status: 'On Track',
    topics: [
      { name: 'Optics', status: 'completed', coverage: 100, testsConducted: 5 },
      { name: 'Thermodynamics', status: 'in-progress', coverage: 40, testsConducted: 1 },
      { name: 'Electromagnetism', status: 'pending', coverage: 0, testsConducted: 0 }
    ]
  }
];

export const SyllabusTracker: React.FC = () => {
  const { profile } = useAuth();
  const [syllabusList, setSyllabusList] = useState<SubjectSyllabus[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const handleRetry = () => setRetryTrigger(prev => prev + 1);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);

  // Management Modal states
  const [isManageOpen, setIsManageOpen] = useState<boolean>(false);
  const [selectedSubject, setSelectedSubject] = useState<SubjectSyllabus | null>(null);
  const [newSubjectName, setNewSubjectName] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // New Topic fields
  const [newTopicName, setNewTopicName] = useState<string>('');
  const [newTopicCoverage, setNewTopicCoverage] = useState<number>(0);
  const [newTopicTests, setNewTopicTests] = useState<number>(0);
  const [newTopicStatus, setNewTopicStatus] = useState<'completed' | 'in-progress' | 'pending'>('pending');

  // Test Scheduler modal states
  const [isScheduleOpen, setIsScheduleOpen] = useState<boolean>(false);
  const [scheduleTopic, setScheduleTopic] = useState<{ topicName: string; subjectName: string } | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleTime, setScheduleTime] = useState<string>('');
  const [scheduleDuration, setScheduleDuration] = useState<number>(60);
  const [isScheduling, setIsScheduling] = useState<boolean>(false);

  // Check if user is authorized to manage syllabus
  const canManage = profile?.role === 'admin' || profile?.role === 'school';
  const userSchoolId = profile?.schoolId || 'global';

  // Load and subscribe to syllabus data
  useEffect(() => {
    setLoading(true);
    setError(null);
    const q = query(collection(db, 'syllabus'), orderBy('subject'));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const fetched = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        } as SubjectSyllabus));

        // Filter by schoolId if applicable
        const schoolFiltered = fetched.filter(item => 
          item.schoolId === userSchoolId || item.schoolId === 'global'
        );

        // If no syllabus exists, seed with defaults to avoid empty state
        if (schoolFiltered.length === 0 && !isSeeding && fetched.length === 0) {
          setIsSeeding(true);
          try {
            for (const item of SEED_SYLLABUS) {
              await addDoc(collection(db, 'syllabus'), {
                ...item,
                schoolId: userSchoolId,
                createdAt: serverTimestamp()
              });
            }
            toast.success("Initialized default academic syllabus tracking.");
          } catch (err: any) {
            console.error("Failed to seed default syllabus:", err);
            toast.error("Failed to seed syllabus blueprint");
          } finally {
            setIsSeeding(false);
          }
        } else {
          setSyllabusList(schoolFiltered);
          setLoading(false);
        }
      } catch (err: any) {
        console.error("Failed to map syllabus documents:", err);
        setError(err.message || "Failed to organize syllabus list.");
        setLoading(false);
      }
    }, (err) => {
      setLoading(false);
      setError(err.message || "Security permission denied or cloud connection broken.");
      handleFirestoreError(err, OperationType.LIST, 'syllabus');
    });

    return () => unsubscribe();
  }, [userSchoolId, retryTrigger]);

  // Handle adding a new subject document
  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;

    setIsSaving(true);
    try {
      const newSub: Omit<SubjectSyllabus, 'id'> = {
        subject: newSubjectName.trim(),
        schoolId: userSchoolId,
        status: 'On Track',
        topics: []
      };
      
      const docRef = await addDoc(collection(db, 'syllabus'), {
        ...newSub,
        createdAt: serverTimestamp()
      });

      setNewSubjectName('');
      setSelectedSubject({ id: docRef.id, ...newSub });
      toast.success(`Successfully created subject node "${newSub.subject}".`);
    } catch (err) {
      console.error("Error creating subject:", err);
      toast.error("Failed to register syllabus subject");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle deleting a subject document
  const handleDeleteSubject = async (id: string, subjectName: string) => {
    if (!confirm(`Are you absolutely sure you want to delete the entire "${subjectName}" syllabus track?`)) return;

    try {
      await deleteDoc(doc(db, 'syllabus', id));
      if (selectedSubject?.id === id) {
        setSelectedSubject(null);
      }
      toast.success(`Deleted subject track "${subjectName}".`);
    } catch (err) {
      console.error("Error deleting subject:", err);
      toast.error("Failed to purge syllabus track");
    }
  };

  // Add topic to the active subject
  const handleAddTopic = async () => {
    if (!selectedSubject) return;
    if (!newTopicName.trim()) {
      toast.warning("Please enter a topic title");
      return;
    }

    const updatedTopics = [
      ...selectedSubject.topics,
      {
        name: newTopicName.trim(),
        status: newTopicStatus,
        coverage: Math.max(0, Math.min(100, newTopicCoverage)),
        testsConducted: Math.max(0, newTopicTests)
      }
    ];

    try {
      await updateDoc(doc(db, 'syllabus', selectedSubject.id), {
        topics: updatedTopics
      });

      setSelectedSubject({
        ...selectedSubject,
        topics: updatedTopics
      });

      // Reset new topic fields
      setNewTopicName('');
      setNewTopicCoverage(0);
      setNewTopicTests(0);
      setNewTopicStatus('pending');
      toast.success("Added new topic to curriculum mapping.");
    } catch (err) {
      console.error("Error updating topics:", err);
      toast.error("Failed to add topic node");
    }
  };

  // Remove topic from subject list
  const handleRemoveTopic = async (topicIndex: number) => {
    if (!selectedSubject) return;

    const updatedTopics = selectedSubject.topics.filter((_, idx) => idx !== topicIndex);

    try {
      await updateDoc(doc(db, 'syllabus', selectedSubject.id), {
        topics: updatedTopics
      });

      setSelectedSubject({
        ...selectedSubject,
        topics: updatedTopics
      });
      toast.success("Topic removed.");
    } catch (err) {
      console.error("Error deleting topic:", err);
      toast.error("Failed to remove topic node");
    }
  };

  // Update specific topic inline in selectedSubject topics list
  const handleUpdateTopicField = async (
    index: number, 
    field: keyof Topic, 
    value: any
  ) => {
    if (!selectedSubject) return;

    const updatedTopics = selectedSubject.topics.map((t, idx) => {
      if (idx === index) {
        let updatedVal = value;
        if (field === 'coverage') {
          updatedVal = Math.max(0, Math.min(100, Number(value)));
        } else if (field === 'testsConducted') {
          updatedVal = Math.max(0, Number(value));
        }
        return { ...t, [field]: updatedVal };
      }
      return t;
    });

    try {
      await updateDoc(doc(db, 'syllabus', selectedSubject.id), {
        topics: updatedTopics
      });

      setSelectedSubject({
        ...selectedSubject,
        topics: updatedTopics
      });
    } catch (err) {
      console.error("Error updating topic field:", err);
      toast.error("Failed to commit topic modification");
    }
  };

  // Change subject overall status
  const handleUpdateSubjectStatus = async (status: 'On Track' | 'Behind' | 'Critical') => {
    if (!selectedSubject) return;

    try {
      await updateDoc(doc(db, 'syllabus', selectedSubject.id), { status });
      setSelectedSubject({ ...selectedSubject, status });
      toast.success(`Updated status to ${status}`);
    } catch (err) {
      console.error("Error updating status:", err);
      toast.error("Failed to commit status change");
    }
  };

  // Schedule Test Handler
  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleDate || !scheduleTime) {
      toast.warning("Please specify both date and time");
      return;
    }

    setIsScheduling(true);
    setTimeout(() => {
      toast.success(`Assessment scheduled for ${scheduleTopic?.topicName} (${scheduleTopic?.subjectName}) on ${scheduleDate} at ${scheduleTime}!`);
      setIsScheduling(false);
      setIsScheduleOpen(false);
      setScheduleTopic(null);
    }, 800);
  };

  // Calculate dynamic syllabus gaps to display
  const detectedGap = React.useMemo(() => {
    for (const sub of syllabusList) {
      const gapTopic = sub.topics.find(t => t.coverage < 100 && t.testsConducted === 0);
      if (gapTopic) {
        return {
          subjectName: sub.subject,
          topicName: gapTopic.name
        };
      }
    }
    return null;
  }, [syllabusList]);

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 font-black text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider mb-2">
            Curriculum Oversight
          </Badge>
          <h2 className="text-4xl font-display font-black text-slate-900 tracking-tight">Syllabus Velocity</h2>
          <p className="text-slate-500 font-medium mt-1">
            Real-time mapping of curriculum coverage against assessment milestones.
          </p>
        </div>

        <Dialog open={isManageOpen} onOpenChange={setIsManageOpen}>
          <DialogTrigger
              render={
                <Button 
                  variant="default" 
                  size="lg"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl px-6 py-5 flex items-center gap-2 shadow-lg shadow-indigo-100 cursor-pointer animate-none"
                  onClick={() => {
                    if (syllabusList.length > 0 && !selectedSubject) {
                      setSelectedSubject(syllabusList[0]);
                    }
                  }}
                >
                  <Edit size={16} />
                  Manage Syllabus
                </Button>
              }
            />
            
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-white p-8 rounded-3xl border-0 shadow-2xl">
              <DialogHeader className="mb-6">
                <DialogTitle className="text-2xl font-black text-slate-950 tracking-tight">
                  Academic Syllabus Architect
                </DialogTitle>
                <p className="text-sm text-slate-400 font-semibold leading-relaxed">
                  Design institutional curriculums and track real-time milestones.
                </p>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Left side: Subjects list */}
                <div className="md:col-span-1 border-r border-slate-100 pr-4 space-y-6">
                  <div>
                    <Label className="text-xs font-black uppercase text-slate-400 tracking-wider">
                      Add New Subject
                    </Label>
                    <form onSubmit={handleAddSubject} className="flex gap-2 mt-2">
                      <Input
                        placeholder="e.g., Chemistry"
                        value={newSubjectName}
                        onChange={e => setNewSubjectName(e.target.value)}
                        className="rounded-xl border-slate-200 text-xs font-bold"
                      />
                      <Button 
                        type="submit" 
                        disabled={isSaving} 
                        size="sm"
                        className="bg-indigo-600 text-white rounded-xl h-8 w-8 p-0"
                      >
                        {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Plus size={16} />}
                      </Button>
                    </form>
                  </div>

                  <div>
                    <Label className="text-xs font-black uppercase text-slate-400 tracking-wider">
                      Active Subjects
                    </Label>
                    <div className="space-y-1 mt-2 max-h-[40vh] overflow-y-auto">
                      {syllabusList.map((sub) => (
                        <div
                          key={sub.id}
                          className={`flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer border ${
                            selectedSubject?.id === sub.id
                              ? 'bg-indigo-50/60 border-indigo-150 text-indigo-900 font-black shadow-sm'
                              : 'border-transparent text-slate-600 hover:bg-slate-50 font-bold'
                          }`}
                          onClick={() => setSelectedSubject(sub)}
                        >
                          <span className="text-xs uppercase tracking-tight truncate">{sub.subject}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge className="text-[9px] font-black scale-90 px-1 py-0 shadow-none bg-slate-100 text-slate-600">
                              {sub.topics.length} topics
                            </Badge>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSubject(sub.id, sub.subject);
                              }}
                              className="text-slate-300 hover:text-red-500 hover:bg-red-50"
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right side: Topic lists and settings */}
                <div className="md:col-span-2 space-y-6">
                  {selectedSubject ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                        <div>
                          <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase">
                            {selectedSubject.subject}
                          </h3>
                          <p className="text-xs text-slate-400 font-bold mt-1">
                            Modify curriculum topics and live parameters
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs font-black text-slate-400 uppercase tracking-wider">
                            Status:
                          </Label>
                          <select
                            value={selectedSubject.status}
                            onChange={e => handleUpdateSubjectStatus(e.target.value as any)}
                            className="bg-slate-50 border border-slate-200 rounded-xl p-1.5 text-xs font-black text-slate-700 outline-none cursor-pointer"
                          >
                            <option value="On Track">On Track</option>
                            <option value="Behind">Behind</option>
                            <option value="Critical">Critical</option>
                          </select>
                        </div>
                      </div>

                      {/* Topic Rows list */}
                      <div className="space-y-4 max-h-[35vh] overflow-y-auto pr-1">
                        <Label className="text-xs font-black uppercase text-slate-400 tracking-wider block mb-2">
                          Curriculum Topics
                        </Label>
                        {selectedSubject.topics.length === 0 ? (
                          <div className="p-8 border border-dashed border-slate-200 rounded-2xl text-center text-slate-400 text-xs font-medium">
                            No topics registered in this subject. Initialize below.
                          </div>
                        ) : (
                          selectedSubject.topics.map((topic, tIdx) => (
                            <div 
                              key={tIdx}
                              className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div className="flex-1 space-y-1 min-w-[150px]">
                                <Input
                                  value={topic.name}
                                  onChange={e => handleUpdateTopicField(tIdx, 'name', e.target.value)}
                                  className="font-bold text-xs bg-white uppercase tracking-tight h-8 border-slate-200"
                                  placeholder="Topic Name"
                                />
                              </div>

                              <div className="flex items-center gap-3 flex-wrap">
                                <div className="w-24">
                                  <Label className="text-[9px] font-black text-slate-400 block mb-0.5">COVERAGE (%)</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={topic.coverage}
                                    onChange={e => handleUpdateTopicField(tIdx, 'coverage', e.target.value)}
                                    className="font-bold text-xs bg-white h-8 border-slate-200"
                                  />
                                </div>

                                <div className="w-20">
                                  <Label className="text-[9px] font-black text-slate-400 block mb-0.5">ASSESSMENTS</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={topic.testsConducted}
                                    onChange={e => handleUpdateTopicField(tIdx, 'testsConducted', e.target.value)}
                                    className="font-bold text-xs bg-white h-8 border-slate-200"
                                  />
                                </div>

                                <div className="w-24">
                                  <Label className="text-[9px] font-black text-slate-400 block mb-0.5">STATUS</Label>
                                  <select
                                    value={topic.status}
                                    onChange={e => handleUpdateTopicField(tIdx, 'status', e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg p-1.5 text-xs font-black text-slate-700 outline-none h-8 w-full"
                                  >
                                    <option value="completed">Completed</option>
                                    <option value="in-progress">In Progress</option>
                                    <option value="pending">Pending</option>
                                  </select>
                                </div>

                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => handleRemoveTopic(tIdx)}
                                  className="text-slate-300 hover:text-red-500 hover:bg-red-50 h-8 w-8 mt-4"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Add topic form nested */}
                      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
                        <Label className="text-xs font-black uppercase text-indigo-700 tracking-wider flex items-center gap-2">
                          <Plus size={14} /> Add Topic Node
                        </Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-slate-400">TOPIC TITLE</Label>
                            <Input
                              placeholder="e.g., Vector Algebra"
                              value={newTopicName}
                              onChange={e => setNewTopicName(e.target.value)}
                              className="rounded-xl border-slate-200 text-xs font-bold bg-white"
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-slate-400">COVER %</Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={newTopicCoverage}
                                onChange={e => setNewTopicCoverage(Number(e.target.value))}
                                className="rounded-xl border-slate-200 text-xs font-bold bg-white"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-slate-400">TESTS</Label>
                              <Input
                                type="number"
                                min="0"
                                value={newTopicTests}
                                onChange={e => setNewTopicTests(Number(e.target.value))}
                                className="rounded-xl border-slate-200 text-xs font-bold bg-white"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-slate-400">STATUS</Label>
                              <select
                                value={newTopicStatus}
                                onChange={e => setNewTopicStatus(e.target.value as any)}
                                className="bg-white border border-slate-200 rounded-xl p-1.5 text-xs font-black text-slate-700 outline-none w-full"
                              >
                                <option value="completed">Completed</option>
                                <option value="in-progress">In Progress</option>
                                <option value="pending">Pending</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <Button 
                          onClick={handleAddTopic}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs px-4 h-9 cursor-pointer w-full flex items-center justify-center gap-1"
                        >
                          <Plus size={14} /> Add Topic to Subject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 text-xs font-medium p-12 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                      Select or create a subject track to initiate tracking edits.
                    </div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
      </header>

      <DataLoader
        isLoading={loading}
        error={error}
        onRetry={handleRetry}
        loadingMessage="Compiling Syllabus Coordinates..."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-none">
          {syllabusList.map((subj, idx) => {
            const progressVal = subj.topics.length > 0 
              ? Math.round(subj.topics.reduce((acc, t) => acc + t.coverage, 0) / subj.topics.length)
              : 0;

            const badgeColor = subj.status === 'On Track' 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
              : subj.status === 'Behind' 
                ? 'bg-amber-50 text-amber-700 border-amber-100'
                : 'bg-rose-50 text-rose-700 border-rose-100';

            return (
              <motion.div
                key={subj.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-white">
                  <CardHeader className="p-10 border-b border-slate-50">
                    <div className="flex items-center justify-between">
                       <div className="flex items-center gap-4">
                          <div className="h-12 w-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                             <BookOpen size={24} />
                          </div>
                          <div>
                             <CardTitle className="text-2xl font-black text-slate-900 tracking-tighter uppercase">
                               {subj.subject}
                             </CardTitle>
                             <CardDescription className="font-bold text-slate-400">
                               Total Progress: {progressVal}%
                             </CardDescription>
                          </div>
                       </div>
                       <div className="text-right">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                          <Badge className={`${badgeColor} border font-black text-[10px] uppercase`}>
                            {subj.status}
                          </Badge>
                       </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-10">
                    <div className="space-y-8">
                      {subj.topics.length === 0 ? (
                        <p className="text-slate-400 text-xs font-medium py-4 text-center border-2 border-dashed border-slate-50 rounded-2xl">
                          No topics added yet.
                        </p>
                      ) : (
                        subj.topics.map((topic) => (
                          <div key={topic.name} className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {topic.status === 'completed' ? (
                                  <CheckCircle2 className="text-emerald-500" size={18} />
                                ) : topic.status === 'in-progress' ? (
                                  <PlayCircle className="text-amber-500 animate-pulse" size={18} />
                                ) : (
                                  <Circle className="text-slate-200" size={18} />
                                )}
                                <span className="text-sm font-black text-slate-800 uppercase tracking-tight">
                                  {topic.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-4">
                                 <div className="text-right">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Tests</p>
                                    <p className="text-xs font-black text-slate-900 mt-1">{topic.testsConducted}</p>
                                 </div>
                                 <div className="text-right min-w-[40px]">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Coverage</p>
                                    <p className="text-xs font-black text-indigo-600 mt-1">{topic.coverage}%</p>
                                 </div>
                              </div>
                            </div>
                            <div className="relative">
                               <Progress value={topic.coverage} className="h-2 bg-slate-100 transition-all rounded-full overflow-hidden" />
                               {topic.coverage < 100 && topic.status === 'in-progress' && (
                                  <div className="absolute -top-1 right-0 translate-x-1/2 h-3 w-3 rounded-full bg-white border-2 border-indigo-600" />
                                )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    
                    <div className="mt-10 p-6 bg-slate-50/60 rounded-[32px] border border-slate-100 flex items-center justify-between gap-4">
                       <div className="flex items-center gap-3">
                          {subj.topics.some(t => t.coverage < 100 && t.testsConducted === 0) ? (
                            <>
                              <AlertCircle className="text-amber-500 shrink-0" size={20} />
                              <p className="text-[11px] font-bold text-slate-600 leading-tight uppercase tracking-tight">
                                Syllabus gap detected in <span className="text-indigo-600 font-extrabold">{subj.topics.find(t => t.coverage < 100 && t.testsConducted === 0)?.name}</span>. No assessments recorded.
                              </p>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="text-emerald-500 shrink-0" size={20} />
                              <p className="text-[11px] font-bold text-slate-600 leading-tight uppercase tracking-tight">
                                Curriculum is fully aligned. Standard operations are active.
                              </p>
                            </>
                          )}
                       </div>
                       <Button 
                         variant="outline"
                         size="sm"
                         onClick={() => {
                           const topicWithGap = subj.topics.find(t => t.coverage < 100 && t.testsConducted === 0) || subj.topics[0];
                           if (topicWithGap) {
                             setScheduleTopic({ topicName: topicWithGap.name, subjectName: subj.subject });
                             setIsScheduleOpen(true);
                           } else {
                             setScheduleTopic({ topicName: 'General Curriculum', subjectName: subj.subject });
                             setIsScheduleOpen(true);
                           }
                         }}
                         className="h-8 text-[10px] font-black text-indigo-600 bg-white border-indigo-200 uppercase tracking-widest hover:bg-indigo-50 shrink-0 cursor-pointer"
                       >
                         Schedule Test
                       </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </DataLoader>

      {/* Dynamic overall gap warning if not triggered on specific card level (or as an overarching dashboard card) */}
      <div className="p-6 bg-slate-950 text-white rounded-[32px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
         <div className="flex items-center gap-3">
            {detectedGap ? (
              <AlertCircle className="text-amber-400 shrink-0 animate-pulse" size={24} />
            ) : (
              <CheckCircle2 className="text-emerald-400 shrink-0" size={24} />
            )}
            <div>
               <p className="text-xs font-black uppercase tracking-wider text-indigo-400">
                 {detectedGap ? 'Curriculum Flag Raised' : 'Institutional Syllabus Confirmed'}
               </p>
               <p className="text-xs text-slate-300 font-semibold mt-1">
                 {detectedGap ? (
                   <>Assessment discrepancy detected in <span className="text-white font-bold">{detectedGap.topicName}</span> ({detectedGap.subjectName}). Launch an active proctored exam to complete coverage parameters.</>
                 ) : (
                   'All monitored curriculum paths are verified. Standard operational guidelines are being actively proctored.'
                 )}
               </p>
            </div>
         </div>
         <Button
           onClick={() => {
             const defaultTopic = detectedGap || (syllabusList[0]?.topics[0] ? { topicName: syllabusList[0].topics[0].name, subjectName: syllabusList[0].subject } : { topicName: 'General Curriculum', subjectName: 'All Subjects' });
             setScheduleTopic({ topicName: defaultTopic.topicName, subjectName: defaultTopic.subjectName });
             setIsScheduleOpen(true);
           }}
           className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl px-4 py-2 flex items-center gap-1.5 shadow-lg shadow-indigo-900 cursor-pointer shrink-0"
         >
           <Calendar size={14} />
           Schedule Now
         </Button>
      </div>

      {/* Test Scheduler Dialog */}
      <Dialog open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
        <DialogContent className="max-w-md bg-white p-8 rounded-3xl border-0 shadow-2xl">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-black text-slate-950 uppercase tracking-tight flex items-center gap-2">
              <Calendar className="text-indigo-600" size={20} /> Schedule Curriculum Test
            </DialogTitle>
            <p className="text-xs text-slate-400 font-bold">
              Dispatch an evaluation module for the specified curriculum node.
            </p>
          </DialogHeader>

          {scheduleTopic && (
            <div className="p-4 bg-indigo-50/60 rounded-2xl border border-indigo-100 text-xs font-black text-indigo-950 uppercase tracking-tight mb-4">
              Topic: {scheduleTopic.topicName} ({scheduleTopic.subjectName})
            </div>
          )}

          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Date</Label>
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="rounded-xl border-slate-200 text-xs font-bold bg-slate-50"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Time</Label>
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  className="rounded-xl border-slate-200 text-xs font-bold bg-slate-50"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Duration (Minutes)</Label>
              <Input
                type="number"
                min="10"
                max="300"
                value={scheduleDuration}
                onChange={e => setScheduleDuration(Number(e.target.value))}
                className="rounded-xl border-slate-200 text-xs font-bold bg-slate-50"
                required
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsScheduleOpen(false)}
                className="flex-1 rounded-xl border-slate-200 font-bold text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isScheduling}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                {isScheduling ? <Loader2 className="animate-spin" size={14} /> : 'Confirm Schedule'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
