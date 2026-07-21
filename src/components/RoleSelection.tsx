import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { db, collection, getDocs, query, orderBy, doc, updateDoc } from '../lib/firebase';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ShieldCheck, User as UserIcon, Building2, Search, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { School } from '../types';
import { toast } from 'sonner';

export const RoleSelection: React.FC = () => {
  const { profile, user, refreshProfile } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'school' | 'student' | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    // If admin role is already assigned in their profile, auto-select it
    if (profile?.role === 'admin' && !selectedRole) {
      setSelectedRole('admin');
    }
  }, [profile, selectedRole]);

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const schoolsRef = collection(db, 'schools');
        const q = query(schoolsRef, orderBy('name'));
        const querySnapshot = await getDocs(q);
        const fetchedSchools = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as School));
        setSchools(fetchedSchools);
      } catch (error) {
        console.error("Error fetching schools:", error);
      }
    };
    fetchSchools();
  }, []);

  const handleRoleFinalize = async () => {
    if (profile && selectedRole) {
      if ((selectedRole === 'student' || selectedRole === 'school') && !selectedSchool) {
        return;
      }

      setIsUpdating(true);
      try {
        // Security Check: Is the school active?
        const school = schools.find(s => s.id === selectedSchool);
        if (selectedRole !== 'admin' && school?.status === 'inactive') {
          toast.error("This institution node is currently dormant. Contact regional admin.");
          setIsUpdating(false);
          return;
        }

        // Security Check: Domain validation
        if (selectedRole !== 'admin' && school?.allowedDomains && school.allowedDomains.length > 0) {
          const userEmail = user?.email?.toLowerCase() || '';
          const userDomain = userEmail.split('@')[1];
          if (!school.allowedDomains.includes(userDomain)) {
            toast.error(`Authorization Failed: Your domain (@${userDomain}) is not provisioned for access to ${school.name}.`);
            setIsUpdating(false);
            return;
          }
        }

        let permissions: string[] = [];
        
        if (selectedRole === 'admin') permissions = ['manage_exams', 'view_results'];
        else if (selectedRole === 'school') permissions = ['manage_exams', 'view_results', 'manage_students'];
        else permissions = ['take_exams'];
          
        const userRef = doc(db, 'users', profile.uid);
        await updateDoc(userRef, { 
          role: selectedRole, 
          permissions, 
          schoolId: selectedSchool || null 
        });

        toast.success("Security profile established.");
        await refreshProfile();
      } catch (err) {
        console.error("Profile update failed:", err);
        toast.error("An unexpected error occurred during profile setup.");
      } finally {
        setIsUpdating(false);
      }
    }
  };

  useEffect(() => {
    if (selectedRole === 'admin' && profile && profile.role !== 'admin') {
      handleRoleFinalize();
    }
  }, [selectedRole, profile]);

  if (selectedRole) {
    if (selectedRole === 'admin') {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
          <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Finalizing admin access...</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-20 animate-in slide-in-from-bottom duration-700">
        <Card className="w-full max-w-md p-8 border-slate-200 shadow-2xl rounded-3xl">
           <div className="text-center mb-8">
              <div className="h-16 w-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Building2 className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-display font-black text-slate-900 tracking-tight">Select Institution</h2>
              <p className="text-slate-500 text-sm mt-1">Associate your account with a registered school center.</p>
           </div>

           <div className="space-y-6">
              <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Institutional Branch</label>
                 <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                    <SelectTrigger className="h-12 bg-white border-2 border-slate-300 rounded-xl font-bold text-sm text-slate-900 px-4 justify-between shadow-sm hover:border-indigo-500 transition-all">
                       <SelectValue placeholder="Browse and Select School" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-2 border-slate-300 shadow-2xl rounded-2xl p-1.5 z-50">
                       {schools.map(s => (
                         <SelectItem key={s.id} value={s.id} className="font-bold text-xs text-slate-800 hover:bg-slate-50 cursor-pointer py-1.5 px-3 rounded-lg">{s.name}</SelectItem>
                       ))}
                    </SelectContent>
                 </Select>
              </div>

              <Button 
                disabled={!selectedSchool || isUpdating} 
                className="w-full h-12 bg-indigo-600 hover:bg-slate-900 font-bold rounded-xl shadow-lg shadow-indigo-100 transition-all border-none"
                onClick={handleRoleFinalize}
              >
                {isUpdating ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enter Portal Workspace"}
              </Button>
              <Button variant="ghost" className="w-full h-12 text-slate-400 font-bold" onClick={() => setSelectedRole(null)}>
                Change Role Type
              </Button>
           </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 animate-in fade-in zoom-in duration-500">
      <div className="text-center mb-12">
        <h2 className="text-4xl font-display font-bold text-slate-900 tracking-tighter">Workspace Allocation</h2>
        <p className="text-slate-500 mt-2 text-lg font-medium opacity-70">Choose your system permissions profile to proceed.</p>
      </div>

      <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
        <Card className="hover:border-indigo-600 hover:shadow-2xl hover:-translate-y-2 cursor-pointer transition-all duration-300 group border-2 border-slate-100 rounded-3xl overflow-hidden" onClick={() => setSelectedRole('admin')}>
          <CardHeader className="text-center py-12">
            <div className="mx-auto bg-slate-50 w-24 h-24 rounded-3xl flex items-center justify-center mb-8 border border-slate-100 group-hover:bg-indigo-600 transition-all duration-300 shadow-inner group-hover:shadow-indigo-200">
              <ShieldCheck className="h-12 w-12 text-slate-300 group-hover:text-white transition-colors duration-300" />
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-widest text-[14px]">System Admin</CardTitle>
            <CardDescription className="text-slate-500 mt-4 text-xs font-semibold leading-relaxed px-6 opacity-60">
              Root access for system-wide infrastructure management and multi-school oversight.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="hover:border-indigo-600 hover:shadow-2xl hover:-translate-y-2 cursor-pointer transition-all duration-300 group border-2 border-slate-100 rounded-3xl overflow-hidden" onClick={() => setSelectedRole('school')}>
          <CardHeader className="text-center py-12">
            <div className="mx-auto bg-slate-50 w-24 h-24 rounded-3xl flex items-center justify-center mb-8 border border-slate-100 group-hover:bg-indigo-600 transition-all duration-300 shadow-inner group-hover:shadow-indigo-200">
              <Building2 className="h-12 w-12 text-slate-300 group-hover:text-white transition-colors duration-300" />
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-widest text-[14px]">Institutional Branch</CardTitle>
            <CardDescription className="text-slate-500 mt-4 text-xs font-semibold leading-relaxed px-6 opacity-60">
              School-level management tools for local student onboarding and exam administration.
            </CardDescription>
          </CardHeader>
        </Card>
        
        <Card className="hover:border-indigo-600 hover:shadow-2xl hover:-translate-y-2 cursor-pointer transition-all duration-300 group border-2 border-slate-100 rounded-3xl overflow-hidden" onClick={() => setSelectedRole('student')}>
          <CardHeader className="text-center py-12">
            <div className="mx-auto bg-slate-50 w-24 h-24 rounded-3xl flex items-center justify-center mb-8 border border-slate-100 group-hover:bg-indigo-600 transition-all duration-300 shadow-inner group-hover:shadow-indigo-200">
              <UserIcon className="h-12 w-12 text-slate-300 group-hover:text-white transition-colors duration-300" />
            </div>
            <CardTitle className="text-2xl font-display font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-widest text-[14px]">Academic Student</CardTitle>
            <CardDescription className="text-slate-500 mt-4 text-xs font-semibold leading-relaxed px-6 opacity-60">
              Standard student profile for attempting exams and reviewing academic performance metrics.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
};
