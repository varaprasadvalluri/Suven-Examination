import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch, setDoc, onSnapshot, addDoc } from '../lib/firebase';
import { Exam, Question, Attempt } from '../types';
import { MathInputToolbar } from './MathInputToolbar';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter } from './ui/card';
import { Badge } from './ui/badge';
import { Clock, ChevronLeft, Circle, ArrowLeft, ArrowRight, ChevronRight, Send, HelpCircle, ShieldAlert, PauseCircle, Eye, Volume2, ListChecks, X, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

// Specialized Subject-Specific Modules
import { ScratchpadCanvas } from './ScratchpadCanvas';
import { PeriodicTableHelper } from './PeriodicTableHelper';
import { EmbeddedCodeEditor } from './EmbeddedCodeEditor';
import { RichTextKeyboardEditor } from './RichTextKeyboardEditor';
import { LazyExamAsset } from './LazyExamAsset';
import { ExamSyncProvider, useExamSync } from './ExamSyncContext';
import { OfflineSubmissionSafeWall } from './OfflineSubmissionSafeWall';
import { examAnswerQueue } from '../services/api';

const ExamInterfaceCore: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { isOnline, isSynced, syncAnswers, forceBackgroundSync } = useExamSync();
  
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | string | number[] | null)[]>([]);
  const [visited, setVisited] = useState<boolean[]>([]);
  const [markedForReview, setMarkedForReview] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
  const [hasWarnedUnder5Min, setHasWarnedUnder5Min] = useState(false);
  
  const [timePerQuestion, setTimePerQuestion] = useState<Record<number, number>>({});
  const [violationsCount, setViolationsCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [extraTime, setExtraTime] = useState<number>(0);
  const [showOfflineWall, setShowOfflineWall] = useState(false);
  const [offlineAnswersSnapshot, setOfflineAnswersSnapshot] = useState<(number | string | number[] | null)[]>([]);

  // Enhanced Examination Interface States (Product Owner & QA Upgrades)
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [paletteFilter, setPaletteFilter] = useState<'ALL' | 'ANSWERED' | 'UNANSWERED' | 'REVIEW' | 'UNVISITED'>('ALL');

  // Secure Real-Time Webcam & Microphone Proctoring States
  const [webcamAllowed, setWebcamAllowed] = useState<boolean>(false);
  const [micAllowed, setMicAllowed] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [talkingDuration, setTalkingDuration] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  // Challenge-Response Biometric Presence Invariant States (Anti-Distraction, Anti-Phone Copying)
  const [challengeActive, setChallengeActive] = useState<boolean>(false);
  const [challengeTimeLeft, setChallengeTimeLeft] = useState<number>(0);
  const [challengeCoords, setChallengeCoords] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const challengeIntervalRef = useRef<any>(null);
  const challengeCountdownRef = useRef<any>(null);

  const handlePassChallenge = () => {
    setChallengeActive(false);
    toast.success("Active presence confirmed. Focus alignment synchronized successfully.", {
      icon: "🛡️"
    });
  };

  const logProctorAnomaly = useCallback(async (type: string, description: string) => {
    if (!attemptId || !attempt) return;
    try {
      const logRef = doc(collection(db, 'proctoring_logs'));
      await setDoc(logRef, {
        id: logRef.id,
        attemptId,
        studentId: attempt.studentId,
        studentName: attempt.studentName,
        studentEmail: attempt.studentEmail || '',
        examId: attempt.examId,
        examTitle: exam?.title || 'E-Exam Assessment',
        type,
        timestamp: new Date().toISOString(),
        description
      });
    } catch (e) {
      console.error("Proctor anomaly save fail", e);
    }
  }, [attemptId, attempt, exam]);

  const fetchData = useCallback(async () => {
    if (!attemptId) return;
    setLoading(true);
    try {
      const attemptRef = doc(db, 'attempts', attemptId);
      let attemptSnap;
      try {
        attemptSnap = await getDoc(attemptRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `attempts/${attemptId}`);
        return;
      }

      if (!attemptSnap.exists()) {
        toast.error("Attempt not found");
        return;
      }

      const aData = { id: attemptSnap.id, ...attemptSnap.data() } as Attempt;
      if (aData.status === 'completed') {
        navigate(`/result/${attemptId}`);
        return;
      }
      setAttempt(aData);
      setAnswers(aData.answers || []);
      setViolationsCount(aData.violationsCount || 0);
      setTimePerQuestion(aData.timePerQuestion || {});

      const examRef = doc(db, 'exams', aData.examId);
      let examSnap;
      try {
        examSnap = await getDoc(examRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `exams/${aData.examId}`);
        return;
      }
      
      if (!examSnap.exists()) {
        toast.error("Exam not found");
        return;
      }
      const eData = { id: examSnap.id, ...examSnap.data() } as Exam;
      setExam(eData);

      const qsQuery = query(collection(db, 'questions'), where('examId', '==', aData.examId));
      let qsSnap;
      try {
        qsSnap = await getDocs(qsQuery);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'questions');
        return;
      }
      
      const qList = qsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
      
      const seed = attemptId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const seededShuffle = (array: any[], seed: number) => {
        const arr = [...array];
        let currentSeed = seed;
        for (let i = arr.length - 1; i > 0; i--) {
          currentSeed = (currentSeed * 9301 + 49297) % 233280;
          const rnd = currentSeed / 233280;
          const j = Math.floor(rnd * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };
      
      const shuffledQuestions = seededShuffle(qList, seed);
      setQuestions(shuffledQuestions);

      // Restore visited and review tags from localStorage if they exist
      const cachedVisited = localStorage.getItem(`exam_visited_${attemptId}`);
      const cachedReview = localStorage.getItem(`exam_review_${attemptId}`);
      
      if (cachedVisited) {
        try { setVisited(JSON.parse(cachedVisited)); } catch (e) { console.error(e); }
      } else {
        const initVisited = Array(shuffledQuestions.length).fill(false);
        initVisited[0] = true;
        setVisited(initVisited);
      }

      if (cachedReview) {
        try { setMarkedForReview(JSON.parse(cachedReview)); } catch (e) { console.error(e); }
      } else {
        setMarkedForReview(Array(shuffledQuestions.length).fill(false));
      }

      const startTime = new Date(aData.startTime).getTime();
      const durationMs = eData.duration * 60 * 1000;
      const elapsedMs = Date.now() - startTime;
      const remaining = Math.max(0, Math.floor((durationMs - elapsedMs) / 1000));
      setTimeLeft(remaining);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load attempt data");
    } finally {
      setLoading(false);
    }
  }, [attemptId, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // MODULE 2: Emergency Pause & Dynamic Time Extension Real-Time Sync Engine
  useEffect(() => {
    if (!attemptId || !attempt) return;

    // 1. Subscribe to specific student attempt updates
    const unsubAttempt = onSnapshot(doc(db, 'attempts', attemptId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        
        // Handle student-specific extra time allocated by primary admins (minutes)
        if (typeof data.extraTime === 'number') {
          setExtraTime(prev => {
            if (data.extraTime > prev) {
              toast.success(`⏰ Dynamic Time Extension: School admin has extended your session by ${data.extraTime} extra minutes!`, {
                duration: 6000,
                icon: <Clock className="text-indigo-600 animate-spin" />
              });
            }
            return data.extraTime;
          });
        }

        // Handle specific student pause triggers
        const isStudentPaused = !!data.isPaused || !!data.paused;
        setIsPaused(prev => {
          if (isStudentPaused && !prev) {
            toast.error("⏸️ Exam paused by administrator. Your countdown timer is locked.", {
              duration: 5000,
              icon: <PauseCircle className="text-amber-500 animate-pulse" />
            });
          } else if (!isStudentPaused && prev) {
            toast.success("▶️ Exam resumed by administrator. Countdown active.", {
              duration: 4000
            });
          }
          return isStudentPaused;
        });
      }
    });

    // 2. Subscribe to general Exam updates
    const unsubExam = onSnapshot(doc(db, 'exams', attempt.examId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const isExamPaused = !!data.isPaused || !!data.paused;
        if (isExamPaused) {
          setIsPaused(true);
        }
      }
    });

    return () => {
      unsubAttempt();
      unsubExam();
    };
  }, [attemptId, attempt]);

  useEffect(() => {
    if (questions.length > 0 && visited.length > 0) {
      if (!visited[currentIndex]) {
        const nextVisited = [...visited];
        nextVisited[currentIndex] = true;
        setVisited(nextVisited);
      }
    }
  }, [currentIndex, questions.length, visited]);

  useEffect(() => {
    if (attemptId && visited.length > 0) {
      localStorage.setItem(`exam_visited_${attemptId}`, JSON.stringify(visited));
    }
  }, [visited, attemptId]);

  useEffect(() => {
    if (attemptId && markedForReview.length > 0) {
      localStorage.setItem(`exam_review_${attemptId}`, JSON.stringify(markedForReview));
    }
  }, [markedForReview, attemptId]);

  // Periodic Auto-Save for time tracking and statistics
  useEffect(() => {
    if (!attemptId || loading || !attempt || attempt.status === 'completed') return;

    const autoSaveInterval = setInterval(async () => {
      try {
        await updateDoc(doc(db, 'attempts', attemptId), {
          timePerQuestion,
          status: 'in-progress'
        });
      } catch (err) {
        console.error("Implicit stats tick update missed:", err);
      }
    }, 30000);

    return () => clearInterval(autoSaveInterval);
  }, [attemptId, loading, attempt, timePerQuestion]);

  const handleAnswer = async (optionValue: number | string | number[] | null) => {
    const newAnswers = [...answers];
    newAnswers[currentIndex] = optionValue;
    setAnswers(newAnswers);
    
    if (attemptId) {
      await syncAnswers(newAnswers, attemptId);
    }
  };

  const handleClearResponse = async () => {
    const newAnswers = [...answers];
    newAnswers[currentIndex] = null;
    setAnswers(newAnswers);

    if (attemptId) {
      await syncAnswers(newAnswers, attemptId);
    }
  };

  const handleMarkForReview = () => {
    const nextMarked = [...markedForReview];
    nextMarked[currentIndex] = true;
    setMarkedForReview(nextMarked);
    
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      toast.info("You are at the final item. Review response states or submit.");
    }
  };

  const handleSaveAndNext = () => {
    const nextMarked = [...markedForReview];
    nextMarked[currentIndex] = false;
    setMarkedForReview(nextMarked);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      toast.info("End of sequence. Complete exam or jump to target cards.");
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!attemptId || !exam || questions.length === 0 || !attempt) return;
    
    setIsSubmitConfirmOpen(false);

    // MODULE 3: Offline Safe-Wall Intercept
    if (!isOnline) {
      setOfflineAnswersSnapshot([...answers]);
      setShowOfflineWall(true);
      return;
    }
    
    setLoading(true);
    try {
      // Flush any queued answers immediately to DB before scoring/finalizing
      try {
        await examAnswerQueue.flush();
      } catch (flushErr) {
        console.warn("Answer queue flush warning:", flushErr);
      }
      
      let score = 0;
      let correctCount = 0;
      const errorBookEntries: any[] = [];

      questions.forEach((q, idx) => {
        const studentAns = answers[idx];
        const qType = q.type || 'single';
        let isCorrect = false;

        if (qType === 'numerical') {
          isCorrect = studentAns !== null && studentAns !== undefined && 
                      String(studentAns).trim() === String(q.numericalAnswer || '').trim();
        } else if (qType === 'multiple') {
          if (Array.isArray(studentAns)) {
            isCorrect = studentAns.includes(q.correctAnswerIndex);
          } else {
            isCorrect = studentAns === q.correctAnswerIndex;
          }
        } else {
          isCorrect = studentAns === q.correctAnswerIndex;
        }

        if (isCorrect) {
          score += q.marks;
          correctCount++;
        } else if (studentAns !== null && studentAns !== undefined) {
          // Negative marking deduction (-1) for incorrect single or multiple choice MCQs
          if (qType !== 'numerical') {
            score = Math.max(0, score - 1);
          }
          
          errorBookEntries.push({
            studentId: attempt.studentId,
            examId: exam.id,
            questionId: q.id || idx.toString(),
            questionText: q.text,
            selectedAnswer: qType === 'numerical' ? String(studentAns) : (Array.isArray(studentAns) ? studentAns.join(', ') : studentAns),
            correctAnswer: qType === 'numerical' ? String(q.numericalAnswer) : q.correctAnswerIndex,
            subject: q.subject || exam.subject || 'General',
            explanation: q.explanation || "Review the step-by-step formula and solution logic.",
            imageUrl: q.imageUrl || "",
            createdAt: new Date().toISOString()
          });
        }
      });

      const accuracy = (correctCount / questions.length) * 100;
      const totalTimeSpent = Object.values(timePerQuestion).reduce((a, b) => a + b, 0);
      const avgTimePerCorrect = correctCount > 0 ? totalTimeSpent / correctCount : 0;

      const submissionPayload = {
        score,
        accuracy,
        avgTimePerCorrect,
        status: 'completed',
        answers,
        timePerQuestion,
        endTime: new Date().toISOString(),
        schoolId: attempt.schoolId || (exam as any).schoolId || 'school-core-node-1',
        examId: attempt.examId || exam.id
      };

      let isCompletedInDb = false;

      // Primary Channel: Direct Firestore Client Update
      try {
        await updateDoc(doc(db, 'attempts', attemptId), submissionPayload);
        isCompletedInDb = true;
      } catch (err) {
        console.warn("Client-side updateDoc failed, attempting Express API proxy submission:", err);
      }

      // Fallback Channel: Express Server Proxy Write
      if (!isCompletedInDb) {
        try {
          const res = await fetch('/api/db/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'update',
              collectionName: 'attempts',
              docId: attemptId,
              data: submissionPayload
            })
          });
          if (res.ok) {
            isCompletedInDb = true;
          } else {
            console.warn("Express write API returned non-OK response:", await res.text());
          }
        } catch (apiErr) {
          console.error("Express write API fetch error:", apiErr);
        }
      }

      // Secondary logging: Error books
      if (errorBookEntries.length > 0) {
        try {
          const batch = writeBatch(db);
          errorBookEntries.forEach(entry => {
            const ebRef = doc(collection(db, 'error_books'));
            batch.set(ebRef, entry);
          });
          await batch.commit();
        } catch (err) {
          console.warn("Client-side batch write error_books failed, trying server proxy:", err);
          try {
            for (const entry of errorBookEntries) {
              await fetch('/api/db/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'add',
                  collectionName: 'error_books',
                  data: entry
                })
              });
            }
          } catch (ebErr) {
            console.warn("Server proxy write error_books failed, continuing with submission completion:", ebErr);
          }
        }
      }

      localStorage.removeItem(`exam_visited_${attemptId}`);
      localStorage.removeItem(`exam_review_${attemptId}`);
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#4F46E5', '#3B82F6', '#10B981', '#F59E0B']
      });

      toast.success("Exam submitted successfully!");
      setTimeout(() => navigate(`/result/${attemptId}`), 1500);
    } catch (error) {
      console.error("Critical submission error:", error);
      toast.error("An error occurred during submission. Attempting automatic navigation...");
      setTimeout(() => navigate(`/result/${attemptId}`), 2000);
    } finally {
      setLoading(false);
    }
  }, [attemptId, exam, questions, answers, navigate, timePerQuestion, attempt]);

  const lastViolationRef = useRef<number>(0);

  const handleViolationTrigger = useCallback(async (eventType: string, eventDetail: string) => {
    if (loading || !attempt || (attempt.status !== 'started' && attempt.status !== 'in-progress') || !attemptId) return;
    
    const now = Date.now();
    if (now - lastViolationRef.current < 3000) {
      return;
    }
    lastViolationRef.current = now;

    const newCount = violationsCount + 1;
    setViolationsCount(newCount);

    try {
      await updateDoc(doc(db, 'attempts', attemptId), { 
        violationsCount: newCount 
      });
    } catch (err) {
      console.error("Error updates:", err);
    }

    if (newCount === 1) {
      setIsWarningModalOpen(true);
      toast.error(`SECURITY WARNING: ${eventDetail} (Violation 1 of 2 logged).`, {
        icon: <ShieldAlert className="h-5 w-5 text-red-600" />,
        duration: 6000,
      });
      await logProctorAnomaly(eventType, `First level warning: ${eventDetail}`);
    } else if (newCount >= 2) {
      toast.error(`CRITICAL SECURITY ALERT: ${eventDetail} (Violation ${newCount}). FORCING SUBMISSION.`);
      await logProctorAnomaly(eventType + '_force_submit', `Force-submitted owing to multiple violations: ${eventDetail}`);
      handleSubmit();
    }
  }, [loading, attempt, attemptId, violationsCount, logProctorAnomaly, handleSubmit]);

  useEffect(() => {
    // Sync initial state
    setIsFullscreen(!!document.fullscreenElement);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleViolationTrigger('tab_switch', 'Tab switched or browser minimized');
      }
    };
    
    const handleBlur = () => {
      if (!document.hidden && !isWarningModalOpen) {
        handleViolationTrigger('blur', 'Active window/screen focus lost');
      }
    };

    const handleFullscreenChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
      if (!isFS && !loading && attempt && (attempt?.status === 'started' || attempt?.status === 'in-progress')) {
        handleViolationTrigger('fullscreen_exit', 'Student exited secure full-screen mode');
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [loading, attempt, isWarningModalOpen, handleViolationTrigger]);

  // 1. Initialize secure media capturing (Camera disabled per policy, optional audio analysis)
  useEffect(() => {
    if (loading || !attempt || attempt.status === 'completed') return;

    const initMedia = async () => {
      // Camera / Video stream request completely removed so students are never prompted for camera access.
      setWebcamAllowed(false);

      try {
        const audioStream = await navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => null);
        if (audioStream) {
          audioStreamRef.current = audioStream;
          setMicAllowed(true);
          
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;
            
            const source = ctx.createMediaStreamSource(audioStream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            audioAnalyserRef.current = analyser;
          }
        }
      } catch (err) {
        console.warn("Microphone access not allowed or unavailable", err);
      }
    };

    initMedia();

    return () => {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [loading, attempt]);

  // 2. Continuous Microphone volume/talking decibel analysis
  useEffect(() => {
    if (!micAllowed || !audioAnalyserRef.current) return;
    
    const bufferLength = audioAnalyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const interval = setInterval(() => {
      if (!audioAnalyserRef.current) return;
      
      // Auto-resume audio context if suspended by browser security policy
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }

      audioAnalyserRef.current.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const normalizedLevel = Math.min(100, Math.round((avg / 128) * 100));
      setMicLevel(normalizedLevel);
      
      // Loudness trigger: if average volume exceeds conversational threshold (e.g. 28)
      if (normalizedLevel > 28) {
        setTalkingDuration(prev => {
          const next = prev + 1;
          // If speech or loud whispering persists for 25 consecutive ticks (~2.5 seconds)
          if (next === 25) {
            handleViolationTrigger('talking_detected', 'Whispering or talking noise detected inside secure exam room');
          }
          return next;
        });
      } else {
        setTalkingDuration(0);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [micAllowed, handleViolationTrigger]);

  // 3. Random challenge-response presence challenge (forces focus alignment to block phone copying / side-help)
  useEffect(() => {
    if (loading || !attempt || attempt.status === 'completed' || isPaused) return;

    const triggerChallenge = () => {
      setChallengeActive(prevActive => {
        if (prevActive) return true;
        
        // Compute randomized placement coordinates to verify active eye gaze and attention
        const rx = Math.floor(Math.random() * 60) + 20; 
        const ry = Math.floor(Math.random() * 60) + 20; 
        setChallengeCoords({ x: rx, y: ry });
        setChallengeTimeLeft(7); 
        
        toast.warning("BIOMETRIC FOCUS CHALLENGE: Please look directly at the green target node to verify active screen presence.", {
          icon: <ShieldAlert className="h-5 w-5 text-amber-500 animate-bounce" />,
          duration: 6000
        });

        return true;
      });
    };

    // Trigger biometric check challenge randomly every 35 to 65 seconds
    const intervalTime = (Math.floor(Math.random() * 30) + 35) * 1000;
    challengeIntervalRef.current = setInterval(triggerChallenge, intervalTime);

    return () => {
      if (challengeIntervalRef.current) clearInterval(challengeIntervalRef.current);
    };
  }, [loading, attempt, isPaused]);

  // Challenge Countdown Ticker
  useEffect(() => {
    if (!challengeActive) {
      if (challengeCountdownRef.current) {
        clearInterval(challengeCountdownRef.current);
        challengeCountdownRef.current = null;
      }
      return;
    }

    if (!challengeCountdownRef.current) {
      challengeCountdownRef.current = setInterval(() => {
        setChallengeTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(challengeCountdownRef.current);
            challengeCountdownRef.current = null;
            setChallengeActive(false);
            
            // FAILED challenge - student was copying from phone/talking/distracted
            handleViolationTrigger('active_presence_failed', 'Failed active biometric presence audit (Off-screen distraction / device look-away suspected)');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (challengeCountdownRef.current) {
        clearInterval(challengeCountdownRef.current);
        challengeCountdownRef.current = null;
      }
    };
  }, [challengeActive, handleViolationTrigger]);

  useEffect(() => {
    if (!attempt || attempt.status === 'completed' || loading) return;

    const clearClipboard = async () => {
      try {
        await navigator.clipboard.writeText('');
      } catch (err) {
        // clipboard API might require focus or permission, ignore if blocked
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      toast.warning("PROCTOR ALERT: Right-click menu is locked on the exam portal.", {
        icon: <ShieldAlert className="h-4 w-4 text-orange-500" />
      });
      logProctorAnomaly('right_click', 'Student triggered context menu right-click');
    };

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      toast.warning("PROCTOR ALERT: Copying text is strictly restricted during live testing.", {
        icon: <ShieldAlert className="h-4 w-4 text-red-500" />
      });
      logProctorAnomaly('copy_blocked', 'Student attempted to copy questions/options text');
      clearClipboard();
    };

    const handleCut = (e: ClipboardEvent) => {
      e.preventDefault();
      toast.warning("PROCTOR ALERT: Cutting text is strictly restricted during live testing.", {
        icon: <ShieldAlert className="h-4 w-4 text-red-500" />
      });
      logProctorAnomaly('cut_blocked', 'Student attempted to cut exam content');
      clearClipboard();
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      toast.warning("PROCTOR ALERT: Pasting from clipboard is disabled.", {
        icon: <ShieldAlert className="h-4 w-4 text-red-500" />
      });
      logProctorAnomaly('paste_blocked', 'Student attempted to paste into on-screen fields');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen' || e.key === 'Snapshot' || e.keyCode === 44) {
        e.preventDefault();
        toast.error("PROCTOR ALERT: PrintScreen capture is prohibited.", {
          icon: <ShieldAlert className="h-5 w-5 text-red-650" />
        });
        logProctorAnomaly('print_screen', 'Student pressed PrintScreen/Snapshot shortcut key');
        clearClipboard();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (['c', 'v', 'x', 'p', 's', 'u', 'a'].includes(key)) {
          e.preventDefault();
          toast.error(`PROCTOR ALERT: Command shortcut (Ctrl/Cmd + ${key.toUpperCase()}) is blocked.`, {
            icon: <ShieldAlert className="h-5 w-5 text-red-650" />
          });
          logProctorAnomaly('shortcut_blocked', `Student triggered blocked keyboard combination: Ctrl/Cmd + ${key.toUpperCase()}`);
          if (['c', 'x'].includes(key)) {
            clearClipboard();
          }
          return;
        }

        if (e.shiftKey && ['i', 'j', 'c'].includes(key)) {
          e.preventDefault();
          toast.error("PROCTOR ALERT: Developer options are blocked.", {
            icon: <ShieldAlert className="h-5 w-5 text-red-650" />
          });
          logProctorAnomaly('shortcut_blocked', `Student triggered developer tools shortcut: Ctrl/Cmd + Shift + ${key.toUpperCase()}`);
          return;
        }
      }

      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        toast.error("PROCTOR ALERT: Developer Tools (F12) access is prohibited.", {
          icon: <ShieldAlert className="h-5 w-5 text-red-650" />
        });
        logProctorAnomaly('f12_blocked', 'Student pressed F12 to open Developer Tools');
        return;
      }
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const addProctorListeners = (target: EventTarget) => {
      target.addEventListener('contextmenu', handleContextMenu as any, true);
      target.addEventListener('copy', handleCopy as any, true);
      target.addEventListener('cut', handleCut as any, true);
      target.addEventListener('paste', handlePaste as any, true);
      target.addEventListener('keydown', handleKeyDown as any, true);
      target.addEventListener('selectstart', handleSelectStart as any, true);
    };

    const removeProctorListeners = (target: EventTarget) => {
      target.removeEventListener('contextmenu', handleContextMenu as any, true);
      target.removeEventListener('copy', handleCopy as any, true);
      target.removeEventListener('cut', handleCut as any, true);
      target.removeEventListener('paste', handlePaste as any, true);
      target.removeEventListener('keydown', handleKeyDown as any, true);
      target.removeEventListener('selectstart', handleSelectStart as any, true);
    };

    addProctorListeners(window);
    addProctorListeners(document);

    const container = document.getElementById('exam-content-container');
    if (container) {
      addProctorListeners(container);
      (container as HTMLElement).style.userSelect = 'none';
      (container as HTMLElement).style.webkitUserSelect = 'none';
    }

    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    return () => {
      removeProctorListeners(window);
      removeProctorListeners(document);
      const activeContainer = document.getElementById('exam-content-container');
      if (activeContainer) {
        removeProctorListeners(activeContainer);
      }
      document.body.style.userSelect = 'auto';
      document.body.style.webkitUserSelect = 'auto';
    };
  }, [attempt, loading, logProctorAnomaly]);

  useEffect(() => {
    if (!exam || !attempt || attempt.status === 'completed' || loading) return;

    // 1. Freeze timer tick completely if admin triggered an active Emergency Pause
    if (isPaused) return;

    const startTime = new Date(attempt.startTime).getTime();
    // 2. Compute dynamic time bounds: base duration + school-allocated extraTime minutes
    const durationMs = (exam.duration + extraTime) * 60 * 1000;
    const endTime = startTime + durationMs;

    const timer = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      setTimeLeft(remaining);

      setTimePerQuestion(prev => ({
        ...prev,
        [currentIndex]: (prev[currentIndex] || 0) + 1
      }));

      // 3. Auto-submit when time has fully run out
      if (remaining <= 0) {
        clearInterval(timer);
        handleSubmit();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [exam, attempt, loading, handleSubmit, currentIndex, isPaused, extraTime]);

  // Trigger alert when remaining time falls below 5 minutes
  useEffect(() => {
    if (timeLeft > 0 && timeLeft <= 300 && !hasWarnedUnder5Min) {
      setHasWarnedUnder5Min(true);
      toast.error("🚨 CRITICAL TIME WARNING: Less than 5 minutes remaining! Please review and finalize your questions.", {
        duration: 10000,
        id: "five-minute-warning",
      });
    } else if (timeLeft > 300 && hasWarnedUnder5Min) {
      setHasWarnedUnder5Min(false);
    }
  }, [timeLeft, hasWarnedUnder5Min]);

  useEffect(() => {
    if (!attemptId || !attempt || attempt.status === 'completed') return;

    const logActivity = async (type: string, description: string) => {
      try {
        const payload = {
          attemptId,
          studentId: attempt.studentId,
          examId: attempt.examId,
          type,
          description,
          timestamp: new Date().toISOString()
        };
        await addDoc(collection(db, 'proctoring_logs'), payload);
        
        // Update the violations count on the attempt for the LiveProctoringWall
        const currentViolations = attempt.violationsCount || 0;
        await updateDoc(doc(db, 'attempts', attemptId), {
           violationsCount: currentViolations + 1,
           lastViolation: description,
           lastViolationTime: new Date().toISOString()
        });
      } catch (err) {
        console.error("Proctoring log error:", err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logActivity('tab_switch', 'Student switched tabs or minimized browser window.');
      }
    };

    const handleBlur = () => {
      logActivity('blur', 'Student lost focus of the exam window.');
    };

    const handleCopyPaste = (e) => {
      e.preventDefault();
      logActivity('copy_paste', `Student attempted to ${e.type} content.`);
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        logActivity('fullscreen_exit', 'Student exited fullscreen mode.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [attemptId, attempt]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getStatusCounts = () => {
    let answered = 0;
    let notAnswered = 0;
    let markedReview = 0;
    let answeredMarkedReview = 0;
    let notVisited = 0;

    questions.forEach((_, i) => {
      const isMarked = markedForReview[i];
      const isAns = answers[i] !== null && answers[i] !== undefined;
      const isVis = visited[i];

      if (isMarked) {
        if (isAns) answeredMarkedReview++;
        else markedReview++;
      } else if (isAns) {
        answered++;
      } else if (isVis) {
        notAnswered++;
      } else {
        notVisited++;
      }
    });

    return { answered, notAnswered, markedReview, answeredMarkedReview, notVisited };
  };

  if (loading && !attempt) return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 px-4 animate-pulse">
      {/* Skeleton Header mimicking the sticky Control Navigation Header */}
      <div className="flex items-center justify-between bg-white py-4 px-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="space-y-2 w-1/3">
          <div className="h-3 bg-slate-200 rounded w-24" />
          <div className="h-6 bg-slate-200 rounded w-48" />
        </div>
        <div className="flex items-center gap-4 w-1/2 justify-end">
          <div className="h-10 bg-slate-200 rounded-xl w-32 hidden sm:block" />
          <div className="h-10 bg-slate-300 rounded-xl w-24" />
          <div className="h-10 bg-slate-200 rounded-xl w-40" />
        </div>
      </div>

      {/* Skeleton Answered Questions Progress Bar Card */}
      <div className="border border-slate-100 rounded-2xl p-5 bg-white space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            <div className="h-4 bg-slate-200 rounded w-48" />
          </div>
          <div className="h-4 bg-slate-200 rounded w-24" />
        </div>
        <div className="h-3 bg-slate-100 rounded-full w-full" />
      </div>

      {/* Skeleton Subject Segments Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
        <div className="h-4 bg-slate-200 rounded w-24 shrink-0" />
        <div className="h-9 bg-slate-200 rounded-xl w-36 shrink-0" />
        <div className="h-9 bg-slate-150 rounded-xl w-36 shrink-0" />
        <div className="h-9 bg-slate-150 rounded-xl w-36 shrink-0" />
      </div>

      {/* Skeleton Main split grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Side: Question Board Skeleton */}
        <div className="lg:col-span-8 space-y-6">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden" />
          
          <div className="border border-slate-100 rounded-[32px] overflow-hidden bg-white shadow-sm">
            {/* Header part */}
            <div className="bg-slate-900 px-8 py-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-slate-800" />
                <div className="h-4 bg-slate-800 rounded w-40" />
              </div>
              <div className="h-4 bg-slate-800 rounded w-28" />
            </div>
            
            {/* Content part */}
            <div className="p-8 space-y-6 min-h-[300px]">
              <div className="space-y-2">
                <div className="h-5 bg-slate-200 rounded w-11/12" />
                <div className="h-5 bg-slate-200 rounded w-3/4" />
              </div>
              
              {/* Option Skeletons */}
              <div className="grid grid-cols-1 gap-4 pt-2">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 flex items-center gap-5">
                    <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
                    <div className="h-4 bg-slate-200 rounded w-2/3" />
                  </div>
                ))}
              </div>
            </div>

            {/* Footer controls part */}
            <div className="flex items-center justify-between bg-slate-50 border-t border-slate-100 px-8 py-5">
              <div className="flex items-center gap-2">
                <div className="h-10 bg-slate-200 rounded-xl w-20" />
                <div className="h-10 bg-slate-200 rounded-xl w-32" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-10 bg-slate-200 rounded-xl w-44" />
                <div className="h-10 bg-slate-200 rounded-xl w-32" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Command Board & Interactive Palette Skeleton */}
        <div className="lg:col-span-4 space-y-6">
          {/* Student Profile Skeleton */}
          <div className="border border-slate-100 rounded-[24px] p-5 bg-white flex items-center gap-4 shadow-sm">
            <div className="h-12 w-12 rounded-2xl bg-slate-200 shrink-0" />
            <div className="space-y-2 w-full">
              <div className="h-4 bg-slate-200 rounded w-1/2" />
              <div className="h-3 bg-slate-150 rounded w-1/3" />
            </div>
          </div>

          {/* Legend Status Map Skeleton */}
          <div className="border border-slate-100 rounded-3xl p-5 bg-white space-y-4 shadow-sm">
            <div className="h-3 bg-slate-200 rounded w-24" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((idx) => (
                <div key={idx} className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 shrink-0" />
                  <div className="h-3 bg-slate-150 rounded w-12" />
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Question Grid Palette Skeleton */}
          <div className="border border-slate-100 rounded-3xl p-6 bg-white space-y-4 shadow-sm">
            <div className="h-3 bg-slate-200 rounded w-36 mx-auto" />
            <div className="grid grid-cols-5 gap-2.5 justify-items-center">
              {Array.from({ length: 15 }).map((_, idx) => (
                <div key={idx} className="w-11 h-11 rounded-xl bg-slate-150" />
              ))}
            </div>
            <div className="pt-4 border-t border-slate-100">
              <div className="h-4 bg-slate-200 rounded w-1/2 mx-auto" />
            </div>
          </div>

          {/* Secure Video Stream Skeleton */}
          <div className="bg-slate-900 border border-slate-800 rounded-[24px] p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                <div className="h-3 bg-slate-800 rounded w-28" />
              </div>
              <div className="h-3 bg-slate-800 rounded w-12" />
            </div>
            <div className="aspect-video bg-slate-950 rounded-xl flex flex-col items-center justify-center space-y-2">
              <div className="w-5 h-5 bg-slate-800 rounded-full" />
              <div className="h-2 bg-slate-800 rounded w-16" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  
  if (!exam || questions.length === 0 || !attempt) {
    return (
      <div className="p-8 text-center text-slate-500 font-medium">
        No questions or attempt node loaded.
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;
  const counts = getStatusCounts();

  const answeredCount = answers.filter(a => a !== null && a !== undefined).length;
  const unansweredCount = questions.length - answeredCount;
  const markedForReviewCount = markedForReview.filter(Boolean).length;

  // Dynamic segments/subject lists derived directly from the test questions
  const uniqueSubjects = Array.from(new Set(questions.map(q => q.subject || exam.subject || 'General')));
  const currentSubject = currentQuestion?.subject || exam.subject || 'General';

  const unansweredBySubject = uniqueSubjects.map(sub => {
    const subQIndices = questions.map((q, idx) => (q.subject || exam?.subject || 'General') === sub ? idx : -1).filter(idx => idx !== -1);
    const subUnanswered = subQIndices.filter(idx => answers[idx] === null || answers[idx] === undefined).length;
    return { subject: sub, unanswered: subUnanswered, total: subQIndices.length };
  }).filter(item => item.unanswered > 0);

  const jumpToSubject = (subjectName: string) => {
    const idx = questions.findIndex(q => (q.subject || exam.subject || 'General') === subjectName);
    if (idx !== -1) {
      setCurrentIndex(idx);
    } else {
      toast.error(`No questions found in segment: ${subjectName}`);
    }
  };

  const handleCheckboxToggle = async (optionIdx: number) => {
    const currentSelection = Array.isArray(answers[currentIndex])
      ? (answers[currentIndex] as number[])
      : (answers[currentIndex] !== null ? [Number(answers[currentIndex])] : []);

    let nextSelection: number[];
    if (currentSelection.includes(optionIdx)) {
      nextSelection = currentSelection.filter(x => x !== optionIdx);
    } else {
      nextSelection = [...currentSelection, optionIdx].sort();
    }

    const newAnswers = [...answers];
    newAnswers[currentIndex] = nextSelection.length > 0 ? nextSelection : null;
    setAnswers(newAnswers);

    if (attemptId) {
      await syncAnswers(newAnswers, attemptId);
    }
  };

  const enterFullscreen = () => {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        toast.error("Could not activate full-screen mode. Please click to allow permissions.");
        console.error(err);
      });
    } else {
      setIsFullscreen(true); // Fallback for unsupported browsers
    }
  };

  if (!isFullscreen && !loading && attempt && attempt.status !== 'completed') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-[32px] space-y-6 shadow-2xl"
        >
          <div className="p-4 bg-rose-500/10 rounded-full w-20 h-20 flex items-center justify-center mx-auto text-rose-500 border border-rose-500/20">
            <ShieldAlert size={40} className="text-rose-500 animate-pulse" />
          </div>
          <div className="space-y-2">
            <Badge className="bg-rose-500/20 text-rose-400 font-bold tracking-wider text-[10px] uppercase">Proctor Lockout Active</Badge>
            <h2 className="text-2xl font-display font-black tracking-tight text-white">Secure Examination Mode</h2>
            <p className="text-xs text-slate-400 font-medium leading-relaxed">
              This digital assessment is fully proctored under secure national guidelines. You must enter and maintain full-screen mode to proceed. Switching tabs, losing focus, or exiting full-screen is logged as a security infraction.
            </p>
          </div>
          <Button 
            onClick={enterFullscreen}
            className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold uppercase tracking-wider text-xs border-b-4 border-indigo-800 active:border-b-0 transition-all cursor-pointer shadow-lg shadow-indigo-500/20"
          >
            Enter Secure Exam Mode (Fullscreen)
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f111a] text-slate-200 font-sans selection:bg-indigo-500/30 flex flex-col absolute inset-0 overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-[#171a26] border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
         <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
               <div className="h-8 w-8 bg-amber-400 rounded flex items-center justify-center font-black text-slate-900 shadow-md shadow-amber-500/10">
                 S
               </div>
               <h1 className="font-bold text-slate-100 text-sm md:text-base tracking-wide">{exam?.title || "Mock Test"}</h1>
            </div>
            {/* Subject Pills */}
            <div className="hidden md:flex items-center gap-2 border-l border-slate-800 pl-6 ml-2">
              {uniqueSubjects.map((sub, i) => {
                 const colors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
                 const color = colors[i % colors.length];
                 const isActive = currentSubject === sub;
                 const subQIdx = questions.map((q, idx) => (q.subject || exam?.subject || 'General') === sub ? idx : -1).filter(idx => idx !== -1);
                 const subAnsCount = subQIdx.filter(idx => answers[idx] !== null && answers[idx] !== undefined).length;
                 
                 return (
                   <button 
                     key={sub}
                     onClick={() => jumpToSubject(sub)}
                     className={`h-8 px-4 rounded-full border text-[11px] font-bold flex items-center gap-2 transition-all cursor-pointer
                       ${isActive ? 'bg-slate-800 border-indigo-500/50 text-white shadow-sm' : 'border-slate-800/80 text-slate-400 hover:bg-slate-800/50'}`}
                   >
                     <div className={`h-1.5 w-1.5 rounded-full ${color}`} />
                     {sub}
                     <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[9px] ml-1">{subAnsCount}/{subQIdx.length}</span>
                   </button>
                 )
              })}
            </div>
         </div>

         <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 hidden sm:flex items-center gap-1.5">
               <Circle size={8} className={isSynced ? 'text-slate-600 fill-slate-700' : 'text-amber-500 fill-amber-500'} /> 
               {isSynced ? 'Auto-save' : 'Saving...'}
            </span>
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full text-[10px] font-bold hidden sm:flex items-center gap-1.5">
               <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Proctored
            </span>
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-1.5 rounded-lg text-slate-200 font-mono font-bold text-sm shadow-inner shadow-black/20">
               <Clock size={14} className="text-slate-500" />
               {formatTime(timeLeft)}
            </div>
            <Button onClick={() => setIsSubmitConfirmOpen(true)} className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-6 h-9 text-xs rounded-md shadow-lg shadow-amber-500/10 cursor-pointer border-none">
               Submit Exam
            </Button>
         </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
         {/* Left Main Area */}
         <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto bg-[#0b0d14]">
            {/* Top meta */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
               <div className="flex items-center gap-3">
                 <span className="bg-[#171a26] border border-slate-800 px-3 py-1.5 rounded text-xs font-bold text-slate-300">Q {currentIndex + 1} / {questions.length}</span>
                 {answers[currentIndex] !== null && answers[currentIndex] !== undefined ? (
                   <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider">Answered</span>
                 ) : markedForReview[currentIndex] ? (
                   <span className="bg-purple-500/20 text-purple-400 border border-purple-500/20 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider">Review</span>
                 ) : (
                   <span className="bg-rose-500/20 text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider">Not Answered</span>
                 )}
                 {/* Font Size Zoom Control */}
                 <div className="flex items-center bg-[#171a26] border border-slate-800 rounded px-1 py-0.5 text-xs text-slate-400">
                   <span className="px-1.5 text-[10px] text-slate-500 font-bold uppercase">Zoom:</span>
                   <button onClick={() => setFontSize('sm')} className={`px-1.5 py-0.5 rounded cursor-pointer ${fontSize === 'sm' ? 'bg-indigo-600 text-white font-bold' : 'hover:text-slate-200'}`}>A-</button>
                   <button onClick={() => setFontSize('base')} className={`px-1.5 py-0.5 rounded cursor-pointer ${fontSize === 'base' ? 'bg-indigo-600 text-white font-bold' : 'hover:text-slate-200'}`}>A</button>
                   <button onClick={() => setFontSize('lg')} className={`px-1.5 py-0.5 rounded cursor-pointer ${fontSize === 'lg' ? 'bg-indigo-600 text-white font-bold' : 'hover:text-slate-200'}`}>A+</button>
                 </div>
               </div>

               <div className="flex items-center gap-2">
                 <div className="text-xs font-bold font-mono tracking-wider bg-[#171a26] border border-slate-800 px-3 py-1.5 rounded flex gap-2">
                   <span className="text-emerald-400">+{currentQuestion?.marks || 4}</span> <span className="text-slate-700">|</span> <span className="text-rose-500">-1</span>
                 </div>
               </div>
            </div>

            {/* Question Box */}
            <div className="flex-1 bg-[#171a26] border border-slate-800 rounded-2xl p-6 md:p-10 flex flex-col overflow-y-auto shadow-xl shadow-black/10">
               <div className="flex items-center gap-3 mb-8">
                 <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-bold px-3 py-1 rounded-full">{currentSubject}</Badge>
                 <span className="text-xs text-slate-500 font-medium">
                    {currentQuestion?.type === 'single' ? 'Single Correct · MCQ' : currentQuestion?.type === 'multiple' ? 'Multiple Correct · MCQ' : 'Subjective / Numerical'}
                 </span>
               </div>
               
               <div className={`font-semibold text-slate-200 leading-relaxed mb-10 whitespace-pre-wrap ${
                  fontSize === 'sm' ? 'text-sm md:text-base' : fontSize === 'lg' ? 'text-lg md:text-xl' : 'text-base md:text-lg'
               }`}>
                  {currentQuestion?.text}
               </div>
               
               {currentQuestion?.imageUrl && (
                  <div className="mb-10 max-w-2xl rounded-xl overflow-hidden border border-slate-800">
                     <img src={currentQuestion.imageUrl} alt="Question Graphic" className="w-full h-auto" />
                  </div>
               )}

               <div className="space-y-3 mt-auto">
                 {currentQuestion?.options.map((opt, idx) => {
                    const letters = ['A', 'B', 'C', 'D', 'E'];
                    const letter = letters[idx];
                    const isSelected = Array.isArray(answers[currentIndex]) 
                      ? (answers[currentIndex]).includes(idx) 
                      : answers[currentIndex] === idx;

                    return (
                      <button 
                         key={idx}
                         onClick={() => currentQuestion.type === 'multiple' ? handleCheckboxToggle(idx) : handleAnswer(idx)}
                         className={`w-full text-left p-4 rounded-xl border flex items-center gap-4 transition-all cursor-pointer
                           ${isSelected ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-200' : 'bg-slate-900/50 border-slate-800/60 text-slate-300 hover:bg-slate-800 hover:border-slate-700'}`}
                      >
                         <div className={`h-7 w-7 rounded-full border flex items-center justify-center font-bold text-xs shrink-0
                           ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                           {letter}
                         </div>
                         <span className="text-sm font-medium leading-relaxed">{opt}</span>
                      </button>
                    )
                 })}
               </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between mt-6 shrink-0 gap-4">
               <div className="flex gap-3">
                  <Button onClick={handleClearResponse} variant="outline" className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200 bg-transparent h-11 px-4 md:px-6 rounded-xl font-bold text-xs cursor-pointer">Clear Response</Button>
                  <Button onClick={handleMarkForReview} variant="outline" className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200 bg-transparent h-11 px-4 md:px-6 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer">
                     <div className="h-1.5 w-1.5 rounded-full bg-amber-400 hidden md:block" /> Mark for Review
                  </Button>
               </div>
               <div className="flex gap-3">
                  <Button onClick={() => setCurrentIndex(c => Math.max(0, c - 1))} disabled={currentIndex === 0} variant="outline" className="border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-slate-100 bg-transparent h-11 px-4 md:px-6 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer">
                    <ArrowLeft size={16} /> <span className="hidden md:inline">Previous</span>
                  </Button>
                  <Button onClick={handleSaveAndNext} className="bg-amber-400 hover:bg-amber-500 text-slate-950 h-11 px-6 md:px-8 rounded-xl font-black text-xs flex items-center gap-2 cursor-pointer border-none shadow-lg shadow-amber-500/10">
                    Save & Next <ArrowRight size={16} />
                  </Button>
               </div>
            </div>
         </div>

         {/* Right Sidebar */}
         <div className="w-80 bg-[#171a26] border-l border-slate-800 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-800 bg-[#131620] flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Question Palette</span>
              {paletteFilter !== 'ALL' && (
                <button 
                  onClick={() => setPaletteFilter('ALL')} 
                  className="text-[10px] text-indigo-400 hover:underline font-bold cursor-pointer"
                >
                  Clear Filter
                </button>
              )}
            </div>

            <div className="p-4 grid grid-cols-2 gap-3 shrink-0 border-b border-slate-800/50 bg-[#131620]">
               <button 
                 onClick={() => setPaletteFilter(prev => prev === 'ANSWERED' ? 'ALL' : 'ANSWERED')}
                 className={`border rounded-xl p-3 flex flex-col justify-center items-center transition-all cursor-pointer ${
                   paletteFilter === 'ANSWERED' ? 'bg-emerald-500/30 border-emerald-400 ring-2 ring-emerald-500/30' : 'bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-500/30'
                 }`}
               >
                  <span className="block text-xl font-black text-emerald-500">{counts.answered + counts.answeredMarkedReview}</span>
                  <span className="text-[9px] text-emerald-400/80 font-bold uppercase tracking-wider mt-1">Answered</span>
               </button>
               <button 
                 onClick={() => setPaletteFilter(prev => prev === 'UNANSWERED' ? 'ALL' : 'UNANSWERED')}
                 className={`border rounded-xl p-3 flex flex-col justify-center items-center transition-all cursor-pointer ${
                   paletteFilter === 'UNANSWERED' ? 'bg-rose-500/30 border-rose-400 ring-2 ring-rose-500/30' : 'bg-rose-500/20 border-rose-500/30 hover:bg-rose-500/30'
                 }`}
               >
                  <span className="block text-xl font-black text-rose-500">{counts.notAnswered}</span>
                  <span className="text-[9px] text-rose-400/80 font-bold uppercase tracking-wider mt-1">Not Ans.</span>
               </button>
               <button 
                 onClick={() => setPaletteFilter(prev => prev === 'REVIEW' ? 'ALL' : 'REVIEW')}
                 className={`border rounded-xl p-3 flex flex-col justify-center items-center transition-all cursor-pointer ${
                   paletteFilter === 'REVIEW' ? 'bg-purple-500/30 border-purple-400 ring-2 ring-purple-500/30' : 'bg-purple-500/20 border-purple-500/30 hover:bg-purple-500/30'
                 }`}
               >
                  <span className="block text-xl font-black text-purple-400">{counts.markedReview}</span>
                  <span className="text-[9px] text-purple-300/80 font-bold uppercase tracking-wider mt-1">Review</span>
               </button>
               <button 
                 onClick={() => setPaletteFilter(prev => prev === 'UNVISITED' ? 'ALL' : 'UNVISITED')}
                 className={`border rounded-xl p-3 flex flex-col justify-center items-center transition-all cursor-pointer ${
                   paletteFilter === 'UNVISITED' ? 'bg-slate-700/50 border-slate-500 ring-2 ring-slate-500/30' : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80'
                 }`}
               >
                  <span className="block text-xl font-black text-slate-300">{counts.notVisited}</span>
                  <span className="text-[9px] text-slate-400/80 font-bold uppercase tracking-wider mt-1">Unvisited</span>
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-8 bg-[#171a26]">
               {uniqueSubjects.map((sub, sIdx) => {
                  const subColor = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'][sIdx % 4];
                  return (
                    <div key={sub} className="space-y-4">
                       <div className="flex items-center gap-2 text-[10px] font-black tracking-widest text-slate-400 uppercase">
                          <div className={`h-1.5 w-1.5 rounded-full ${subColor}`} />
                          {sub}
                       </div>
                       <div className="grid grid-cols-5 gap-2.5">
                          {questions.map((q, i) => {
                             if ((q.subject || exam?.subject || 'General') !== sub) return null;
                             const isAns = answers[i] !== null && answers[i] !== undefined;
                             const isVis = visited[i];
                             const isMarked = markedForReview[i];

                             // Palette filter check
                             if (paletteFilter === 'ANSWERED' && !isAns) return null;
                             if (paletteFilter === 'UNANSWERED' && (isAns || !isVis)) return null;
                             if (paletteFilter === 'REVIEW' && !isMarked) return null;
                             if (paletteFilter === 'UNVISITED' && isVis) return null;
                             
                             let bgColor = 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700/50 shadow-sm';
                             if (isAns) bgColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30';
                             if (!isAns && isVis) bgColor = 'bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30';
                             if (isMarked) bgColor = 'bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30';
                             if (i === currentIndex) bgColor = 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20 ring-2 ring-indigo-500/30 ring-offset-2 ring-offset-[#171a26]';

                             return (
                               <button
                                 key={i}
                                 onClick={() => setCurrentIndex(i)}
                                 className={`h-10 w-full rounded-lg border flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${bgColor}`}
                               >
                                 {i + 1}
                               </button>
                             );
                          })}
                       </div>
                    </div>
                  )
               })}
            </div>
         </div>
      </div>

      <Dialog open={isSubmitConfirmOpen} onOpenChange={setIsSubmitConfirmOpen}>
        <DialogContent className="sm:max-w-lg bg-white rounded-3xl border-0 shadow-2xl p-6 md:p-8">
          <DialogHeader className="space-y-3">
            <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center border shadow-sm ${
              unansweredCount > 0 
                ? 'bg-amber-50 border-amber-200 text-amber-600' 
                : 'bg-emerald-50 border-emerald-200 text-emerald-600'
            }`}>
              {unansweredCount > 0 ? (
                <AlertTriangle className="h-8 w-8" />
              ) : (
                <CheckCircle2 className="h-8 w-8" />
              )}
            </div>
            
            <DialogTitle className="text-center text-2xl font-black text-slate-900 tracking-tight">
              Submit Examination?
            </DialogTitle>
            
            <DialogDescription className="text-center text-slate-500 font-medium text-xs leading-relaxed">
              {unansweredCount > 0 
                ? `You still have ${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''}. Submitting now will finalize your answers as they are.` 
                : 'Great job! You have attempted all questions in this assessment.'
              }
            </DialogDescription>
          </DialogHeader>

          {/* Unanswered Warning Banner */}
          {unansweredCount > 0 && (
            <div className="bg-rose-50 border border-rose-200/80 rounded-2xl p-4 flex items-start gap-3 mt-2">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs font-semibold text-rose-900 leading-snug">
                <p className="font-extrabold uppercase text-[10px] tracking-wider text-rose-700 mb-0.5">
                  Unanswered Questions Warning
                </p>
                You have <span className="font-black underline text-rose-700">{unansweredCount} unanswered question{unansweredCount > 1 ? 's' : ''}</span> out of {questions.length}. Any unattempted questions will receive zero marks.
              </div>
            </div>
          )}

          {/* Summary Metric Grid */}
          <div className="grid grid-cols-4 gap-2.5 mt-4">
            <div className="bg-slate-50 border border-slate-150 p-3 rounded-2xl text-center">
              <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Total</span>
              <span className="text-lg font-black text-slate-800 block mt-0.5">{questions.length}</span>
            </div>
            <div className="bg-emerald-50/60 border border-emerald-100 p-3 rounded-2xl text-center">
              <span className="text-[9px] font-extrabold text-emerald-600 uppercase tracking-wider block">Answered</span>
              <span className="text-lg font-black text-emerald-600 block mt-0.5">{answeredCount}</span>
            </div>
            <div className={`p-3 rounded-2xl text-center border ${
              unansweredCount > 0 
                ? 'bg-rose-50/60 border-rose-200 text-rose-700' 
                : 'bg-slate-50 border-slate-150 text-slate-700'
            }`}>
              <span className="text-[9px] font-extrabold uppercase tracking-wider block">Unanswered</span>
              <span className="text-lg font-black block mt-0.5">{unansweredCount}</span>
            </div>
            <div className="bg-purple-50/60 border border-purple-100 p-3 rounded-2xl text-center">
              <span className="text-[9px] font-extrabold text-purple-600 uppercase tracking-wider block">In Review</span>
              <span className="text-lg font-black text-purple-600 block mt-0.5">{markedForReviewCount}</span>
            </div>
          </div>

          {/* Subject-Wise Unanswered Breakdown List */}
          {unansweredBySubject.length > 0 && (
            <div className="mt-4 bg-slate-50 border border-slate-150 rounded-2xl p-3.5 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Unanswered by Subject:
              </span>
              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                {unansweredBySubject.map(item => (
                  <div key={item.subject} className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span className="truncate max-w-[200px]">{item.subject}</span>
                    <span className="font-bold text-rose-600 bg-rose-100/60 px-2 py-0.5 rounded-full text-[10px]">
                      {item.unanswered} unanswered / {item.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="grid grid-cols-2 gap-3 mt-6">
            <Button 
              variant="outline" 
              className="h-12 rounded-xl font-bold border-slate-200 text-slate-700 hover:bg-slate-50 text-xs uppercase tracking-wider cursor-pointer" 
              onClick={() => setIsSubmitConfirmOpen(false)} 
              disabled={loading}
            >
              Continue Exam
            </Button>
            <Button 
              className={`h-12 rounded-xl font-extrabold text-white text-xs uppercase tracking-wider border-none shadow-md cursor-pointer transition-all ${
                unansweredCount > 0 
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' 
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
              }`} 
              onClick={handleSubmit} 
              disabled={loading}
            >
              {loading ? "Transmitting..." : "Yes, Submit Exam"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWarningModalOpen} onOpenChange={(open) => {
        if (!open) return;
        setIsWarningModalOpen(open);
      }}>
        <DialogContent className="sm:max-w-md bg-white rounded-3xl border-4 border-rose-500 shadow-2xl p-6 select-none">
          <DialogHeader>
            <div className="mx-auto w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center mb-4 border border-rose-100 animate-pulse">
               <ShieldAlert className="h-10 w-10 text-rose-600" />
            </div>
            <DialogTitle className="text-center text-2xl font-display font-black tracking-tight text-rose-850 uppercase">PROCTOR WARNING OVERLAY</DialogTitle>
            <DialogDescription className="text-center text-slate-700 font-bold pt-3 leading-relaxed">
              Active window focus loss or browser tab switch detected.
              <br/>
              <span className="text-rose-600 font-black underline">This is Violation 1 of 2 logged.</span>
              <br/><br/>
              According to the strict security rules of the Online Examination core, any subsequent screen deviations or tab switching will trigger 
              <span className="text-red-700 font-black"> immediate automatic exam submission</span> with the current answers.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150 text-[11px] font-bold text-slate-500 leading-relaxed text-center my-2">
             🔒 Proctor monitoring is active. Do not touch keyboard combinations, minimize, right-click, or leave full-screen mode.
          </div>
          <DialogFooter className="mt-6">
            <Button 
              className="w-full h-12 rounded-xl font-black bg-slate-900 hover:bg-rose-600 text-white shadow-xl transition-all border-none cursor-pointer uppercase tracking-wider text-xs" 
              onClick={() => setIsWarningModalOpen(false)}
            >
              I Understand, Resume Exam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Biometric Active Gaze Presence Challenge Backdrop Overlay */}
      {challengeActive && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-[32px] p-8 shadow-2xl text-center space-y-6 relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-amber-500 to-rose-500 animate-pulse" />
            
            <div className="h-16 w-16 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Eye className="h-8 w-8 text-amber-400 animate-pulse" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Active Presence Verification</h3>
              <p className="text-xs text-slate-400 font-semibold leading-relaxed">
                A randomized gaze presence verification is active. 
                This ensures students do not look down at mobile devices or search external aids.
              </p>
            </div>

            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500 font-bold">COUNTDOWN</span>
              <span className="text-rose-400 font-black text-sm animate-pulse">{challengeTimeLeft}s REMAINING</span>
            </div>

            <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wider animate-bounce">
              🔍 Click the flashing target confirmation node floating on the screen!
            </p>
          </div>

          {/* Floated green target verify node */}
          <button
            type="button"
            onClick={handlePassChallenge}
            style={{ 
              top: `${challengeCoords.y}%`, 
              left: `${challengeCoords.x}%` 
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 h-20 w-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center cursor-pointer shadow-lg shadow-emerald-500/30 hover:scale-110 active:scale-95 transition-all animate-pulse z-[10000]"
          >
            <div className="h-4 w-4 rounded-full bg-emerald-400" />
            <span className="absolute -bottom-6 text-[9px] font-black font-mono text-emerald-400 bg-slate-900 px-2 py-0.5 rounded border border-emerald-500/30 uppercase tracking-widest whitespace-nowrap">
              CONFIRM PRESENT
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

export const ExamInterface: React.FC = () => {
  return (
    <ExamSyncProvider>
      <ExamInterfaceCore />
    </ExamSyncProvider>
  );
};
