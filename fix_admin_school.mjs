import fs from 'fs';
let code = fs.readFileSync('src/components/AdminSchoolManagement.tsx', 'utf8');

const handlePreRegisterCode = `
  const handlePreRegister = async () => {
    if (!preRegisterEmail || preRegisterEmail.trim().length === 0) {
      toast.error("Please enter an email address");
      return;
    }
    
    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!emailRegex.test(preRegisterEmail.trim())) {
      toast.error("Validation failed: Email is not of a valid format");
      return;
    }
    
    try {
      await addDoc(collection(db, 'allowed_schools'), {
        email: preRegisterEmail.trim().toLowerCase(),
        createdAt: new Date().toISOString(),
        status: 'active'
      });
      toast.success("Email successfully pre-registered");
      setIsPreRegisterOpen(false);
      setPreRegisterEmail('');
    } catch (error) {
      console.error("Error pre-registering email:", error);
      toast.error("Failed to pre-register email");
    }
  };
`;

// Insert the function before handleCreateSchool
code = code.replace('  const handleCreateSchool = async () => {', handlePreRegisterCode + '\n  const handleCreateSchool = async () => {');

// Fix syntax error in Sheet
code = code.replace(`            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger render={
                <></>
              } />
            } />`, `            `);

// Replace UserPlus if it's missing (it might be missing from lucide-react imports)
if (!code.includes('UserPlus')) {
  code = code.replace('import { Plus,', 'import { Plus, UserPlus,');
}

fs.writeFileSync('src/components/AdminSchoolManagement.tsx', code);
console.log("Done");
