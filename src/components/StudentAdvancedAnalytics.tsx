import React, { useMemo } from 'react';
import { 
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, 
  ResponsiveContainer, Cell, ReferenceLine, 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend,
  CartesianGrid
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Target, Zap, TrendingUp, Trophy, ArrowUpRight, Scale, ShieldCheck } from 'lucide-react';
import { Attempt } from '../types';

interface AdvancedAnalyticsProps {
  attempts: Attempt[];
}

export const StudentAdvancedAnalytics: React.FC<AdvancedAnalyticsProps> = ({ attempts }) => {
  // Logic for Speed vs Accuracy Scatter Plot
  const scatterData = useMemo(() => {
    if (!attempts || attempts.length === 0) {
      return [
        { name: 'Warmup Run', accuracy: 90, avgTime: 18, score: 360 },
        { name: 'Science Explorer', accuracy: 85, avgTime: 22, score: 340 }
      ];
    }
    return attempts.map(a => ({
      name: a.examTitle || 'Exam',
      accuracy: a.accuracy || (a.score / (a.answers.length * 4)) * 100, // Normalized logic
      avgTime: a.avgTimePerCorrect || 18,
      score: a.score
    }));
  }, [attempts]);

  // Children-friendly Benchmark data Comparison
  const benchmarkData = [
    { accuracy: 95, avgTime: 15 },
    { accuracy: 92, avgTime: 18 },
    { accuracy: 88, avgTime: 20 },
    { accuracy: 98, avgTime: 12 },
  ];

  // Subject-wise performance radar metrics
  const subjectPerformance = [
    { subject: 'Physics 🌌', student: 85, percentile: 92 },
    { subject: 'Chemistry 🧪', student: 78, percentile: 85 },
    { subject: 'Mathematics 📐', student: 92, percentile: 98 },
    { subject: 'Biology 🌿', student: 70, percentile: 72 },
  ];

  return (
    <div className="space-y-11 animate-in fade-in duration-500">
      
      {/* Analytics Dashboard Header Block */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <Badge className="bg-indigo-50 border-2 border-indigo-250 text-indigo-700 px-3.5 py-1 font-black text-xs uppercase mb-3 select-none">
             Performance Intelligence
          </Badge>
          <h2 className="text-3xl md:text-4xl font-black text-indigo-950 tracking-tight uppercase leading-none font-display">
             Ranker's Analysis 📊
          </h2>
          <p className="text-sm font-semibold text-slate-600 mt-2.5 max-w-2xl leading-relaxed">
             Unlock insights about your learning speed, category percentiles, and compare results with top global explorers!
          </p>
        </div>
      </div>

      {/* 2-Column Bento grid containing Speed vs Accuracy and Institutional Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-11">
        
        {/* Speed vs Accuracy Scatter Plot */}
        <Card className="bg-gradient-to-br from-[#13162C] to-[#121326] border border-[#20254C] rounded-[32px] shadow-2xl relative overflow-hidden flex flex-col group min-w-[280px] w-full">
          <CardHeader className="p-8 pb-0">
             <div className="flex items-center gap-4 mb-2">
                <div className="h-11 w-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-300 group-hover:scale-105 transition-transform shrink-0">
                  <TrendingUp className="h-6 w-6" /> {/* Locked Icon at 24x24 px */}
                </div>
                <CardTitle className="font-display font-black text-2xl uppercase tracking-tight text-white leading-none">
                   Speed vs. Accuracy ⚡
                </CardTitle>
             </div>
             <CardDescription className="text-xs font-semibold text-slate-400 leading-relaxed pl-15 mt-1">
                See the magic balance between your quick decisions and correct answers.
             </CardDescription>
          </CardHeader>
          
          <CardContent className="p-8 pb-4 h-[380px]">
             <ResponsiveContainer width="100%" height="100%">
               <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1E2342" />
                 <XAxis 
                   type="number" 
                   dataKey="avgTime" 
                   name="Seconds per Item" 
                   unit="s" 
                   label={{ value: 'Response Time (s)', position: 'bottom', offset: 0, className: 'text-[10px] uppercase font-black tracking-widest fill-slate-400' }}
                   stroke="#2F365F"
                   tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }}
                 />
                 <YAxis 
                   type="number" 
                   dataKey="accuracy" 
                   name="Accuracy" 
                   unit="%" 
                   label={{ value: 'Accuracy (%)', angle: -90, position: 'insideLeft', className: 'text-[10px] uppercase font-black tracking-widest fill-slate-400' }}
                   stroke="#2F365F"
                   tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }}
                   domain={[0, 100]}
                 />
                 <ZAxis type="number" dataKey="score" range={[60, 400]} />
                 <Tooltip 
                   cursor={{ strokeDasharray: '3 3' }} 
                   contentStyle={{ backgroundColor: '#0F1121', borderRadius: '20px', border: '2px solid #20254C', color: '#fff', padding: '16px' }}
                 />
                 <Legend verticalAlign="top" height={36}/>
                 
                 {/* Benchmark Zone indicators */}
                 <ReferenceLine x={20} stroke="#FF5A6A" strokeDasharray="3 3" strokeWidth={1.5} />
                 <ReferenceLine y={85} stroke="#10b981" strokeDasharray="3 3" strokeWidth={1.5} />

                 <Scatter name="Top 10% Benchmark" data={benchmarkData} fill="#334155" />
                 <Scatter name="Your Attempts" data={scatterData} fill="#6366f1">
                    {scatterData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.accuracy > 85 ? '#10b981' : '#6366f1'} />
                    ))}
                 </Scatter>
               </ScatterChart>
             </ResponsiveContainer>
          </CardContent>
          
          <div className="bg-[#121429] p-6.5 flex items-center justify-between border-t border-[#1E2342] mt-auto">
             <div>
                <p className="text-[10px] font-black text-rose-450 uppercase tracking-widest leading-none">Optimal Target Zone 🎯</p>
                <p className="text-sm font-black text-slate-100 mt-2">Accuracy: &gt;85% | Speed: &lt;20s per question</p>
             </div>
             <ArrowUpRight className="text-slate-500 h-6 w-6 shrink-0" />
          </div>
        </Card>

        {/* Subject-wise Real-time Percentile */}
        <Card className="bg-gradient-to-br from-[#13162C] to-[#121326] border border-[#20254C] rounded-[32px] shadow-2xl relative overflow-hidden flex flex-col group min-w-[280px] w-full">
          <CardHeader className="p-8 pb-0">
             <div className="flex items-center gap-4 mb-2">
                <div className="h-11 w-11 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-300 group-hover:scale-105 transition-transform shrink-0">
                  <Trophy className="h-6 w-6" /> {/* Locked Icon at 24x24 px */}
                </div>
                <CardTitle className="font-display font-black text-2xl uppercase tracking-tight text-white leading-none">
                   Academy Leaderboard 🏆
                </CardTitle>
             </div>
             <CardDescription className="text-xs font-semibold text-slate-400 leading-relaxed pl-15 mt-1">
                Verify how your score stands against other outstanding branch scholars.
             </CardDescription>
          </CardHeader>
          
          <CardContent className="p-8 pb-4 h-[380px]">
             <ResponsiveContainer width="100%" height="100%">
               <RadarChart cx="50%" cy="50%" outerRadius="75%" data={subjectPerformance}>
                 <PolarGrid stroke="#232959" />
                 <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fontWeight: 800, fill: '#94a3b8' }} />
                 <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#232959" tick={{ fontSize: 9, fill: '#64748b' }} />
                 <Radar
                   name="National Percentile"
                   dataKey="percentile"
                   stroke="#f59e0b"
                   strokeWidth={3.5}
                   fill="#f59e0b"
                   fillOpacity={0.25}
                 />
                 <Radar
                   name="Explorer Raw Index"
                   dataKey="student"
                   stroke="#6366f1"
                   strokeWidth={3}
                   fill="#6366f1"
                   fillOpacity={0.15}
                 />
                 <Tooltip contentStyle={{ backgroundColor: '#0F1121', borderRadius: '20px', border: '2px solid #20254C', color: '#fff' }} />
                 <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', fill: '#fff' }} />
               </RadarChart>
             </ResponsiveContainer>
          </CardContent>
          
          <div className="bg-[#1C1723]/65 p-6.5 border-t border-[#20254C] mt-auto flex items-center justify-between">
             <div className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-full bg-[#181525] border border-orange-500/20 flex items-center justify-center text-orange-400 shadow-sm shrink-0">
                   <Zap className="h-6 w-6 animate-pulse" /> {/* Locked Icon at 24x24 px */}
                </div>
                <div>
                   <p className="text-[10px] font-black text-orange-450 uppercase tracking-widest leading-none">Predicted Rank</p>
                   <p className="text-sm font-black text-white mt-1.5 uppercase tracking-tight">#4 top of branch (Top 2% Overall)</p>
                </div>
             </div>
             <Badge className="bg-emerald-500 border-none text-white font-extrabold text-[10px] px-3.5 py-1 shadow-lg shadow-emerald-500/20">
                ⭐ RISING EXPLORER
             </Badge>
          </div>
        </Card>

        {/* Cognitive Heuristics & Proctoring Stats (Integrity Metric) */}
        <Card className="bg-gradient-to-br from-[#13162C] to-[#121326] border border-[#20254C] rounded-[32px] shadow-2xl relative overflow-hidden lg:col-span-2 min-w-[280px] w-full">
           <CardHeader className="p-8">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                   <div className="flex items-center gap-4 mb-2">
                      <div className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                        <Scale className="h-6 w-6" /> {/* Locked Icon at 24x24 px */}
                      </div>
                      <CardTitle className="font-display font-black text-2xl uppercase tracking-tight text-white leading-none">
                         Focus & Security Shield Status
                      </CardTitle>
                   </div>
                   <CardDescription className="text-xs font-semibold text-slate-400 pl-15 mt-1">
                      Integrity tracking summary captured securely by AI proctors during testing.
                   </CardDescription>
                </div>
                
                <div className="text-right">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Integrity Index</p>
                   <p className="text-3xl font-black text-emerald-400 mt-1 uppercase tracking-tight font-display">98.4</p>
                </div>
              </div>
           </CardHeader>
           
           <CardContent className="px-8 pb-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                 {[
                   { label: 'Avg Eye Compliance', value: '94%', sub: 'Focus Consistency', color: 'bg-indigo-500', emote: '👁️' },
                   { label: 'Tab Persistence', value: '100%', sub: 'Zero Window Blurs', color: 'bg-emerald-400', emote: '🛡️' },
                   { label: 'Identity Verification', value: 'Verified', sub: 'Single User Presence', color: 'bg-orange-500', emote: '👤' },
                   { label: 'Violation Events', value: 'Level 0', sub: 'Behavioral Stability', color: 'bg-emerald-500', emote: '✅' }
                 ].map((stat, i) => (
                   <div key={i} className="p-6 bg-[#121429] rounded-[24px] border border-[#1E2342] flex flex-col items-center text-center group hover:bg-[#151730] hover:border-[#2C3362] transition-all duration-300">
                      <span className="text-xl mb-3 select-none filter drop-shadow">{stat.emote}</span>
                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-wider mb-2.5 leading-none">{stat.label}</p>
                      <p className="text-2xl font-black text-white mb-1.5 uppercase tracking-tight leading-none">{stat.value}</p>
                      <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide leading-none mb-4">{stat.sub}</p>
                      
                      <div className="w-full h-1.5 bg-slate-950/60 rounded-full overflow-hidden">
                        <div className={`h-full ${stat.color}`} style={{ width: '100%' }} />
                      </div>
                   </div>
                 ))}
              </div>
           </CardContent>
        </Card>

      </div>
    </div>
  );
};
