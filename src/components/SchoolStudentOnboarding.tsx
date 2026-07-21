import React, { useState, useEffect } from 'react';
import { useDbObserver } from '../lib/observerPattern';
import { useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, doc, setDoc, writeBatch, collection, query, where, onSnapshot, deleteDoc, getDoc, getDocs, limit, startAfter, getCountFromServer, orderBy, updateDoc } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Upload, Download, UserPlus, CheckCircle2, AlertCircle, Loader2, User, ChevronDown, Check, Copy, Link, Search, Building2, Eye, ShieldAlert, Sparkles, Send, Inbox, Edit, Trash2, BarChart3, GraduationCap, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Badge } from './ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from './ui/select';

const ACADEMIC_LEVELS = [
  "Play Class",
  "LKG",
  "UKG",
  "1st Grade",
  "2nd Grade",
  "3rd Grade",
  "4th Grade",
  "5th Grade",
  "6th Grade",
  "7th Grade",
  "8th Grade",
  "9th Grade",
  "10th Grade",
  "Intermediate 1st Year",
  "Intermediate 2nd Year"
];

export const SchoolStudentOnboarding: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [examDropdownOpen, setExamDropdownOpen] = useState(false);
  const [examSearchText, setExamSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  
  // Dynamic secure tokens
  const [dynamicToken, setDynamicToken] = useState<string | null>(null);
  const [isGeneratingDynamicToken, setIsGeneratingDynamicToken] = useState(false);
  
  // Validation Warnings
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([]);
  
  // School Name display
  const [schoolName, setSchoolName] = useState('Active Academic Center');

  // Invitation Dialog state
  const [activeInvite, setActiveInvite] = useState<{ url: string; studentName: string; examTitle: string } | null>(null);

  // Student CRUD / Dialog States
  const [editingStudent, setEditingStudent] = useState<any | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    class: '',
    section: '',
    rollNumber: '',
    dob: ''
  });

  const [deletingStudent, setDeletingStudent] = useState<any | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [viewingStudentAnalytics, setViewingStudentAnalytics] = useState<any | null>(null);
  const [isAnalyticsDialogOpen, setIsAnalyticsDialogOpen] = useState(false);
  const [studentAttempts, setStudentAttempts] = useState<any[]>([]);

  const [manualStudent, setManualStudent] = useState({
    name: '',
    email: '',
    class: '',
    section: '',
    rollNumber: '',
    dob: ''
  });

  const [invitations, setInvitations] = useState<any[]>([]);
  const [currentAttempts, setCurrentAttempts] = useState<any[]>([]);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);

  // Pagination states for millions scale
  const [totalStudentsCount, setTotalStudentsCount] = useState<number>(0);
  const [lastVisibleDocs, setLastVisibleDocs] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState<boolean>(false);
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(10);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const handleRetry = () => setRetryTrigger(prev => prev + 1);

  // Fetch School Name Details & Published Exams
  useEffect(() => {
    if (!profile?.schoolId) return;

    getDoc(doc(db, 'schools', profile.schoolId)).then(snap => {
      if (snap.exists()) {
        setSchoolName(snap.data().name || 'Authorized Academic Hub');
      }
    }).catch(err => {
      console.error("Failed to read school details: ", err);
    });

    const examsQuery = query(
      collection(db, 'exams'),
      where('status', '==', 'published')
    );
    const unsubscribeExams = onSnapshot(examsQuery, (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const schoolId = profile?.schoolId;
      const permittedExams = schoolId
        ? fetched.filter((e: any) => !e.assignedSchoolIds || e.assignedSchoolIds.length === 0 || e.assignedSchoolIds.includes(schoolId))
        : fetched;
      setExams(permittedExams);
      if (permittedExams.length > 0) {
        if (!selectedExamId || !permittedExams.some((e: any) => e.id === selectedExamId)) {
          setSelectedExamId(permittedExams[0].id);
        }
      } else {
        setSelectedExamId('');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'exams');
    });

    return () => {
      unsubscribeExams();
    };
  }, [profile?.schoolId]);

  // Reset page cursors when search query or page size changes
  useEffect(() => {
    setStudentPage(1);
    setLastVisibleDocs([]);
  }, [searchQuery, studentPageSize]);

  // Combined effect to fetch students page
  useEffect(() => {
    if (!profile?.schoolId) return;

    const handler = setTimeout(() => {
      const loadStudents = async () => {
        setLoadingStudents(true);
        try {
          // 1. Get the total count of students matching search
          let countQ = query(
            collection(db, 'users'),
            where('schoolId', '==', profile.schoolId),
            where('role', '==', 'student')
          );
          if (searchQuery.trim()) {
            const searchVal = searchQuery.trim();
            countQ = query(
              collection(db, 'users'),
              where('schoolId', '==', profile.schoolId),
              where('role', '==', 'student'),
              where('name', '>=', searchVal),
              where('name', '<=', searchVal + '\uf8ff')
            );
          }
          const countSnap = await getCountFromServer(countQ);
          setTotalStudentsCount(countSnap.data().count);

          // 2. Fetch page of students
          let studentQ = query(
            collection(db, 'users'),
            where('schoolId', '==', profile.schoolId),
            where('role', '==', 'student'),
            orderBy('name'),
            limit(studentPageSize)
          );

          if (searchQuery.trim()) {
            const searchVal = searchQuery.trim();
            studentQ = query(
              collection(db, 'users'),
              where('schoolId', '==', profile.schoolId),
              where('role', '==', 'student'),
              where('name', '>=', searchVal),
              where('name', '<=', searchVal + '\uf8ff'),
              orderBy('name'),
              limit(studentPageSize)
            );
          }

          // Apply pagination cursor if applicable
          if (studentPage > 1) {
            const cursorDoc = lastVisibleDocs[studentPage - 2];
            if (cursorDoc) {
              studentQ = query(studentQ, startAfter(cursorDoc));
            }
          }

          const snap = await getDocs(studentQ);
          const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setStudents(fetched);

          // Store cursor for current page to allow next page lookup
          if (snap.docs.length > 0) {
            const lastDoc = snap.docs[snap.docs.length - 1];
            setLastVisibleDocs(prev => {
              const updated = [...prev];
              updated[studentPage - 1] = lastDoc;
              return updated;
            });
          }
        } catch (err) {
          console.error("Error loading paginated students: ", err);
          toast.error("Failed to load student directory page");
        } finally {
          setLoadingStudents(false);
        }
      };

      loadStudents();
    }, studentPage === 1 ? 400 : 0);

    return () => clearTimeout(handler);
  }, [profile?.schoolId, searchQuery, studentPage, studentPageSize, retryTrigger]);

  // Register GoF Observer to listen for updates to 'users' and 'invitations' collections
  useDbObserver(['users', 'invitations'], () => {
    handleRetry();
  });

  // Subscribe to ONLY the invitations of the students currently displayed on the page
  useEffect(() => {
    if (!profile?.schoolId || students.length === 0) {
      setInvitations([]);
      return;
    }

    const studentIds = students.map(s => s.uid || s.id);
    const chunkSize = 30; // Firestore IN limit
    const unsubscribes: (() => void)[] = [];

    // Setup chunked subscriptions
    for (let i = 0; i < studentIds.length; i += chunkSize) {
      const chunk = studentIds.slice(i, i + chunkSize);
      const qInv = query(
        collection(db, 'invitations'),
        where('schoolId', '==', profile.schoolId),
        where('studentId', 'in', chunk)
      );

      const unsub = onSnapshot(qInv, (snap) => {
        const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setInvitations(prev => {
          // Remove old items for this specific chunk
          const filteredPrev = prev.filter(p => !chunk.includes(p.studentId));
          return [...filteredPrev, ...fetched];
        });
      }, (error) => {
        console.error("Error reading invitations chunk:", error);
      });
      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [students, profile?.schoolId]);

  // Subscribe to ONLY the attempts of the students currently displayed on the page for the selected exam
  useEffect(() => {
    if (!profile?.schoolId || students.length === 0 || !selectedExamId || selectedExamId === 'none') {
      setCurrentAttempts([]);
      return;
    }

    const studentIds = students.map(s => s.uid || s.id);
    const chunkSize = 30; // Firestore IN limit
    const unsubscribes: (() => void)[] = [];

    for (let i = 0; i < studentIds.length; i += chunkSize) {
      const chunk = studentIds.slice(i, i + chunkSize);
      const qAttempts = query(
        collection(db, 'attempts'),
        where('examId', '==', selectedExamId),
        where('studentId', 'in', chunk)
      );

      const unsub = onSnapshot(qAttempts, (snap) => {
        const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCurrentAttempts(prev => {
          const filteredPrev = prev.filter(p => !chunk.includes(p.studentId));
          return [...filteredPrev, ...fetched];
        });
      }, (error) => {
        console.error("Error reading attempts chunk:", error);
      });
      unsubscribes.push(unsub);
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [students, selectedExamId, profile?.schoolId]);

  // Dynamic secure exam link subscription
  useEffect(() => {
    if (!profile?.schoolId || !selectedExamId || selectedExamId === 'none') {
      setDynamicToken(null);
      return;
    }

    const tokenDocId = `gen_${profile.schoolId}_${selectedExamId}`;
    const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
    
    const unsubscribe = onSnapshot(tokenRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.isActive) {
          setDynamicToken(data.id);
        } else {
          setDynamicToken(null);
        }
      } else {
        setDynamicToken(null);
      }
    }, (err) => {
      console.error("Error reading secure exam link token:", err);
    });

    return () => unsubscribe();
  }, [selectedExamId, profile?.schoolId]);

  const handleActivateDynamicSecurity = async () => {
    if (!profile?.schoolId || !selectedExamId || selectedExamId === 'none') return;
    
    setIsGeneratingDynamicToken(true);
    const toastId = toast.loading("Provisioning secure administrative exam gateway token...");
    
    try {
      const tokenDocId = `gen_${profile.schoolId}_${selectedExamId}`;
      const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
      const uuidToken = `tkn_${crypto.randomUUID().replace(/-/g, "")}`;
      
      const exam = exams.find(e => e.id === selectedExamId);
      const expiresAt = exam?.endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Default to exam end time

      await setDoc(tokenRef, {
        id: uuidToken,
        examId: selectedExamId,
        schoolId: profile.schoolId,
        isActive: true,
        expiresAt: expiresAt,
        createdAt: new Date().toISOString()
      }, { merge: true });

      setDynamicToken(uuidToken);
      toast.success("Dynamic Exam Link Cryptographically Activated & Sealed!", { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Failed to provision dynamic exam token.", { id: toastId });
    } finally {
      setIsGeneratingDynamicToken(false);
    }
  };

  const handleDeactivateDynamicSecurity = async () => {
    if (!profile?.schoolId || !selectedExamId || selectedExamId === 'none') return;
    
    const toastId = toast.loading("Revoking dynamic security token...");
    try {
      const tokenDocId = `gen_${profile.schoolId}_${selectedExamId}`;
      const tokenRef = doc(db, 'secure_exam_links', tokenDocId);
      
      await setDoc(tokenRef, {
        isActive: false,
        revokedAt: new Date().toISOString()
      }, { merge: true });

      setDynamicToken(null);
      toast.success("Dynamic Security Key Revoked successfully.", { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Failed to revoke dynamic security key.", { id: toastId });
    }
  };

  // Pre-flight validation checker
  const performValidationPreflight = (newData: any[]) => {
    const warnings: string[] = [];
    const emailsInFile = new Set<string>();
    const rollsInFile = new Set<string>();

    newData.forEach((s, idx) => {
      const rowNum = idx + 2;
      const email = s.email?.toString().trim().toLowerCase();
      const roll = s.rollNumber?.toString().trim();

      if (!s.name) {
        warnings.push(`Row ${rowNum}: Student name is empty.`);
      }
      if (!email) {
        warnings.push(`Row ${rowNum}: Email address is empty.`);
      } else {
        // Multi-row duplicate detection in file itself
        if (emailsInFile.has(email)) {
          warnings.push(`Row ${rowNum}: Duplicate email inside sheet: "${s.email}".`);
        }
        emailsInFile.add(email);

        // Check against existing database students list
        const dbDuplicateEmail = students.find(ds => ds.email?.toLowerCase() === email);
        if (dbDuplicateEmail) {
          warnings.push(`Row ${rowNum}: Email "${s.email}" already exists in student directory.`);
        }
      }

      if (roll) {
        if (rollsInFile.has(roll)) {
          warnings.push(`Row ${rowNum}: Duplicate Register/Roll number inside sheet: "${roll}".`);
        }
        rollsInFile.add(roll);

        // Check duplicate roll number against database
        const dbDuplicateRoll = students.find(ds => ds.rollNumber?.toString().trim() === roll);
        if (dbDuplicateRoll) {
          warnings.push(`Row ${rowNum}: Register number "${roll}" matches existing student "${dbDuplicateRoll.name}".`);
        }
      }
    });

    setDuplicateWarnings(warnings);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        setPreviewData(data);
        performValidationPreflight(data);
        toast.info(`Successfully loaded ${data.length} student rows.`);
      } catch (err) {
        toast.error("Failed to parse file. Make sure it's valid Excel/CSV.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { name: 'John Doe', email: 'john@school.com', class: '10th Grade', section: 'A', rollNumber: '101', dob: '2005-08-15' },
      { name: 'Jane Smith', email: 'jane@school.com', class: '10th Grade', section: 'B', rollNumber: '102', dob: '2006-02-28' }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students Template");
    XLSX.writeFile(wb, "Student_Onboarding_Template.xlsx");
  };

  const processImport = async () => {
    if (!profile?.schoolId) {
      toast.error("Account error: No school associated.");
      return;
    }
    
    setIsUploading(true);
    try {
      const batch = writeBatch(db);
      
      previewData.forEach(student => {
        const uid = crypto.randomUUID();
        const userRef = doc(db, 'users', uid);
        batch.set(userRef, {
          uid: uid,
          name: student.name || 'Anonymous Student',
          email: student.email || '',
          role: 'student',
          schoolId: profile.schoolId,
          class: student.class?.toString() || 'Unassigned',
          section: student.section?.toString() || 'A',
          rollNumber: student.rollNumber?.toString() || 'N/A',
          dob: student.dob?.toString() || '',
          permissions: ['take_exams'],
          createdAt: new Date().toISOString()
        });
      });

      await batch.commit();
      
      toast.success(`Onboarded ${previewData.length} students successfully!`);
      setPreviewData([]);
      setDuplicateWarnings([]);
    } catch (error) {
      toast.error("Failed to import students");
    } finally {
      setIsUploading(false);
    }
  };

  const handleManualAdd = async () => {
    if (!profile?.schoolId) return;
    if (!manualStudent.name) {
      toast.error("Validation failed: Candidate name field is required");
      return;
    }

    if (manualStudent.name.trim().length < 3) {
      toast.error("Validation failed: Candidate name must contain at least 3 letters");
      return;
    }

    const trimmedEmail = manualStudent.email ? manualStudent.email.trim() : '';
    if (trimmedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        toast.error("Validation failed: Invalid structural email format (e.g. child@school.com)");
        return;
      }

      const dbDuplicateEmail = students.find(ds => ds.email && ds.email.toLowerCase() === trimmedEmail.toLowerCase());
      if (dbDuplicateEmail) {
        toast.error(`Duplicate Email address "${trimmedEmail}" is already registered.`);
        return;
      }
    }

    // Check pre-existing duplicate checks for manual addition
    const dbDuplicateRoll = students.find(ds => ds.rollNumber?.toString().trim() === manualStudent.rollNumber?.trim());
    if (dbDuplicateRoll && manualStudent.rollNumber) {
      toast.error(`Duplicate Register number "${manualStudent.rollNumber}" detected. Maps to resident student "${dbDuplicateRoll.name}".`);
      return;
    }

    try {
      const trimmedRoll = manualStudent.rollNumber ? manualStudent.rollNumber.trim() : '';
      const uid = trimmedRoll 
        ? `std_${profile.schoolId}_${trimmedRoll.replace(/\s+/g, '_').toLowerCase()}`
        : crypto.randomUUID();

      await setDoc(doc(db, 'users', uid), {
        ...manualStudent,
        email: trimmedEmail,
        uid: uid,
        role: 'student',
        schoolId: profile.schoolId,
        permissions: ['take_exams'],
        createdAt: new Date().toISOString()
      });

      toast.success("Student added successfully");
      setIsManualOpen(false);
      setManualStudent({ name: '', email: '', class: '', section: '', rollNumber: '', dob: '' });
    } catch (error) {
      toast.error("Failed to onboard student");
    }
  };

  // Secure token & invite link generation strategy
  const handleTriggerInvite = async (student: any) => {
    if (!selectedExamId) {
      toast.error("Please pick an assessment paper to invite students.");
      return;
    }

    const exam = exams.find(e => e.id === selectedExamId);
    if (!exam) return;

    const studentId = student.uid || student.id;
    const existingInvite = invitations.find(inv => inv.studentId === studentId && inv.examId === selectedExamId);

    if (existingInvite) {
      const inviteUrl = `${window.location.origin}/login?invite=${existingInvite.id}`;
      setActiveInvite({
        url: inviteUrl,
        studentName: student.name,
        examTitle: exam.title
      });
      return;
    }

    try {
      const secureToken = crypto.randomUUID(); // Crytographically secure random 128-bit UI token
      const inviteRef = doc(db, 'invitations', secureToken);

      await setDoc(inviteRef, {
        id: secureToken,
        studentId: studentId,
        studentName: student.name,
        studentEmail: student.email || '',
        examId: exam.id,
        examTitle: exam.title,
        schoolId: profile?.schoolId || null,
        status: 'sent',
        createdAt: new Date().toISOString()
      });

      const inviteUrl = `${window.location.origin}/login?invite=${secureToken}`;
      setActiveInvite({
        url: inviteUrl,
        studentName: student.name,
        examTitle: exam.title
      });

      toast.success(`Email & SMS delivery gateway triggered for "${student.name}"! Single-use secure token issued.`);
    } catch (err) {
      toast.error("Failed to generate secure invitation link");
    }
  };

  const handleReTriggerInvite = async (student: any, attempt: any) => {
    if (!selectedExamId) {
      toast.error("Please pick an assessment paper to invite students.");
      return;
    }

    const exam = exams.find(e => e.id === selectedExamId);
    if (!exam) return;

    const studentId = student.uid || student.id;
    const toastId = toast.loading("Updating re-attempt security policies...");
    try {
      // 1. Set canReattempt = true in attempt document
      const attemptRef = doc(db, 'attempts', attempt.id);
      await updateDoc(attemptRef, {
        canReattempt: true
      });

      // 2. Locate or create invite, update status to 'sent' so it is active
      let activeInviteId = '';
      const existingInvite = invitations.find(inv => inv.studentId === studentId && inv.examId === selectedExamId);

      if (existingInvite) {
        activeInviteId = existingInvite.id;
        const inviteRef = doc(db, 'invitations', activeInviteId);
        await updateDoc(inviteRef, {
          status: 'sent'
        });
      } else {
        const secureToken = crypto.randomUUID();
        activeInviteId = secureToken;
        const inviteRef = doc(db, 'invitations', secureToken);
        await setDoc(inviteRef, {
          id: secureToken,
          studentId: studentId,
          studentName: student.name,
          studentEmail: student.email || '',
          examId: exam.id,
          examTitle: exam.title,
          schoolId: profile?.schoolId || null,
          status: 'sent',
          createdAt: new Date().toISOString()
        });
      }

      const inviteUrl = `${window.location.origin}/login?invite=${activeInviteId}`;
      setActiveInvite({
        url: inviteUrl,
        studentName: student.name,
        examTitle: exam.title
      });

      toast.success(`Re-attempt successfully enabled! Dynamic exam gatekeeper link generated for ${student.name}`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Failed to enable re-attempt and generate link", { id: toastId });
    }
  };

  const handleToggleReattempt = async (student: any, attempt: any) => {
    const studentId = student.uid || student.id;
    const exam = exams.find(e => e.id === selectedExamId);
    if (!exam) return;

    const newCanReattempt = !attempt.canReattempt;
    const toastId = toast.loading(newCanReattempt ? "Enabling re-attempt..." : "Disabling re-attempt...");
    try {
      // Toggle canReattempt in attempt doc
      const attemptRef = doc(db, 'attempts', attempt.id);
      await updateDoc(attemptRef, {
        canReattempt: newCanReattempt
      });

      // Also set invitation status back to 'sent' if enabling re-attempt, so they can use the link again!
      const existingInvite = invitations.find(inv => inv.studentId === studentId && inv.examId === selectedExamId);
      if (existingInvite) {
        const inviteRef = doc(db, 'invitations', existingInvite.id);
        await updateDoc(inviteRef, {
          status: newCanReattempt ? 'sent' : 'used'
        });
      }

      toast.success(newCanReattempt ? `Re-attempt enabled for "${student.name}"! The student can now use their entry link.` : `Re-attempt disabled for "${student.name}".`, { id: toastId });
    } catch (error) {
      console.error("Error toggling re-attempt:", error);
      toast.error("Failed to toggle re-attempt status", { id: toastId });
    }
  };

  // Batch Generate Secure UUIDv4 Login Tokens for all candidates who lack one for the selected exam
  const handleBatchGenerateTokens = async () => {
    if (!profile?.schoolId) return;
    if (!selectedExamId || selectedExamId === 'none') {
      toast.error("Please select an active assessment context to perform batch token issuance.");
      return;
    }
    const exam = exams.find(e => e.id === selectedExamId);
    if (!exam) return;

    const studentsWithoutInvite = students.filter(student => {
      const studentId = student.uid || student.id;
      return !invitations.some(inv => inv.studentId === studentId && inv.examId === selectedExamId);
    });

    if (studentsWithoutInvite.length === 0) {
      toast.info("All registered candidates already possess active secure entry credentials for this exam.");
      return;
    }

    setIsGeneratingBatch(true);
    const toastId = toast.loading(`Auto-generating secure UUIDv4 assessment tokens for ${studentsWithoutInvite.length} candidates...`);

    try {
      const batch = writeBatch(db);
      studentsWithoutInvite.forEach(student => {
        const secureToken = crypto.randomUUID();
        const inviteRef = doc(db, 'invitations', secureToken);
        batch.set(inviteRef, {
          id: secureToken,
          studentId: student.uid || student.id,
          studentName: student.name,
          studentEmail: student.email || '',
          examId: exam.id,
          examTitle: exam.title,
          schoolId: profile.schoolId,
          status: 'sent',
          createdAt: new Date().toISOString()
        });
      });

      await batch.commit();
      toast.success(`${studentsWithoutInvite.length} unique assessment tokens successfully auto-generated and securely bound!`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Discrepancy issuing bulk credentials.", { id: toastId });
    } finally {
      setIsGeneratingBatch(false);
    }
  };

  // Export current exam links list with students as Excel spreadsheet
  const handleExportBatchLinks = () => {
    if (!selectedExamId || selectedExamId === 'none') return;
    const exam = exams.find(e => e.id === selectedExamId);
    if (!exam) return;

    const dataToExport = students.map(student => {
      const studentId = student.uid || student.id;
      const associatedInvite = invitations.find(inv => inv.studentId === studentId && inv.examId === selectedExamId);
      const secureToken = associatedInvite ? associatedInvite.id : 'NOT GENERATED';
      const secureLink = associatedInvite ? `${window.location.origin}/login?invite=${associatedInvite.id}` : 'Click "Trigger Link" or "Generate Tokens" to build';

      return {
        "Student Name": student.name,
        "Email": student.email,
        "Roll/Register ID": student.rollNumber || 'N/A',
        "Date of Birth (DOB)": student.dob || 'N/A',
        "Class": student.class || 'N/A',
        "Section": student.section || 'N/A',
        "Assessment Title": exam.title,
        "Secure Invitation Token (UUIDv4)": secureToken,
        "Direct Passwordless Entry URL": secureLink,
        "Delivery Status": associatedInvite ? associatedInvite.status : 'Awaiting Generation'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);

    const columnWidths = [
      { wch: 25 }, // Name
      { wch: 30 }, // Email
      { wch: 15 }, // Roll/Register ID
      { wch: 20 }, // Date of Birth (DOB)
      { wch: 15 }, // Class
      { wch: 10 }, // Section
      { wch: 30 }, // Assessment
      { wch: 40 }, // Token
      { wch: 80 }, // URL
      { wch: 15 }, // Status
    ];
    worksheet['!cols'] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Access Tokens");

    const sanitizedTitle = exam.title.replace(/[^a-zA-Z0-9]/g, '_');
    XLSX.writeFile(workbook, `Assessment_Tokens_${sanitizedTitle}.xlsx`);
    toast.success("Excel sheet containing secure entry codes successfully downloaded!");
  };

  // Subscribe to viewed student's past attempts to chart development trends
  useEffect(() => {
    if (!viewingStudentAnalytics) return;
    const q = query(
      collection(db, 'attempts'),
      where('schoolId', '==', profile?.schoolId || ''),
      where('studentId', '==', viewingStudentAnalytics.uid || viewingStudentAnalytics.id),
      where('status', '==', 'completed')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setStudentAttempts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'attempts');
    });
    return () => unsubscribe();
  }, [viewingStudentAnalytics, profile?.schoolId]);

  const openEditDialog = (student: any) => {
    setEditingStudent(student);
    setEditForm({
      name: student.name || '',
      email: student.email || '',
      class: student.class || '',
      section: student.section || '',
      rollNumber: student.rollNumber || '',
      dob: student.dob || ''
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingStudent) return;
    if (!editForm.name.trim()) {
      toast.error("Name is a required property.");
      return;
    }

    const trimmedEmail = editForm.email.trim();
    if (trimmedEmail) {
      const dbDuplicateEmail = students.find(ds => 
        (ds.uid || ds.id) !== (editingStudent.uid || editingStudent.id) && 
        ds.email && ds.email.toLowerCase() === trimmedEmail.toLowerCase()
      );
      if (dbDuplicateEmail) {
        toast.error(`Duplicate Email address "${trimmedEmail}" is already registered.`);
        return;
      }
    }

    const toastId = toast.loading("Updating scholarship profile records...");
    try {
      const studentId = editingStudent.uid || editingStudent.id;
      const studentRef = doc(db, 'users', studentId);
      await setDoc(studentRef, {
        ...editingStudent,
        name: editForm.name.trim(),
        email: trimmedEmail,
        class: editForm.class,
        section: editForm.section,
        rollNumber: editForm.rollNumber.trim(),
        dob: editForm.dob.trim()
      }, { merge: true });
      toast.success("Student profile successfully re-registered!", { id: toastId });
      setIsEditDialogOpen(false);
      setEditingStudent(null);
    } catch (err) {
      console.error(err);
      toast.error("Discrepancy modifying profile record node.", { id: toastId });
    }
  };

  const confirmDeleteStudent = (student: any) => {
    setDeletingStudent(student);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteExecute = async () => {
    if (!deletingStudent) return;
    const toastId = toast.loading("Purging student registration context, attempts, and grade percentages...");
    try {
      const studentId = deletingStudent.uid || deletingStudent.id;
      
      const batch = writeBatch(db);

      // 1. Fetch attempts for the student
      const attemptsQuery = query(collection(db, 'attempts'), where('studentId', '==', studentId));
      const attemptsSnap = await getDocs(attemptsQuery);
      attemptsSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 2. Fetch error books for the student
      const errorBooksQuery = query(collection(db, 'error_books'), where('studentId', '==', studentId));
      const errorBooksSnap = await getDocs(errorBooksQuery);
      errorBooksSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 3. Fetch invitations for the student
      const invitationsQuery = query(collection(db, 'invitations'), where('studentId', '==', studentId));
      const invitationsSnap = await getDocs(invitationsQuery);
      invitationsSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 4. Delete the student profile document itself
      const studentDocRef = doc(db, 'users', studentId);
      batch.delete(studentDocRef);

      // Commit the atomic cascade deletion
      await batch.commit();

      toast.success("Academic records and all exam activity purged successfully.", { id: toastId });
      setIsDeleteDialogOpen(false);
      setDeletingStudent(null);
    } catch (err) {
      console.error(err);
      toast.error("Discrepancy executing folder delete block.", { id: toastId });
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedToken(url);
    toast.success("Secure invitation URL copied to cache!");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const filteredStudents = students;

  return (
    <div className="space-y-10 px-1 md:px-0">
      
      {/* SECTION 1: Standardized Bulk Uploading with strict validations */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-black text-slate-900 tracking-tight text-wrap break-words">Bulk Student Onboarding</h2>
          <p className="text-slate-500 mt-1 text-wrap break-words text-sm font-medium">Easily onboard student batches via Excel spreadsheets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <Dialog open={isManualOpen} onOpenChange={setIsManualOpen}>
            <DialogTrigger 
              render={
                <Button variant="outline" className="flex-grow sm:flex-initial border-indigo-200 text-indigo-600 hover:bg-indigo-50 h-11 text-xs font-black uppercase tracking-wider rounded-xl cursor-pointer transition-all duration-300 shadow-md shadow-indigo-100 hover:scale-[1.02]">
                  <UserPlus className="h-4 w-4 mr-2 flex-shrink-0" /> Add Scholar Manually
                </Button>
              }
            />
            <DialogContent className="w-full max-w-[95vw] sm:max-w-md max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-[30px] border-none shadow-[0_25px_50px_-12px_rgba(4f,70,229,0.25)] bg-white animate-in zoom-in-95">
              
              {/* Premium Top Hero Header */}
              <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 text-white p-6 pb-8 border-b border-white/5">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(99,102,241,0.2),transparent)] pointer-events-none" />
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-xl pointer-events-none" />
                <div className="relative z-10 space-y-2">
                  <div className="inline-flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-400/25 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest text-indigo-300">
                    <Sparkles className="h-3 w-3 text-[#FFE28A] animate-pulse" />
                    Registrar Node
                  </div>
                  <DialogTitle className="text-xl font-black text-slate-100 tracking-tight text-wrap break-words">Register Candidate</DialogTitle>
                  <div className="inline-block bg-white/10 text-amber-200 text-[10px] font-mono px-3 py-1 rounded-md border border-white/10 uppercase font-black">
                    🏫 Institution: {schoolName}
                  </div>
                  <DialogDescription className="text-slate-300 text-xs mt-1 leading-relaxed text-wrap break-words">
                    Load academic credentials to issue secure assessment invitations instantly.
                  </DialogDescription>
                </div>
              </div>
               
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                
                {/* Field 1: Name */}
                <div className="grid gap-1.5 relative">
                  <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Candidate Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-indigo-400 pointer-events-none" />
                    <Input 
                      className="w-full h-12 pl-11 border-slate-200/80 hover:border-slate-300 focus:border-indigo-600 rounded-xl text-sm font-semibold transition-all shadow-xs" 
                      value={manualStudent.name} 
                      onChange={e => setManualStudent({...manualStudent, name: e.target.value})} 
                      placeholder="e.g. Alexander Pierce" 
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium">Use official record names for certificate mapping.</p>
                </div>

                {/* Field 2: Email */}
                <div className="grid gap-1.5 relative">
                  <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Secure Email Address (Optional)</Label>
                  <div className="relative">
                    <Inbox className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-indigo-400 pointer-events-none" />
                    <Input 
                      className="w-full h-12 pl-11 border-slate-200/80 hover:border-slate-300 focus:border-indigo-600 rounded-xl text-sm font-semibold transition-all shadow-xs" 
                      type="email" 
                      value={manualStudent.email} 
                      onChange={e => setManualStudent({...manualStudent, email: e.target.value})} 
                      placeholder="e.g. alexander@school.com" 
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium">Invitation passes with login hashes will ship here.</p>
                </div>

                {/* Academic Level & Section layout */}
                <div className="grid grid-cols-2 gap-4">
                  
                  <div className="grid gap-1.5">
                    <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Academic Grade</Label>
                    <Select 
                      value={manualStudent.class} 
                      onValueChange={val => setManualStudent({...manualStudent, class: val})}
                    >
                      <SelectTrigger className="w-full h-12 bg-white border-2 border-slate-300 hover:border-indigo-500 focus:border-indigo-650 rounded-xl text-sm font-bold text-slate-900 transition-all shadow-sm px-4 justify-between">
                        <SelectValue placeholder="Pick Grade" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[180px] overflow-y-auto bg-white border-2 border-slate-300 shadow-xl rounded-xl p-1 z-50">
                        {ACADEMIC_LEVELS.map(level => (
                          <SelectItem key={level} value={level} className="text-xs font-bold font-sans text-slate-800 hover:bg-slate-50 cursor-pointer py-1.5 px-2.5 rounded-lg">
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Section</Label>
                    <Input 
                      className="w-full h-12 border-slate-200/80 hover:border-slate-300 focus:border-indigo-600 rounded-xl text-sm font-bold text-center transition-all shadow-xs" 
                      value={manualStudent.section} 
                      onChange={e => setManualStudent({...manualStudent, section: e.target.value})} 
                      placeholder="e.g. B" 
                    />
                  </div>

                </div>

                {/* Field 4: Roll Register Number */}
                <div className="grid gap-1.5 relative">
                  <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Institution Register / Roll Number</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-indigo-400 pointer-events-none" />
                    <Input 
                      className="w-full h-12 pl-11 border-slate-200/80 hover:border-slate-300 focus:border-indigo-600 rounded-xl font-mono text-sm font-bold transition-all shadow-xs" 
                      value={manualStudent.rollNumber} 
                      onChange={e => setManualStudent({...manualStudent, rollNumber: e.target.value})} 
                      placeholder="e.g. REG-78401" 
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium">Must be a unique code to prevent registry intersection.</p>
                </div>

                {/* Field 5: Date of Birth */}
                <div className="grid gap-1.5 relative">
                  <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Date of Birth (DOB)</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-indigo-400 pointer-events-none" />
                    <Input 
                      type="date"
                      className="w-full h-12 pl-11 border-slate-200/80 hover:border-slate-300 focus:border-indigo-600 rounded-xl text-sm font-semibold transition-all shadow-xs cursor-pointer" 
                      value={manualStudent.dob} 
                      onChange={e => setManualStudent({...manualStudent, dob: e.target.value})} 
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium">Acts as a unique secondary verification field.</p>
                </div>

              </div>
               
              {/* Premium Footer with Gradient Trigger */}
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
                <Button 
                  onClick={handleManualAdd} 
                  className="w-full h-12 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md shadow-indigo-200 cursor-pointer hover:scale-[1.01]"
                >
                  Confirm Registration
                </Button>
                <div className="flex items-center justify-center gap-1 text-[9px] text-slate-400 font-medium pt-1">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  <span>Saves securely to encrypted institution database</span>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={downloadTemplate} className="flex-grow sm:flex-initial border-slate-200 h-11 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer">
            <Download className="h-4 w-4 mr-2 flex-shrink-0" /> Template Template
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 border-indigo-200 shadow-sm bg-indigo-50/10 border-dashed border-2 rounded-[30px] p-2 flex flex-col justify-center">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="h-16 w-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 text-indigo-600 border border-slate-100">
                <Upload className="h-8 w-8" />
              </div>
              <h3 className="font-bold text-slate-900 text-base">Upload Spreadsheet</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-[280px] sm:max-w-full text-balance px-2">Drop your .xlsx or .csv student list here to auto-onboard.</p>
              
              <div className="mt-6 w-full">
                <Label htmlFor="bulk-upload" className="block w-full border-2 border-indigo-100 bg-white hover:bg-indigo-50 border-dashed rounded-2xl p-6 cursor-pointer transition-all">
                  <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Select Worksheet</span>
                  <Input id="bulk-upload" type="file" className="hidden" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} />
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-slate-200 shadow-xl shadow-slate-100 rounded-[30px] overflow-hidden min-h-[350px] flex flex-col justify-between">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400">Data Import Sync Station</CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-500 mt-1">Review validation alerts and schema consistency before committing.</CardDescription>
            </div>
            {duplicateWarnings.length > 0 && (
              <Badge className="bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] space-x-1 py-1 rounded-md">
                <ShieldAlert size={12} />
                <span>{duplicateWarnings.length} Warnings</span>
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-0 flex-grow flex flex-col justify-between">
            {previewData.length > 0 ? (
              <div className="divide-y divide-slate-100 flex-grow flex flex-col justify-between">
                <div>
                  {/* Duplicate checks warnings panel */}
                  {duplicateWarnings.length > 0 && (
                    <div className="p-4 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium space-y-1">
                      <p className="font-bold text-[11px] uppercase tracking-wider flex items-center gap-1">
                        <AlertCircle size={14} className="text-amber-600" />
                        A ASSESSMENT GATEWAY BLOCKED: DUPLICATES IDENTIFIED
                      </p>
                      <div className="max-h-[100px] overflow-y-auto font-mono text-[10px] space-y-1 pt-1 opacity-90 pl-5 list-disc leading-relaxed">
                        {duplicateWarnings.map((w, i) => (
                          <div key={i}>• {w}</div>
                        ))}
                      </div>
                      <p className="text-[10px] italic text-amber-600/90 pt-1">Note: You are strongly advised to clean duplicates to prevent system conflicts.</p>
                    </div>
                  )}

                  <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-100">
                    {previewData.map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between p-4 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-slate-150 bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">
                            {s.name?.toString().substring(0,1)}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 leading-none">{s.name}</p>
                            <p className="text-[10px] text-slate-400 mt-1">{s.email}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Roll: {s.rollNumber}</p>
                          <p className="text-[10px] text-indigo-500 font-bold">Class {s.class}-{s.section}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 bg-slate-50 flex items-center justify-between border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-500">Ready to sync {previewData.length} records</p>
                  <Button 
                    disabled={isUploading} 
                    className="bg-indigo-600 hover:bg-slate-900 rounded-xl px-8 font-bold text-xs h-10"
                    onClick={processImport}
                  >
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Import'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-20 text-slate-300 flex-grow">
                <AlertCircle className="h-10 w-10 mb-4 opacity-25" />
                <p className="text-sm font-black opacity-30 uppercase tracking-wider text-xs">Awaiting Spreadsheet File</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SECTION 2: Interactive Student Registry & Secure Exam invites Dispatch Panel */}
      <Card className="border-slate-200 hover:border-slate-300 shadow-xl shadow-slate-100/50 rounded-[40px] overflow-hidden bg-white">
        <CardHeader className="bg-slate-900 text-white p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-indigo-500/20 text-indigo-300 border-0 font-black text-[10px] uppercase px-3 py-1 rounded-md">Live Control Tower</Badge>
                <span className="text-[10px] font-black tracking-widest text-[#FFE28A] uppercase">single-use secure dispatcher</span>
              </div>
              <CardTitle className="text-2xl font-black uppercase tracking-tight">Active Scholar Directory</CardTitle>
              <CardDescription className="text-indigo-200 mt-1 font-medium text-xs">Verify credentials and trigger instant examination access triggers.</CardDescription>
            </div>

            {/* Global Target Exam Selection */}
            <div className="bg-white/10 p-4 rounded-3xl border border-white/10 max-w-sm w-full relative">
              <Label className="text-[10px] font-black uppercase text-indigo-300 tracking-wider">Select Assessment Context</Label>
              <div className="relative mt-2">
                <button
                  type="button"
                  onClick={() => setExamDropdownOpen(!examDropdownOpen)}
                  className="w-full h-12 bg-white text-slate-950 rounded-xl font-black text-xs border-2 border-indigo-400 hover:border-indigo-600 shadow-sm focus:ring-4 focus:ring-indigo-500/20 transition-all px-4 flex items-center justify-between cursor-pointer"
                >
                  <span className="flex-1 text-left block truncate text-slate-900 font-bold">
                    {exams.find(e => e.id === selectedExamId) 
                      ? exams.find(e => e.id === selectedExamId)?.title 
                      : "Assessments Library"}
                  </span>
                  <ChevronDown className="h-4 w-4 ml-2 text-indigo-600 shrink-0" />
                </button>

                {examDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-[100]" 
                      onClick={() => {
                        setExamDropdownOpen(false);
                        setExamSearchText('');
                      }} 
                    />
                    <div className="absolute left-0 right-0 mt-1.5 bg-white border-2 border-indigo-400 shadow-2xl rounded-2xl p-3 z-[110] flex flex-col gap-2 max-h-[320px] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                      <div className="relative flex items-center shrink-0">
                        <Search className="absolute left-3 h-3.5 w-3.5 text-indigo-500" />
                        <input
                          type="text"
                          value={examSearchText}
                          onChange={(e) => setExamSearchText(e.target.value)}
                          placeholder="Search assessments..."
                          className="w-full h-9 pl-9 pr-3 bg-indigo-50/50 border-2 border-indigo-100 focus:border-indigo-400 focus:bg-white text-xs font-bold text-slate-800 rounded-lg outline-none transition-all"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                        {(() => {
                          const queryFiltered = exams.filter(e => 
                            (e.title || '').toLowerCase().includes(examSearchText.toLowerCase()) ||
                            (e.subject || '').toLowerCase().includes(examSearchText.toLowerCase())
                          );
                          const sliced = queryFiltered.slice(0, 50);
                          
                          if (queryFiltered.length === 0) {
                            return (
                              <div className="text-center py-6 text-xs text-slate-400 font-bold">
                                No matching assessments found
                              </div>
                            );
                          }
                          
                          return (
                            <>
                              {sliced.map(e => {
                                const isSelected = e.id === selectedExamId;
                                return (
                                  <button
                                    key={e.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedExamId(e.id);
                                      setExamDropdownOpen(false);
                                      setExamSearchText('');
                                    }}
                                    className={`w-full text-left font-black text-xs cursor-pointer py-2 px-3 rounded-lg flex items-center justify-between transition-colors ${
                                      isSelected 
                                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 font-black' 
                                        : 'text-slate-900 hover:bg-indigo-50 font-black'
                                    }`}
                                  >
                                    <span className="truncate pr-2">
                                      {e.title} - <span className={`text-[10px] font-bold ${isSelected ? 'text-indigo-200' : 'text-slate-450'}`}>({e.subject})</span>
                                    </span>
                                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                                  </button>
                                );
                              })}
                              
                              {queryFiltered.length > 50 && (
                                <div className="text-[10px] text-center text-slate-500 font-bold pt-1.5 border-t border-slate-100 italic">
                                  Showing top 50 matches of {queryFiltered.length}.
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardHeader>

        {/* Dynamic General Shareable Exam Link Row */}
        {selectedExamId && selectedExamId !== 'none' && (
          <div className="border-b border-slate-200 divide-y divide-slate-150 bg-white">
            {/* Row 1: Common Shared Entry Link */}
            <div className={`p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 transition-all duration-300 ${dynamicToken ? 'bg-emerald-50/10 border-l-4 border-l-emerald-500' : 'bg-indigo-50/10'}`}>
              <div className="space-y-2 max-w-xl">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black uppercase text-indigo-700 tracking-wider flex items-center gap-1.5 font-sans">
                    <Link size={13} className="text-indigo-600" />
                    Method A: General Portal Access URL
                  </p>
                  {dynamicToken ? (
                    <Badge className="bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-600 border-0 font-black text-[9px] uppercase tracking-wider px-2 py-0.5 rounded flex items-center gap-1">
                      <ShieldAlert size={10} className="text-emerald-500 animate-pulse" />
                      Dynamic Token Sealing Enabled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] text-slate-400 font-bold border-slate-200">
                      Standard Predictable Parameters
                    </Badge>
                  )}
                </div>
                
                <p className="text-xs font-semibold text-slate-500 leading-relaxed font-sans">
                  {dynamicToken 
                    ? "Cryptographically signed URL active. Students must enter with this unique signature. The portal will automatically reject any tampered param variants."
                    : "Send this shared entry page URL to students. They must manually sign in using their Student Name and Roll Number. Revoke predictability by sealing the link below!"
                  }
                </p>

                {/* Switch Actions for dynamic token generation */}
                <div className="pt-1 flex items-center gap-2">
                  {dynamicToken ? (
                    <button 
                      onClick={handleDeactivateDynamicSecurity}
                      className="text-[10px] font-black uppercase text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1"
                    >
                      Disable Dynamic Token and Revert to Standard
                    </button>
                  ) : (
                    <button 
                      onClick={handleActivateDynamicSecurity}
                      disabled={isGeneratingDynamicToken}
                      className="text-[10px] font-black uppercase text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1.5"
                    >
                      {isGeneratingDynamicToken ? "Sealing Links..." : "🔒 Seal Link: Generate Dynamic Signature Token"}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 w-full lg:w-auto">
                <div className="flex border-2 border-slate-900 rounded-2xl overflow-hidden bg-white shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] self-stretch lg:self-auto max-w-md w-full">
                  <input 
                    type="text" 
                    readOnly 
                    value={dynamicToken 
                      ? `${window.location.origin}/student/exam-entry?token=${dynamicToken}`
                      : `${window.location.origin}/student/exam-entry?examId=${selectedExamId}&schoolId=${profile?.schoolId}`
                    } 
                    className="px-4 py-2.5 bg-transparent text-slate-755 font-mono text-[10.5px] outline-none select-all w-full min-w-[220px]"
                  />
                  <Button 
                    onClick={() => {
                      const shareUrl = dynamicToken 
                        ? `${window.location.origin}/student/exam-entry?token=${dynamicToken}`
                        : `${window.location.origin}/student/exam-entry?examId=${selectedExamId}&schoolId=${profile?.schoolId}`;
                      handleCopyLink(shareUrl);
                    }}
                    className="bg-slate-900 hover:bg-slate-800 text-white border-l-2 border-slate-900 h-auto font-black text-[9px] uppercase tracking-wider px-5 rounded-none cursor-pointer"
                  >
                    {copiedToken === (dynamicToken 
                      ? `${window.location.origin}/student/exam-entry?token=${dynamicToken}`
                      : `${window.location.origin}/student/exam-entry?examId=${selectedExamId}&schoolId=${profile?.schoolId}`
                    ) ? <Check size={14} /> : <Copy size={13} />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Row 2: Secure Individual Passwordless Link Auto-Generator Hub */}
            <div className="p-6 bg-slate-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl font-sans">
                <p className="text-[10px] font-black uppercase text-emerald-700 tracking-wider flex items-center gap-1.5">
                  <Sparkles size={13} className="text-emerald-600" />
                  Method B: Crypto-Secure Single-Use Passkeys (UUIDv4)
                </p>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                  Instantly auto-generate unique, non-guessable secure entry links for each individual student. Once generated, download the Excel spreadsheet to easily share custom URLs with candidates.
                </p>
                
                {/* Visual counts */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <div className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span>Scholars Directory: <strong>{students.length}</strong></span>
                  </div>
                  <div className="text-[10px] font-bold text-emerald-700 bg-emerald-50/60 border border-emerald-200/50 px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Secure Passes Issued: <strong>{invitations.filter(inv => inv.examId === selectedExamId).length}</strong></span>
                  </div>
                  {students.length > invitations.filter(inv => inv.examId === selectedExamId).length && (
                    <div className="text-[10px] font-bold text-amber-700 bg-amber-50/60 border border-amber-200/50 px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      <span>Pending Issuance: <strong>{students.length - invitations.filter(inv => inv.examId === selectedExamId).length}</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Button 
                  onClick={handleBatchGenerateTokens}
                  disabled={isGeneratingBatch || students.length === 0}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-black text-[10px] uppercase tracking-widest h-11 px-5 rounded-2xl shadow-sm cursor-pointer flex items-center gap-2"
                >
                  {isGeneratingBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles size={13} />}
                  <span>Batch Generate Keys</span>
                </Button>

                <Button 
                  onClick={handleExportBatchLinks}
                  disabled={students.length === 0 || invitations.filter(inv => inv.examId === selectedExamId).length === 0}
                  className="bg-white hover:bg-slate-50 text-slate-900 border-2 border-slate-900 font-black text-[10px] uppercase tracking-widest h-11 px-5 rounded-2xl shadow-sm cursor-pointer flex items-center gap-2"
                >
                  <Download size={13} />
                  <span>Export Spreadsheet</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        <CardContent className="p-0">
          <div className="p-6 border-b border-slate-100 flex items-center bg-slate-50/50 gap-4">
            <Search className="text-slate-400" size={20} />
            <Input 
              placeholder="Search directory by name, email or register code..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="border-none bg-transparent hover:bg-transparent shadow-none font-medium text-slate-800 placeholder-slate-400 text-sm focus-visible:ring-0 w-full"
            />
          </div>

          <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
            {filteredStudents.map((student) => {
              const studentId = student.uid || student.id;
              const hasInvite = selectedExamId && selectedExamId !== 'none' && invitations.some(inv => inv.studentId === studentId && inv.examId === selectedExamId);
              const attempt = selectedExamId && selectedExamId !== 'none' && currentAttempts.find(a => a.studentId === studentId && a.examId === selectedExamId);
              const isCompleted = attempt?.status === 'completed';
              const canReattempt = attempt?.canReattempt;
              return (
                <div key={student.id} className="px-8 py-5 flex flex-col md:flex-row md:items-center justify-between hover:bg-slate-50/70 transition-colors gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="h-12 w-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100 font-bold text-base shadow-sm">
                      {student.name?.substring(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                         <span className="text-base font-black text-slate-900 leading-none">{student.name}</span>
                        <Badge variant="outline" className="text-[9px] px-2 py-0.5 rounded bg-slate-50 font-black text-slate-400 border-slate-200">
                          CLASS {student.class || 'N/A'}-{student.section || 'N/A'}
                        </Badge>
                        {hasInvite && !isCompleted && (
                          <Badge className="bg-emerald-50 hover:bg-emerald-50 text-emerald-700 border-emerald-100 font-black text-[9px] px-2 py-0.5 rounded flex items-center gap-1">
                            <CheckCircle2 size={10} className="text-emerald-600" />
                            <span>SECURE PASS READY</span>
                          </Badge>
                        )}
                        {isCompleted && (
                          canReattempt ? (
                            <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 border-amber-200 font-black text-[9px] px-2 py-0.5 rounded flex items-center gap-1 animate-pulse">
                              <CheckCircle2 size={10} className="text-amber-600" />
                              <span>RE-ATTEMPT ENABLED</span>
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-800 border-emerald-200 font-black text-[9px] px-2 py-0.5 rounded flex items-center gap-1">
                              <CheckCircle2 size={10} className="text-emerald-600" />
                              <span>EXAM COMPLETED</span>
                            </Badge>
                          )
                        )}
                      </div>
                      <p className="text-xs font-semibold text-slate-400 mt-1">{student.email}</p>
                    </div>
                  </div>

                <div className="flex flex-wrap items-center gap-3 self-end md:self-auto font-sans">
                  <div className="text-right hidden sm:block mr-2">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest leading-none">Register ID</span>
                    <p className="text-sm font-black text-slate-800 mt-1 font-mono">{student.rollNumber || 'N/A'}</p>
                  </div>

                  <div className="text-right hidden sm:block mr-2">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest leading-none">Date of Birth</span>
                    <p className="text-sm font-black text-slate-600 mt-1">{student.dob || 'Unset'}</p>
                  </div>

                  {/* Actions Deck (Read Analytics, Update Edit, Delete) */}
                  <div className="flex items-center gap-1.5 bg-slate-100/60 p-1 rounded-xl border border-slate-200/40">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setViewingStudentAnalytics(student);
                        setIsAnalyticsDialogOpen(true);
                      }}
                      className="h-9 w-9 rounded-lg hover:bg-white hover:text-indigo-650 text-slate-500 transition-colors"
                      title="Performance Trends"
                    >
                      <BarChart3 size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(student)}
                      className="h-9 w-9 rounded-lg hover:bg-white hover:text-[#FFE28A] text-slate-500 transition-colors"
                      title="Edit Profile"
                    >
                      <Edit size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => confirmDeleteStudent(student)}
                      className="h-9 w-9 rounded-lg hover:bg-red-50 hover:text-red-650 text-slate-500 transition-colors"
                      title="Delete Student"
                    >
                      <Trash2 size={15} className="text-red-500" />
                    </Button>
                  </div>
                  
                  {isCompleted ? (
                    <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                      {canReattempt && (
                        <Button
                          variant="outline"
                          onClick={() => handleToggleReattempt(student, attempt)}
                          className="border-rose-200 hover:bg-rose-50 text-rose-700 font-black text-[10px] uppercase tracking-widest h-10 rounded-xl px-3 cursor-pointer transition-all hover:border-rose-300"
                          title="Disable Re-attempt"
                        >
                          Revoke
                        </Button>
                      )}
                      <Button 
                        onClick={() => handleReTriggerInvite(student, attempt)}
                        disabled={!selectedExamId || selectedExamId === 'none'}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-black text-[10px] uppercase tracking-widest h-10 rounded-xl shadow-md px-4 cursor-pointer flex items-center gap-1.5 group transition-all"
                      >
                        <span>Re-trigger Link</span>
                        <Send size={11} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </Button>
                    </div>
                  ) : (
                    <Button 
                      onClick={() => handleTriggerInvite(student)}
                      disabled={!selectedExamId || selectedExamId === 'none'}
                      className="bg-indigo-600 hover:bg-slate-950 text-white font-black text-[10px] uppercase tracking-widest h-10 rounded-xl shadow-md px-4 cursor-pointer flex items-center gap-1.5 group transition-all"
                    >
                      <span>Trigger Link</span>
                      <Send size={11} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </Button>
                  )}
                </div>
              </div>
              );
            })}

            {filteredStudents.length === 0 && (
              <div className="py-24 text-center text-slate-400 bg-slate-50/20">
                <User className="h-12 w-12 mx-auto mb-4 opacity-25" />
                <h4 className="font-bold text-slate-900 text-sm">No Scholars Registered</h4>
                <p className="text-xs text-slate-400 mt-1">Manual add or bulk upload students to build your directory.</p>
              </div>
            )}
          </div>

          {/* Dynamic Onboarding Pagination Controls */}
          {totalStudentsCount > 0 && (
            <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">Rows per page:</span>
                <select 
                  value={studentPageSize} 
                  onChange={e => {
                    setStudentPageSize(parseInt(e.target.value));
                    setStudentPage(1);
                  }}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                <span className="text-xs font-bold text-slate-400 ml-4 font-mono">
                  Showing {(studentPage - 1) * studentPageSize + 1}-{Math.min(studentPage * studentPageSize, totalStudentsCount)} of {totalStudentsCount}
                </span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={studentPage === 1 || loadingStudents}
                  type="button"
                  onClick={() => setStudentPage(studentPage - 1)}
                  className="h-9 px-4 rounded-xl border-slate-200 text-xs font-black uppercase tracking-wider bg-white cursor-pointer font-sans"
                >
                  Previous
                </Button>
                <div className="h-9 w-9 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-center text-xs font-black text-indigo-700 select-none font-mono">
                  {loadingStudents ? <Loader2 className="h-3 w-3 animate-spin text-indigo-500" /> : studentPage}
                </div>
                <Button 
                  type="button"
                  variant="outline" 
                  size="sm" 
                  disabled={studentPage * studentPageSize >= totalStudentsCount || loadingStudents}
                  onClick={() => setStudentPage(studentPage + 1)}
                  className="h-9 px-4 rounded-xl border-slate-200 text-xs font-black uppercase tracking-wider bg-white cursor-pointer font-sans"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECURE DISPATCH CONSOLE - SINGLE USE LINK INSPECTOR */}
      <Dialog open={activeInvite !== null} onOpenChange={(open) => !open && setActiveInvite(null)}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-lg p-0 rounded-3xl overflow-hidden border-none shadow-2xl">
          <div className="bg-slate-900 text-white p-8">
            <div className="flex items-center gap-3.5 mb-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <div className="h-2 w-2 rounded-full bg-emerald-400 absolute" />
              <span className="text-[10px] font-black uppercase tracking-widest text-[#B5F2D2]">Secure Dispatch Active</span>
            </div>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-[#FFE28A]">Invited to: {activeInvite?.examTitle}</DialogTitle>
            <DialogDescription className="text-slate-300 mt-1.5 font-semibold text-xs leading-relaxed">
              We generated an unguessable single-use secure authorization pass for candidate <strong>{activeInvite?.studentName}</strong>. 
            </DialogDescription>
          </div>
          
          <div className="p-8 space-y-6">
            <div className="bg-emerald-500/10 border-2 border-emerald-500/15 p-5 rounded-2xl text-emerald-800 text-xs font-semibold leading-relaxed flex items-start gap-3">
              <span className="text-xl">🚀</span>
              <div>
                <p className="font-black text-[11px] uppercase tracking-wider text-emerald-900">SIMULATED SMS & EMAIL DELIVERED</p>
                <p className="text-[11.5px] mt-1 opacity-90">Our assessment gateway fired API triggers carrying the direct-session URL with 128-bit verification hashes to key student contacts.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Candidate Secure Single-Use URL</Label>
              <div className="flex border-[3px] border-slate-900 rounded-2xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-slate-50">
                <input 
                  type="text" 
                  readOnly 
                  value={activeInvite?.url || ''} 
                  className="flex-grow px-4 py-3 bg-transparent text-slate-800 font-mono text-[11px] outline-none select-all"
                />
                <Button 
                  onClick={() => activeInvite && handleCopyLink(activeInvite.url)}
                  className="bg-slate-900 hover:bg-slate-800 text-white border-l-[3px] border-slate-910 h-auto font-black text-[10px] uppercase tracking-wider px-5 rounded-none"
                >
                  {copiedToken === activeInvite?.url ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl text-[11px] leading-relaxed text-slate-500 font-medium">
              💡 <strong>QA Manual Testing Shortcut:</strong> Simply copy the link, open a new Private/Incognito Browser page (or log out), and paste the link to join directly as <strong>{activeInvite?.studentName}</strong> without typing credentials!
            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
            <Button onClick={() => setActiveInvite(null)} className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-11 px-8 font-bold text-xs">
              Dismiss Console
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* STUDENT CRUD - EDIT PROFILE DIALOG */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-md p-0 rounded-3xl overflow-hidden border-none shadow-2xl bg-white">
          <div className="bg-slate-900 text-white p-6 pb-8">
            <div className="inline-flex items-center gap-1.5 bg-indigo-5050 bg-indigo-500/20 border border-indigo-400/20 px-2.5 py-1 rounded text-xs font-black uppercase tracking-widest text-indigo-300">
              <Edit size={12} /> Registry Modification
            </div>
            <DialogTitle className="text-xl font-black uppercase mt-3 tracking-tight">Edit Student Credentials</DialogTitle>
            <DialogDescription className="text-indigo-200 mt-1 text-xs">
              Meticulously amend active record fields for candidate: <strong>{editingStudent?.name}</strong>.
            </DialogDescription>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Candidate Name</Label>
              <Input
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full h-11 border-slate-200 rounded-xl text-sm font-semibold"
                placeholder="Name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Email Address (Optional)</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full h-11 border-slate-200 rounded-xl text-sm font-semibold"
                placeholder="Email address"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Class Grade</Label>
                <Select value={editForm.class} onValueChange={val => setEditForm({ ...editForm, class: val })}>
                  <SelectTrigger className="w-full h-11 bg-white border-2 border-slate-300 hover:border-indigo-500 focus:border-indigo-650 rounded-xl text-xs font-bold text-slate-900 px-4 justify-between shadow-sm">
                    <SelectValue placeholder="Grade" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[160px] overflow-y-auto bg-white border-2 border-slate-300 shadow-xl rounded-xl p-1 z-50">
                    {ACADEMIC_LEVELS.map(level => (
                      <SelectItem key={level} value={level} className="text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer py-1.5 px-2.5 rounded-lg">
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Section</Label>
                <Input
                  value={editForm.section}
                  onChange={e => setEditForm({ ...editForm, section: e.target.value })}
                  className="w-full h-11 border-slate-200 rounded-xl text-sm font-bold text-center"
                  placeholder="Section"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Register / Roll Number</Label>
              <Input
                value={editForm.rollNumber}
                onChange={e => setEditForm({ ...editForm, rollNumber: e.target.value })}
                className="w-full h-11 border-slate-200 rounded-xl font-mono text-sm font-bold"
                placeholder="Roll number"
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Date of Birth (DOB)</Label>
              <Input
                type="date"
                value={editForm.dob}
                onChange={e => setEditForm({ ...editForm, dob: e.target.value })}
                className="w-full h-11 border-slate-200 rounded-xl text-sm font-semibold cursor-pointer"
              />
            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 rounded-b-3xl">
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="rounded-xl h-11 text-xs font-bold border-slate-200">
              Cancel
            </Button>
            <Button onClick={handleEditSave} className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-11 px-6 text-xs font-black uppercase tracking-wider">
              Save Profile changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* STUDENT CRUD - DELETE CONFIRMATION DIALOG */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-md p-0 rounded-3xl overflow-hidden border-none shadow-2xl bg-white">
          <div className="bg-red-900/10 text-red-700 p-6 border-b border-red-150">
            <div className="inline-flex items-center gap-1.5 bg-red-100 text-red-800 px-2.5 py-1 rounded text-xs font-black uppercase tracking-widest">
              <ShieldAlert size={14} /> Critical Action Block
            </div>
            <DialogTitle className="text-xl font-black mt-3 tracking-tight">Delete Candidate Node?</DialogTitle>
          </div>

          <div className="p-8 space-y-4">
            <p className="text-sm text-slate-600 font-semibold leading-relaxed">
              Are you absolutely certain you wish to delete candidate <strong>{deletingStudent?.name}</strong> (Roll: {deletingStudent?.rollNumber}) from the registry system?
            </p>
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl text-[11px] leading-relaxed text-rose-850 font-bold uppercase flex items-center gap-2">
              <span>⚠️</span>
              This action completely clears authentication credentials, invitation tokens, and resets live proctor references for this candidate.
            </div>
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} className="rounded-xl h-11 text-xs font-bold border-slate-200">
              Abort Action
            </Button>
            <Button onClick={handleDeleteExecute} className="bg-red-600 hover:bg-red-700 text-white rounded-xl h-11 px-6 text-xs font-black uppercase tracking-widest cursor-pointer">
              Yes, Purge Profile
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* READ ANALYTICS - STUDENT ACADEMIC PROGRESS MOVEMENT MODAL */}
      <Dialog open={isAnalyticsDialogOpen} onOpenChange={setIsAnalyticsDialogOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl p-0 rounded-[40px] overflow-hidden border-none shadow-2xl bg-white animate-in zoom-in-95">
          <div className="bg-slate-900 text-white p-8">
            <div className="flex justify-between items-center">
              <div className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-300 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-indigo-400/25">
                <BarChart3 size={12} /> Unified Merit Index
              </div>
              <span className="text-[10px] font-mono text-slate-400 uppercase font-black">Roll: {viewingStudentAnalytics?.rollNumber}</span>
            </div>
            <DialogTitle className="text-2xl font-black uppercase mt-4 tracking-tight text-[#FFE28A]">{viewingStudentAnalytics?.name}</DialogTitle>
            <DialogDescription className="text-indigo-200 mt-1 font-semibold text-xs leading-relaxed">
              Review examination track history, proctoring violations indices and curriculum development charts.
            </DialogDescription>
          </div>

          <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
            
            {studentAttempts.length > 0 ? (
              <div className="space-y-6">
                
                {/* Micro KPI Row */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Total Papers</p>
                    <p className="text-xl font-black text-slate-950 mt-1">{studentAttempts.length}</p>
                  </div>
                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-center">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">Average score</p>
                    <p className="text-xl font-black text-emerald-950 mt-1">
                      {Math.round(studentAttempts.reduce((acc, current) => acc + (current.score || 0), 0) / studentAttempts.length)}%
                    </p>
                  </div>
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-center">
                    <p className="text-[9px] font-black text-amber-600 uppercase tracking-wider">Integrity Zone</p>
                    <p className="text-xl font-black text-amber-950 mt-1">
                      {Math.max(60, 100 - (studentAttempts.reduce((acc, current) => acc + (current.violationsCount || 0) + (current.tabSwitches || 0), 0)) * 10)}%
                    </p>
                  </div>
                </div>

                {/* Score Trend Curve */}
                <div className="border border-slate-150 rounded-2xl p-4 bg-slate-50/50">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-4">Academic Progression Curve</p>
                  <div className="h-[200px] w-full text-xs">
                    {/* Basic visual representation of trend lines using simple progress bars or styled divs to keep rendering lightweight and resilient */}
                    <div className="space-y-3 pt-2">
                      {studentAttempts.map((attempt, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex justify-between items-center text-[11px] font-semibold text-slate-700">
                            <span className="font-bold truncate max-w-[280px]">{attempt.examTitle}</span>
                            <span className="font-black text-indigo-650">{attempt.score || 0}% score</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden flex">
                            <div 
                              className={`h-full rounded-full ${
                                (attempt.score || 0) >= 80 ? 'bg-emerald-500' : (attempt.score || 0) >= 50 ? 'bg-indigo-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${attempt.score || 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Detailed attempts directory listing */}
                <div className="space-y-2.5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Historical Assessment Sheets</p>
                  <div className="divide-y divide-slate-150 border border-slate-150 rounded-2xl overflow-hidden bg-white">
                    {studentAttempts.map((at, index) => (
                     <div key={index} onClick={() => { setIsAnalyticsDialogOpen && setIsAnalyticsDialogOpen(false); navigate(`/result/${at.id}`); }} className="p-4 flex justify-between items-center hover:bg-indigo-50/40 cursor-pointer group transition-colors text-xs font-semibold text-slate-700" title="Click to view complete exam forensic details">
                        <div>
                          <p className="font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">{at.examTitle} <Eye size={12} className="text-indigo-400 transition-opacity" /></p>
                          <p className="text-[10px] text-slate-400 mt-1 font-medium">Finished on: {new Date(at.startTime).toLocaleDateString()}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-slate-800 text-base">{at.score || 0}%</span>
                          <span className="block text-[9px] text-slate-400 font-mono tracking-tighter mt-0.5">Attempt ID: {at.id.substring(0, 8)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            ) : (
              <div className="text-center py-20 bg-slate-50 rounded-2xl text-slate-400 space-y-3">
                <GraduationCap className="h-10 w-10 mx-auto opacity-20 text-indigo-600" />
                <h5 className="font-bold text-slate-800 text-sm">No Performance Records Recorded</h5>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  This candidate has not signed up or answered any assessment questions yet. Use the share links to prompt dynamic examination entry.
                </p>
              </div>
            )}
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end rounded-b-3xl">
            <Button onClick={() => setIsAnalyticsDialogOpen(false)} className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-11 px-8 font-bold text-xs">
              Deactivate Insight Frame
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};
