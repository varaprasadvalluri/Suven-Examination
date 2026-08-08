import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { 
  Server, 
  Send, 
  RefreshCw, 
  Trash2, 
  Terminal, 
  CheckCircle2, 
  Zap, 
  Database, 
  FileJson, 
  Sparkles, 
  Activity, 
  Clock, 
  Info, 
  ArrowRight,
  Shield,
  Layers,
  Cpu,
  BookOpen
} from 'lucide-react';
import { requestCache, examAnswerQueue, performanceInterceptor } from '../services/api';
import { toast } from 'sonner';

interface EndpointSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  requiresAuth: boolean;
  defaultPayload?: string;
  category: 'System' | 'Auth' | 'Exams' | 'Cloudinary' | 'Database';
}

export const ApiDocs: React.FC = () => {
  const { user, profile } = useAuth();
  
  // State for active category filtering
  const [activeCategory, setActiveCategory] = useState<string>('All');

  // Interactive playground state
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointSpec | null>(null);
  const [requestBody, setRequestBody] = useState<string>('');
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responsePayload, setResponsePayload] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isCachedResult, setIsCachedResult] = useState<boolean>(false);

  // Stats monitoring state
  const [cacheEntries, setCacheEntries] = useState<string[]>([]);
  const [queueStats, setQueueStats] = useState<any>(null);
  const [performanceLogs, setPerformanceLogs] = useState<any[]>([]);

  // List of documented endpoints
  const endpoints: EndpointSpec[] = [
    {
      method: 'GET',
      path: '/api/health',
      description: 'Checks server wellness, project identifiers, and active database connection nodes.',
      requiresAuth: false,
      category: 'System'
    },
    {
      method: 'POST',
      path: '/api/auth/validate',
      description: 'Synchronizes active login state with physical Firestore records, checking system-wide roles and matching custom admin emails.',
      requiresAuth: true,
      category: 'Auth',
      defaultPayload: JSON.stringify({
        uid: user?.uid || 'anonymous_explorer_id',
        email: user?.email || 'admin@suvenedu.demo',
        displayName: profile?.name || 'Awesome Explorer'
      }, null, 2)
    },
    {
      method: 'GET',
      path: '/api/auth/session',
      description: 'Retrieves current validated backend secure session profile parameters.',
      requiresAuth: true,
      category: 'Auth'
    },
    {
      method: 'POST',
      path: '/api/gatekeeper/enroll',
      description: 'Standard security checking node for starting exams. Registers device footprint credentials, checks and resumes previous slots, and locks double check-ins.',
      requiresAuth: false,
      category: 'Exams',
      defaultPayload: JSON.stringify({
        username: profile?.name || 'Awesome Candidate',
        rollNumber: 'ROLL-STARS-001',
        finalSchoolId: profile?.schoolId || 'school-core-node-1',
        finalExamId: 'exam_demo_maths_1',
        examTitle: 'Mathematics Playful Trial',
        clientFootprint: typeof navigator !== 'undefined' ? navigator.userAgent : 'GENERIC_BROWSER_CLIENT'
      }, null, 2)
    },
    {
      method: 'POST',
      path: '/api/cloudinary/sign',
      description: 'Signs client requests cryptographically with SHA-1 signature to upload question images directly to Cloudinary.',
      requiresAuth: true,
      category: 'Cloudinary',
      defaultPayload: JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        folder: 'exams'
      }, null, 2)
    },
    {
      method: 'POST',
      path: '/api/db/query',
      description: 'Cushioned server proxy layer that securely executes query filter reads over protected collections without direct client-side SDK listening.',
      requiresAuth: true,
      category: 'Database',
      defaultPayload: JSON.stringify({
        collectionName: 'exams',
        where: [['schoolId', '==', profile?.schoolId || 'school-core-node-1']]
      }, null, 2)
    },
    {
      method: 'POST',
      path: '/api/auth/create-profile',
      description: 'Creates or overrides standard users with explicit roles, credentials, and parameters.',
      requiresAuth: true,
      category: 'Auth',
      defaultPayload: JSON.stringify({
        uid: 'user_star_999',
        email: 'new_student@suvenedu.demo',
        name: 'New Little Star',
        role: 'student',
        schoolId: 'school-core-node-1'
      }, null, 2)
    }
  ];

  // Refresh dynamic stats
  const refreshStats = () => {
    // Collect active in-memory cache keys
    const keys: string[] = [];
    requestCache.store.forEach((val, key) => {
      if (Date.now() <= val.expiresAt) {
        keys.push(key);
      }
    });
    setCacheEntries(keys);

    // Get current queue parameters
    setQueueStats(examAnswerQueue.getStats());

    // Load recent performance logs from performanceInterceptor
    setPerformanceLogs(performanceInterceptor.history || []);
  };

  useEffect(() => {
    refreshStats();
    const interval = setInterval(refreshStats, 3000);
    return () => clearInterval(interval);
  }, []);

  // Handle endpoint selection
  const handleSelectEndpoint = (ep: EndpointSpec) => {
    setSelectedEndpoint(ep);
    setRequestBody(ep.defaultPayload || '');
    setResponseStatus(null);
    setResponsePayload('');
    setResponseTime(null);
    setIsCachedResult(false);
  };

  // Run selected request
  const handleExecuteRequest = async () => {
    if (!selectedEndpoint) return;

    setIsExecuting(true);
    setResponseStatus(null);
    setResponsePayload('');
    setIsCachedResult(false);

    const startTime = performance.now();
    const url = selectedEndpoint.path;
    const method = selectedEndpoint.method;

    // Check if it is a GET request and served from our local requestCache
    if (method === 'GET') {
      const cached = requestCache.get(url);
      if (cached) {
        try {
          const bodyText = await cached.text();
          const duration = performance.now() - startTime;
          setResponseStatus(200);
          setResponseTime(duration);
          setIsCachedResult(true);
          setResponsePayload(JSON.stringify(JSON.parse(bodyText), null, 2));
          toast.success('Response served instantly from in-memory cache! ⚡');
          setIsExecuting(false);
          refreshStats();
          return;
        } catch (e) {
          console.error("Cache parsing error, falling back to network fetch", e);
        }
      }
    }

    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
        }
      };

      if (method !== 'GET' && requestBody) {
        options.body = requestBody;
      }

      const res = await fetch(url, options);
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      setResponseStatus(res.status);
      setResponseTime(durationMs);

      // Collect headers
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });
      setResponseHeaders(resHeaders);

      // Cache GET responses
      if (method === 'GET' && res.status === 200) {
        requestCache.set(url, res.clone());
      }

      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        setResponsePayload(JSON.stringify(parsed, null, 2));
      } catch {
        setResponsePayload(text || 'Empty Response');
      }

      toast.success(`Request completed in ${durationMs.toFixed(1)}ms!`);
    } catch (err: any) {
      const endTime = performance.now();
      setResponseStatus(0);
      setResponseTime(endTime - startTime);
      setResponsePayload(err?.message || String(err));
      toast.error('Network request failed.');
    } finally {
      setIsExecuting(false);
      refreshStats();
    }
  };

  const handleClearCache = () => {
    requestCache.clear();
    setCacheEntries([]);
    toast.success('In-memory request caching layer purged successfully!');
    refreshStats();
  };

  const handleForceFlushQueue = async () => {
    await examAnswerQueue.flush();
    toast.success('Active answer submission batch queue flushed to Firestore!');
    refreshStats();
  };

  const categories = ['All', 'System', 'Auth', 'Exams', 'Cloudinary', 'Database'];
  const filteredEndpoints = endpoints.filter(ep => activeCategory === 'All' || ep.category === activeCategory);

  return (
    <div className="space-y-8 pb-16 animate-in fade-in duration-500">
      
      {/* Playful Dimensional Hero Header */}
      <div className="bg-white border-2 border-b-[6px] border-slate-200 p-6 md:p-8 rounded-[32px] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/60 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-12 w-24 h-24 bg-yellow-50/60 rounded-full blur-2xl pointer-events-none" />
        
        <div className="space-y-2 relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="text-3xl">📡</span>
            <span className="text-[10px] font-black tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full uppercase">
              Unified Node Gateway
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black font-display text-indigo-950 uppercase tracking-tight">
            Interactive API Playground
          </h1>
          <p className="text-slate-600 max-w-2xl font-semibold text-xs leading-relaxed">
            Test and audit SuvenEdu live endpoints. Inspect server health, validate transaction gates, and monitor the underlying client-side caching and batch queuing systems in real time.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button 
            onClick={refreshStats}
            variant="outline"
            className="border-slate-350 hover:bg-slate-50 font-bold h-12 rounded-xl border-b-[4px]"
          >
            <RefreshCw className="h-4 w-4 mr-2 text-slate-500 animate-spin-slow" />
            Refresh Core Logs
          </Button>
        </div>
      </div>

      {/* Bento Grid: Caching and Queuing Monitoring Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Memory Caching Panel */}
        <div className="bg-white border-2 border-b-[5px] border-slate-200 rounded-[24px] p-5 space-y-4 shadow-sm relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-100 flex items-center justify-center border border-cyan-200">
                <Zap className="h-4 w-4 text-cyan-600" />
              </div>
              <div>
                <h3 className="font-black text-indigo-950 text-sm font-display uppercase tracking-wide">
                  Memory Request Cache
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  Client Interceptor (TTL: 15s)
                </p>
              </div>
            </div>
            
            {cacheEntries.length > 0 && (
              <Button 
                onClick={handleClearCache}
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-rose-500 hover:bg-rose-50 rounded-lg"
                title="Purge Cache"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 font-mono text-[11px] h-32 overflow-y-auto space-y-2">
            <p className="text-slate-400 border-b border-dashed border-slate-200 pb-1.5 font-sans font-bold uppercase text-[9px] tracking-wider">
              Cached GET URLs ({cacheEntries.length})
            </p>
            {cacheEntries.length === 0 ? (
              <p className="text-slate-400 italic text-center py-6">
                No active cache nodes. Execute standard GET requests to populate keys.
              </p>
            ) : (
              cacheEntries.map((url, i) => (
                <div key={i} className="flex items-center justify-between bg-white px-2 py-1 rounded border border-slate-100 text-slate-700">
                  <span className="truncate max-w-[200px]" title={url}>{url}</span>
                  <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1 rounded uppercase font-bold">LIVE</span>
                </div>
              ))
            )}
          </div>
          
          <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
            <Info className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            Keeps system redundant requests strictly at 0 load.
          </div>
        </div>

        {/* Answer Queue Panel */}
        <div className="bg-white border-2 border-b-[5px] border-slate-200 rounded-[24px] p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center border border-purple-200">
                <Layers className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <h3 className="font-black text-indigo-950 text-sm font-display uppercase tracking-wide">
                  Exam Submission Queue
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  Write-Batch Aggregation (Interval: 4s)
                </p>
              </div>
            </div>

            {queueStats && queueStats.pendingCount > 0 && (
              <Button
                onClick={handleForceFlushQueue}
                variant="outline"
                className="h-7 px-2 text-[10px] border-purple-300 text-purple-700 font-bold rounded-lg"
              >
                Flush Now
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3.5 pt-1">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center space-y-0.5">
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Queue Backlog</p>
              <p className="text-xl font-black text-indigo-950 font-mono">
                {queueStats?.pendingCount ?? 0}
              </p>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center space-y-0.5">
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Batches Committed</p>
              <p className="text-xl font-black text-purple-600 font-mono">
                {queueStats?.totalBatchesProcessed ?? 0}
              </p>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-center col-span-2 flex items-center justify-between px-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Saved Requests Weight</span>
              <span className="text-sm font-black text-emerald-600 font-mono">
                -{queueStats?.totalRequestsSaved ?? 0} HTTP calls saved
              </span>
            </div>
          </div>

          <div className="text-[10px] font-mono text-slate-500 bg-slate-50 border border-slate-150 p-2 rounded-lg flex items-center justify-between">
            <span>Status:</span>
            <span className={queueStats?.isTimerActive ? "text-purple-600 font-bold uppercase animate-pulse" : "text-slate-400 font-bold uppercase"}>
              {queueStats?.isTimerActive ? "Active Timer Polling" : "Dormant (Empty)"}
            </span>
          </div>
        </div>

        {/* Live Network Latency Logs */}
        <div className="bg-white border-2 border-b-[5px] border-slate-200 rounded-[24px] p-5 space-y-4 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center border border-amber-200">
              <Terminal className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h3 className="font-black text-indigo-950 text-sm font-display uppercase tracking-wide">
                Network Stream Monitor
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                Performance Latency Console
              </p>
            </div>
          </div>

          <div className="bg-slate-900 text-slate-300 rounded-xl p-3 border border-slate-800 font-mono text-[10px] h-32 overflow-y-auto space-y-2.5">
            {performanceLogs.length === 0 ? (
              <p className="text-slate-500 italic text-center py-8">
                No outbound API requests recorded in current browser session.
              </p>
            ) : (
              performanceLogs.map((log, index) => (
                <div key={index} className="space-y-0.5 border-b border-slate-800 pb-1.5 last:border-b-0">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className={`px-1 rounded font-bold uppercase ${
                      log.method === 'GET' ? 'text-emerald-400 bg-emerald-950/40' : 'text-amber-400 bg-amber-950/40'
                    }`}>
                      {log.method}
                    </span>
                    <span className="text-slate-500 font-bold">{log.durationMs.toFixed(1)}ms</span>
                  </div>
                  <p className="text-[10px] text-white truncate" title={log.url}>
                    {log.url.split('?')[0]}
                  </p>
                  <p className="text-[9px] text-slate-500 text-right">
                    Status: <span className={log.status < 400 ? "text-emerald-500" : "text-rose-500"}>{log.status}</span>
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1 justify-between">
            <span>Core Target Context:</span>
            <span className="text-indigo-600 font-mono font-bold text-[10px]">Cloud Run / Node.js Host</span>
          </div>
        </div>

      </div>

      {/* Main Interactive Workstation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Hand: Endpoint selection list */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border-2 transition-all shrink-0 ${
                  activeCategory === cat
                    ? 'bg-indigo-950 text-white border-indigo-950 border-b-[4px]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-350 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-3.5 max-h-[640px] overflow-y-auto pr-1">
            {filteredEndpoints.map((ep, i) => {
              const isSelected = selectedEndpoint?.path === ep.path && selectedEndpoint?.method === ep.method;
              
              return (
                <div
                  key={i}
                  onClick={() => handleSelectEndpoint(ep)}
                  className={`border-2 p-4 rounded-2xl cursor-pointer transition-all duration-200 group text-left ${
                    isSelected
                      ? 'bg-indigo-50/50 border-indigo-500 border-b-[5px] scale-[1.01]'
                      : 'bg-white border-slate-200 hover:border-slate-350 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black font-mono border ${
                        ep.method === 'GET'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : ep.method === 'POST'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        {ep.method}
                      </span>
                      <span className="font-mono text-xs font-bold text-indigo-950 truncate max-w-[200px] lg:max-w-[150px] xl:max-w-[220px]">
                        {ep.path}
                      </span>
                    </div>

                    <span className="text-[9px] font-black uppercase text-slate-400 shrink-0">
                      {ep.category}
                    </span>
                  </div>

                  <p className="text-slate-500 font-semibold text-[11px] leading-relaxed line-clamp-2">
                    {ep.description}
                  </p>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-[10px] font-bold text-slate-400">
                    <span className="flex items-center gap-1">
                      <Shield className={`h-3 w-3 ${ep.requiresAuth ? 'text-amber-500' : 'text-slate-400'}`} />
                      {ep.requiresAuth ? 'Auth Guarded' : 'Public Access'}
                    </span>
                    <span className="text-indigo-600 font-black group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                      Playground Terminal <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredEndpoints.length === 0 && (
              <div className="bg-white border-2 border-slate-200 p-8 text-center rounded-2xl text-slate-500">
                No endpoints found in category "{activeCategory}".
              </div>
            )}
          </div>
        </div>

        {/* Right Hand: Interactive request playground */}
        <div className="lg:col-span-7">
          {selectedEndpoint ? (
            <div className="bg-white border-2 border-b-[6px] border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
              
              {/* Playground Header */}
              <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b-2 border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono ${
                    selectedEndpoint.method === 'GET'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-amber-500 text-white'
                  }`}>
                    {selectedEndpoint.method}
                  </span>
                  <div>
                    <h3 className="font-mono font-bold text-xs tracking-tight text-slate-200">
                      {selectedEndpoint.path}
                    </h3>
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">
                      Interactive Command Post
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs">⚡</span>
                  <span className="text-[10px] font-mono text-indigo-400 font-black">200_OK READY</span>
                </div>
              </div>

              {/* Playground Area */}
              <div className="p-6 space-y-5">
                
                {/* Method Details */}
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Method Summary</p>
                  <p className="text-slate-600 font-semibold text-xs leading-relaxed">
                    {selectedEndpoint.description}
                  </p>
                </div>

                {/* Request Payload Editor */}
                {selectedEndpoint.method !== 'GET' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        JSON Payload Parameters
                      </p>
                      <button 
                        onClick={() => setRequestBody(selectedEndpoint.defaultPayload || '')}
                        className="text-[10px] font-black text-indigo-600 hover:underline"
                      >
                        Reset Defaults
                      </button>
                    </div>

                    <div className="relative">
                      <textarea
                        value={requestBody}
                        onChange={(e) => setRequestBody(e.target.value)}
                        className="w-full h-40 bg-slate-950 text-indigo-400 font-mono text-[11px] p-4 rounded-2xl border-2 border-slate-800 focus:outline-none focus:border-indigo-500 transition-colors"
                        placeholder="{\n  // Provide request payload\n}"
                      />
                      <div className="absolute bottom-3 right-3 text-[9px] font-mono text-slate-600 font-bold">
                        JSON (application/json)
                      </div>
                    </div>
                  </div>
                )}

                {/* Submit Trigger Actions */}
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleExecuteRequest}
                    disabled={isExecuting}
                    className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl border-b-[5px] border-indigo-850 hover:scale-[1.01] active:scale-[0.99] transition-transform duration-100 flex items-center justify-center gap-2.5"
                  >
                    <Send className={`h-4 w-4 ${isExecuting ? 'animate-pulse' : ''}`} />
                    {isExecuting ? 'Transmitting Over Node...' : 'Execute Live API Request ⚡'}
                  </Button>
                </div>

                {/* Response Log Console */}
                {(responseStatus !== null || responsePayload) && (
                  <div className="space-y-2 pt-2 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        Response Terminal Output
                      </p>
                      
                      <div className="flex items-center gap-3 font-mono text-[11px] font-bold">
                        {isCachedResult && (
                          <span className="text-cyan-600 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded uppercase text-[9px]">
                            Cache Hit
                          </span>
                        )}
                        <span className="text-slate-500">
                          Uptime: {responseTime ? `${responseTime.toFixed(1)}ms` : '0ms'}
                        </span>
                        <span className={responseStatus === 200 ? 'text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded' : 'text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded'}>
                          STATUS: {responseStatus}
                        </span>
                      </div>
                    </div>

                    <pre className="bg-slate-950 text-slate-200 p-4 rounded-2xl font-mono text-[11px] overflow-x-auto max-h-64 border-2 border-slate-800">
                      <code>{responsePayload}</code>
                    </pre>

                    {/* Headers collapsible */}
                    {Object.keys(responseHeaders).length > 0 && (
                      <details className="text-[10px] font-mono text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-150 cursor-pointer">
                        <summary className="font-bold uppercase tracking-wider text-slate-600 select-none">
                          View HTTP Headers ({Object.keys(responseHeaders).length})
                        </summary>
                        <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2 text-[10px]">
                          {Object.entries(responseHeaders).map(([key, val]) => (
                            <div key={key} className="flex justify-between">
                              <span className="font-bold text-slate-600">{key}:</span>
                              <span className="text-slate-500 truncate max-w-xs">{val}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

              </div>

            </div>
          ) : (
            <div className="bg-white border-2 border-dashed border-slate-200 p-12 text-center rounded-[32px] text-slate-500 flex flex-col items-center justify-center space-y-4 min-h-[480px]">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                <Terminal className="h-7 w-7 text-indigo-500 animate-pulse" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h4 className="font-black text-indigo-950 text-sm font-display uppercase">Command Station Standby</h4>
                <p className="text-xs text-slate-600 font-semibold leading-relaxed">
                  Select any backend endpoint from the sidebar catalog to inspect specifications, provide custom parameters, and transmit requests.
                </p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* 🛡️ HIGH-CONCURRENCY SCALING GUIDE: FIRESTORE & GCP FOR 20,000+ CONCURRENT STUDENTS */}
      <div className="bg-white border-2 border-b-[8px] border-slate-200 p-6 md:p-8 rounded-[32px] shadow-sm space-y-8 mt-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50/50 rounded-full blur-3xl pointer-events-none" />
        
        <div className="border-b-2 border-slate-100 pb-5 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center border border-emerald-200">
              <Cpu className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <span className="text-[10px] font-black tracking-widest text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full uppercase">
                Enterprise Scale Architecture
              </span>
              <h2 className="text-xl md:text-2xl font-black font-display text-indigo-950 uppercase tracking-tight mt-1">
                Firestore Sharding & Index Optimization Guide
              </h2>
            </div>
          </div>
          <p className="text-slate-600 font-semibold text-xs leading-relaxed max-w-4xl">
            A battle-tested blueprint detailing Firestore database sharding, index exemptions, compound indexes, client-side write-buffering, and GCP Cloud Run configurations to effortlessly process exam heartbeats and final submissions for 20,000+ concurrent candidates.
          </p>
        </div>

        {/* Core Scaling Calculations Block */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-900 text-white p-5 rounded-2xl border border-slate-800">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Peak Concurrent Load</span>
            <span className="text-2xl font-black font-mono text-emerald-400">20,000+</span>
            <span className="text-[10px] font-semibold text-slate-400 block">Active Student Terminals</span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Est. Write Frequency</span>
            <span className="text-2xl font-black font-mono text-amber-400">Every 4s</span>
            <span className="text-[10px] font-semibold text-slate-400 block">Throttled Heartbeats</span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Raw Ingress Load</span>
            <span className="text-2xl font-black font-mono text-indigo-400">5,000 / sec</span>
            <span className="text-[10px] font-semibold text-slate-400 block">Peak DB Write Mutations</span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Optimized Ingress</span>
            <span className="text-2xl font-black font-mono text-emerald-400">&lt; 150 / sec</span>
            <span className="text-[10px] font-semibold text-slate-400 block">Using Batch Aggregation</span>
          </div>
        </div>

        {/* Structured Architectural Modules */}
        <div className="space-y-8">
          
          {/* Module 1: Firestore Database Sharding */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center font-bold text-xs">1</span>
              <h3 className="font-bold text-indigo-950 text-sm uppercase tracking-wide">
                Firestore Database Sharding Strategy
              </h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pl-8">
              <div className="space-y-3.5 text-slate-600 font-semibold text-xs leading-relaxed">
                <p>
                  Firestore has a soft physical limit of <strong className="text-indigo-950 font-bold">10,000 write operations per second</strong> per database and <strong className="text-indigo-950 font-bold">1 write per second</strong> on any single document. To prevent write hotspots and limit bottlenecking, we implement key sharding guidelines:
                </p>
                <ul className="list-disc list-inside space-y-2 text-slate-500">
                  <li>
                    <strong className="text-slate-700">Randomized Document IDs (Avoid Sequential Key Hotspots):</strong> Firestore ranges documents lexicographically. When creating documents with sequential or timestamp-based keys (e.g., <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">std_20260719_0001</code>), Firestore routes them to the same tablet partition, causing latency spikes. We enforce random UUID-v4 keys (<code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">std_school1_f839-4ab2-bc91</code>) to distribute updates across independent storage ranges.
                  </li>
                  <li>
                    <strong className="text-slate-700">Distributed Sharded Counters:</strong> For aggregate values that update frequently (such as the total submission tally), a single document becomes an instant bottle-neck. We partition the counter across <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">N</code> separate document shards (e.g., 20 shards) and select a shard randomly during increments, summing them up on demand.
                  </li>
                </ul>
              </div>

              {/* Sharded Counter Sample */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Distributed Sharded Counter Pattern</span>
                <pre className="bg-slate-950 text-emerald-400 p-4 rounded-xl font-mono text-[11px] overflow-x-auto border-2 border-slate-800">
<code>{`// Incrementing a sharded counter distributed across 20 shards
const SHARD_COUNT = 20;
const shardId = Math.floor(Math.random() * SHARD_COUNT).toString();
const shardRef = doc(db, 'exams', examId, 'counters', shardId);

// Write mutation distributes to an independent document
await setDoc(shardRef, { 
  count: increment(1) 
}, { merge: true });`}</code>
                </pre>
              </div>
            </div>
          </div>

          {/* Module 2: Index Optimization & Exemptions */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center font-bold text-xs">2</span>
              <h3 className="font-bold text-indigo-950 text-sm uppercase tracking-wide">
                Index Optimization & Single-Field Exemptions
              </h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pl-8">
              <div className="space-y-3.5 text-slate-600 font-semibold text-xs leading-relaxed">
                <p>
                  By default, Firestore creates single-field indexes for every field in every document. While convenient, this dramatically degrades write throughput on high-concurrency exams because every write mutation must update multiple single-field index trees.
                </p>
                <ul className="list-disc list-inside space-y-2 text-slate-500">
                  <li>
                    <strong className="text-slate-700">Single-Field Index Exemptions:</strong> For high-volumetric fields that are updated during proctoring heartbeats but are never queried directly (e.g., <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">answers</code> array, <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">timePerQuestion</code> map, or large payload metadata structures), we must explicitly configure index exemptions to completely bypass index-write charges.
                  </li>
                  <li>
                    <strong className="text-slate-700">Strict Composite Indexes:</strong> For admin boards or school dashboards where we filter by <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">schoolId</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">examId</code>, and sort by <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">updatedAt</code>, we pre-compile a Composite Index to ensure queries execute in <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">O(1)</code> time, completely avoiding index-generation lookup bottlenecks at runtime.
                  </li>
                </ul>
              </div>

              {/* firestore.indexes.json Setup */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">firestore.indexes.json Config Spec</span>
                <pre className="bg-slate-950 text-cyan-400 p-4 rounded-xl font-mono text-[11px] overflow-x-auto border-2 border-slate-800">
<code>{`{
  "indexes": [
    {
      "collectionGroup": "attempts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "examId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "attempts",
      "fieldPath": "answers",
      "indexes": [] // 👈 Complete exemption saves 20,000+ writes!
    }
  ]
}`}</code>
                </pre>
              </div>
            </div>
          </div>

          {/* Module 3: Write-Batching & Client Buffering */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center font-bold text-xs">3</span>
              <h3 className="font-bold text-indigo-950 text-sm uppercase tracking-wide">
                Client-Side Batch Aggregation & Resiliency
              </h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pl-8">
              <div className="space-y-3.5 text-slate-600 font-semibold text-xs leading-relaxed">
                <p>
                  Directly transmitting every single keystroke or answer select to Firestore from 20,000 active browser tabs leads to instant server-side saturation and high database operations costs. 
                </p>
                <p>
                  SuvenEdu integrates an in-memory client-side <strong className="text-indigo-950 font-bold">Write-Batch Aggregator</strong> (<code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">examAnswerQueue</code>) that intercepts, debounces, and compresses update actions:
                </p>
                <ul className="list-disc list-inside space-y-2 text-slate-500">
                  <li>
                    <strong className="text-slate-700">Time-Based Debounce:</strong> Student answers are cached in local memory, merging multiple rapid key inputs and periodically committing them once every 4 seconds in structured, compressed batches.
                  </li>
                  <li>
                    <strong className="text-slate-700">Offline-First Fail-safe:</strong> If network latency spikes during the high-concurrency exam, the local queue automatically falls back to local storage and retries with an exponential backoff strategy, guaranteeing no student answers are lost.
                  </li>
                </ul>
              </div>

              {/* Client Queue Monitor State */}
              <div className="bg-indigo-50/50 border border-indigo-150 rounded-2xl p-4 flex flex-col justify-between">
                <div className="space-y-2">
                  <span className="text-[10px] font-black tracking-widest text-indigo-600 bg-white border border-indigo-200 px-2.5 py-0.5 rounded uppercase">
                    Aggregator Metrics Tally
                  </span>
                  <p className="text-slate-600 font-semibold text-xs leading-relaxed">
                    By bundling individual student heartbeat updates into consolidated write-batches, the total database operation costs are reduced by over <strong className="text-indigo-950 font-black">95%</strong>, keeping average latency below <strong className="text-emerald-600 font-bold">50ms</strong>.
                  </p>
                </div>
                <div className="border-t border-slate-200 pt-3 mt-4 flex items-center justify-between text-[11px] font-bold text-slate-500">
                  <span>Current Saved Writes Counter:</span>
                  <span className="text-indigo-700 font-mono font-black">-{queueStats?.totalRequestsSaved ?? 0} Requests</span>
                </div>
              </div>
            </div>
          </div>

          {/* Module 4: GCP Cloud Run Container Autoscale Specs */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center font-bold text-xs">4</span>
              <h3 className="font-bold text-indigo-950 text-sm uppercase tracking-wide">
                GCP Cloud Run Container Scaling Specifications
              </h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pl-8">
              <div className="space-y-3.5 text-slate-600 font-semibold text-xs leading-relaxed">
                <p>
                  To handle the sudden spikes of 20,000 students starting and submitting their exams simultaneously, the custom Express + Node.js backend must be provisioned on Google Cloud Run with explicit scaling parameters:
                </p>
                <ul className="list-disc list-inside space-y-2 text-slate-500">
                  <li>
                    <strong className="text-slate-700">Instance Warm-up (--min-instances):</strong> Configure at least <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">--min-instances=10</code> thirty minutes before the exam begins to prevent cold-starts.
                  </li>
                  <li>
                    <strong className="text-slate-700">CPU Allocation & Concurrency:</strong> Set <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">--cpu-throttling=false</code> to keep CPUs allocated constantly, and set concurrency to <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">--concurrency=80</code> to allow each container instance to process multiple student channels simultaneously.
                  </li>
                </ul>
              </div>

              {/* gcloud Deploy Command Spec */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">GCP Production CLI Deployment Command</span>
                <pre className="bg-slate-950 text-amber-400 p-4 rounded-xl font-mono text-[11px] overflow-x-auto border-2 border-slate-800">
<code>{`gcloud run deploy suven-edu-exam-portal \\
  --image gcr.io/suven-edu/exam-portal:latest \\
  --platform managed \\
  --region us-central1 \\
  --min-instances 10 \\
  --max-instances 100 \\
  --concurrency 80 \\
  --cpu 2 \\
  --memory 4Gi \\
  --set-env-vars="NODE_ENV=production" \\
  --no-cpu-throttling`}</code>
                </pre>
              </div>
            </div>
          </div>

        </div>

        {/* Closing Notice Footer */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[11px] font-semibold text-slate-500 flex items-center gap-2.5">
          <BookOpen className="h-4.5 w-4.5 text-indigo-500 shrink-0" />
          <span>
            These sharding and index optimization specifications comply with Google Cloud Architecture Framework guidelines. Implement these configurations directly in your GCP Firebase/Firestore console for maximum resilience under pressure.
          </span>
        </div>

      </div>

    </div>
  );
};
