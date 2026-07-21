const fs = require('fs');
let code = fs.readFileSync('src/components/AdminSchoolManagement.tsx', 'utf8');

const target = `      {/* Search and view toggle */}`;

const replacement = `      {/* Visual Health Status Summary */}
      <div className="bg-white border border-slate-200/60 rounded-[20px] p-6 lg:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              Network Health & Access Status
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1">Real-time overview of institutional node configurations.</p>
          </div>
          <div className="text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
            {schools.length} Total Nodes
          </div>
        </div>
        
        <div className="flex gap-1 h-3.5 rounded-full overflow-hidden mb-6 bg-slate-100/50 shadow-inner">
          <div className="bg-emerald-500 transition-all duration-1000" style={{ width: \`\${(schools.filter(s => s.status === 'active' && s.allowedDomains?.length > 0).length / (schools.length || 1)) * 100}%\` }} title="Fully Active" />
          <div className="bg-amber-400 transition-all duration-1000" style={{ width: \`\${(schools.filter(s => s.status === 'active' && (!s.allowedDomains || s.allowedDomains.length === 0)).length / (schools.length || 1)) * 100}%\` }} title="Pending Domain" />
          <div className="bg-rose-400 transition-all duration-1000" style={{ width: \`\${(schools.filter(s => s.status === 'inactive').length / (schools.length || 1)) * 100}%\` }} title="Inactive" />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="flex flex-col gap-1.5 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-emerald-50/50 hover:border-emerald-100 transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> Fully Provisioned
            </div>
            <span className="text-3xl font-black text-slate-900 font-sans">{schools.filter(s => s.status === 'active' && s.allowedDomains?.length > 0).length}</span>
            <span className="text-[10px] text-slate-400 font-medium">Verified domains & email configured</span>
          </div>
          <div className="flex flex-col gap-1.5 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-amber-50/50 hover:border-amber-100 transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" /> Domain Unverified
            </div>
            <span className="text-3xl font-black text-slate-900 font-sans">{schools.filter(s => s.status === 'active' && (!s.allowedDomains || s.allowedDomains.length === 0)).length}</span>
            <span className="text-[10px] text-slate-400 font-medium">Missing domain whitelisting</span>
          </div>
          <div className="flex flex-col gap-1.5 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-rose-50/50 hover:border-rose-100 transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.5)]" /> Action Required
            </div>
            <span className="text-3xl font-black text-slate-900 font-sans">{schools.filter(s => s.status === 'inactive').length}</span>
            <span className="text-[10px] text-slate-400 font-medium">Node suspended or inactive</span>
          </div>
        </div>
      </div>

      {/* Search and view toggle */}`;

code = code.replace(target, replacement);
fs.writeFileSync('src/components/AdminSchoolManagement.tsx', code);
console.log("Updated!");
