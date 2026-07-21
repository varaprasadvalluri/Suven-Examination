import React, { createContext, useContext, useState, useEffect } from 'react';
import { db, doc, updateDoc, writeBatch } from '../lib/firebase';
import { Wifi, WifiOff, CloudLightning, ShieldAlert, Loader2 } from 'lucide-react';
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
      toast.success("Connection re-established. Syncing active response drafts with cloud database...", {
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
      toast.success("Relational cache consolidated successfully with national database.");
    } catch (e) {
      console.error("Background replication mismatch:", e);
    }
  };

  return (
    <ExamSyncContext.Provider value={{ isOnline, isSynced, syncAnswers, forceBackgroundSync }}>
      {children}
      {/* Visual Network Status Bar */}
      <NetworkStatusBar isOnline={isOnline} isSynced={isSynced} />
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

// Component for the Visual Connection Status Banner
const NetworkStatusBar: React.FC<{ isOnline: boolean; isSynced: boolean }> = ({ isOnline, isSynced }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none select-none">
      <div className="max-w-md mx-auto p-3 bg-transparent flex justify-center">
        <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-xl backdrop-blur-md transition-all pointer-events-auto ${isOnline ? (isSynced ? 'bg-[#f0fdf4]/95 border-emerald-250 text-emerald-800' : 'bg-amber-50/95 border-amber-250 text-amber-800') : 'bg-rose-50/95 border-rose-250 text-rose-800 animate-pulse'}`}>
          {isOnline ? (
            isSynced ? (
              <>
                <Wifi className="h-4 w-4 text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-wider">Protected Online Core &bull; Synced</span>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-wider">Synchronizing Offline Queue...</span>
              </>
            )
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-rose-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-wider">Local Cached Offline Mode &bull; Safe Save Active</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
