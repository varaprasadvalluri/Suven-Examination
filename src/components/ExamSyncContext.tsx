import React, { createContext, useContext, useState, useEffect } from 'react';
import { db, doc, updateDoc, writeBatch } from '../lib/firebase';
import { Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { examAnswerQueue } from '../services/api';

interface ExamSyncContextType {
  isOnline: boolean;
  isSynced: boolean;
  syncAnswers: (answers: any[], attemptId: string) => Promise<void>;
  forceBackgroundSync: (attemptId: string) => Promise<void>;
}

const ExamSyncContext = createContext<ExamSyncContextType | undefined>(undefined);

export const ExamSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSynced, setIsSynced] = useState(true);
  const [pendingDraft, setPendingDraft] = useState<any[] | null>(null);

  // Monitor network status globally
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Back online. Syncing your answers...", {
        icon: <Wifi className="h-4 w-4 text-emerald-500 animate-bounce" />
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning("Server disconnected. The exam portal is running locally on offline cache.", {
        icon: <WifiOff className="h-4 w-4 text-rose-500 animate-pulse" />,
        duration: 8000
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // When internet comes back online, automatically trigger background queue synthesis
  useEffect(() => {
    if (isOnline && pendingDraft) {
      const savedAttemptId = localStorage.getItem('active_attempt_id_draft');
      if (savedAttemptId) {
        forceBackgroundSync(savedAttemptId);
      }
    }
  }, [isOnline, pendingDraft]);

  // Listen to examAnswerQueue state changes to update the visual sync status
  useEffect(() => {
    const unsubscribe = examAnswerQueue.addListener((state) => {
      setIsSynced(state.isSynced);
    });
    return () => unsubscribe();
  }, []);

  // Sync answers locally (write-to-draft throttling) and queue to Firestore
  const syncAnswers = async (currentAnswers: any[], attemptId: string) => {
    try {
      setIsSynced(false);
      // Ensure we cache immediately in indexedDB/localStorage (Offline resilience)
      localStorage.setItem(`exam_draft_${attemptId}`, JSON.stringify(currentAnswers));
      localStorage.setItem('active_attempt_id_draft', attemptId);
      setPendingDraft(currentAnswers);

      if (!isOnline) {
        // Safe offline caching
        return;
      }

      // Queue the state update for high-throughput batching
      examAnswerQueue.enqueue(attemptId, currentAnswers);
    } catch (e) {
      console.error("Local sync transaction error", e);
      setIsSynced(false);
    }
  };

  // Push queued answers using transaction batch once connection returns
  const forceBackgroundSync = async (attemptId: string) => {
    if (!isOnline) return;

    try {
      const offlineCacheString = localStorage.getItem(`exam_draft_${attemptId}`);
      if (!offlineCacheString) return;

      const cachedAnswers = JSON.parse(offlineCacheString);
      const attemptRef = doc(db, 'attempts', attemptId);
      
      const batch = writeBatch(db);
      batch.update(attemptRef, {
        answers: cachedAnswers,
        updatedAt: new Date().toISOString()
      });
      
      await batch.commit();

      setPendingDraft(null);
      setIsSynced(true);
      // No toast here on purpose — this fires on every answer sync, and a popup per answer
      // is noisy. The header's quiet "Saving.../Auto-save" indicator (driven by isSynced)
      // already communicates save state without interrupting the student.
    } catch (e) {
      console.error("Background replication mismatch:", e);
    }
  };

  return (
    <ExamSyncContext.Provider value={{ isOnline, isSynced, syncAnswers, forceBackgroundSync }}>
      {children}
    </ExamSyncContext.Provider>
  );
};

export const useExamSync = () => {
  const context = useContext(ExamSyncContext);
  if (context === undefined) {
    throw new Error('useExamSync must be used within an ExamSyncProvider context wrapper');
  }
  return context;
};
