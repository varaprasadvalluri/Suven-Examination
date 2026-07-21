const fs = require('fs');
let content = fs.readFileSync('src/components/LiveProctoringWall.tsx', 'utf8');

// We need to fetch and listen to proctoring_logs
const importInjection = `import { query, where, limit, onSnapshot, collection, orderBy } from 'firebase/firestore';`;
content = content.replace(/import { query, where, limit, onSnapshot, collection } from 'firebase\/firestore';/, importInjection);


const stateInjection = `  const [activeAttempts, setActiveAttempts] = useState<Attempt[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    const logsQuery = query(collection(db, 'proctoring_logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubLogs();
  }, [profile]);
`;
content = content.replace(/const \[activeAttempts, setActiveAttempts\] = useState<Attempt\[\]>\(\[\]\);\s*const \[loading, setLoading\] = useState\(true\);/, stateInjection);


const renderReplacement = `            <div className="divide-y divide-white/5">
                {logs.length === 0 ? (
                  <div className="p-10 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">No anomalies detected yet.</div>
                ) : logs.map((log, i) => {
                  const isCritical = log.type === 'copy_paste' || log.type === 'tab_switch';
                  const isWarning = log.type === 'blur' || log.type === 'fullscreen_exit';
                  return (
                  <div key={log.id || i} className="px-10 py-6 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-default">
                     <div className="flex items-center gap-6">
                        <span className="font-mono text-xs text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <div className={\`h-2 w-2 rounded-full \${isCritical ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' : isWarning ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]' : 'bg-indigo-400'}\`} />
                        <div>
                           <p className="text-sm font-bold tracking-tight">{log.description || log.type}</p>
                           <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">Student: {log.studentId} • Attempt: {log.attemptId}</p>
                        </div>
                     </div>
                  </div>
                )})}
            </div>`;

content = content.replace(/<div className="divide-y divide-white\/5">.*?<\/div>\s*<\/CardContent>/s, renderReplacement + '\n         </CardContent>');

fs.writeFileSync('src/components/LiveProctoringWall.tsx', content);
console.log("Patched LiveProctoringWall");
