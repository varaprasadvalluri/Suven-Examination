import fs from 'fs';
let code = fs.readFileSync('src/components/AdminSchoolManagement.tsx', 'utf8');

const targetImports = `import { School, AuthPolicy } from '../types';`;
const replacementImports = `import { School, AuthPolicy } from '../types';
import { UserPlus } from 'lucide-react';`;
code = code.replace(targetImports, replacementImports);

const targetState = `  const [isSheetOpen, setIsSheetOpen] = useState(false);`;
const replacementState = `  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isPreRegisterOpen, setIsPreRegisterOpen] = useState(false);
  const [preRegisterEmail, setPreRegisterEmail] = useState('');`;
code = code.replace(targetState, replacementState);

const targetFunctions = `  const handleOnboardSchool = async () => {`;
const replacementFunctions = `  const handlePreRegister = async () => {
    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!emailRegex.test(preRegisterEmail.trim())) {
      toast.error("Validation failed: Administrator email is not of a valid format");
      return;
    }
    try {
      await addDoc(collection(db, 'allowed_schools'), {
        email: preRegisterEmail.trim().toLowerCase(),
        createdAt: new Date().toISOString()
      });
      toast.success("School email pre-registered successfully");
      setIsPreRegisterOpen(false);
      setPreRegisterEmail('');
    } catch (error) {
      toast.error("Failed to pre-register school email");
    }
  };

  const handleOnboardSchool = async () => {`;
code = code.replace(targetFunctions, replacementFunctions);

const targetButtons = `<Button className="bg-slate-900 hover:bg-black text-white h-11 px-6 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all text-xs cursor-pointer">
                <Plus className="h-4 w-4" /> 
                Register School
              </Button>`;
const replacementButtons = `<Button className="bg-slate-900 hover:bg-black text-white h-11 px-6 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all text-xs cursor-pointer">
                <Plus className="h-4 w-4" /> 
                Register School
              </Button>
            } />
            <Dialog open={isPreRegisterOpen} onOpenChange={setIsPreRegisterOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="h-11 px-6 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all text-xs cursor-pointer ml-2">
                  <UserPlus className="h-4 w-4" /> 
                  Pre-Register Email
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Pre-Register School Email</DialogTitle>
                  <DialogDescription>
                    Allow a school administrator to sign up by pre-registering their email address.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input
                      id="email"
                      value={preRegisterEmail}
                      onChange={(e) => setPreRegisterEmail(e.target.value)}
                      placeholder="admin@school.edu"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handlePreRegister}>Pre-Register</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger render={
                <></>
              } />`;
code = code.replace(targetButtons, replacementButtons);

// Wait, the button replacement might be tricky if the sheet trigger uses render prop.
fs.writeFileSync('src/components/AdminSchoolManagement.tsx', code);
