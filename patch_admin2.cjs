const fs = require('fs');
let content = fs.readFileSync('src/components/AdminOverview.tsx', 'utf8');

const loadingBlock = `  if (loading) return (
     <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
       <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
       <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest text-sm">Synchronizing Intelligence Base...</p>
     </div>
  );`;

content = content.replace(/if \(loading\) return \(\s*<div.*?<\/div>\s*\);/s, loadingBlock);
fs.writeFileSync('src/components/AdminOverview.tsx', content);
console.log("Patched loading state in AdminOverview");
