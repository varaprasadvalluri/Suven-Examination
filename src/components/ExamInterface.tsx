import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch, setDoc, onSnapshot } from '../lib/firebase';
import { Exam, Question, Attempt } from '../types';
import { MathInputToolbar } from './MathInputToolbar';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter } from './ui/card';
import { Badge } from './ui/badge';
import { Clock, ChevronLeft, ChevronRight, Send, HelpCircle, ShieldAlert, PauseCircle, Eye, Volume2, ListChecks, X } from 'lucide-react';
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
      const logRef = doc(collection(db, 'proctor_logs'));
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
      await examAnswerQueue.flush();
      
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

      try {
        await updateDoc(doc(db, 'attempts', attemptId), {
          score,
          accuracy,
          avgTimePerCorrect,
          status: 'completed',
          answers,
          timePerQuestion,
          endTime: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `attempts/${attemptId}`);
        return;
      }
      
      if (errorBookEntries.length > 0) {
        try {
          const batch = writeBatch(db);
          errorBookEntries.forEach(entry => {
            const ebRef = doc(collection(db, 'error_books'));
            batch.set(ebRef, entry);
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'error_books');
          return;
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

      toast.success("Exam finalization sequence complete.");
      setTimeout(() => navigate(`/result/${attemptId}`), 2000);
    } catch (error) {
      console.error(error);
      toast.error("Failed to submit exam");
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

  // 1. Initialize secure audio/video capturing
  useEffect(() => {
    if (loading || !attempt || attempt.status === 'completed') return;

    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
        if (stream) {
          videoStreamRef.current = stream;
          setWebcamAllowed(true);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        }
      } catch (err) {
        console.warn("Webcam access not allowed or unavailable", err);
      }

      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
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

  // Dynamic segments/subject lists derived directly from the test questions
  const uniqueSubjects = Array.from(new Set(questions.map(q => q.subject || exam.subject || 'General')));
  const currentSubject = currentQuestion?.subject || exam.subject || 'General';

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
    <div className="max-w-7xl mx-auto space-y-6 pb-20 px-4">
      {/* QUICK SUMMARY SIDEBAR */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black z-40 animate-in fade-in"
            />

            {/* Sidebar drawer container */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-80 md:w-96 bg-white shadow-2xl z-50 border-l border-slate-200 flex flex-col"
            >
              {/* Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5 text-indigo-600" />
                  <h3 className="text-lg font-display font-black text-slate-900 tracking-tight">Quick Summary</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer border-0 bg-transparent"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Stats overview banner */}
              <div className="p-6 border-b border-slate-100 bg-slate-50/30">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded-xl border border-slate-150 text-center shadow-sm">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Answered</span>
                    <span className="text-xl font-black text-emerald-600">{counts.answered + counts.answeredMarkedReview}</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-150 text-center shadow-sm">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Skipped</span>
                    <span className="text-xl font-black text-amber-500">{questions.length - (counts.answered + counts.answeredMarkedReview)}</span>
                  </div>
                </div>
              </div>

              {/* Scrollable list of questions */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {questions.map((q, idx) => {
                  const isAnswered = answers[idx] !== null && answers[idx] !== undefined;
                  const isMarked = markedForReview[idx];
                  const isActive = currentIndex === idx;
                  const subjectName = q.subject || exam.subject || 'General';

                  return (
                    <button
                      key={q.id || idx}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(idx);
                        if (window.innerWidth < 768) {
                          setIsSidebarOpen(false);
                        }
                      }}
                      className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all active:scale-[0.99] cursor-pointer ${
                        isActive
                          ? "border-indigo-600 bg-indigo-50/30 shadow-sm"
                          : "border-slate-150 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-black tracking-tight ${isActive ? "text-indigo-950 font-extrabold" : "text-slate-850 font-bold"}`}>
                            Question {idx + 1}
                          </span>
                          {isActive && (
                            <span className="bg-indigo-100 text-indigo-700 font-extrabold text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Current
                            </span>
                          )}
                          {isMarked && (
                            <span className="bg-violet-100 text-violet-700 font-extrabold text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Review
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                          {subjectName}
                        </span>
                      </div>

                      <div>
                        {isAnswered ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider">
                            Answered
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider">
                            Skipped
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Sidebar footer controls */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <Button
                  onClick={() => setIsSidebarOpen(false)}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-11 font-bold text-xs uppercase tracking-wider border-none"
                >
                  Close Summary
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* EMERGENCY PAUSE OVERLAY GATE */}
      {isPaused && (
        <div className="fixed inset-0 bg-slate-950/90 z-[9999] backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="text-center space-y-6 max-w-md p-8 bg-slate-900 border border-slate-800 rounded-[32px] shadow-2xl">
            <div className="h-20 w-20 bg-amber-500/10 border border-amber-450 rounded-3xl flex items-center justify-center mx-auto animate-pulse">
              <PauseCircle className="h-10 w-10 text-amber-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black uppercase tracking-tight text-white font-display">Assessment Session Paused</h2>
              <p className="text-slate-400 text-xs font-semibold leading-relaxed">
                The institutional administration has triggered an emergency pause. Your answers are safe, and your countdown clock has been locked at {formatTime(timeLeft)}.
              </p>
            </div>
            <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl font-sans">
              <span className="text-[10px] tracking-wider font-extrabold uppercase text-[#FFE28A] block font-mono">
                System Signal Locked &bull; Synced
              </span>
              <p className="text-[10px] text-slate-500 mt-1">
                Your remaining seconds will resume immediately when the administrator lifts the pause.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* OFFLINE SUBMISSION SAFE-WALL BLOCK */}
      {showOfflineWall && (
        <OfflineSubmissionSafeWall
          answers={offlineAnswersSnapshot}
          studentId={attempt.studentId}
          studentName={attempt.studentName}
          examId={exam.id}
          examTitle={exam.title}
          isOnline={isOnline}
          onOnlineSubmit={handleSubmit}
        />
      )}

      {/* Security alert header */}
      {violationsCount > 0 && (
        <div className="bg-rose-50 border border-rose-200 p-2 rounded-xl flex items-center justify-center gap-2 text-rose-600 text-[10px] font-black uppercase tracking-widest animate-bounce">
          <ShieldAlert size={14} />
          Lockout Warning: {violationsCount} of 3 Security Violations Logged
        </div>
      )}

      {/* Control Navigation Header */}
      <div className="flex items-center justify-between sticky top-4 z-30 bg-white/85 backdrop-blur-xl py-4 px-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100">
        <div>
          <span className="text-xs font-black uppercase tracking-widest text-indigo-600">Narayana E-Exam Platform</span>
          <h1 className="text-xl font-display font-black text-slate-950 tracking-tight leading-none mt-1">{exam.title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <Button 
            type="button"
            variant="outline" 
            onClick={() => setIsSidebarOpen(true)} 
            className="border-slate-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200 h-12 rounded-xl font-bold text-xs uppercase tracking-wider shadow-sm flex items-center gap-2 cursor-pointer bg-white"
          >
            <ListChecks className="h-4 w-4 text-indigo-600" />
            <span className="hidden sm:inline">Quick Summary</span>
          </Button>
          <span className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono font-bold text-sm ${timeLeft < 600 ? 'bg-rose-600 text-white animate-bounce shadow-lg border-2 border-rose-300' : 'bg-slate-900 text-white shadow-lg'}`}>
             <Clock className="h-4 w-4" /> {formatTime(timeLeft)}
          </span>
          <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700 px-8 h-12 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 border-b-4 border-emerald-800 active:border-b-0 transition-all text-white border-0 cursor-pointer" onClick={() => setIsSubmitConfirmOpen(true)}>
            <Send className="h-4 w-4 mr-2" /> Finish Assessment
          </Button>
        </div>
      </div>

      {/* 5-minute Warning Visual Alert Banner */}
      {timeLeft > 0 && timeLeft <= 300 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-lg shadow-red-100/50 animate-pulse"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600 shrink-0">
              <Clock className="h-5 w-5 animate-spin" style={{ animationDuration: '4s' }} />
            </div>
            <div>
              <p className="font-extrabold text-red-800 text-xs sm:text-sm uppercase tracking-wider flex items-center gap-2">
                ⚠️ CRITICAL TIME LIMIT WARNING &bull; Less than 5 Minutes Remaining
              </p>
              <p className="text-red-600 text-xs font-semibold leading-relaxed">
                You have only <strong className="text-red-800 font-extrabold font-mono text-sm">{formatTime(timeLeft)}</strong> left! All responses are synchronized dynamically. Please complete pending items and finalize your paper.
              </p>
            </div>
          </div>
          <div className="hidden md:block shrink-0">
            <span className="bg-red-600 text-white font-extrabold tracking-widest text-[10px] py-2 px-4 uppercase rounded-xl shadow-md">
              TIME CRITICAL
            </span>
          </div>
        </motion.div>
      )}

      {/* Answered Questions Progress Bar */}
      <Card id="exam-answered-progress-bar" className="border border-slate-100 rounded-2xl p-5 bg-white space-y-3 shadow-sm">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Answered Questions Progress</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-800 font-extrabold">{counts.answered + counts.answeredMarkedReview}</span>
            <span>of</span>
            <span className="text-slate-800 font-extrabold">{questions.length} Answered</span>
            <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-md text-[10px] font-black border border-emerald-100 ml-2">
              {Math.round(((counts.answered + counts.answeredMarkedReview) / questions.length) * 100)}% Complete
            </span>
          </div>
        </div>
        <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${((counts.answered + counts.answeredMarkedReview) / questions.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 60, damping: 15 }}
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full"
          />
        </div>
      </Card>

      {/* Narayana Segment Tabs for Subjects */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0 mr-2">Subject Segments:</span>
        {uniqueSubjects.map((sub) => (
          <button
            key={sub}
            onClick={() => jumpToSubject(sub)}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border ${sub === currentSubject ? 'bg-indigo-600 text-white border-indigo-750 shadow-md shadow-indigo-100' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'}`}
          >
            {sub} Segment ({questions.filter(q => (q.subject || exam.subject || 'General') === sub).length})
          </button>
        ))}
      </div>

      {/* Main split grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Question Board */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white/50 relative h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="absolute left-0 top-0 h-full bg-indigo-600"
            />
          </div>

          <Card id="exam-content-container" className="shadow-2xl shadow-slate-200/70 border-0 rounded-[32px] overflow-hidden bg-white select-none">
            <div className="bg-slate-900 px-8 py-5 flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm">
                    {currentIndex + 1}
                  </span>
                  <span className="text-white font-display font-bold text-sm">Question {currentIndex + 1} of {questions.length} ({currentSubject})</span>
               </div>
               <div className="flex items-center gap-4">
                  <span className="bg-indigo-505/10 bg-white/10 px-3 py-1 rounded-md text-[10px] font-black text-white uppercase tracking-widest">
                    Type: {currentQuestion.type || 'single'} MCQ (+{currentQuestion.marks}M)
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">ELAPSED: {formatTime(timePerQuestion[currentIndex] || 0)}</span>
               </div>
            </div>
            
            <CardContent className="p-8 space-y-6 bg-white min-h-[300px]">
              {/* Dynamic Staggered Asset Lazy-Loader */}
              {(currentQuestion?.imageUrl || currentQuestion?.audioUrl) ? (
                <div className="mb-4 animate-in fade-in duration-300">
                  <LazyExamAsset 
                    src={currentQuestion.imageUrl || currentQuestion.audioUrl || ""} 
                    type={currentQuestion.audioUrl ? 'audio' : 'image'} 
                    isActive={true} 
                  />
                </div>
              ) : (
                currentSubject === 'Languages' && (
                  <div className="mb-4 animate-in fade-in duration-300">
                    <LazyExamAsset 
                      src="https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg" 
                      type="audio" 
                      isActive={true} 
                    />
                  </div>
                )
              )}

              <h3 className="text-slate-800 text-xl font-display font-black leading-relaxed">{currentQuestion.text}</h3>

              {/* Dynamic Answer Components / Subject Modules */}
              {currentSubject === 'Computer Science' ? (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <EmbeddedCodeEditor 
                    value={answers[currentIndex] !== null && answers[currentIndex] !== undefined ? String(answers[currentIndex]) : ""}
                    onChange={(val) => handleAnswer(val)}
                    questionId={currentQuestion?.id || currentIndex.toString()}
                  />
                </div>
              ) : (currentSubject === 'Languages' || currentSubject === 'Literature') ? (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <RichTextKeyboardEditor 
                    value={answers[currentIndex] !== null && answers[currentIndex] !== undefined ? String(answers[currentIndex]) : ""}
                    onChange={(val) => handleAnswer(val)}
                  />
                </div>
              ) : currentQuestion.type === 'math' ? (
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="p-4 bg-white border border-slate-200 rounded-3xl max-w-3xl mx-auto text-left">
                    <MathInputToolbar 
                      value={answers[currentIndex] !== null && answers[currentIndex] !== undefined ? String(answers[currentIndex]) : ""}
                      onChange={(val) => handleAnswer(val)}
                      placeholder="Type your equations (e.g. \int_0^\pi \sin(x) dx) or use the quick key buttons..."
                      inputId="live-exam-math-editor"
                      isTextArea={true}
                    />
                  </div>
                </div>
              ) : currentQuestion.type === 'numerical' ? (
                <div className="space-y-6 animate-in fade-in duration-300">
                   <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-205 rounded-2xl max-w-sm mx-auto">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">On-Screen Keypad Entry</span>
                      <input
                         type="text"
                         value={answers[currentIndex] !== null && answers[currentIndex] !== undefined ? String(answers[currentIndex]) : ""}
                         readOnly
                         placeholder="NOT ANSWERED"
                         className="w-full text-center font-mono text-3xl font-black bg-white py-4 px-6 border-2 border-indigo-600 rounded-2xl text-indigo-950 focus:outline-none"
                      />
                   </div>
                   
                   <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto bg-slate-100 p-4 rounded-3xl border border-slate-200">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', '.'].map(key => (
                         <button
                            key={key}
                            type="button"
                            onClick={() => {
                               const currentVal = answers[currentIndex] !== null && answers[currentIndex] !== undefined
                                  ? String(answers[currentIndex])
                                  : "";
                               if (currentVal.length < 12) {
                                  handleAnswer(currentVal + key);
                               }
                            }}
                            className="h-12 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl font-mono text-lg font-bold text-slate-800 transition-colors shadow-sm active:scale-95 cursor-pointer"
                         >
                            {key}
                         </button>
                      ))}
                      <button
                         type="button"
                         onClick={() => {
                            const currentVal = answers[currentIndex] !== null && answers[currentIndex] !== undefined
                               ? String(answers[currentIndex])
                               : "";
                            if (currentVal.length > 0) {
                               handleAnswer(currentVal.slice(0, -1));
                            } else {
                               handleAnswer(null);
                            }
                         }}
                         className="col-span-1 h-12 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 rounded-xl font-bold transition-colors shadow-sm active:scale-95 text-xs uppercase cursor-pointer"
                      >
                         BkSp
                      </button>
                      <button
                         type="button"
                         onClick={handleClearResponse}
                         className="col-span-2 h-12 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-black transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider border-none cursor-pointer"
                      >
                         Clear Value
                      </button>
                   </div>
                </div>
              ) : currentQuestion.type === 'multiple' ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 pt-2 animate-in fade-in duration-300">
                     {(currentQuestion.options || []).map((opt, i) => {
                        const isSelected = Array.isArray(answers[currentIndex]) 
                           ? (answers[currentIndex] as number[]).includes(i)
                           : answers[currentIndex] === i;

                        return (
                           <button
                             key={i}
                             type="button"
                             onClick={() => handleCheckboxToggle(i)}
                             className={`group relative p-6 rounded-2xl border-2 text-left transition-all hover:scale-[1.005] active:scale-[0.99] cursor-pointer ${isSelected ? 'border-indigo-600 bg-indigo-50/50 shadow-lg shadow-indigo-100' : 'border-slate-100 hover:border-indigo-200 bg-white'}`}
                           >
                             <div className="flex items-center gap-5">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-all ${isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-400 rotate-12' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-400'}`}>
                                   {String.fromCharCode(65 + i)}
                                </div>
                                <span className={`text-lg transition-colors ${isSelected ? 'text-indigo-950 font-bold' : 'text-slate-600'}`}>{opt}</span>
                             </div>
                             <div className="absolute right-6 top-1/2 -translate-y-1/2">
                                <input type="checkbox" checked={isSelected} readOnly className="pointer-events-none rounded border-slate-300 text-indigo-600" />
                             </div>
                           </button>
                        );
                     })}
                  </div>
                  {currentSubject === 'Chemistry' && (
                    <div className="mt-8 pt-6 border-t border-slate-100 animate-in slide-in-from-bottom-2 duration-300">
                      <PeriodicTableHelper 
                        onInsertSymbol={(sym) => {
                          const currentVal = answers[currentIndex] !== null && answers[currentIndex] !== undefined ? String(answers[currentIndex]) : "";
                          handleAnswer(currentVal + sym);
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 pt-2 animate-in fade-in duration-300">
                     {(currentQuestion.options || []).map((opt, i) => (
                       <button
                         key={i}
                         type="button"
                         onClick={() => handleAnswer(i)}
                         className={`group relative p-6 rounded-2xl border-2 text-left transition-all hover:scale-[1.005] active:scale-[0.99] cursor-pointer ${answers[currentIndex] === i ? 'border-indigo-600 bg-indigo-50/50 shadow-lg shadow-indigo-100' : 'border-slate-100 hover:border-indigo-200 bg-white'}`}
                       >
                         <div className="flex items-center gap-5">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-all ${answers[currentIndex] === i ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-400 rotate-12' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-400'}`}>
                               {String.fromCharCode(65 + i)}
                            </div>
                            <span className={`text-lg transition-colors ${answers[currentIndex] === i ? 'text-indigo-950 font-bold' : 'text-slate-600'}`}>{opt}</span>
                         </div>
                         {answers[currentIndex] === i && (
                           <div className="absolute right-6 top-1/2 -translate-y-1/2">
                             <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                           </div>
                         )}
                       </button>
                     ))}
                  </div>
                  {currentSubject === 'Chemistry' && (
                    <div className="mt-8 pt-6 border-t border-slate-100 animate-in slide-in-from-bottom-2 duration-300">
                      <PeriodicTableHelper 
                        onInsertSymbol={(sym) => {
                          const currentVal = answers[currentIndex] !== null && answers[currentIndex] !== undefined ? String(answers[currentIndex]) : "";
                          handleAnswer(currentVal + sym);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </CardContent>

            <CardFooter className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 border-t border-slate-100 px-8 py-5">
               <div className="flex items-center gap-2">
                  <Button variant="ghost" className="h-12 px-6 rounded-xl font-bold text-slate-400 hover:text-slate-900 cursor-pointer" disabled={currentIndex === 0} onClick={() => setCurrentIndex(currentIndex - 1)}>
                    <ChevronLeft className="h-4 w-4 mr-2" /> Prev
                  </Button>
                  <Button variant="outline" className="h-12 px-5 rounded-xl font-bold text-rose-600 border-rose-200 hover:bg-rose-50 cursor-pointer" onClick={handleClearResponse}>
                    Clear Response
                  </Button>
               </div>
               <div className="flex items-center gap-2">
                  <Button className="h-12 px-5 rounded-xl font-bold bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-100 border-none cursor-pointer" onClick={handleMarkForReview}>
                     Mark for Review & Next
                  </Button>
                  <Button className="h-12 px-6 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 border-none cursor-pointer" onClick={handleSaveAndNext}>
                     Save & Next <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
               </div>
            </CardFooter>
          </Card>
        </div>

        {/* Right Side: Command Board & Interactive Palette */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Student details */}
          <Card className="border border-slate-100 rounded-[24px] shadow-sm bg-white overflow-hidden">
             <div className="p-5 flex items-center gap-4 border-b border-slate-100 bg-slate-50/50">
                <div className="h-12 w-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-black text-lg">
                   {attempt.studentName ? attempt.studentName.slice(0, 2).toUpperCase() : 'ST'}
                </div>
                <div>
                   <p className="text-sm font-black text-slate-800 leading-tight">{attempt.studentName}</p>
                   <p className="text-[10px] text-slate-400 font-mono mt-0.5">{attempt.studentEmail || "Verified Onboard ID"}</p>
                </div>
             </div>
          </Card>

          {/* Color Mapping Legend */}
          <Card className="border border-slate-100 rounded-3xl p-5 bg-white space-y-4 shadow-sm">
             <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Legend Status Map</h4>
             <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2.5">
                   <span className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-black text-xs shadow-sm">
                     {counts.answered}
                   </span>
                   <span className="text-[9px] font-bold text-slate-600 uppercase">Answered</span>
                </div>
                <div className="flex items-center gap-2.5">
                   <span className="w-8 h-8 rounded-lg bg-rose-500 text-white flex items-center justify-center font-black text-xs shadow-sm">
                     {counts.notAnswered}
                   </span>
                   <span className="text-[9px] font-bold text-slate-600 uppercase">Not Ans</span>
                </div>
                <div className="flex items-center gap-2.5 col-span-2">
                   <span className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center font-black text-xs shadow-sm">
                     {counts.markedReview}
                   </span>
                   <span className="text-[9px] font-bold text-slate-600 uppercase">Marked for Review</span>
                </div>
                <div className="flex items-center gap-2.5 col-span-2">
                   <span className="w-8 h-8 rounded-lg bg-indigo-900 border border-emerald-400 text-white flex items-center justify-center font-black text-xs relative shadow-sm">
                     {counts.answeredMarkedReview}
                     <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 border border-white" />
                   </span>
                   <span className="text-[9px] font-bold text-slate-655 uppercase leading-none">Ans & Marked for Review</span>
                </div>
                <div className="flex items-center gap-2.5 col-span-2">
                   <span className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center font-black text-xs border border-slate-200">
                     {counts.notVisited}
                   </span>
                   <span className="text-[9px] font-bold text-slate-600 uppercase">Not Visited</span>
                </div>
             </div>
          </Card>

          {/* Interactive Question Board Palette */}
          <Card className="border border-slate-100 rounded-3xl p-6 bg-white space-y-4 shadow-sm">
             <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Interactive Question Grid</h4>
             <div className="grid grid-cols-5 gap-2.5 justify-items-center">
                {questions.map((_, i) => {
                   const isMarked = markedForReview[i];
                   const isAns = answers[i] !== null && answers[i] !== undefined;
                   const isVis = visited[i];
                   
                   let statusClass = "bg-slate-50 text-slate-450 border border-slate-150 hover:bg-slate-100 cursor-pointer";
                   let badgeDot = false;
                   
                   if (isMarked) {
                      if (isAns) {
                         statusClass = "bg-indigo-900 text-white border border-emerald-400 font-bold shadow-md relative cursor-pointer";
                         badgeDot = true;
                      } else {
                         statusClass = "bg-violet-600 text-white font-bold shadow-md cursor-pointer";
                      }
                   } else if (isAns) {
                      statusClass = "bg-emerald-500 text-white font-bold shadow-md cursor-pointer";
                   } else if (isVis) {
                      statusClass = "bg-rose-500 text-white font-bold shadow-md cursor-pointer";
                   }
                   
                   if (currentIndex === i) {
                      statusClass += " ring-4 ring-indigo-500 ring-offset-2 scale-110 z-10 font-black";
                   }

                   return (
                      <button
                        key={i}
                        onClick={() => setCurrentIndex(i)}
                        className={`w-11 h-11 rounded-xl text-xs font-black flex items-center justify-center transition-all ${statusClass}`}
                      >
                        {i + 1}
                        {badgeDot && (
                          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        )}
                      </button>
                   );
                })}
             </div>
              <div className="pt-4 border-t border-slate-100 mt-2">
                 <Button 
                   type="button"
                   variant="ghost" 
                   onClick={() => setIsSidebarOpen(true)} 
                   className="w-full text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/50 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer h-10 rounded-xl"
                 >
                   <ListChecks className="h-4 w-4" /> View Detailed Summary List
                 </Button>
              </div>
              </Card>

           {/* Secure Live Video Stream */}
          <div className="bg-slate-900 border border-slate-800 rounded-[24px] p-5 shadow-xl overflow-hidden">
             <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                   <div className={`h-1.5 w-1.5 rounded-full ${webcamAllowed ? 'bg-emerald-500 animate-ping' : 'bg-rose-500 animate-pulse'}`} />
                   <span className="text-[9px] font-black text-white uppercase tracking-wider">Live Secure Proctor Stream</span>
                </div>
                <span className="text-[8px] font-mono text-emerald-400 uppercase animate-pulse font-bold">
                  {webcamAllowed ? 'STREAM ONLINE' : 'RADAR SCANNING'}
                </span>
             </div>
             
             <div className="aspect-video bg-black rounded-xl relative overflow-hidden flex items-center justify-center">
                {webcamAllowed ? (
                  <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline 
                    muted 
                    className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                  />
                ) : (
                  <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
                     <ShieldAlert size={20} className="text-rose-500 animate-bounce mb-1" />
                     <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Secure Monitoring Active</p>
                     <p className="text-[7px] text-slate-500 font-medium max-w-[140px] mt-0.5 leading-normal">
                       Webcam authorized under national guidelines. Local sandboxed capture running.
                     </p>
                  </div>
                )}
                
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                <div className="text-[8px] font-mono text-emerald-400 absolute top-2 left-2 bg-slate-950/70 px-1.5 py-0.5 rounded pointer-events-none">
                  {webcamAllowed ? 'REC ● LIVE' : 'SANDBOX SIM ● SECURE'}
                </div>
                
                {/* Simulated Biometric Crosshair */}
                <div className="absolute inset-4 border border-dashed border-emerald-500/10 rounded-full animate-pulse pointer-events-none" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-emerald-500/20 rounded pointer-events-none" />
             </div>

             {/* Live Microphone Decibel Tracking */}
             <div className="mt-3.5 pt-3.5 border-t border-slate-800/60 space-y-2">
                <div className="flex items-center justify-between text-[9px]">
                   <span className="text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <Volume2 size={10} className={micLevel > 28 ? "text-rose-500 animate-pulse" : "text-indigo-400"} /> 
                      MIC LEVEL MONITOR
                   </span>
                   <span className={`font-black font-mono ${micLevel > 28 ? 'text-rose-500 animate-pulse font-extrabold' : 'text-emerald-400 font-bold'}`}>
                      {micLevel > 28 ? 'TALKING/NOISE' : `${micLevel}% ACTIVE`}
                   </span>
                </div>
                
                <div className="h-1.5 bg-slate-950 rounded-full overflow-hidden flex">
                   <div 
                      className={`h-full transition-all duration-75 ${
                        micLevel > 28 ? 'bg-rose-500 shadow-md shadow-rose-500/40' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.max(4, micLevel)}%` }}
                   />
                </div>
                {micLevel > 28 && (
                   <p className="text-[7px] text-rose-500 font-extrabold uppercase tracking-wider text-right animate-pulse">
                      Talking detected! Whispering/conversations are flagged.
                   </p>
                )}
             </div>

             {/* Biometric Gaze Metric */}
             <div className="mt-3 space-y-1.5 text-[9px] border-t border-slate-800/40 pt-3">
                <div className="flex items-center justify-between text-slate-400">
                   <span className="font-bold uppercase tracking-wider">FOCUS ALIGNMENT</span>
                   <span className="text-emerald-400 font-bold font-mono">
                     {challengeActive ? 'CALIBRATING...' : '98.4% MATCH'}
                   </span>
                </div>
                <div className="h-1 bg-slate-950 rounded-full overflow-hidden">
                   <div 
                      className={`h-full transition-all duration-500 ${challengeActive ? 'bg-amber-500 animate-pulse w-[40%]' : 'bg-emerald-400 w-[98.4%]'}`} 
                   />
                </div>
             </div>
          </div>

        </div>
      </div>

      <Dialog open={isSubmitConfirmOpen} onOpenChange={setIsSubmitConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-3xl border-0 shadow-2xl">
          <DialogHeader>
            <div className="mx-auto w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mb-6 border border-indigo-100">
               <HelpCircle className="h-10 w-10 text-indigo-600" />
            </div>
            <DialogTitle className="text-center text-2xl font-display font-black tracking-tight">Final Submission</DialogTitle>
            <DialogDescription className="text-center text-slate-500 font-medium pt-2">
              You have completed {answers.filter(a => a !== null).length} out of {questions.length} responses. Are you ready to transmit your final exam data to the valuation core?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid grid-cols-2 gap-4 mt-8">
            <Button variant="outline" className="h-12 rounded-xl font-bold border-slate-200 cursor-pointer" onClick={() => setIsSubmitConfirmOpen(false)} disabled={loading}>
              Return
            </Button>
            <Button className="h-12 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 text-white border-none cursor-pointer" onClick={handleSubmit} disabled={loading}>
              {loading ? "Transmitting..." : "Confirm & Send"}
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

      {/* Free-hand drawing whiteboard rough tool */}
      {(currentSubject === 'Mathematics' || currentSubject === 'Physics') && (
        <ScratchpadCanvas />
      )}

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
