import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  `    // 2. Query Firestore schools to see if this user is a school admin
    let realSchoolId = '';
    let isRealSchool = false;
    if (emailLower && !emailLower.endsWith('@suvenedu.demo')) {
      try {
        const sRef = clientCollection(clientDb, 'schools');
        const q = clientQuery(sRef, clientWhere('adminEmail', '==', emailLower));
        const snap = await clientGetDocs(q);
        if (!snap.empty) {
          isRealSchool = true;
          realSchoolId = snap.docs[0].id;
        } else {
          // Case-insensitive fallback lookup
          const allSchools = await clientGetDocs(sRef);
          const foundSchool = allSchools.docs.find(doc => {
            const data = doc.data();
            return (data.adminEmail || '').trim().toLowerCase() === emailLower;
          });
          if (foundSchool) {
            isRealSchool = true;
            realSchoolId = foundSchool.id;
          }
        }
      } catch (e) {
        console.error("fetchProfile school verification error in server:", e);
      }
    }`,
  `    // 2. Query Firestore allowed_schools to see if this user is a school admin
    let realSchoolId = '';
    let isRealSchool = false;
    if (emailLower && !emailLower.endsWith('@suvenedu.demo')) {
      try {
        const sRef = clientCollection(clientDb, 'allowed_schools');
        const q = clientQuery(sRef, clientWhere('email', '==', emailLower));
        const snap = await clientGetDocs(q);
        if (!snap.empty) {
          isRealSchool = true;
          realSchoolId = 'school-' + uid;
        }
      } catch (e) {
        console.error("fetchProfile allowed_schools verification error in server:", e);
      }
    }`
);

fs.writeFileSync('server.ts', code);
console.log("Done");
