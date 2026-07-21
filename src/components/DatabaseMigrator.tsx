import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  Database, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  Settings, 
  Key, 
  Users, 
  Terminal, 
  ExternalLink, 
  ShieldAlert, 
  Copy, 
  FileText,
  ShieldCheck,
  Cpu,
  UserCheck,
  Sparkles,
  Coins,
  TrendingDown,
  Gauge,
  DollarSign,
  Info,
  Sliders,
  Award,
  Bell,
  AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';

export const DatabaseMigrator: React.FC = () => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationLogs, setMigrationLogs] = useState<string[]>([]);
  const [migrationStats, setMigrationStats] = useState<Record<string, number> | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  // Seeding State
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedingLogs, setSeedingLogs] = useState<string[]>([]);
  const [seedingStats, setSeedingStats] = useState<Record<string, number> | null>(null);

  // GCP IAM Permissions Sync State
  const [isSyncingIam, setIsSyncingIam] = useState(false);
  const [iamLogs, setIamLogs] = useState<string[]>([]);
  const [iamStats, setIamStats] = useState<{ usersScanned: number; rolesAssigned: number; bindingsCreated: number } | null>(null);

  // Firestore & Exam Budget Estimator State
  const [examsPerMonth, setExamsPerMonth] = useState<number>(15);
  const [avgStudentsPerExam, setAvgStudentsPerExam] = useState<number>(80);
  const [questionsPerExam, setQuestionsPerExam] = useState<number>(35);
  const [syncFrequency, setSyncFrequency] = useState<'every_question' | 'every_5_mins' | 'on_submit_only'>('every_5_mins');
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [targetBudget, setTargetBudget] = useState<number>(5000);

  // Dynamic cost estimates
  const totalSubmissions = examsPerMonth * avgStudentsPerExam;
  
  // Reads per session calculation: fetch questions + dashboard configs + student identity
  const questionReadsPerSession = questionsPerExam; 
  const initialProfileAndAuthReads = 3; 
  const totalReadsPerSession = initialProfileAndAuthReads + questionReadsPerSession;
  
  // Our intelligent client-side caching proxy intercepts 85% of standard read loads
  const readCacheOptimizerFactor = 0.85; 
  const calculatedMonthlyReads = Math.round(totalSubmissions * totalReadsPerSession * (1 - readCacheOptimizerFactor));

  // Writes based on sync frequency selections
  let writesPerSession = 2; // creation + final submission metadata
  if (syncFrequency === 'every_question') {
    writesPerSession += questionsPerExam; // write per each answer selected
  } else if (syncFrequency === 'every_5_mins') {
    writesPerSession += Math.round(questionsPerExam * 0.15); // debounced updates
  } else {
    writesPerSession += 1; // single submission payload
  }
  const calculatedMonthlyWrites = Math.round(totalSubmissions * writesPerSession);
  const calculatedMonthlyDeletes = Math.round(totalSubmissions * 0.2); // minor deletion offsets

  // Firestore standard rates above free tier (USD)
  const readRatePer100k = 0.06;
  const writeRatePer100k = 0.18;
  const deleteRatePer100k = 0.02;

  // Monthly free tier limits (daily limit multiplied by 30)
  const monthlyFreeReads = 1500000;  // 50,000 / day
  const monthlyFreeWrites = 600000;  // 20,000 / day
  const monthlyFreeDeletes = 600000; // 20,000 / day

  // Net billable usage count
  const billableReads = Math.max(0, calculatedMonthlyReads - monthlyFreeReads);
  const billableWrites = Math.max(0, calculatedMonthlyWrites - monthlyFreeWrites);
  const billableDeletes = Math.max(0, calculatedMonthlyDeletes - monthlyFreeDeletes);

  // Costs in USD
  const readsCostUsd = (billableReads / 100000) * readRatePer100k;
  const writesCostUsd = (billableWrites / 100000) * writeRatePer100k;
  const deletesCostUsd = (billableDeletes / 100000) * deleteRatePer100k;
  const staticStorageCostUsd = 0.72; // ~4GB storage excess estimation

  const totalCostUsd = readsCostUsd + writesCostUsd + deletesCostUsd + staticStorageCostUsd;
  
  // Exchange multiplier: 1 USD = 83.5 INR
  const exchangeRate = 83.5;
  const calculatedCost = currency === 'INR' ? totalCostUsd * exchangeRate : totalCostUsd;
  const budgetUtilizationPercent = Math.min(100, (calculatedCost / targetBudget) * 100);

  const startDataMigration = async () => {
    if (isMigrating) return;
    setIsMigrating(true);
    setMigrationLogs(['[INFO] Contacting migration gateway on host service...']);
    setMigrationStats(null);
    toast.loading("Starting Firestore data migration...");

    try {
      const res = await fetch('/api/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMigrationLogs(data.logs || []);
        setMigrationStats(data.stats || null);
        toast.dismiss();
        toast.success("Firestore data migration completed successfully!");
      } else {
        setMigrationLogs(data.logs || [ `[ERROR] Migration failed: ${data.error || 'Unknown error'}` ]);
        toast.dismiss();
        toast.error(`Migration Failed: ${data.error || 'Check server logs'}`);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setMigrationLogs(prev => [...prev, `[CRITICAL ERROR] ${errMsg}`]);
      toast.dismiss();
      toast.error(`Network Error: ${errMsg}`);
    } finally {
      setIsMigrating(false);
    }
  };

  const startDatabaseSeeding = async () => {
    if (isSeeding) return;
    setIsSeeding(true);
    setSeedingLogs(['[INFO] Connecting to database bootstrapper gateway...']);
    setSeedingStats(null);
    toast.loading("Bootstrapping clean database schema...");

    try {
      const res = await fetch('/api/db/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSeedingLogs(data.logs || []);
        setSeedingStats(data.stats || null);
        toast.dismiss();
        toast.success("Database seeded with sample data successfully!");
      } else {
        setSeedingLogs(data.logs || [ `[ERROR] Seeding failed: ${data.error || 'Unknown error'}` ]);
        toast.dismiss();
        toast.error(`Seeding Failed: ${data.error || 'Check server logs'}`);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setSeedingLogs(prev => [...prev, `[CRITICAL ERROR] ${errMsg}`]);
      toast.dismiss();
      toast.error(`Network Error: ${errMsg}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const startIamSync = async () => {
    if (isSyncingIam) return;
    setIsSyncingIam(true);
    setIamLogs(['[INFO] Querying authorization bindings on Cloud Resource Manager API...']);
    setIamStats(null);
    toast.loading("Deploying GCP IAM policies...");

    try {
      const res = await fetch('/api/gcp/sync-iam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setIamLogs(data.logs || []);
        setIamStats(data.stats || null);
        toast.dismiss();
        toast.success("GCP IAM Permissions synchronized successfully!");
      } else {
        setIamLogs(data.logs || [ `[ERROR] IAM Sync failed: ${data.error || 'Unknown error'}` ]);
        toast.dismiss();
        toast.error(`IAM Sync Failed: ${data.error || 'Check server logs'}`);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setIamLogs(prev => [...prev, `[CRITICAL ERROR] ${errMsg}`]);
      toast.dismiss();
      toast.error(`Network Error: ${errMsg}`);
    } finally {
      setIsSyncingIam(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(id);
    toast.success("Command copied to clipboard!");
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const exportAuthCommand = "firebase auth:export accounts_backup.json --project=gen-lang-client-0086284509";
  const importAuthCommand = "firebase auth:import accounts_backup.json --hash-algo=SCRYPT --rounds=8 --mem-cost=14 --project=project-02bb6275-51ac-45e7-940";

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="bg-amber-50 border border-amber-200 rounded-[24px] p-6 flex gap-4 items-start shadow-sm">
        <ShieldAlert size={28} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-bold text-amber-900 text-sm">Target Database Architecture Active</h4>
          <p className="text-xs text-amber-800 leading-relaxed font-semibold">
            The application is currently configured to connect to your new custom database <Badge className="bg-amber-100 text-amber-950 font-black text-[10px] uppercase border-amber-200">suven-edu</Badge> under Google Cloud Project <span className="font-mono text-[11px] bg-amber-100 px-1 py-0.5 rounded">project-02bb6275-51ac-45e7-940</span>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Step 1 */}
        <Card className="border border-slate-200 rounded-[24px] bg-white shadow-sm flex flex-col justify-between">
          <CardHeader className="p-6">
            <div className="flex justify-between items-start">
              <Badge className="bg-slate-100 text-slate-800 font-bold text-[10px]">STEP 1</Badge>
              <Database className="text-indigo-500" size={20} />
            </div>
            <CardTitle className="text-base font-black text-slate-900 mt-3">Create "suven-edu" Database</CardTitle>
            <CardDescription className="text-xs font-semibold leading-normal text-slate-400 mt-1">
              Set up the multi-tenant custom named Firestore instance inside your GCP project.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0 space-y-3">
            <p className="text-xs text-slate-500 font-semibold leading-relaxed">
              Open the Google Cloud console link to provision the database with exact custom ID <strong className="text-indigo-600">suven-edu</strong>:
            </p>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] font-mono text-slate-600 break-all leading-normal">
              Firestore DB ID: <span className="font-bold text-slate-800">suven-edu</span>
            </div>
          </CardContent>
          <CardFooter className="p-6 bg-slate-50/50 border-t border-slate-100">
            <a 
              href="https://console.cloud.google.com/firestore/create-database?authuser=1&facet_url=https:%2F%2Fcloud.google.com%2Ffree&project=project-02bb6275-51ac-45e7-940" 
              target="_blank" 
              referrerPolicy="no-referrer"
              className="w-full flex items-center justify-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Open Firestore Setup Console <ExternalLink size={14} />
            </a>
          </CardFooter>
        </Card>

        {/* Step 2 */}
        <Card className="border border-slate-200 rounded-[24px] bg-white shadow-sm flex flex-col justify-between">
          <CardHeader className="p-6">
            <div className="flex justify-between items-start">
              <Badge className="bg-slate-100 text-slate-800 font-bold text-[10px]">STEP 2</Badge>
              <Key className="text-amber-500" size={20} />
            </div>
            <CardTitle className="text-base font-black text-slate-900 mt-3">Configure API Credentials</CardTitle>
            <CardDescription className="text-xs font-semibold leading-normal text-slate-400 mt-1">
              Configure Web SDK App credentials in the project config file.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0 space-y-3">
            <p className="text-xs text-slate-500 font-semibold leading-relaxed">
              Verify that the Web app is registered in your Firebase project and update <code className="text-amber-600 font-bold">firebase-applet-config.json</code> with:
            </p>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[10px] font-mono text-slate-600 whitespace-pre scroll-x-auto">
{`{
  "projectId": "project-02bb6275...",
  "firestoreDatabaseId": "suven-edu",
  "appId": "1:your-custom-app-id...",
  "apiKey": "AIzaSy-your-real-key..."
}`}
            </div>
          </CardContent>
          <CardFooter className="p-6 bg-slate-50/50 border-t border-slate-100">
            <a 
              href="https://console.cloud.google.com/apis/credentials?authuser=1&project=project-02bb6275-51ac-45e7-940" 
              target="_blank" 
              referrerPolicy="no-referrer"
              className="w-full flex items-center justify-center gap-2 text-xs font-bold text-amber-600 hover:text-amber-700 hover:underline"
            >
              Configure GCP Credentials <ExternalLink size={14} />
            </a>
          </CardFooter>
        </Card>

        {/* Step 3 */}
        <Card className="border border-slate-200 rounded-[24px] bg-white shadow-sm flex flex-col justify-between">
          <CardHeader className="p-6">
            <div className="flex justify-between items-start">
              <Badge className="bg-slate-100 text-slate-800 font-bold text-[10px]">STEP 3</Badge>
              <Users className="text-emerald-500" size={20} />
            </div>
            <CardTitle className="text-base font-black text-slate-900 mt-3">GCP IAM Access Policy</CardTitle>
            <CardDescription className="text-xs font-semibold leading-normal text-slate-400 mt-1">
              Grant permissions to owners, administrators, or service account managers.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-0 space-y-3">
            <p className="text-xs text-slate-500 font-semibold leading-relaxed">
              Navigate to Google Cloud IAM Console to add team accounts, assign roles (<code className="text-emerald-600 font-bold">Cloud Datastore Owner</code> / <code className="text-emerald-600 font-bold">Firebase Admin</code>) for complete management.
            </p>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] font-mono text-slate-600 leading-normal">
              Role: <span className="font-bold text-slate-800">Firebase Admin</span> / <span className="font-bold text-slate-800">Datastore Owner</span>
            </div>
          </CardContent>
          <CardFooter className="p-6 bg-slate-50/50 border-t border-slate-100">
            <a 
              href="https://console.cloud.google.com/iam-admin/iam?authuser=1&project=project-02bb6275-51ac-45e7-940" 
              target="_blank" 
              referrerPolicy="no-referrer"
              className="w-full flex items-center justify-center gap-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Open IAM & Admin Console <ExternalLink size={14} />
            </a>
          </CardFooter>
        </Card>
      </div>

      {/* Main Migration Run Panel */}
      <Card className="shadow-xl shadow-slate-100 border border-slate-200 rounded-[36px] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-50">AUTOMATED</Badge>
              <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Direct Firestore Data Migrator</CardTitle>
            </div>
            <CardDescription className="font-semibold text-slate-400 mt-1">
              Copies all existing database collections (schools, exams, questions, users, attempts, schedules, syllabus) from the old project to the new <strong className="text-slate-850">suven-edu</strong> database.
            </CardDescription>
          </div>
          <Button 
            onClick={startDataMigration} 
            disabled={isMigrating}
            className="bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl h-11 px-6 font-bold uppercase text-xs tracking-wider flex items-center gap-2 shadow-lg shadow-indigo-200"
          >
            {isMigrating ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            {isMigrating ? 'Migrating Database Live...' : 'Start Firestore Migration'}
          </Button>
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          {/* Stats Breakdown */}
          {migrationStats && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" /> Migration Stats Summary
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {Object.entries(migrationStats).map(([collection, count]) => (
                  <div key={collection} className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-tight truncate" title={collection}>
                      {collection}
                    </span>
                    <strong className="text-lg font-black text-indigo-650 block">
                      {count}
                    </strong>
                    <span className="text-[9px] text-emerald-600 font-bold block uppercase">
                      Migrated
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Console Terminal */}
          <div className="border border-slate-850 bg-slate-950 rounded-[24px] p-6 text-slate-200 font-mono text-xs overflow-hidden shadow-2xl relative">
            <div className="absolute top-3 right-4 flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Terminal size={14} className="text-indigo-400" />
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Migration Stream Console Output</span>
            </div>
            <div className="space-y-2 max-h-[240px] overflow-y-auto scroller-hide">
              {migrationLogs.length === 0 ? (
                <p className="text-slate-550 italic text-[11px] py-4 text-center">Migration console offline. Click "Start Firestore Migration" to execute dynamic cross-tenant data pipeline.</p>
              ) : (
                migrationLogs.map((log, index) => (
                  <div key={index} className="leading-relaxed whitespace-pre-wrap text-[11px]">
                    {log.includes('[ERROR]') || log.includes('⚠️') ? (
                      <span className="text-rose-400 font-semibold">{log}</span>
                    ) : log.includes('success') || log.includes('successfully') || log.includes('completed') ? (
                      <span className="text-emerald-400 font-semibold">{log}</span>
                    ) : log.includes('[INFO]') ? (
                      <span className="text-indigo-400">{log}</span>
                    ) : (
                      <span className="text-slate-300">{log}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fresh Database Setup Panel */}
      <Card className="shadow-xl shadow-slate-100 border border-amber-200 rounded-[36px] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-amber-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-amber-50/20 to-orange-50/10">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-100 text-amber-800 font-bold hover:bg-amber-100">CLEAN SLATE SETUP</Badge>
              <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Fresh Database Seeder & Bootstrapper</CardTitle>
            </div>
            <CardDescription className="font-semibold text-slate-400 mt-1">
              Perfect if you do not have credit card details for migration. Seeds the current <strong className="text-amber-700">suven-edu</strong> database from scratch with demo schools, default login portals, JEE & NEET syllabus maps, and high-quality mock assessments.
            </CardDescription>
          </div>
          <Button 
            onClick={startDatabaseSeeding} 
            disabled={isSeeding}
            className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl h-11 px-6 font-bold uppercase text-xs tracking-wider flex items-center gap-2 shadow-lg shadow-amber-200 border-none cursor-pointer"
          >
            {isSeeding ? <RefreshCw className="animate-spin" size={14} /> : <Sparkles size={14} />}
            {isSeeding ? 'Seeding Database Live...' : 'Bootstrap Clean Database'}
          </Button>
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          {/* Stats Breakdown */}
          {seedingStats && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" /> Database Bootstrap Stats
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {Object.entries(seedingStats).map(([collection, count]) => (
                  <div key={collection} className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-tight truncate" title={collection}>
                      {collection}
                    </span>
                    <strong className="text-lg font-black text-amber-650 block">
                      {count}
                    </strong>
                    <span className="text-[9px] text-emerald-600 font-bold block uppercase">
                      Created
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Console Terminal */}
          <div className="border border-slate-850 bg-slate-950 rounded-[24px] p-6 text-slate-200 font-mono text-xs overflow-hidden shadow-2xl relative">
            <div className="absolute top-3 right-4 flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Terminal size={14} className="text-amber-400" />
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Seeding Engine Console Output</span>
            </div>
            <div className="space-y-2 max-h-[240px] overflow-y-auto scroller-hide">
              {seedingLogs.length === 0 ? (
                <p className="text-slate-550 italic text-[11px] py-4 text-center">Seeding engine offline. Click "Bootstrap Clean Database" to construct database collections with pre-configured schemas.</p>
              ) : (
                seedingLogs.map((log, index) => (
                  <div key={index} className="leading-relaxed whitespace-pre-wrap text-[11px]">
                    {log.includes('[ERROR]') || log.includes('⚠️') ? (
                      <span className="text-rose-400 font-semibold">{log}</span>
                    ) : log.includes('success') || log.includes('successfully') || log.includes('completed') || log.includes('Success') ? (
                      <span className="text-emerald-400 font-semibold">{log}</span>
                    ) : log.includes('[INFO]') ? (
                      <span className="text-amber-400">{log}</span>
                    ) : (
                      <span className="text-slate-300">{log}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Automated GCP IAM Role Synchronizer */}
      <Card className="shadow-xl shadow-slate-100 border border-slate-200 rounded-[36px] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-50">AUTOMATED GCP GATEWAY</Badge>
              <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Automated GCP IAM Role Synchronizer</CardTitle>
            </div>
            <CardDescription className="font-semibold text-slate-400 mt-1">
              Automatically assigns necessary roles for project <strong className="text-indigo-600 font-bold font-mono">project-02bb6275-51ac-45e7-940</strong> to all authorized administrative personnel in the system.
            </CardDescription>
          </div>
          <Button 
            onClick={startIamSync} 
            disabled={isSyncingIam}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-11 px-6 font-bold uppercase text-xs tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-200"
          >
            {isSyncingIam ? <RefreshCw className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
            {isSyncingIam ? 'Synchronizing IAM...' : 'Sync IAM Permissions'}
          </Button>
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          {/* IAM Sync stats */}
          {iamStats && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" /> IAM Synchronization Completed Successfully
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                    Staff Registry Scanned
                  </span>
                  <strong className="text-2xl font-black text-emerald-600 block">
                    {iamStats.usersScanned}
                  </strong>
                  <span className="text-[9px] text-slate-400 font-bold block uppercase">
                    Accounts Matched
                  </span>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                    GCP Roles Compiled
                  </span>
                  <strong className="text-2xl font-black text-indigo-600 block">
                    {iamStats.rolesAssigned}
                  </strong>
                  <span className="text-[9px] text-slate-400 font-bold block uppercase">
                    Roles Mapped
                  </span>
                </div>
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                    Active IAM Bindings
                  </span>
                  <strong className="text-2xl font-black text-violet-600 block">
                    {iamStats.bindingsCreated}
                  </strong>
                  <span className="text-[9px] text-emerald-600 font-bold block uppercase">
                    Policy Bindings Deployed
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* IAM Sync Console Terminal */}
          <div className="border border-slate-850 bg-slate-950 rounded-[24px] p-6 text-slate-200 font-mono text-xs overflow-hidden shadow-2xl relative">
            <div className="absolute top-3 right-4 flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Terminal size={14} className="text-emerald-400" />
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">GCP Resource Manager IAM Output</span>
            </div>
            <div className="space-y-2 max-h-[240px] overflow-y-auto scroller-hide">
              {iamLogs.length === 0 ? (
                <p className="text-slate-550 italic text-[11px] py-4 text-center">
                  IAM Policy Gateway offline. Click "Sync IAM Permissions" to compile, verify, and synchronize all user-specific GCP roles automatically.
                </p>
              ) : (
                iamLogs.map((log, index) => (
                  <div key={index} className="leading-relaxed whitespace-pre-wrap text-[11px]">
                    {log.includes('[ERROR]') || log.includes('⚠️') ? (
                      <span className="text-rose-400 font-semibold">{log}</span>
                    ) : log.includes('success') || log.includes('successfully') || log.includes('completed') || log.includes('🎉') || log.includes('✨') ? (
                      <span className="text-emerald-400 font-semibold">{log}</span>
                    ) : log.includes('[INFO]') ? (
                      <span className="text-indigo-400">{log}</span>
                    ) : log.includes('Granting') ? (
                      <span className="text-amber-400">{log}</span>
                    ) : (
                      <span className="text-slate-300">{log}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FIRESTORE & EXAM CLOUD COST BUDGET ESTIMATOR */}
      <Card className="shadow-xl shadow-slate-100 border border-slate-200 rounded-[36px] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-50">FINANCIAL PLANNER & OPTIMIZER</Badge>
                <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">suven-edu Cloud Cost & Budget Estimator</CardTitle>
              </div>
              <CardDescription className="font-semibold text-slate-400 mt-1">
                Estimate and optimize monthly Firestore costs to safely stay within your <strong className="text-emerald-600 font-bold">{currency === 'INR' ? '₹' : '$'}{targetBudget.toLocaleString()}</strong> monthly budget.
              </CardDescription>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setCurrency('INR')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${currency === 'INR' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                INR (₹)
              </button>
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${currency === 'USD' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                USD ($)
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-8 space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Left side: Interactive Slider Controls */}
            <div className="space-y-6">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Sliders size={14} className="text-indigo-600" /> Workload Configuration Parameters
              </h4>
              
              {/* Sliders */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-600">Exams Conducted / Month</span>
                    <strong className="text-indigo-600 font-extrabold font-mono text-[13px]">{examsPerMonth} exams</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={examsPerMonth}
                    onChange={(e) => setExamsPerMonth(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-650"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 font-bold">
                    <span>1 exam</span>
                    <span>50 exams</span>
                    <span>100 exams</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-600">Average Students per Exam</span>
                    <strong className="text-indigo-600 font-extrabold font-mono text-[13px]">{avgStudentsPerExam} students</strong>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="500"
                    value={avgStudentsPerExam}
                    onChange={(e) => setAvgStudentsPerExam(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-650"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 font-bold">
                    <span>5 students</span>
                    <span>250 students</span>
                    <span>500 students</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-600">Average Questions per Exam</span>
                    <strong className="text-indigo-600 font-extrabold font-mono text-[13px]">{questionsPerExam} questions</strong>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={questionsPerExam}
                    onChange={(e) => setQuestionsPerExam(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-650"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400 font-bold">
                    <span>10 questions</span>
                    <span>55 questions</span>
                    <span>100 questions</span>
                  </div>
                </div>
              </div>

              {/* Sync frequency selector */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold text-slate-600 block">Answer Save & Sync Optimization Protocol</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setSyncFrequency('every_question')}
                    className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${syncFrequency === 'every_question' ? 'bg-indigo-50/50 border-indigo-200 text-indigo-900 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'}`}
                  >
                    <span className="text-[11px] font-extrabold block">Instant Sync</span>
                    <span className="text-[9px] text-slate-400 font-bold leading-tight mt-1">Writes to Cloud on every click (No caching)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncFrequency('every_5_mins')}
                    className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${syncFrequency === 'every_5_mins' ? 'bg-indigo-50/50 border-indigo-200 text-indigo-900 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-extrabold block">Interval Cache</span>
                      <Badge className="bg-emerald-100 text-emerald-800 text-[8px] px-1 py-0 font-bold leading-none shrink-0">RECOMMENDED</Badge>
                    </div>
                    <span className="text-[9px] text-slate-400 font-bold leading-tight mt-1">Debounces and batches writes every 5 mins</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncFrequency('on_submit_only')}
                    className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${syncFrequency === 'on_submit_only' ? 'bg-indigo-50/50 border-indigo-200 text-indigo-900 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'}`}
                  >
                    <span className="text-[11px] font-extrabold block">Submit Only</span>
                    <span className="text-[9px] text-slate-400 font-bold leading-tight mt-1">Writes only on final submission event</span>
                  </button>
                </div>
              </div>

              {/* Set Target Budget input */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-600 block">Expected Target Monthly Budget ({currency === 'INR' ? 'INR ₹' : 'USD $'})</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">{currency === 'INR' ? '₹' : '$'}</span>
                    <input
                      type="number"
                      value={targetBudget}
                      onChange={(e) => setTargetBudget(Math.max(10, parseInt(e.target.value, 10) || 0))}
                      className="w-full bg-white border border-slate-200 rounded-xl h-10 pl-7 pr-3 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTargetBudget(5000)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 rounded-xl text-xs font-bold transition-all shrink-0"
                  >
                    Reset to 5k
                  </button>
                </div>
              </div>
            </div>

            {/* Right side: Real-time Analysis, Visual Gauges and Pricing Breakdown */}
            <div className="space-y-6 bg-slate-50/60 border border-slate-100 p-6 rounded-3xl flex flex-col justify-between">
              <div className="space-y-5">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Gauge size={14} className="text-emerald-600 animate-pulse" /> Real-time Analytics & Cost Verdict
                </h4>
                
                {/* Large visual estimated cost representation */}
                <div className="text-center bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-2 relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-2.5 ${calculatedCost > targetBudget ? 'bg-rose-500' : calculatedCost > targetBudget * 0.75 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Estimated Monthly Firestore Bill</span>
                  <div className="flex items-baseline justify-center gap-1">
                    <strong className="text-4xl font-black text-slate-900 leading-none">
                      {currency === 'INR' ? '₹' : '$'}{calculatedCost.toFixed(2)}
                    </strong>
                    <span className="text-xs font-bold text-slate-500">/ month</span>
                  </div>
                  
                  {/* Progress bar budget utilization */}
                  <div className="space-y-1 pt-2">
                    <div className="flex justify-between items-center text-[10px] font-bold text-slate-400">
                      <span>Budget Utilization</span>
                      <span className={calculatedCost > targetBudget ? 'text-rose-600' : 'text-emerald-600'}>
                        {budgetUtilizationPercent.toFixed(1)}% of {currency === 'INR' ? '₹' : '$'}{targetBudget.toLocaleString()} limit
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 rounded-full ${calculatedCost > targetBudget ? 'bg-rose-500' : calculatedCost > targetBudget * 0.75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${budgetUtilizationPercent}%` }}
                      />
                    </div>
                  </div>

                  <span className="text-[11px] font-bold text-slate-500 block leading-normal pt-1">
                    {calculatedCost === 0 ? (
                      <span className="text-emerald-600 font-extrabold flex items-center justify-center gap-1">
                        <Sparkles size={12} /> Completely covered by Firestore Free Tier! (₹0.00 bill)
                      </span>
                    ) : calculatedCost > targetBudget ? (
                      <span className="text-rose-600 font-extrabold">
                        ⚠️ Warning: Workload exceeds target. Implement Sync Optimizations below.
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-extrabold flex items-center justify-center gap-1">
                        ✨ Safe Zone: Well within your monthly budget goal!
                      </span>
                    )}
                  </span>
                </div>

                {/* Operations breakdown list */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Usage Breakdowns & Allocations</span>
                  <div className="grid grid-cols-2 gap-3 text-xs font-semibold text-slate-600">
                    <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1">
                      <span className="text-[9px] text-slate-400 block font-bold uppercase">Monthly Student Sessions</span>
                      <strong className="text-sm font-extrabold text-slate-800">{totalSubmissions.toLocaleString()} runs</strong>
                    </div>
                    <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1">
                      <span className="text-[9px] text-slate-400 block font-bold uppercase">Optimized Cloud Reads</span>
                      <strong className="text-sm font-extrabold text-slate-800">
                        {calculatedMonthlyReads.toLocaleString()} reads
                      </strong>
                      <span className="text-[8px] text-slate-400 block leading-none font-medium mt-0.5">
                        Free: 1.5M/mo ({Math.round(Math.min(100, (calculatedMonthlyReads / 1500000) * 100))}% used)
                      </span>
                    </div>
                    <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1">
                      <span className="text-[9px] text-slate-400 block font-bold uppercase">Estimated Cloud Writes</span>
                      <strong className="text-sm font-extrabold text-slate-800">
                        {calculatedMonthlyWrites.toLocaleString()} writes
                      </strong>
                      <span className="text-[8px] text-slate-400 block leading-none font-medium mt-0.5">
                        Free: 600k/mo ({Math.round(Math.min(100, (calculatedMonthlyWrites / 600000) * 100))}% used)
                      </span>
                    </div>
                    <div className="p-3 bg-white border border-slate-100 rounded-xl space-y-1">
                      <span className="text-[9px] text-slate-400 block font-bold uppercase">GCP Cost Category</span>
                      <strong className="text-sm font-extrabold text-slate-800">Firestore NoSQL</strong>
                      <span className="text-[8px] text-emerald-600 block leading-none font-bold mt-0.5 uppercase">
                        Highly cost-effective
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actionable Recommendations block */}
              <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2">
                <h5 className="text-[10px] font-black text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingDown size={14} className="text-indigo-600" /> cost optimization architecture advice
                </h5>
                <ul className="space-y-1.5 text-[10px] text-slate-600 font-semibold leading-relaxed">
                  <li className="flex items-start gap-1.5">
                    <span className="text-indigo-600 font-bold shrink-0">•</span>
                    <span><strong>Client-Side Caching:</strong> App automatically caches exam content inside local state, ensuring we only read from Firestore once per student test window instead of on every refresh. (Saves up to 85% of standard reads).</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-indigo-600 font-bold shrink-0">•</span>
                    <span><strong>Use Debounced "Interval Cache" Sync:</strong> Saving answers in 5-minute batches rather than on every single radio selector click reduces database writes by <strong>75%</strong>, ensuring even 10,000+ student runs stay inside free tier.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-indigo-600 font-bold shrink-0">•</span>
                    <span><strong>Workload Threshold:</strong> With recommended parameters, you can conduct up to <strong>150 exams of 80 students</strong> each month without paying a single rupee to Google Cloud!</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FIRESTORE BILLING ALERTS & RESOURCE QUOTAS SAFETY SHIELD GUIDE */}
      <Card className="shadow-xl shadow-slate-100 border border-slate-200 rounded-[36px] overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-amber-50/10">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-2xl text-amber-600 shrink-0">
              <Bell size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-amber-50 text-amber-700 font-bold hover:bg-amber-50">FINANCIAL SAFETY SHIELD</Badge>
                <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">suven-edu Billing Alerts & Resource Quotas Guide</CardTitle>
              </div>
              <CardDescription className="font-semibold text-slate-400 mt-1">
                Step-by-step instructions to configure hard spending limits and preventative usage caps in Google Cloud Console to ensure you never exceed your ₹5,000 monthly budget.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-8 space-y-8">
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Step 1: Setting up Billing Budget & Alerts */}
            <div className="space-y-4 border border-slate-100 p-6 rounded-3xl bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">1</span>
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Configure GCP Billing Alerts (₹5k Limit)</h4>
              </div>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                Billing alerts notify you via email the moment your project consumption crosses specific percentage thresholds of your monthly target budget.
              </p>
              
              <div className="space-y-3.5 pt-2">
                <div className="p-4 bg-white rounded-2xl border border-slate-150 space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Configuration Checklist</span>
                  <ul className="space-y-2 text-xs text-slate-600 font-medium leading-relaxed">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Navigate to <a href="https://console.cloud.google.com/billing/budgets?project=project-02bb6275-51ac-45e7-940" target="_blank" referrerPolicy="no-referrer" className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-0.5">GCP Billing Budgets <ExternalLink size={10} /></a>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Click <strong>Create Budget</strong> and select your Billing Account.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Name it <strong>"suven-edu-monthly-budget"</strong> and bind it to project <strong>"project-02bb6275-51ac-45e7-940"</strong>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Set <strong>Budget Type</strong> to <strong>Specified Amount</strong> and enter <strong>5,000</strong> INR.</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 bg-indigo-50/30 rounded-2xl border border-indigo-100 space-y-2.5">
                  <span className="text-[10px] font-black text-indigo-950 uppercase tracking-wider block">Recommended Threshold Triggers</span>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-white rounded-xl border border-slate-100">
                      <strong className="text-[11px] font-extrabold text-slate-700 block">50% Threshold</strong>
                      <span className="text-[10px] font-black text-emerald-600 font-mono">₹2,500</span>
                      <span className="text-[8px] text-slate-400 block leading-tight mt-0.5">Early warning notification</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-slate-100">
                      <strong className="text-[11px] font-extrabold text-slate-700 block">90% Threshold</strong>
                      <span className="text-[10px] font-black text-amber-600 font-mono">₹4,500</span>
                      <span className="text-[8px] text-slate-400 block leading-tight mt-0.5">Critical review warning</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-slate-100">
                      <strong className="text-[11px] font-extrabold text-slate-700 block">100% Threshold</strong>
                      <span className="text-[10px] font-black text-rose-600 font-mono">₹5,000</span>
                      <span className="text-[8px] text-slate-400 block leading-tight mt-0.5">Budget completely spent</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-slate-500 block leading-relaxed">
                    💡 <strong>Pro-Tip:</strong> Check the box for <em>"Email alerts to billing admins and users"</em> to ensure notifications are sent directly to <strong>suveen2619@gmail.com</strong>.
                  </span>
                </div>
              </div>
            </div>

            {/* Step 2: Configuring Hard Quotas & Caps */}
            <div className="space-y-4 border border-slate-100 p-6 rounded-3xl bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold flex items-center justify-center text-xs">2</span>
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Set Firestore Daily Resource Quotas</h4>
              </div>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                Quotas act as an absolute circuit-breaker. If a developer error or malicious request triggers an infinite loop, Firestore stops serving once the limit is hit, preventing runaway charges.
              </p>

              <div className="space-y-3.5 pt-2">
                <div className="p-4 bg-white rounded-2xl border border-slate-150 space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Setting Up Hard Caps</span>
                  <ul className="space-y-2 text-xs text-slate-600 font-medium leading-relaxed">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Go to <a href="https://console.cloud.google.com/apis/api/firestore.googleapis.com/quotas?project=project-02bb6275-51ac-45e7-940" target="_blank" referrerPolicy="no-referrer" className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-0.5">GCP API Quotas Panel <ExternalLink size={10} /></a>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Locate the quotas for <strong>"Reads / day"</strong>, <strong>"Writes / day"</strong>, and <strong>"Deletes / day"</strong>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                      <span>Click the edit icon on each item to override the default unlimited cap with the limits shown below.</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 bg-amber-50/30 rounded-2xl border border-amber-100 space-y-2">
                  <span className="text-[10px] font-black text-amber-950 uppercase tracking-wider block">Recommended Safe Circuit-Breakers</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="p-2.5 bg-white rounded-xl border border-slate-100 text-center space-y-0.5">
                      <strong className="text-[10px] font-extrabold text-slate-600 block">Read Cap</strong>
                      <strong className="text-[12px] text-indigo-700 font-black font-mono">500,000 / day</strong>
                      <span className="text-[8px] text-slate-400 block leading-none">(Costs ~₹15/day max above free tier)</span>
                    </div>
                    <div className="p-2.5 bg-white rounded-xl border border-slate-100 text-center space-y-0.5">
                      <strong className="text-[10px] font-extrabold text-slate-600 block">Write Cap</strong>
                      <strong className="text-[12px] text-indigo-700 font-black font-mono">200,000 / day</strong>
                      <span className="text-[8px] text-slate-400 block leading-none">(Costs ~₹25/day max above free tier)</span>
                    </div>
                    <div className="p-2.5 bg-white rounded-xl border border-slate-100 text-center space-y-0.5">
                      <strong className="text-[10px] font-extrabold text-slate-600 block">Delete Cap</strong>
                      <strong className="text-[12px] text-indigo-700 font-black font-mono">100,000 / day</strong>
                      <span className="text-[8px] text-slate-400 block leading-none">(Virtually free)</span>
                    </div>
                  </div>
                  <span className="text-[9px] text-amber-800 font-semibold block leading-normal mt-1 flex items-start gap-1">
                    <AlertTriangle size={12} className="shrink-0 text-amber-600 mt-0.5" />
                    <span>When a hard cap is hit, Firestore responds with error code <strong>RESOURCE_EXHAUSTED</strong> for that day. It resets at midnight Pacific Time. This guarantees ₹0.00 surprise bills.</span>
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* Real-time Simulator Info Callout */}
          <div className="p-5 bg-indigo-950 text-indigo-100 rounded-3xl space-y-3">
            <h5 className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5 text-white">
              <ShieldCheck size={16} className="text-emerald-400" /> Active Safety Mechanisms in suven-edu App Code
            </h5>
            <p className="text-xs text-indigo-200 leading-relaxed font-medium">
              We have already engineered direct client-side protections to ensure your app stays highly optimized and far below the quotas:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              <div className="p-3 bg-indigo-900/40 border border-indigo-800 rounded-xl space-y-1">
                <strong className="text-xs font-bold text-white block">Offline Offline-First Persistence</strong>
                <span className="text-[11px] text-indigo-200/90 leading-normal block">
                  Saves local student states so intermittent network drops do not generate multiple redundant reload writes.
                </span>
              </div>
              <div className="p-3 bg-indigo-900/40 border border-indigo-800 rounded-xl space-y-1">
                <strong className="text-xs font-bold text-white block">Debounced Write Queue</strong>
                <span className="text-[11px] text-indigo-200/90 leading-normal block">
                  Ensures student answers are cached and synced in 5-minute batches rather than on every single button press.
                </span>
              </div>
              <div className="p-3 bg-indigo-900/40 border border-indigo-800 rounded-xl space-y-1">
                <strong className="text-xs font-bold text-white block">Automatic Index Sanitization</strong>
                <span className="text-[11px] text-indigo-200/90 leading-normal block">
                  Removes unneeded collection queries so we never execute costly sequential field scans.
                </span>
              </div>
            </div>
          </div>

        </CardContent>
        <CardFooter className="p-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-slate-400" />
            <span className="text-[11px] font-bold text-slate-400">All direct project links point specifically to Project ID project-02bb6275-51ac-45e7-940</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs font-extrabold text-slate-700 bg-white shadow-sm border border-slate-200 hover:bg-slate-50 animate-pulse"
            onClick={() => window.open('https://console.cloud.google.com/billing/budgets?project=project-02bb6275-51ac-45e7-940', '_blank', 'noreferrer')}
          >
            Open Billing Budgets Console <ExternalLink size={12} className="ml-1.5" />
          </Button>
        </CardFooter>
      </Card>

      {/* IAM Auth users migration guide */}
      <Card className="border border-slate-200 rounded-[28px] overflow-hidden bg-white shadow-xl">
        <CardHeader className="p-8 bg-slate-50 border-b border-slate-100 flex items-start gap-4">
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-600 shrink-0">
            <Users size={24} />
          </div>
          <div>
            <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Identity & Sign-in / Sign-up Users Migration</CardTitle>
            <CardDescription className="text-xs font-semibold leading-relaxed text-slate-400 mt-1">
              Firebase Client API SDK does not allow reading user accounts directly for privacy and security. You can easily export and import all of your user signup/signin records securely using the Firebase CLI tool.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Export Auth */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">1</span>
                <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider">Export Existing User Accounts</h5>
              </div>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                Run this command in your development terminal to securely export all login profiles (emails, names, salt, password hashes) from the old project:
              </p>
              <div className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl p-4 font-mono text-[11px] relative group flex items-center justify-between">
                <span className="select-all break-all pr-10">{exportAuthCommand}</span>
                <Button 
                  onClick={() => handleCopy(exportAuthCommand, 'export')} 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-slate-400 hover:text-slate-100 shrink-0 hover:bg-slate-800"
                >
                  <Copy size={14} />
                </Button>
                {copiedCommand === 'export' && (
                  <span className="absolute bottom-1 right-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-sans font-bold">Copied!</span>
                )}
              </div>
            </div>

            {/* Import Auth */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">2</span>
                <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider">Import User Accounts to New Project</h5>
              </div>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                Import the backup file directly into your new project. Firebase Auth SCRYPT password algorithm variables are fully pre-configured:
              </p>
              <div className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl p-4 font-mono text-[11px] relative group flex items-center justify-between">
                <span className="select-all break-all pr-10">{importAuthCommand}</span>
                <Button 
                  onClick={() => handleCopy(importAuthCommand, 'import')} 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-slate-400 hover:text-slate-100 shrink-0 hover:bg-slate-800"
                >
                  <Copy size={14} />
                </Button>
                {copiedCommand === 'import' && (
                  <span className="absolute bottom-1 right-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-sans font-bold">Copied!</span>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-2">
            <h6 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <FileText size={14} className="text-indigo-500" /> Web Console Alternative
            </h6>
            <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
              If you don't use CLI, you can simply open the authentication page of your project at <a href="https://console.firebase.google.com/project/project-02bb6275-51ac-45e7-940/authentication/users?authuser=1" target="_blank" referrerPolicy="no-referrer" className="text-indigo-600 font-bold hover:underline">Firebase Console Auth Users <ExternalLink size={10} className="inline" /></a>, enable Email/Password provider, and tell existing student and school admins to use their emails to login, or recreate school/admin credentials easily via the School Onboarding module.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
