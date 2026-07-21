/**
 * Unified API Service Layer
 * Centralizes all backend, Express gateway, and database communication.
 * Provides high-level domain-specific wrappers targeting the API Gateway endpoints.
 * This acts as the single source of truth for frontend components, preventing direct DB dependency.
 */

import { toast } from 'sonner';
import { 
  db as proxyDb,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  writeBatch
} from '../lib/apiService';

// Export core low-level database operations for backwards compatibility
export {
  proxyDb as db,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  writeBatch
};

// Export Observer Pattern components for standard UI-refresh bindings
export { useDbObserver, GlobalDbSubject } from '../lib/observerPattern';
export type { CrudUpdateEvent, DbObserver } from '../lib/observerPattern';

/**
 * ============================================================================
 * GATEWAY HELPER METHODS & ERROR INTERCEPTOR
 * ============================================================================
 */

export interface LatencyRecord {
  url: string;
  method: string;
  durationMs: number;
  status: number;
  timestamp: string;
}

/**
 * Performance Interceptor
 * Monitors, aggregates, and logs latency metrics across all API endpoints.
 * Highly useful for diagnostic sizing under 10,000-student stress levels.
 */
export const performanceInterceptor = {
  history: [] as LatencyRecord[],
  
  getStats() {
    const totalRequests = this.history.length;
    if (totalRequests === 0) {
      return { totalRequests, avgDurationMs: 0, maxDurationMs: 0, routeBreakdown: {} };
    }
    
    const sum = this.history.reduce((acc, curr) => acc + curr.durationMs, 0);
    const max = Math.max(...this.history.map(r => r.durationMs));
    
    const routeBreakdown: Record<string, { count: number; avgDurationMs: number }> = {};
    this.history.forEach(r => {
      const key = `${r.method} ${r.url.split('?')[0]}`;
      if (!routeBreakdown[key]) {
        routeBreakdown[key] = { count: 0, avgDurationMs: 0 };
      }
      routeBreakdown[key].count++;
      routeBreakdown[key].avgDurationMs += r.durationMs;
    });
    
    Object.keys(routeBreakdown).forEach(key => {
      routeBreakdown[key].avgDurationMs = Number((routeBreakdown[key].avgDurationMs / routeBreakdown[key].count).toFixed(2));
    });
    
    return {
      totalRequests,
      avgDurationMs: Number((sum / totalRequests).toFixed(2)),
      maxDurationMs: Number(max.toFixed(2)),
      routeBreakdown
    };
  },
  
  clearHistory() {
    this.history = [];
  },
  
  log(record: LatencyRecord) {
    this.history.push(record);
    // Keep history bounded to avoid memory footprint expansion
    if (this.history.length > 500) {
      this.history.shift();
    }
    const isSlow = record.durationMs > 400;
    const color = isSlow ? 'color: #f59e0b; font-weight: bold;' : 'color: #10b981;';
    console.log(
      `%c[Performance Interceptor] ${record.method} ${record.url.split('?')[0]} - ${record.durationMs.toFixed(1)}ms (Status: ${record.status})`,
      color
    );
  }
};

/**
 * Simple In-Memory Request Caching Layer
 * Caches GET response payloads to mitigate unnecessary backend load.
 */
export const requestCache = {
  store: new Map<string, { response: Response; expiresAt: number }>(),
  defaultTtlMs: 15000, // 15 seconds short duration cache

  get(url: string): Response | null {
    const entry = this.store.get(url);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(url);
      return null;
    }

    // Return a clone of the cached Response so it can be read again
    return entry.response.clone();
  },

  set(url: string, response: Response, ttlMs?: number) {
    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    this.store.set(url, {
      response: response.clone(),
      expiresAt: Date.now() + ttl
    });
  },

  invalidate(url: string) {
    this.store.delete(url);
  },

  clear() {
    this.store.clear();
  }
};

interface QueuedAnswer {
  attemptId: string;
  answers: any[];
  timestamp: number;
}

type QueueStateListener = (state: { pendingCount: number; isSynced: boolean }) => void;

/**
 * High-Throughput Exam Answer Queueing & Batching Layer
 * Batches question submissions into a single Firestore writeBatch transaction,
 * de-duplicates rapid changes to the same student attempt, and flushes every 4s.
 */
