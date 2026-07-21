const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `      const sRef = clientCollection(clientDb, 'schools');
      // 1. Try exact match
      const q = clientQuery(sRef, clientWhere('adminEmail', '==', emailLower));
      const snap = await clientGetDocs(q);
      
      if (!snap.empty) {
        isAuthorized = true;
        validSchoolId = snap.docs[0].id;
      } else {
        // 2. Domain and case-insensitive check
        const allSchools = await clientGetDocs(sRef);
        const emailDomain = emailLower.split('@')[1];
        
        const foundSchool = allSchools.docs.find(doc => {
          const data = doc.data();
          if (!data) return false;
          
          const isEmailMatch = (data.adminEmail || '').trim().toLowerCase() === emailLower;
          const isDomainMatch = emailDomain && Array.isArray(data.allowedDomains) && 
             data.allowedDomains.map((d: string) => d.trim().toLowerCase()).includes(emailDomain);
            
          return isEmailMatch || isDomainMatch;
        });
        
        if (foundSchool) {
          isAuthorized = true;
          validSchoolId = foundSchool.id;
        } else {
          // Fallback demo accounts
          const fallbackEmails = [
            'school@suvenedu.demo',
            'admin@suvenedu.demo',
            'sweety123@gmail.com',
            'amruthav1301@gmail.com',
            'suveen2619@gmail.com'
          ];
          if (fallbackEmails.includes(emailLower)) {
            isAuthorized = true;
            validSchoolId = 'school-fallback-id';
          }
        }
      }
      
      if (!isAuthorized) {
        return res.status(403).json({ error: 'Registration allowed only for onboarded schools. This email is not authorized.' });
      }`;

const replacement = `      const allowedRef = clientCollection(clientDb, 'allowed_schools');
      const allowedQ = clientQuery(allowedRef, clientWhere('email', '==', emailLower));
      const allowedSnap = await clientGetDocs(allowedQ);
      if (!allowedSnap.empty) {
        isAuthorized = true;
      }
      
      const sRef = clientCollection(clientDb, 'schools');
      const q = clientQuery(sRef, clientWhere('adminEmail', '==', emailLower));
      const snap = await clientGetDocs(q);
      if (!snap.empty) {
        validSchoolId = snap.docs[0].id;
      }

      // Fallback demo accounts
      const fallbackEmails = [
        'school@suvenedu.demo',
        'admin@suvenedu.demo',
        'sweety123@gmail.com',
        'amruthav1301@gmail.com',
        'suveen2619@gmail.com'
      ];
      if (fallbackEmails.includes(emailLower)) {
        isAuthorized = true;
        validSchoolId = 'school-fallback-id';
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: 'This email address has not been onboarded by the administrator.' });
      }`;

code = code.replace(target, replacement);
fs.writeFileSync('server.ts', code);
