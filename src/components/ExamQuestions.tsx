import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType, collection, query, where, getDocs, doc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch } from '../lib/firebase';
import { Question, Exam } from '../types';
import { MathRenderer } from './MathRenderer';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { ArrowLeft, Plus, Save, Trash2, CheckCircle2, Edit3, X, Wand2, Loader2, FileUp, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { FileUpload } from './FileUpload';

export const ExamQuestions: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editedInfo, setEditedInfo] = useState({ title: '', description: '' });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isDocxLoading, setIsDocxLoading] = useState(false);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionPageSize, setQuestionPageSize] = useState(10);
  const [newQuestion, setNewQuestion] = useState<Question>({
    text: '',
    options: ['', '', '', ''],
    correctAnswerIndex: 0,
    marks: 4,
    subject: 'Physics',
    type: 'single',
    numericalAnswer: '',
    explanation: ''
  });

  const [activeInputName, setActiveInputName] = useState<'text' | 'explanation' | 'opt0' | 'opt1' | 'opt2' | 'opt3' | null>(null);
  const [autoConvertKeywords, setAutoConvertKeywords] = useState(false);

  const replaceMathShortcuts = (text: string): string => {
    let res = text;

    // 1. Plain text keywords followed by space are only converted if enabled
    if (autoConvertKeywords) {
      const keywordReplacements: { [key: string]: string } = {
        'pi ': 'π ',
        'theta ': 'θ ',
        'alpha ': 'α ',
        'beta ': 'β ',
        'gamma ': 'γ ',
        'delta ': 'Δ ',
        'sqrt ': '√ ',
        'integral ': '∫ ',
        'sum ': '∑ ',
        'lambda ': 'λ ',
        'phi ': 'φ ',
        'infinity ': '∞ ',
        'approx ': '≈ ',
        'times ': '× ',
        'div ': '÷ ',
        'mu ': 'μ ',
        'omega ': 'ω '
      };
      for (const [key, val] of Object.entries(keywordReplacements)) {
        res = res.split(key).join(val);
      }
    }

    // 2. Standard LaTeX backslash-escaped and symbol formulas are ALWAYS enabled
    const standardReplacements: { [key: string]: string } = {
      '\\pi': 'π',
      '\\theta': 'θ',
      '\\alpha': 'α',
      '\\beta': 'β',
      '\\gamma': 'γ',
      '\\delta': 'Δ',
      '\\sqrt': '√',
      '\\integral': '∫',
      '\\sum': '∑',
      '\\lambda': 'λ',
      '\\phi': 'φ',
      '\\infinity': '∞',
      '\\approx': '≈',
      '\\not=': '≠',
      '\\le': '≤',
      '\\ge': '≥',
      '\\pm': '±',
      '\\times': '×',
      '\\div': '÷',
      '\\mu': 'μ',
      '\\omega': 'ω',
      // Always replace operators which are highly unlikely to conflict with normal words
      'not= ': '≠ ',
      '<= ': '≤ ',
      '>= ': '≥ ',
      '+- ': '± ',
    };

    for (const [key, val] of Object.entries(standardReplacements)) {
      res = res.split(key).join(val);
    }

    // Convert ^ followed by a digit or common power symbol to Unicode superscript
    const superscriptMap: { [key: string]: string } = {
      '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
      '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
      '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
      'n': 'ⁿ', 'x': 'ˣ', 'y': 'ʸ', 'a': 'ᵃ', 'b': 'ᵇ',
      'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'i': 'ⁱ', 'r': 'ʳ',
      's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ'
    };

    const subscriptMap: { [key: string]: string } = {
      '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
      '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
      '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
      'n': 'ₙ', 'x': 'ₓ', 'y': 'ᵧ', 'a': 'ₐ', 'e': 'ₑ',
      'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ',
      'm': 'ₘ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ',
      't': 'ₜ'
    };

    for (const [char, superChar] of Object.entries(superscriptMap)) {
      res = res.split(`^${char}`).join(superChar);
    }

    for (const [char, subChar] of Object.entries(subscriptMap)) {
      res = res.split(`_${char}`).join(subChar);
    }

    return res;
  };

  const handleTextChangeWithShortcuts = (val: string, field: 'text' | 'explanation' | number) => {
    const processed = replaceMathShortcuts(val);
    
    if (field === 'text') {
      setNewQuestion(prev => ({ ...prev, text: processed }));
    } else if (field === 'explanation') {
      setNewQuestion(prev => ({ ...prev, explanation: processed }));
    } else {
      setNewQuestion(prev => {
        const newOpts = [...prev.options];
        newOpts[field] = processed;
        return { ...prev, options: newOpts };
      });
    }
  };

  const insertMathSymbol = (symbol: string) => {
    let toInsert = symbol;
    if (symbol === 'xʸ') toInsert = '^';
    else if (symbol === 'xᵢ') toInsert = '_';

    if (!activeInputName) {
      setNewQuestion(prev => ({
        ...prev,
        text: replaceMathShortcuts(prev.text + toInsert)
      }));
      return;
    }

    if (activeInputName === 'text') {
      setNewQuestion(prev => ({ ...prev, text: replaceMathShortcuts(prev.text + toInsert) }));
    } else if (activeInputName === 'explanation') {
      setNewQuestion(prev => ({ ...prev, explanation: replaceMathShortcuts((prev.explanation || '') + toInsert) }));
    } else {
      const idx = parseInt(activeInputName.replace('opt', ''));
      if (!isNaN(idx) && idx >= 0 && idx < 4) {
        setNewQuestion(prev => {
          const updatedOpts = [...prev.options];
          updatedOpts[idx] = replaceMathShortcuts(updatedOpts[idx] + toInsert);
          return { ...prev, options: updatedOpts };
        });
      }
    }
  };

  const { profile } = useAuth();
  const canManage = profile?.role === 'admin';

  const fetchExamData = async () => {
    if (!examId) return;
    setLoading(true);
    try {
      const examRef = doc(db, 'exams', examId);
      const examSnap = await getDoc(examRef);
      
      if (!examSnap.exists()) {
        toast.error("Exam not found");
        setLoading(false);
        return;
      }
      
      const examData = { id: examSnap.id, ...examSnap.data() } as Exam;
      setExam(examData);
      setEditedInfo({ title: examData.title, description: examData.description });

      const questionsRef = collection(db, 'questions');
      const q = query(questionsRef, where('examId', '==', examId));
      const questionsSnap = await getDocs(q);
      
      const questionsData = questionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
      setQuestions(questionsData);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load exam data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!examId || !canManage) return;
    
    // Subscribe to exam changes
    const examRef = doc(db, 'exams', examId);
    const unsubscribeExam = onSnapshot(examRef, (snapshot) => {
      if (snapshot.exists()) {
        const examData = { id: snapshot.id, ...snapshot.data() } as Exam;
        setExam(examData);
        setEditedInfo({ title: examData.title, description: examData.description });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `exams/${examId}`);
    });

    // Subscribe to questions changes
    const questionsRef = collection(db, 'questions');
    const q = query(questionsRef, where('examId', '==', examId));
    const unsubscribeQuestions = onSnapshot(q, (snapshot) => {
      const questionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
      setQuestions(questionsData);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'questions');
    });

    return () => {
      unsubscribeExam();
      unsubscribeQuestions();
    };
  }, [examId, canManage]);

  const handleAddQuestion = async () => {
    if (!examId || !newQuestion.text) {
      toast.error("Validation failed: Please fill the question text field");
      return;
    }

    const qType = newQuestion.type || 'single';
    if (qType !== 'numerical' && newQuestion.options.some(o => !o || !o.trim())) {
      toast.error("Validation failed: Please fill in all option field slots (A, B, C, D)");
      return;
    }

    if (qType === 'numerical' && (!newQuestion.numericalAnswer || isNaN(Number(newQuestion.numericalAnswer)))) {
      toast.error("Validation failed: Please provide a valid correct numeric answer");
      return;
    }

    if (!newQuestion.marks || Number(newQuestion.marks) <= 0) {
      toast.error("Validation failed: Marks assigned must be a positive number greater than 0");
      return;
    }

    if (qType !== 'numerical') {
      if (newQuestion.correctAnswerIndex < 0 || newQuestion.correctAnswerIndex >= newQuestion.options.length) {
        toast.error("Validation failed: Target correct option choice is outside options array boundary");
        return;
      }
      
      const optionValues = newQuestion.options.map(o => o.trim().toLowerCase());
      const duplicates = optionValues.filter((item, index) => optionValues.indexOf(item) !== index);
      if (duplicates.length > 0) {
        toast.error("Validation failed: Duplicate option fields are not allowed in MCQ choices");
        return;
      }
    }

    try {
      await addDoc(collection(db, 'questions'), {
        text: newQuestion.text,
        options: qType === 'numerical' ? [] : newQuestion.options,
        correctAnswerIndex: qType === 'numerical' ? -1 : newQuestion.correctAnswerIndex,
        marks: Number(newQuestion.marks) || 4,
        examId,
        subject: newQuestion.subject || exam?.subject || 'Physics',
        type: qType,
        numericalAnswer: qType === 'numerical' ? newQuestion.numericalAnswer : '',
        explanation: newQuestion.explanation || '',
        imageUrl: newQuestion.imageUrl || '',
        imagePublicId: newQuestion.imagePublicId || ''
      });
      toast.success("Question created on secure nodes");
      setNewQuestion({ 
        text: '', 
        options: ['', '', '', ''], 
        correctAnswerIndex: 0, 
        marks: 4,
        subject: exam?.subject || 'Physics',
        type: 'single',
        numericalAnswer: '',
        explanation: '',
        imageUrl: '',
        imagePublicId: ''
      });
      setIsAdding(false);
    } catch (error) {
      toast.error("Failed to add question to database");
      handleFirestoreError(error, OperationType.WRITE, 'questions');
    }
  };

  const handleDeleteQuestion = async (qId: string) => {
    if (!confirm("Are you sure you want to delete this question? Any uploaded image for this question will also be permanently deleted. Do you want to proceed?")) return;
    try {
      const response = await fetch(`/api/questions/${qId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to delete question via API');
      }
      toast.success("Question and its associated image deleted successfully");
    } catch (error: any) {
      toast.error("Failed to delete question: " + error.message);
    }
  };

  const toggleStatus = async () => {
    if (!exam || !examId) return;
    const nextStatus = exam.status === 'published' ? 'draft' : 'published';
    try {
      await updateDoc(doc(db, 'exams', examId), { status: nextStatus });
      toast.success(`Exam ${nextStatus}`);
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const updateExamInfo = async () => {
    if (!examId) return;
    try {
      await updateDoc(doc(db, 'exams', examId), editedInfo);
      toast.success("Exam information updated");
      setIsEditingInfo(false);
    } catch (error) {
      toast.error("Failed to update exam info");
    }
  };

  const handleDocxFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !examId) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'docx' && extension !== 'txt' && extension !== 'doc') {
      toast.error("Unsupported file format. Please upload a .docx, .doc, or .txt document file.");
      return;
    }

    setIsDocxLoading(true);
    const toastId = toast.loading(`Uploading and parsing "${file.name}"...`);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const result = reader.result as string;
        const base64Data = result.split(',')[1];

        try {
          const response = await fetch(`/api/exams/${examId}/import-doc`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              base64Data,
              fileName: file.name,
              subject: exam?.subject || 'General'
            })
          });

          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Parsing failed on the backend.');
          }

          toast.success(`Successfully imported ${data.count} questions one-by-one from "${file.name}"!`, { id: toastId });
          e.target.value = '';
        } catch (error: any) {
          console.error("Document import error:", error);
          toast.error(error.message || "Failed to process document. Please ensure format is correct.", { id: toastId });
        } finally {
          setIsDocxLoading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error("File reading failed.", { id: toastId });
      setIsDocxLoading(false);
    }
  };

  if (!canManage) return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
      <div className="bg-red-50 p-6 rounded-full mb-6">
        <Trash2 className="h-12 w-12 text-red-500" />
      </div>
      <h3 className="text-2xl font-bold text-slate-900">Access Restricted</h3>
      <p className="text-slate-500 mt-2 max-w-sm">You do not have the necessary <code>manage_exams</code> permission to modify questions for this assessment.</p>
      <Button variant="outline" className="mt-8" onClick={() => navigate('/')}>Return to Dashboard</Button>
    </div>
  );

  if (loading) return <div>Loading...</div>;
  if (!exam) return <div>Exam not found</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Dashboard
        </Link>
        <Button variant={exam.status === 'published' ? 'destructive' : 'default'} onClick={toggleStatus}>
           {exam.status === 'published' ? 'Unpublish' : 'Publish Exam'}
        </Button>
      </div>

      <div className="bg-white p-6 rounded-xl border shadow-sm group">
        {isEditingInfo ? (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Exam Title</Label>
              <Input value={editedInfo.title} onChange={e => setEditedInfo({...editedInfo, title: e.target.value})} />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Detailed Description & Instructions</Label>
              <Textarea 
                value={editedInfo.description} 
                onChange={e => setEditedInfo({...editedInfo, description: e.target.value})} 
                className="min-h-[120px] resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setIsEditingInfo(false)}>
                <X className="h-4 w-4 mr-2" /> Cancel
              </Button>
              <Button size="sm" onClick={updateExamInfo} className="bg-indigo-600 hover:bg-indigo-700">
                <Save className="h-4 w-4 mr-2" /> Save Changes
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <h1 className="text-2xl font-bold font-display">{exam.title}</h1>
              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setIsEditingInfo(true)}>
                <Edit3 className="h-4 w-4 text-slate-400" />
              </Button>
            </div>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{exam.description || 'No description provided.'}</p>
            <div className="flex gap-4 mt-4 text-sm font-medium">
              <span className="bg-slate-100 px-3 py-1 rounded-md text-xs font-bold text-slate-600">Questions: {questions.length}</span>
              <span className="bg-slate-100 px-3 py-1 rounded-md text-xs font-bold text-slate-600">Total Marks: {questions.reduce((acc, q) => acc + q.marks, 0)} / {exam.totalMarks}</span>
            </div>
          </>
        )}
      </div>

      <div className="space-y-4">
        {questions.slice((questionPage - 1) * questionPageSize, questionPage * questionPageSize).map((q, localIdx) => {
          const globalIdx = (questionPage - 1) * questionPageSize + localIdx;
          return (
            <Card key={q.id} className="border border-slate-100 shadow-md rounded-2xl overflow-hidden bg-white">
              <CardHeader className="flex flex-row items-start justify-between bg-slate-50/50 pb-3 border-b border-slate-100">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-slate-950 text-white flex items-center justify-center font-bold text-xs">{globalIdx + 1}</span>
                    <CardTitle className="text-base font-bold text-slate-900">Question {globalIdx + 1}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 pt-1.5 flex-wrap">
                    <span className="px-2.5 py-0.5 bg-indigo-50 border border-indigo-150 text-[10px] uppercase font-black tracking-wider text-indigo-600 rounded-md">
                      Subject: {q.subject || exam?.subject || 'General'}
                    </span>
                    <span className="px-2.5 py-0.5 bg-slate-100 text-[10px] uppercase font-black tracking-wider text-slate-600 rounded-md">
                      Type: {q.type || 'single'}
                    </span>
                    <span className="px-2.5 py-0.5 bg-emerald-50 text-[10px] uppercase font-black tracking-wider text-emerald-600 rounded-md font-mono">
                      +{q.marks} Mark(s)
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDeleteQuestion(q.id!)} className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 h-8 w-8 rounded-lg">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <p className="font-medium text-slate-800 text-lg leading-relaxed">{q.text}</p>
                
                {q.imageUrl && (
                  <div className="my-4 rounded-xl overflow-hidden border border-slate-200/60 bg-slate-50/50 p-2 max-w-lg shadow-sm">
                    <img 
                      src={q.imageUrl} 
                      alt={`Illustration for question ${globalIdx + 1}`} 
                      className="max-h-64 object-contain rounded-lg"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
                
                {q.type === 'numerical' ? (
                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1">
                    <p className="text-xs uppercase tracking-widest font-black text-emerald-600">Correct Value Answer</p>
                    <p className="text-xl font-mono font-black text-emerald-950">{q.numericalAnswer}</p>
                  </div>
                ) : q.type === 'math' ? (
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl space-y-1">
                    <p className="text-xs uppercase tracking-widest font-black text-indigo-600">Expected Mathematical Formula (LaTeX)</p>
                    <div className="p-3 bg-white rounded-lg border border-indigo-100 mt-2 flex items-center justify-center">
                      <MathRenderer math={q.numericalAnswer || ''} block={true} />
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono mt-1">Raw Code: <span className="font-bold">{q.numericalAnswer}</span></p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(q.options || []).map((opt, i) => (
                      <div key={i} className={`p-4 rounded-xl border flex items-center justify-between ${i === q.correctAnswerIndex ? 'bg-emerald-50/50 border-emerald-300 text-emerald-950 font-semibold' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-md font-mono text-xs font-black flex items-center justify-center ${i === q.correctAnswerIndex ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span>{opt}</span>
                        </div>
                        {i === q.correctAnswerIndex && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                      </div>
                    ))}
                  </div>
                )}

                {q.explanation && (
                  <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs space-y-1">
                    <p className="font-black uppercase tracking-widest text-indigo-600">Interactive Solution / Step-by-Step Explanation</p>
                    <p className="text-slate-700 leading-relaxed italic">{q.explanation}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Questions Pagination Controls */}
      {questions.length > 0 && (
        <div className="p-4 border border-slate-200 rounded-[24px] flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Questions per page:</span>
            <select 
              value={questionPageSize} 
              onChange={e => {
                setQuestionPageSize(parseInt(e.target.value));
                setQuestionPage(1);
              }}
              className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none cursor-pointer"
            >
              {[5, 10, 20, 50].map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="text-xs font-medium text-slate-400 ml-4">
              Showing {Math.min(questions.length, (questionPage - 1) * questionPageSize + 1)} - {Math.min(questions.length, questionPage * questionPageSize)} of {questions.length} Questions
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setQuestionPage(p => Math.max(1, p - 1))}
              disabled={questionPage === 1}
              className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs"
            >
              Previous
            </Button>
            {Array.from({ length: Math.ceil(questions.length / questionPageSize) }).map((_, idx) => (
              <Button
                key={idx}
                variant={questionPage === idx + 1 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setQuestionPage(idx + 1)}
                className={`h-9 w-9 p-0 rounded-lg text-xs font-bold ${questionPage === idx + 1 ? 'bg-indigo-650 text-white border-indigo-650' : 'border-slate-200 text-slate-600'}`}
              >
                {idx + 1}
              </Button>
            ))}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setQuestionPage(p => Math.min(Math.ceil(questions.length / questionPageSize), p + 1))}
              disabled={questionPage === Math.ceil(questions.length / questionPageSize) || questions.length === 0}
              className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <div className="pt-6 border-t border-slate-100">
        {isAdding ? (
          <Card className="border-2 border-indigo-100 shadow-xl shadow-indigo-50/30 rounded-3xl overflow-hidden bg-white">
            <CardHeader className="flex flex-row items-center justify-between bg-indigo-50/30 pb-4 border-b border-indigo-100/50">
              <CardTitle className="text-xl font-display font-black text-indigo-950 uppercase tracking-tight">Construct Secure Test Question</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setIsAdding(false)} className="rounded-xl hover:bg-indigo-100/50">
                 <X size={18} />
              </Button>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-black uppercase tracking-wider text-slate-400">Subject Segment</Label>
                  <select 
                    value={newQuestion.subject || 'Physics'} 
                    onChange={e => setNewQuestion({...newQuestion, subject: e.target.value})}
                    className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Physics">Physics Track</option>
                    <option value="Chemistry">Chemistry Track</option>
                    <option value="Mathematics">Mathematics (IIT JEE)</option>
                    <option value="Biology">Biology (NEET Prep)</option>
                    <option value="English">English</option>
                    <option value="Other">General / Other Track</option>
                  </select>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs font-black uppercase tracking-wider text-slate-400">Question Format</Label>
                  <select 
                    value={newQuestion.type || 'single'} 
                    onChange={e => setNewQuestion({...newQuestion, type: e.target.value as any})}
                    className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="single">Single Correct Choice MCQ</option>
                    <option value="multiple">Multi-Correct Choice MCQ</option>
                    <option value="numerical">Numerical / Keypad Integer Type</option>
                    <option value="math">Free-response Math Formula (LaTeX)</option>
                  </select>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs font-black uppercase tracking-wider text-slate-400">Marks Assignment</Label>
                  <Input 
                    type="number" 
                    value={newQuestion.marks || ''} 
                    onChange={e => setNewQuestion({...newQuestion, marks: parseInt(e.target.value) || 0})}
                    className="h-10 bg-white border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>

              {/* Mathematics & Scientific Equation Toolbar */}
              {['Physics', 'Chemistry', 'Mathematics', 'Biology'].includes(newQuestion.subject || 'Physics') && (
                <div className="bg-slate-50 border-2 border-dashed border-indigo-250 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base select-none">📐</span>
                      <span className="text-xs font-black uppercase tracking-wider text-indigo-950 font-display">Mathematics & Scientific Equation Toolbar</span>
                    </div>
                    <span className="text-[10px] bg-indigo-100 border border-indigo-200 text-indigo-700 px-2.5 py-0.5 rounded-full font-black uppercase">
                      ACTIVE: {activeInputName ? (activeInputName === 'text' ? 'Statement Text' : activeInputName === 'explanation' ? 'Explanation Field' : `Option ${activeInputName.replace('opt', '').toUpperCase()}`) : 'Select Input Field Below'}
                    </span>
                  </div>
                  
                  {/* Virtual Symbols Keyboard */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { sym: 'π', label: 'pi' },
                        { sym: 'θ', label: 'theta' },
                        { sym: 'α', label: 'alpha' },
                        { sym: 'β', label: 'beta' },
                        { sym: 'γ', label: 'gamma' },
                        { sym: 'Δ', label: 'delta' },
                        { sym: 'λ', label: 'lambda' },
                        { sym: 'φ', label: 'phi' },
                        { sym: 'μ', label: 'mu' },
                        { sym: 'ω', label: 'omega' },
                        { sym: '√', label: 'sqrt' },
                        { sym: '∫', label: 'integral' },
                        { sym: '∑', label: 'sum' },
                        { sym: '∞', label: 'infinity' },
                        { sym: '≈', label: 'approx' },
                        { sym: '≠', label: 'not=' },
                        { sym: '≤', label: 'le' },
                        { sym: '≥', label: 'ge' },
                        { sym: '±', label: 'pm' },
                        { sym: '×', label: 'times' },
                        { sym: '÷', label: 'div' },
                        { sym: '→', label: 'to' }
                      ].map((item) => (
                        <button
                          key={item.sym}
                          type="button"
                          onClick={() => insertMathSymbol(item.sym)}
                          className="h-10 px-3 text-sm font-bold bg-white hover:bg-slate-900 hover:text-white text-slate-800 border border-slate-200 rounded-xl transition-all flex items-center justify-center cursor-pointer shadow-sm active:translate-y-0.5 hover:scale-105"
                          title={`Insert ${item.sym} (Shortkey: ${item.label})`}
                        >
                          {item.sym}
                        </button>
                      ))}
                    </div>

                    <div className="bg-slate-100/60 p-3 rounded-xl space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Powers & Superscripts (POW)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { sym: 'xʸ', label: 'inserts ^ for powers' },
                          { sym: '⁰', label: 'superscript 0' },
                          { sym: '¹', label: 'superscript 1' },
                          { sym: '²', label: 'superscript 2' },
                          { sym: '³', label: 'superscript 3' },
                          { sym: '⁴', label: 'superscript 4' },
                          { sym: '⁵', label: 'superscript 5' },
                          { sym: '⁶', label: 'superscript 6' },
                          { sym: '⁷', label: 'superscript 7' },
                          { sym: '⁸', label: 'superscript 8' },
                          { sym: '⁹', label: 'superscript 9' },
                          { sym: 'ⁿ', label: 'superscript n' },
                          { sym: 'ˣ', label: 'superscript x' },
                          { sym: 'ʸ', label: 'superscript y' },
                          { sym: '⁺', label: 'superscript plus' },
                          { sym: '⁻', label: 'superscript minus' }
                        ].map((item) => (
                          <button
                            key={item.sym}
                            type="button"
                            onClick={() => insertMathSymbol(item.sym)}
                            className="h-9 px-2.5 text-xs font-black bg-white hover:bg-indigo-600 hover:text-white text-indigo-950 border border-indigo-100 rounded-xl transition-all flex items-center justify-center cursor-pointer shadow-xs active:translate-y-0.5 hover:scale-105"
                            title={item.label}
                          >
                            {item.sym}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-100/60 p-3 rounded-xl space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Subscripts (SUB)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { sym: 'xᵢ', label: 'inserts _ for subscripts' },
                          { sym: '₀', label: 'subscript 0' },
                          { sym: '₁', label: 'subscript 1' },
                          { sym: '₂', label: 'subscript 2' },
                          { sym: '₃', label: 'subscript 3' },
                          { sym: '₄', label: 'subscript 4' },
                          { sym: '₅', label: 'subscript 5' },
                          { sym: '₆', label: 'subscript 6' },
                          { sym: 'ₙ', label: 'subscript n' },
                          { sym: 'ₓ', label: 'subscript x' },
                          { sym: 'ᵢ', label: 'subscript i' },
                          { sym: '₊', label: 'subscript plus' },
                          { sym: '₋', label: 'subscript minus' }
                        ].map((item) => (
                          <button
                            key={item.sym}
                            type="button"
                            onClick={() => insertMathSymbol(item.sym)}
                            className="h-9 px-2.5 text-xs font-black bg-white hover:bg-slate-700 hover:text-white text-slate-700 border border-slate-200 rounded-xl transition-all flex items-center justify-center cursor-pointer shadow-xs active:translate-y-0.5 hover:scale-105"
                            title={item.label}
                          >
                            {item.sym}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Interactive conversion guidelines */}
                  <div className="text-[10.5px] bg-white border border-slate-150 p-3.5 rounded-xl space-y-3 text-slate-600 leading-relaxed">
                    <div className="space-y-1">
                      <p className="font-extrabold text-[#6366F1] flex items-center gap-1 uppercase tracking-wider text-[9px]"><Wand2 className="h-4.5 w-4.5 text-[#6366F1]" /> Dynamic LaTeX & Text Autocorrect</p>
                      <p className="font-bold text-slate-500">
                        Type standard LaTeX commands like <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono font-black">\pi</code>, <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono font-black">\sum</code>, <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono font-black">\times</code>, superscripts (<code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono font-black">^2</code>), and subscripts (<code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono font-black">_x</code>) to instantly format formulas without conflicts.
                      </p>
                    </div>

                    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-black text-slate-700 uppercase tracking-wide">Auto-convert plain-text keywords</span>
                        <span className="text-[9px] text-slate-400">If enabled, typing plain words followed by space (e.g. 'sum ', 'times ') converts them to symbols. Keep this off to write English phrases like '3 times' or 'sum of'.</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={autoConvertKeywords} 
                          onChange={(e) => setAutoConvertKeywords(e.target.checked)}
                          className="sr-only peer" 
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <Label className="text-xs font-black uppercase tracking-wider text-slate-400">Question Statement Text</Label>
                <Textarea 
                  value={newQuestion.text} 
                  onChange={e => handleTextChangeWithShortcuts(e.target.value, 'text')} 
                  onFocus={() => setActiveInputName('text')}
                  placeholder="Enter the comprehensive question detail..." 
                  className="min-h-[100px] bg-white border-slate-200 rounded-2xl resize-none p-4"
                />
              </div>

              {/* Reusable Cloudinary Image Upload Component */}
              <div className="bg-indigo-50/10 p-5 rounded-2xl border border-dashed border-indigo-150/60">
                <FileUpload 
                  imageUrl={newQuestion.imageUrl}
                  imagePublicId={newQuestion.imagePublicId}
                  onUploadSuccess={(url, publicId) => {
                    setNewQuestion(prev => ({
                      ...prev,
                      imageUrl: url,
                      imagePublicId: publicId
                    }));
                  }}
                  onDeleteSuccess={() => {
                    setNewQuestion(prev => ({
                      ...prev,
                      imageUrl: undefined,
                      imagePublicId: undefined
                    }));
                  }}
                />
              </div>
 
               {(newQuestion.type || 'single') === 'numerical' ? (
                 <div className="grid gap-2 p-5 bg-amber-50 rounded-2xl border border-amber-200">
                   <Label className="text-xs font-black uppercase tracking-wider text-amber-700">Correct Numerical Value</Label>
                   <Input 
                     placeholder="E.g., 25 or 12.5 or -3" 
                     value={newQuestion.numericalAnswer || ''} 
                     onChange={e => setNewQuestion({...newQuestion, numericalAnswer: e.target.value})}
                     onFocus={() => setActiveInputName(null)}
                     className="bg-white border-amber-300 rounded-xl h-11 text-center font-mono text-lg font-black focus-visible:ring-amber-500"
                   />
                   <p className="text-[10px] text-amber-600 font-medium">Students will input this exact value using an interactive, secure on-screen numeric keypad during live testing.</p>
                 </div>
               ) : (newQuestion.type || 'single') === 'math' ? (
                 <div className="grid gap-2 p-5 bg-indigo-50/50 rounded-2xl border border-indigo-200">
                   <Label className="text-xs font-black uppercase tracking-wider text-indigo-700">Correct Formula Answer (LaTeX format)</Label>
                   <Input 
                     placeholder="E.g., \sqrt{a^2 + b^2} or mc^2" 
                     value={newQuestion.numericalAnswer || ''} 
                     onChange={e => setNewQuestion({...newQuestion, numericalAnswer: e.target.value})}
                     onFocus={() => setActiveInputName(null)}
                     className="bg-white border-indigo-250 rounded-xl h-11 text-center font-mono text-lg font-bold focus-visible:ring-indigo-500"
                   />
                   <p className="text-[10px] text-indigo-600 font-semibold">Students will use a rich mathematical symbol toolbar and virtual keyboard to input their equations for this question.</p>
                 </div>
               ) : (
                 <div className="space-y-4">
                   <div className="flex items-center justify-between">
                     <Label className="text-xs font-black uppercase tracking-wider text-slate-405 text-indigo-900">MCQ Choice Configuration</Label>
                     <div className="flex gap-2">
                       <Button
                         type="button"
                         variant="outline"
                         onClick={() => {
                           if (newQuestion.options.length > 2) {
                             const opts = [...newQuestion.options];
                             opts.pop();
                             setNewQuestion({
                               ...newQuestion,
                               options: opts,
                               correctAnswerIndex: Math.min(newQuestion.correctAnswerIndex, opts.length - 1)
                             });
                           } else {
                             toast.error("MCQs must have at least 2 options!");
                           }
                         }}
                         className="h-8 text-[9px] font-black uppercase rounded-lg border-slate-200 px-3 cursor-pointer bg-white"
                       >
                         - Delete Option
                       </Button>
                       <Button
                         type="button"
                         variant="outline"
                         onClick={() => {
                           if (newQuestion.options.length < 10) {
                             setNewQuestion({
                               ...newQuestion,
                               options: [...newQuestion.options, '']
                             });
                           } else {
                             toast.error("MCQs supports maximum 10 choices!");
                           }
                         }}
                         className="h-8 text-[9px] font-black uppercase rounded-lg border-slate-200 px-3 cursor-pointer bg-white"
                       >
                         + Append Option
                       </Button>
                     </div>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {newQuestion.options.map((opt, i) => (
                     <div key={i} className="grid gap-2 p-4 border border-slate-100 rounded-2xl bg-slate-50/50">
                       <Label className="flex items-center justify-between text-xs font-bold text-slate-700">
                         Option {String.fromCharCode(65 + i)}
                         <button 
                           className={`text-[9px] uppercase font-black px-2.5 py-1 rounded-md transition-all ${newQuestion.correctAnswerIndex === i ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-200 hover:bg-slate-300'}`} 
                           onClick={() => setNewQuestion({...newQuestion, correctAnswerIndex: i})}
                           type="button"
                         >
                           {newQuestion.correctAnswerIndex === i ? '✓ Correct Option' : 'Mark Correct'}
                         </button>
                       </Label>
                       <Input 
                         value={opt} 
                         onChange={e => handleTextChangeWithShortcuts(e.target.value, i)}
                         onFocus={() => setActiveInputName(`opt${i}` as any)} 
                         placeholder={`Option ${String.fromCharCode(65 + i)}`}
                         className="bg-white border-slate-200 rounded-xl"
                       />
                     </div>
                   ))}</div>
                 </div>
               )}
 
               <div className="grid gap-2">
                 <Label className="text-xs font-black uppercase tracking-wider text-slate-400">Step-by-Step Interactive Explanation (Optional)</Label>
                 <Textarea 
                   value={newQuestion.explanation || ''} 
                   onChange={e => handleTextChangeWithShortcuts(e.target.value, 'explanation')} 
                   onFocus={() => setActiveInputName('explanation')}
                   placeholder="Describe the step-by-step formula and solution logic for the student's Error Book..." 
                   className="min-h-[80px] bg-white border-slate-200 rounded-2xl resize-none p-4"
                 />
               </div>
            </CardContent>
            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
              <Button variant="outline" className="h-11 rounded-xl font-bold" onClick={() => setIsAdding(false)}>
                Cancel
              </Button>
              <Button className="h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 rounded-xl shadow-lg shadow-indigo-100 border-none" onClick={handleAddQuestion}>
                Save & Insert Question
              </Button>
            </div>
          </Card>
        ) : (
        <div className="flex flex-col md:flex-row gap-4 w-full">
          <Button 
             variant="outline" 
             className="flex-grow py-12 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/10 rounded-[40px] flex flex-col items-center justify-center gap-3 transition-all group" 
             onClick={() => setIsAdding(true)}
          >
             <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:scale-110 transition-transform">
                <Plus className="h-6 w-6" />
             </div>
             <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Manual Entry Console</span>
          </Button>

          <div className="relative flex-grow group">
             <input 
                type="file" 
                accept=".docx,.doc,.txt" 
                className="hidden" 
                id="doc-import-file"
                onChange={handleDocxFileSelect}
                disabled={isDocxLoading}
             />
             <Button 
                onClick={() => document.getElementById('doc-import-file')?.click()}
                disabled={isDocxLoading}
                className="w-full py-12 bg-indigo-950 border-0 text-white rounded-[40px] flex flex-col items-center justify-center gap-3 shadow-2xl shadow-slate-200 transition-all relative overflow-hidden group/doc"
             >
                <div className="flex flex-col items-center gap-3 relative z-10 text-center">
                   <div className="h-12 w-12 rounded-2xl bg-indigo-500 flex items-center justify-center text-white shadow-xl shadow-indigo-900/50 group-hover/doc:scale-110 transition-transform mx-auto">
                      {isDocxLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6" />}
                   </div>
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover/doc:text-white transition-colors block">{isDocxLoading ? 'Parsing Document...' : 'Word Doc / TXT Importer'}</span>
                </div>
                <div className="absolute -bottom-4 -right-4 text-white/5 rotate-12 transition-transform group-hover/doc:rotate-0 pointer-events-none">
                   <FileUp size={100} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-transparent opacity-0 group-hover/doc:opacity-100 transition-opacity" />
             </Button>
          </div>
        </div>
      )}
    </div>
  </div>
);
};
