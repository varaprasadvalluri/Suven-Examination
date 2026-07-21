const fs = require('fs');
let content = fs.readFileSync('src/components/SchoolDashboard.tsx', 'utf8');

const loadingBlock = `  if (loading) return (
     <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
       <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
       <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest text-sm">Synchronizing Intelligence Base...</p>
     </div>
  );`;

// Find existing if (loading) and replace it
content = content.replace(/if \(loading\) \{[\s\S]*?return \([\s\S]*?<\/div>\s*\);\s*\}/, loadingBlock);

fs.writeFileSync('src/components/SchoolDashboard.tsx', content);
console.log("Patched SchoolDashboard loading");
