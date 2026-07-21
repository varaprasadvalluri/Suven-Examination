import fs from 'fs';
let code = fs.readFileSync('src/components/LoginPage.tsx', 'utf8');

code = code.replace(
  `  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'schools'), (snapshot) => {
      const emailList = snapshot.docs
        .map(doc => doc.data()?.adminEmail)
        .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        .map(e => e.trim().toLowerCase());
      
      const domainsList = snapshot.docs
        .flatMap(doc => {
          const domains = doc.data()?.allowedDomains;
          return Array.isArray(domains) ? domains : [];
        })
        .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
        .map(d => d.trim().toLowerCase());
      
      const fallbackEmails = [
        'school@suvenedu.demo',
        'admin@suvenedu.demo',
        'sweety123@gmail.com',
        'amruthav1301@gmail.com',
        'suveen2619@gmail.com'
      ];
      
      const uniqueEmails = Array.from(new Set([...emailList, ...domainsList, ...fallbackEmails]));
      setOnboardedEmails(uniqueEmails);`,
  `  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'allowed_schools'), (snapshot) => {
      const emailList = snapshot.docs
        .map(doc => doc.data()?.email)
        .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        .map(e => e.trim().toLowerCase());
      
      const uniqueEmails = Array.from(new Set([...emailList]));
      setOnboardedEmails(uniqueEmails);`
);

code = code.replace(
  `        if (!isEmailOnboarded) {
          setErrorMessage("Registration allowed only for onboarded schools. This email is not authorized.");
          setIsLoading(false);
          return;
        }`,
  `        if (!isEmailOnboarded) {
          setErrorMessage("This email address has not been onboarded by the administrator.");
          setIsLoading(false);
          return;
        }`
);

code = code.replace(
  `  const isEmailOnboarded = signUpEmail 
    ? (selectedRole === 'admin' || 
       onboardedEmails.includes(signUpEmail.trim().toLowerCase()) ||
       onboardedEmails.includes(signUpEmail.trim().toLowerCase().split('@')[1] || ''))
    : false;`,
  `  const isEmailOnboarded = signUpEmail 
    ? (selectedRole === 'admin' || 
       onboardedEmails.includes(signUpEmail.trim().toLowerCase()))
    : false;`
);

fs.writeFileSync('src/components/LoginPage.tsx', code);
console.log("Done");
