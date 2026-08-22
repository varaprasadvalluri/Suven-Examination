import React, { useState, useEffect } from 'react';
import { db, collection, getDocs, getCountFromServer } from '../lib/firebase';
import { authHeaders } from '../lib/sessionStore';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import {
  Cloud,
  Database,
  CheckCircle2,
  RefreshCw,
  Download,
  ShieldCheck,
  Layers,
  Server,
  ExternalLink,
  AlertCircle,
  ListChecks
} from 'lucide-react';
import { toast } from 'sonner';

// Real GCP account/project/billing-account identity and the enabled-services list come from
// /api/gcp/live-billing (server/routes/gcp.ts — real Cloud Billing/Resource Manager/Service
// Usage API calls). This page used to also show itemized service costs, a 7-day cost trend
// chart, a "live" audit log, and budget-threshold alerts — all of that was hardcoded/fabricated
// (fixed fake dates, invented log lines, "80%: Armed"/"100%: Safeguard" text disconnected from
// any real number) with no real backing data source; none of it is wired to Cloud Billing's
// actual cost/budget APIs anywhere in this app. Removed rather than kept-but-labeled — an admin
// making a spend decision needs the real number or an honest "not available here," not a
// plausible-looking fake one. Real cost/budget tracking lives in the GCP Console (linked below).
export const AdminCloudBilling: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [gcpApiData, setGcpApiData] = useState<any>(null);
  const [dbStats, setDbStats] = useState({ userCount: 0, schoolCount: 0, examCount: 0, resultCount: 0, totalDocuments: 0 });

  const fetchRealGcpMetrics = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/gcp/live-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({})
      });
      if (response.ok) {
        const liveGcpData = await response.json();
        setGcpApiData(liveGcpData);
        if (liveGcpData?.userAccount) {
          toast.success(`Connected to GCP account ${liveGcpData.userAccount}`);
        }
      } else {
        setGcpApiData(null);
      }
    } catch (e) {
      console.warn('Could not reach /api/gcp/live-billing endpoint:', e);
      setGcpApiData(null);
    }

    try {
      const countOrFallback = async (collectionName: string) => {
        try {
          const snap = await getCountFromServer(collection(db, collectionName));
          return snap.data().count;
        } catch {
          const docs = await getDocs(collection(db, collectionName));
          return docs.docs.length;
        }
      };
      const [users, schools, exams, results] = await Promise.all([
        countOrFallback('users'),
        countOrFallback('schools'),
        countOrFallback('exams'),
        countOrFallback('results')
      ]);
      setDbStats({
        userCount: users,
        schoolCount: schools,
        examCount: exams,
        resultCount: results,
        totalDocuments: users + schools + exams + results
      });
    } catch (err) {
      console.error('Error counting Firestore collections:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRealGcpMetrics();
  }, []);

  const billingApiWorking = !!gcpApiData?.apiStatus?.billingApiEnabled;
  const enabledServices: { name: string; title: string; state: string }[] = gcpApiData?.enabledServices || [];

  const handleExportSummary = () => {
    let csv = 'Field,Value\n';
    csv += `Project ID,"${gcpApiData?.targetProjectId || 'Unavailable'}"\n`;
    csv += `Project Number,"${gcpApiData?.projectNumber || 'Unavailable'}"\n`;
    csv += `Billing Account,"${gcpApiData?.billingInfo?.billingAccountName || 'Unavailable'}"\n`;
    csv += `Billing Enabled,"${gcpApiData?.billingInfo?.billingEnabled ?? 'Unavailable'}"\n`;
    csv += `Firestore Users,${dbStats.userCount}\n`;
    csv += `Firestore Schools,${dbStats.schoolCount}\n`;
    csv += `Firestore Exams,${dbStats.examCount}\n`;
    csv += `Firestore Results,${dbStats.resultCount}\n`;
    csv += `\nEnabled Service,Title,State\n`;
    enabledServices.forEach((s) => {
      csv += `"${s.name}","${s.title}","${s.state}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = `SuvenEdu_GCP_Summary_${new Date().toISOString().split('T')[0]}.csv`;
    downloadLink.click();
    toast.success('GCP account summary exported to CSV.');
  };

  const consoleUrl =
    gcpApiData?.gcpConsoleUrl ||
    (gcpApiData?.targetProjectId
      ? `https://console.cloud.google.com/welcome?project=${gcpApiData.targetProjectId}`
      : 'https://console.cloud.google.com/billing');

  return (
    <div className="space-y-8 font-sans pb-12">
      {/* Page Banner Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-sky-500/5 to-transparent pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              {gcpApiData?.targetProjectId && (
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <Cloud size={12} className="text-sky-400" /> Project: {gcpApiData.targetProjectId}
                </Badge>
              )}
              <Badge
                className={`px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 ${
                  billingApiWorking
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-700/40 text-slate-300 border-slate-600/50'
                }`}
              >
                {billingApiWorking ? (
                  <CheckCircle2 size={12} className="text-emerald-400" />
                ) : (
                  <AlertCircle size={12} className="text-slate-400" />
                )}
                {billingApiWorking ? 'Billing API Connected' : 'Billing API Not Connected'}
              </Badge>
            </div>

            <h1 className="text-2xl md:text-3xl font-serif font-black tracking-tight text-white flex items-center gap-3">
              <Cloud className="text-indigo-400 h-8 w-8" />
              GCP Project Overview
            </h1>

            <p className="text-xs text-slate-300 leading-relaxed">
              Real account, billing, and API-enablement status for this project's Google Cloud account. Itemized cost breakdowns, spend
              trends, and budget alerts aren't tracked inside this app — view those directly in the GCP Console.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a href={consoleUrl} target="_blank" rel="noreferrer">
              <Button
                variant="outline"
                className="h-10 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40 text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer transition-all"
              >
                <ExternalLink size={14} className="text-emerald-400" /> Open GCP Console
              </Button>
            </a>

            <Button
              onClick={fetchRealGcpMetrics}
              disabled={refreshing}
              variant="outline"
              className="h-10 bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700 text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer transition-all"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin text-indigo-400' : ''} />
              {refreshing ? 'Syncing...' : 'Refresh'}
            </Button>

            <Button
              onClick={handleExportSummary}
              className="h-10 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer shadow-md shadow-indigo-900/40"
            >
              <Download size={14} /> Export Summary
            </Button>
          </div>
        </div>
      </div>

      {/* Connected Account Card — every field here is real (or explicitly "Unavailable") */}
      <Card className="bg-gradient-to-r from-slate-900 via-indigo-950/80 to-slate-900 border-indigo-900/60 shadow-lg text-white rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div
              className={`flex items-center gap-2 text-xs font-mono font-semibold ${billingApiWorking ? 'text-emerald-400' : 'text-slate-400'}`}
            >
              {billingApiWorking && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
              {billingApiWorking ? 'CLOUD BILLING API LIVE' : 'CLOUD BILLING API UNAVAILABLE'}
            </div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="text-indigo-400 h-5 w-5" />
              Account: <span className="text-indigo-300">{gcpApiData?.userAccount || 'Not connected'}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 font-mono pt-1">
              <span>
                Project ID: <strong className="text-white">{gcpApiData?.targetProjectId || 'Unavailable'}</strong>
              </span>
              <span>•</span>
              <span>
                Project Number: <strong className="text-white">{gcpApiData?.projectNumber || 'Unavailable'}</strong>
              </span>
              <span>•</span>
              <span>
                Billing Account:{' '}
                <strong className="text-emerald-300">{gcpApiData?.billingInfo?.billingAccountName || 'Unavailable'}</strong>
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* KPI cards — real fields only */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="bg-white border-slate-200/80 shadow-sm rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Firestore Documents</span>
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Database size={18} />
              </div>
            </div>
            <div className="text-2xl md:text-3xl font-serif font-black text-slate-900">{loading ? '—' : dbStats.totalDocuments}</div>
            <p className="text-[10px] font-medium text-slate-400">
              {dbStats.userCount} users • {dbStats.schoolCount} schools • {dbStats.examCount} exams • {dbStats.resultCount} results
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200/80 shadow-sm rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Billing Status</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <ShieldCheck size={18} />
              </div>
            </div>
            <div className="text-lg font-serif font-black text-slate-900">
              {gcpApiData?.billingInfo?.billingEnabled === true
                ? 'Enabled'
                : gcpApiData?.billingInfo?.billingEnabled === false
                  ? 'Disabled'
                  : 'Unavailable'}
            </div>
            <p className="text-[10px] font-medium text-slate-400">From the real Cloud Billing API response.</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200/80 shadow-sm rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Enabled APIs</span>
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center font-bold">
                <ListChecks size={18} />
              </div>
            </div>
            <div className="text-2xl md:text-3xl font-serif font-black text-slate-900">
              {gcpApiData?.apiStatus?.serviceUsageEnabled ? enabledServices.length : '—'}
            </div>
            <p className="text-[10px] font-medium text-slate-400">
              {gcpApiData?.apiStatus?.serviceUsageEnabled
                ? 'Google Cloud services enabled on this project'
                : 'Service Usage API unavailable'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200/80 shadow-sm rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Resource Manager</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Server size={18} />
              </div>
            </div>
            <div className="text-lg font-serif font-black text-slate-900">
              {gcpApiData?.projectDetails?.lifecycleState || 'Unavailable'}
            </div>
            <p className="text-[10px] font-medium text-slate-400">Project lifecycle state, real Resource Manager API.</p>
          </CardContent>
        </Card>
      </div>

      {/* Enabled services list — real data that was fetched but never shown before */}
      <Card className="bg-white border-slate-200/80 shadow-sm rounded-3xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="text-indigo-600" size={20} />
              Enabled Google Cloud Services
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Live from the Service Usage API — no cost figures are computed here.</p>
          </div>
        </div>

        {!gcpApiData?.apiStatus?.serviceUsageEnabled ? (
          <div className="py-8 text-center text-sm text-slate-400 font-medium">
            Service Usage API isn't reachable right now — try Refresh, or check the GCP Console directly.
          </div>
        ) : enabledServices.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400 font-medium">No enabled services returned.</div>
        ) : (
          <div className="divide-y divide-slate-100 mt-2 max-h-96 overflow-y-auto">
            {enabledServices.map((svc) => (
              <div key={svc.name} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{svc.title || svc.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{svc.name}</p>
                </div>
                <Badge variant="outline" className="text-[9px] py-0 border-emerald-200 text-emerald-700 bg-emerald-50 shrink-0">
                  {svc.state}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Honest pointer to where real cost/budget data actually lives */}
      <Card className="bg-slate-50 border-slate-200 rounded-3xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-slate-400 h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 leading-relaxed max-w-xl">
              Cost breakdowns, spend trends, and budget alerts require the Cloud Billing Budget API, which this app doesn't integrate with.
              For real spend and budget alerting, use the GCP Console's Billing section directly.
            </p>
          </div>
          <a
            href="https://console.cloud.google.com/billing"
            target="_blank"
            rel="noreferrer"
            className="text-xs bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl font-bold transition-all shadow flex items-center gap-1.5 shrink-0"
          >
            Open Billing Console <ExternalLink size={13} />
          </a>
        </div>
      </Card>
    </div>
  );
};
