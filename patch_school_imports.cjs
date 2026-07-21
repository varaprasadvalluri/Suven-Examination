const fs = require('fs');
let content = fs.readFileSync('src/components/SchoolDashboard.tsx', 'utf8');
content = content.replace(/UserCheck2\nLoader2/g, "UserCheck2,\nLoader2");
content = content.replace(/Inbox, UserCheck2\r?\nLoader2 }/g, "Inbox, UserCheck2, Loader2 }");
fs.writeFileSync('src/components/SchoolDashboard.tsx', content);