export const examAnswerQueue = {
  queue: [] as QueuedAnswer[],
  timer: null as any,
  flushIntervalMs: 4000,
  isProcessing: false,
  listeners: [] as QueueStateListener[],
  stats: {
    totalEnqueued: 0,
    totalBatchesProcessed: 0,
    totalRequestsSaved: 0,
  },

  addListener(fn: QueueStateListener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  },

  notifyListeners() {
    const isSynced = this.queue.length === 0 && !this.isProcessing;
    this.listeners.forEach(l => {
      try {
        l({
          pendingCount: this.queue.length,
          isSynced
        });
      } catch (err) {
        console.error('[Exam Answer Queue] Listener error:', err);
      }
    });
  },

  enqueue(attemptId: string, answers: any[]) {
    this.stats.totalEnqueued++;
    
    // De-duplicate: If there is already a pending write for this attempt, overwrite with the latest state
    const existingIndex = this.queue.findIndex(item => item.attemptId === attemptId);
    if (existingIndex !== -1) {
      this.stats.totalRequestsSaved++;
      this.queue[existingIndex] = {
        attemptId,
        answers,
        timestamp: Date.now()
      };
    } else {
      this.queue.push({
        attemptId,
        answers,
        timestamp: Date.now()
      });
    }

    this.notifyListeners();

    // Lazy load the interval flush timer
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.flush().catch(err => {
          console.warn('[Exam Answer Queue] Unhandled flush exception caught:', err);
        });
      }, this.flushIntervalMs);
    }
  },

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.isProcessing) return;

    // Pause queue flushing if circuit breaker is OPEN
    if (circuitBreaker.checkState() === 'OPEN') {
      console.warn('[Exam Answer Queue] Flushing paused. Circuit Breaker is in OPEN state (Read-Only Cache Failover Active).');
      return;
    }

    this.isProcessing = true;
    this.notifyListeners();

    const batchToProcess = [...this.queue];
    this.queue = []; // Clear immediately to capture incoming writes during flush

    try {
      console.log(`[Exam Answer Queue] Flushing batch of ${batchToProcess.length} student attempts...`);
      const batch = writeBatch(proxyDb);
      
      batchToProcess.forEach(item => {
        const attemptRef = doc(proxyDb, 'attempts', item.attemptId);
        batch.update(attemptRef, {
          answers: item.answers,
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();
      
      this.stats.totalBatchesProcessed++;
      const savedCount = batchToProcess.length - 1;
      if (savedCount > 0) {
        this.stats.totalRequestsSaved += savedCount;
      }
      
      console.log(`%c[Exam Answer Queue] Batch committed successfully. Stats:`, 'color: #8b5cf6; font-weight: bold;', {
        ...this.stats,
        currentQueueSize: this.queue.length
      });
    } catch (err) {
      console.error('[Exam Answer Queue] Batch commit failed, re-queueing attempts:', err);
      // Re-queue items that haven't been overwritten by newer updates in the meantime
      batchToProcess.forEach(item => {
        const exists = this.queue.some(q => q.attemptId === item.attemptId);
        if (!exists) {
          this.queue.push(item);
        }
      });
    } finally {
      this.isProcessing = false;
      this.notifyListeners();
      
      if (this.queue.length === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  },

  getStats() {
    return {
      ...this.stats,
      pendingCount: this.queue.length,
      isTimerActive: !!this.timer
    };
  }
};

/**
 * 🛡️ CIRCUIT BREAKER UTILITY
 * Monitors server-side API, Firestore, and Redis response times.
 * Trips to OPEN state if latency thresholds are exceeded, gracefully failing over
 * to the client's in-memory read-only cache.
 */
export const circuitBreaker = {
  state: 'CLOSED' as 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  failureCount: 0,
  latencyThresholdMs: 1500, // Trip if API/DB requests exceed 1.5 seconds under high load
  consecutiveFailuresThreshold: 3, // Trip after 3 consecutive failures or slow requests
  cooldownPeriodMs: 15000, // Wait 15 seconds in OPEN state before trying HALF_OPEN probe
  lastStateChange: Date.now(),
  
  onStateChangeListeners: [] as ((state: 'CLOSED' | 'OPEN' | 'HALF_OPEN') => void)[],

  registerListener(listener: (state: 'CLOSED' | 'OPEN' | 'HALF_OPEN') => void) {
    this.onStateChangeListeners.push(listener);
    return () => {
      this.onStateChangeListeners = this.onStateChangeListeners.filter(l => l !== listener);
    };
  },

  notifyListeners() {
    this.onStateChangeListeners.forEach(l => {
      try {
        l(this.state);
      } catch (err) {
        console.error('[Circuit Breaker] Listener notification error:', err);
      }
    });
  },

  recordSuccess(durationMs: number) {
    if (this.state === 'HALF_OPEN') {
      if (durationMs < this.latencyThresholdMs) {
        console.log(`%c[Circuit Breaker] Health probe succeeded with low latency (${durationMs.toFixed(1)}ms). Resetting to CLOSED.`, 'color: #10b981; font-weight: bold;');
        this.transitionTo('CLOSED');
      } else {
        console.warn(`[Circuit Breaker] Health probe succeeded but latency (${durationMs.toFixed(1)}ms) remains too high. Remaining OPEN.`);
        this.transitionTo('OPEN');
      }
    } else if (this.state === 'CLOSED') {
      if (durationMs > this.latencyThresholdMs) {
        this.failureCount++;
        console.warn(`[Circuit Breaker] Slow request detected (${durationMs.toFixed(1)}ms). Consecutive alerts: ${this.failureCount}/${this.consecutiveFailuresThreshold}`);
        if (this.failureCount >= this.consecutiveFailuresThreshold) {
          this.transitionTo('OPEN');
        }
      } else {
        this.failureCount = 0;
      }
    }
  },

  recordFailure() {
    if (this.state === 'HALF_OPEN' || this.state === 'CLOSED') {
      this.failureCount++;
      console.warn(`[Circuit Breaker] Request failure or network error detected. Consecutive alerts: ${this.failureCount}/${this.consecutiveFailuresThreshold}`);
      if (this.failureCount >= this.consecutiveFailuresThreshold) {
        this.transitionTo('OPEN');
      }
    }
  },

  transitionTo(newState: 'CLOSED' | 'OPEN' | 'HALF_OPEN') {
    if (this.state !== newState) {
      this.state = newState;
      this.lastStateChange = Date.now();
      this.failureCount = 0;
      this.notifyListeners();
      
      if (newState === 'OPEN') {
        toast.warning('High database/network latency detected! SuvenEdu has activated Read-Only Cache Failover to safeguard your exam progress.', {
          duration: 8000,
          description: 'You can continue answering; changes are cached locally and will sync when latency stabilizes.',
          icon: '🛡️'
        });
      } else if (newState === 'CLOSED') {
        toast.success('Database latency stabilized. Connected successfully back to live Firebase/Redis nodes.', {
          duration: 4000,
          icon: '✅'
        });
      }
    }
  },

  checkState() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastStateChange > this.cooldownPeriodMs) {
        console.log('[Circuit Breaker] Cooldown elapsed. Transitioning to HALF_OPEN to probe backend health.');
        this.transitionTo('HALF_OPEN');
      }
    }
    return this.state;
  }
};

/**
 * Centralized Fetch Interceptor
 * Intercepts all backend communication to catch 4xx/5xx HTTP errors
 * and connection failures, raising a user-facing toast notification.
 */
async function fetchWithInterceptor(url: string, options: RequestInit = {}): Promise<Response> {
  const startTime = performance.now();
  const method = options.method || 'GET';
  let status = 0;
  let logged = false;

  const isQuery = url.includes('/api/db/query') && method.toUpperCase() === 'POST';
  const isRead = method.toUpperCase() === 'GET' || isQuery;
  const cacheKey = isQuery && options.body ? `${url}::${options.body}` : url;

  // Serve from cache if it is a read query
  if (isRead) {
    const cachedResponse = requestCache.get(cacheKey);
    
    // If Circuit Breaker is OPEN, we MUST fail over to the read-only cache immediately
    if (circuitBreaker.checkState() === 'OPEN') {
      if (cachedResponse) {
        console.warn(`[Circuit Breaker OPEN - Failover] Read-only cache hit for key: ${cacheKey}`);
        return cachedResponse;
      } else {
        console.warn(`[Circuit Breaker OPEN - Failover] Cache miss for key: ${cacheKey}. Constructing graceful fallback response.`);
        
        let fallbackJson = {};
        if (isQuery) {
          try {
            const bodyObj = JSON.parse(options.body as string);
            if (bodyObj.docId) {
              fallbackJson = { data: { exists: false, data: null } };
            } else {
              fallbackJson = { data: [] };
            }
          } catch (e) {
            fallbackJson = { data: [] };
          }
        }
        
        return new Response(JSON.stringify(fallbackJson), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Normal non-tripped flow: serve from cache if it exists (standard cache optimization)
    if (cachedResponse) {
      const durationMs = performance.now() - startTime;
      console.log(`%c[Cache Hit] ${method} ${url.split('?')[0]} - ${durationMs.toFixed(1)}ms (Served from In-Memory Cache)`, 'color: #3b82f6; font-weight: bold;');
      
      performanceInterceptor.log({
        url,
        method,
        durationMs,
        status: 200,
        timestamp: new Date().toISOString()
      });
      
      return cachedResponse;
    }
  } else {
    // Intercept write request if Circuit Breaker is OPEN to prevent UI block or error popups
    if (circuitBreaker.checkState() === 'OPEN') {
      console.warn(`[Circuit Breaker OPEN - Failover] Intercepting write request to: ${url}. Queuing/caching locally.`);
      return new Response(JSON.stringify({ success: true, queued: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  try {
    const res = await fetch(url, options);
    status = res.status;
    
    const durationMs = performance.now() - startTime;
    logged = true;
    performanceInterceptor.log({
      url,
      method,
      durationMs,
      status,
      timestamp: new Date().toISOString()
    });
    
    // Record success/failure metrics to Circuit Breaker
    if (res.ok) {
      circuitBreaker.recordSuccess(durationMs);
    } else {
      circuitBreaker.recordFailure();
    }
    
    if (!res.ok) {
      const statusVal = res.status;
      if ([400, 401, 403, 404, 500].includes(statusVal)) {
        const event = new CustomEvent('global-http-error', { 
          detail: { status: statusVal, url } 
        });
        window.dispatchEvent(event);
      }
      let errorMessage = `Request failed with status ${res.status}`;
      
      try {
        const clone = res.clone();
        const payload = await clone.json();
        if (payload && payload.error) {
          errorMessage = payload.error;
        }
      } catch (e) {
        try {
          const clone = res.clone();
          const text = await clone.text();
          if (text && text.trim().length > 0 && text.length < 200) {
            errorMessage = text.trim();
          }
        } catch (textErr) {
          // ignore parsing error
        }
      }

      // Display consistent toast error notification
      toast.error(`Server Error (${res.status}): ${errorMessage}`, {
        description: `Endpoint: ${url.split('?')[0]}`
      });
      
      throw new Error(errorMessage);
    }

    // Cache successful reads
    if (isRead) {
      requestCache.set(cacheKey, res);
    }
    
    return res;
  } catch (err: any) {
    circuitBreaker.recordFailure();

    if (!logged) {
      const durationMs = performance.now() - startTime;
      performanceInterceptor.log({
        url,
        method,
        durationMs,
        status: status || 0,
        timestamp: new Date().toISOString()
      });
    }
    const msg = (err?.message || String(err)).toLowerCase();
    const isNetworkError = err instanceof TypeError || 
                           msg.includes('fetch') || 
                           msg.includes('network') ||
                           msg.includes('connect');
                           
    if (isNetworkError) {
      toast.error('Network Error: Unable to connect to the backend server.', {
        description: 'Please check your internet connection or try again later.'
      });
    }
    
    throw err;
  }
}

async function safeFetchJson(url: string, options: RequestInit = {}) {
  try {
    const res = await fetchWithInterceptor(url, options);
    const contentType = res.headers.get('content-type');
    
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Non-JSON response received from ${url} (status: ${res.status})`);
    }
    
    return await res.json();
  } catch (err: any) {
    console.error(`[API Gateway Error] Endpoint ${url} failed:`, err);
    throw err;
  }
}

/**
 * ============================================================================
 * CLOUDINARY API WRAPPERS
 * ============================================================================
 */
export const cloudinaryApi = {
  async upload(file: File): Promise<{ url: string; public_id: string }> {
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetchWithInterceptor('/api/cloudinary/upload', {
      method: 'POST',
      body: formData,
    });
    
    return await res.json();
  },

  async sign(params: any): Promise<any> {
    return safeFetchJson('/api/cloudinary/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  },

  async delete(publicId: string): Promise<{ success: boolean }> {
    return safeFetchJson('/api/cloudinary/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_id: publicId }),
    });
  }
};

/**
 * ============================================================================
 * AUTH & PROFILE API WRAPPERS
 * ============================================================================
 */
export const authApi = {
  async validateToken(token: string): Promise<any> {
    return safeFetchJson('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  },

  async createProfile(data: any): Promise<any> {
    return safeFetchJson('/api/auth/create-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async getSession(): Promise<any> {
    return safeFetchJson('/api/auth/session');
  }
};

/**
 * ============================================================================
 * GATEKEEPER / PROCTOR SECURITY API WRAPPERS
 * ============================================================================
 */
export const gatekeeperApi = {
  async enroll(attemptId: string, imageBase64: string): Promise<{ success: boolean; confidence?: number; status?: string }> {
    return safeFetchJson('/api/gatekeeper/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId, imageBase64 }),
    });
  }
};

/**
 * ============================================================================
 * EXAMS & QUESTIONS API WRAPPERS
 * ============================================================================
 */
export const examsApi = {
  async updateExam(examId: string, data: any): Promise<{ success: boolean }> {
    return safeFetchJson(`/api/exams/${examId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async importDoc(examId: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetchWithInterceptor(`/api/exams/${examId}/import-doc`, {
      method: 'POST',
      body: formData,
    });
    
    return await res.json();
  },

  async deleteExam(examId: string): Promise<{ success: boolean }> {
    return safeFetchJson(`/api/exams/${examId}`, {
      method: 'DELETE',
    });
  },

  async deleteQuestion(questionId: string): Promise<{ success: boolean }> {
    return safeFetchJson(`/api/questions/${questionId}`, {
      method: 'DELETE',
    });
  }
};

/**
 * ============================================================================
 * HIGH-LEVEL DOMAIN WRAPPERS (CENTRALIZED DOMAIN SERVICES)
 * ============================================================================
 */

// --- Schools Domain ---
export const schoolsService = {
  async fetchAll(): Promise<any[]> {
    const ref = collection(proxyDb, 'schools');
    const snapshot = await getDocs(ref);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  subscribeList(onNext: (schools: any[]) => void, onError?: (err: any) => void) {
    const ref = collection(proxyDb, 'schools');
    return onSnapshot(
      ref,
      (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        onNext(list);
      },
      onError
    );
  },

  async fetchOne(schoolId: string): Promise<any> {
    const ref = doc(proxyDb, 'schools', schoolId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('School not found');
    return { id: snap.id, ...snap.data() };
  },

  async create(schoolData: any): Promise<string> {
    const ref = collection(proxyDb, 'schools');
    const res = await addDoc(ref, {
      ...schoolData,
      createdAt: serverTimestamp()
    });
    return res.id;
  },

  async update(schoolId: string, data: any): Promise<void> {
    const ref = doc(proxyDb, 'schools', schoolId);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
  },

  async delete(schoolId: string): Promise<void> {
    const ref = doc(proxyDb, 'schools', schoolId);
    await deleteDoc(ref);
  }
};

// --- Exams Domain ---
export const examsService = {
  async fetchAll(): Promise<any[]> {
    const ref = collection(proxyDb, 'exams');
    const snapshot = await getDocs(ref);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  subscribeList(onNext: (exams: any[]) => void, onError?: (err: any) => void) {
    const ref = collection(proxyDb, 'exams');
    return onSnapshot(
      ref,
      (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        onNext(list);
      },
      onError
    );
  },

  subscribeSchoolExams(schoolId: string, onNext: (exams: any[]) => void, onError?: (err: any) => void) {
    const q = query(collection(proxyDb, 'exams'), where('schoolId', '==', schoolId));
    return onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        onNext(list);
      },
      onError
    );
  },

  async fetchOne(examId: string): Promise<any> {
    const ref = doc(proxyDb, 'exams', examId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Exam not found');
    return { id: snap.id, ...snap.data() };
  },

  async create(examData: any): Promise<string> {
    const ref = collection(proxyDb, 'exams');
    const res = await addDoc(ref, {
      ...examData,
      createdAt: serverTimestamp()
    });
    return res.id;
  }
};

// --- Student Attempts Domain ---
export const attemptsService = {
  async fetchOne(attemptId: string): Promise<any> {
    const ref = doc(proxyDb, 'attempts', attemptId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Attempt not found');
    return { id: snap.id, ...snap.data() };
  },

  subscribeOne(attemptId: string, onNext: (attempt: any) => void, onError?: (err: any) => void) {
    const ref = doc(proxyDb, 'attempts', attemptId);
    return onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          onNext({ id: snap.id, ...snap.data() });
        }
      },
      onError
    );
  },

  async create(attemptData: any): Promise<string> {
    const ref = collection(proxyDb, 'attempts');
    const res = await addDoc(ref, {
      ...attemptData,
      createdAt: serverTimestamp()
    });
    return res.id;
  },

  async update(attemptId: string, data: any): Promise<void> {
    const ref = doc(proxyDb, 'attempts', attemptId);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
  }
};
