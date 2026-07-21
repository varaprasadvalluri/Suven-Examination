import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

const targetIndex = code.indexOf("if (role === 'school') {");
const catchIndex = code.indexOf("} catch (err) {", targetIndex);

if (targetIndex !== -1 && catchIndex !== -1) {
  const before = code.substring(0, targetIndex);
  const after = code.substring(catchIndex);
  const newBlock = `if (role === 'school') {
    let isAuthorized = false;
    try {
      const sRef = clientCollection(clientDb, 'allowed_schools');
      const q = clientQuery(sRef, clientWhere('email', '==', emailLower));
      const snap = await clientGetDocs(q);
      
      if (!snap.empty) {
        isAuthorized = true;
        validSchoolId = 'school-' + uid;
      }
      
      if (!isAuthorized) {
        return res.status(403).json({ error: 'This email address has not been onboarded by the administrator.' });
      }
    `;
  fs.writeFileSync('server.ts', before + newBlock + after);
  console.log("Replaced block");
}
