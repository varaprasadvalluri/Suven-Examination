const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const replacement = `
let __dirname, __filename;
try {
  __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);
} catch (e) {
  __filename = '';
  __dirname = __dirname || process.cwd();
}
`;

content = content.replace(/const __filename = fileURLToPath\(import\.meta\.url\);\nconst __dirname = path\.dirname\(__filename\);/, replacement);
fs.writeFileSync('server.ts', content);
console.log("Patched server.ts");
