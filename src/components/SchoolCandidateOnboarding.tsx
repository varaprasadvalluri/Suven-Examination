import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, setDoc, doc, collection, getDocs, query, where } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from './ui/select';
import { 
  UserPlus, 
  User, 
  Inbox, 
  Calendar, 
  Building2, 
  Sparkles, 
  CheckCircle2, 
  ArrowLeft, 
  Copy, 
  GraduationCap,
  ShieldCheck,
  Check
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';

const ACADEMIC_LEVELS = [
  "Play Class",
  "LKG",
  "UKG",
  "1st Grade",
  "2nd Grade",
  "3rd Grade",
  "4th Grade",
  "5th Grade",
  "6th Grade",
  "7th Grade",
  "8th Grade",
  "9th Grade",
  "10th Grade",
  "Intermediate 1st Year",
  "Intermediate 2nd Year"
];

interface SchoolCandidateOnboardingProps {
  onBack?: () => void;
}

export const SchoolCandidateOnboarding: React.FC<SchoolCandidateOnboardingProps> = ({ onBack }) => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [isSubmittingCandidate, setIsSubmittingCandidate] = useState(false);
  const [createdStudentData, setCreatedStudentData] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [schoolName, setSchoolName] = useState('Active Academic Center');

  const [manualStudent, setManualStudent] = useState({
    name: '',
    email: '',
    class: '10th Grade',
    section: 'A',
    rollNumber: `REG-${Math.floor(10000 + Math.random() * 90000)}`,
    dob: ''
  });

  // Fetch school details
  useEffect(() => {
    if (!profile?.schoolId) return;
    const fetchSchoolInfo = async () => {
      try {
        const q = query(collection(db, 'schools'), where('id', '==', profile.schoolId));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const data = snap.docs[0].data();
          if (data.name) setSchoolName(data.name);
        }
      } catch (err) {
        console.error("Error fetching school name:", err);
      }
    };
    fetchSchoolInfo();
  }, [profile?.schoolId]);

  const handleAutoGenerateRoll = () => {
    const newRoll = `REG-${Math.floor(10000 + Math.random() * 90000)}`;
    setManualStudent(prev => ({ ...prev, rollNumber: newRoll }));
    toast.info(`Generated new register code: ${newRoll}`);
  };

  const handleBackToRoster = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  const handleSubmitCandidate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile?.schoolId) {
      toast.error("School context missing. Please log in again.");
      return;
    }

    if (!manualStudent.name.trim()) {
      toast.error("Validation failed: Candidate name field is required");
      return;
    }

    if (manualStudent.name.trim().length < 3) {
      toast.error("Validation failed: Candidate name must contain at least 3 letters");
      return;
    }

    const trimmedEmail = manualStudent.email ? manualStudent.email.trim().toLowerCase() : '';
    if (trimmedEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        toast.error("Validation failed: Invalid email format (e.g. child@school.com)");
        return;
      }
    }

    setIsSubmittingCandidate(true);

    try {
      const finalRoll = manualStudent.rollNumber.trim() || `REG-${Math.floor(10000 + Math.random() * 90000)}`;
      const uid = `std_${profile.schoolId}_${finalRoll.replace(/\s+/g, '_').toLowerCase()}`;

      const candidatePayload = {
        name: manualStudent.name.trim(),
        email: trimmedEmail,
        uid: uid,
        role: 'student',
        schoolId: profile.schoolId,
        class: manualStudent.class || '10th Grade',
        section: (manualStudent.section || 'A').toUpperCase(),
        rollNumber: finalRoll,
        dob: manualStudent.dob || '',
        permissions: ['take_exams'],
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'users', uid), candidatePayload);

      toast.success(`Candidate "${candidatePayload.name}" onboarded successfully!`);
      setCreatedStudentData(candidatePayload);
      setManualStudent({
        name: '',
        email: '',
        class: '10th Grade',
        section: 'A',
        rollNumber: `REG-${Math.floor(10000 + Math.random() * 90000)}`,
        dob: ''
      });
    } catch (error) {
      console.error("Failed to onboard student:", error);
      toast.error("Failed to register candidate. Please check database permissions.");
    } finally {
      setIsSubmittingCandidate(false);
    }
  };

  const handleCopySummary = () => {
    if (!createdStudentData) return;
    const text = `Candidate Onboarding Pass\n------------------------\nName: ${createdStudentData.name}\nRegister No: ${createdStudentData.rollNumber}\nGrade: ${createdStudentData.class} - Sec ${createdStudentData.section}\nEmail: ${createdStudentData.email || 'N/A'}\nSchool: ${schoolName}\nUID: ${createdStudentData.uid}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Candidate record summary copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans -m-4 md:-m-6 lg:-m-10 p-4 md:p-8 lg:p-12 selection:bg-indigo-500 selection:text-white">
      {/* Top Header Bar */}
      <div className="max-w-5xl mx-auto w-full flex items-center justify-between pb-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={handleBackToRoster}
            className="h-10 px-4 bg-white border-slate-200 hover:bg-slate-100 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <ArrowLeft size={16} />
            Back to Candidate Roster
          </Button>
          <div className="hidden sm:block h-5 w-[1px] bg-slate-200" />
          <span className="text-xs font-bold text-slate-500">Candidate Onboarding Engine</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 px-3 py-1 rounded-full text-[11px] font-mono">
            Direct Firestore Node
          </Badge>
        </div>
      </div>

      {/* Main Body Grid */}
      <div className="max-w-5xl mx-auto w-full flex-1 pt-8">
        {!createdStudentData ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Form Column (7 Cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6">
              <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-serif font-black text-slate-900 tracking-tight flex items-center gap-2.5">
                  <UserPlus className="text-indigo-600" size={28} />
                  Register Candidate
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  Load academic credentials to provision candidate records and issue assessment invitations instantly.
                </p>
              </div>

              <form onSubmit={handleSubmitCandidate} className="space-y-6 pt-2">
                
                {/* Step 1: Candidate Identity */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black">1</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Candidate Identity</h3>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">
                        Candidate Full Name <span className="text-rose-500">*</span>
                      </Label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 pointer-events-none" />
                        <Input
                          value={manualStudent.name}
                          onChange={(e) => setManualStudent({ ...manualStudent, name: e.target.value })}
                          placeholder="e.g. Alexander Pierce"
                          required
                          className="h-11 pl-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-sm font-medium focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Official name used for certification and exam loggers.</p>
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">
                        Secure Email Address (Optional)
                      </Label>
                      <div className="relative">
                        <Inbox className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 pointer-events-none" />
                        <Input
                          type="email"
                          value={manualStudent.email}
                          onChange={(e) => setManualStudent({ ...manualStudent, email: e.target.value })}
                          placeholder="e.g. alexander@school.com"
                          className="h-11 pl-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs font-medium focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Direct assessment link notifications will be dispatched here.</p>
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">
                        Date of Birth (DOB)
                      </Label>
                      <div className="relative">
                        <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 pointer-events-none" />
                        <Input
                          type="date"
                          value={manualStudent.dob}
                          onChange={(e) => setManualStudent({ ...manualStudent, dob: e.target.value })}
                          className="h-11 pl-10 bg-slate-50 border-slate-200 text-slate-900 rounded-xl text-xs font-medium focus:border-indigo-600 focus:bg-white cursor-pointer"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Used for secondary candidate validation at assessment lobby.</p>
                    </div>
                  </div>
                </div>

                {/* Step 2: Academic Classification */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black">2</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Academic Placement</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Academic Grade</Label>
                        <Select
                          value={manualStudent.class}
                          onValueChange={(val) => setManualStudent({ ...manualStudent, class: val })}
                        >
                          <SelectTrigger className="h-11 bg-slate-50 border-slate-200 text-slate-900 rounded-xl text-xs font-medium focus:border-indigo-600 focus:bg-white">
                            <SelectValue placeholder="Select Grade" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[220px] bg-white border border-slate-200 shadow-xl rounded-xl">
                            {ACADEMIC_LEVELS.map((lvl) => (
                              <SelectItem key={lvl} value={lvl} className="text-xs font-medium cursor-pointer">
                                {lvl}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Section</Label>
                        <Input
                          value={manualStudent.section}
                          onChange={(e) => setManualStudent({ ...manualStudent, section: e.target.value })}
                          placeholder="e.g. A"
                          className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs font-medium focus:border-indigo-600 focus:bg-white uppercase"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <Label className="text-xs font-bold text-slate-700">Institution Register / Roll Number</Label>
                        <button
                          type="button"
                          onClick={handleAutoGenerateRoll}
                          className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
                        >
                          Auto Generate
                        </button>
                      </div>
                      <div className="relative">
                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 pointer-events-none" />
                        <Input
                          value={manualStudent.rollNumber}
                          onChange={(e) => setManualStudent({ ...manualStudent, rollNumber: e.target.value })}
                          placeholder="e.g. REG-78401"
                          className="h-11 pl-10 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs font-mono font-bold uppercase focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Unique student register ID within institution records.</p>
                    </div>
                  </div>
                </div>

                {/* Submit Trigger */}
                <div className="pt-4 border-t border-slate-100">
                  <Button
                    type="submit"
                    disabled={isSubmittingCandidate || !manualStudent.name.trim()}
                    className="w-full h-12 bg-indigo-600 hover:bg-slate-900 text-white rounded-2xl font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 transition-all cursor-pointer"
                  >
                    {isSubmittingCandidate ? (
                      <>Registering Candidate...</>
                    ) : (
                      <>
                        <Sparkles size={16} /> Provision & Register Candidate
                      </>
                    )}
                  </Button>
                </div>

              </form>
            </div>

            {/* Live Preview Card (5 Cols) */}
            <div className="lg:col-span-5 space-y-4 sticky top-8">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                    Live Candidate Node Preview
                  </span>
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                    Active Profile
                  </Badge>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-serif font-black shadow-md shadow-indigo-100 shrink-0">
                      {manualStudent.name.trim() ? manualStudent.name.trim()[0].toUpperCase() : 'C'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-base font-black text-slate-900 truncate">
                        {manualStudent.name.trim() || 'Candidate Name'}
                      </h4>
                      <p className="text-xs text-slate-500 truncate">
                        {manualStudent.class || '10th Grade'} • Section {manualStudent.section || 'A'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200/60 font-medium">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase block font-bold">Register No.</span>
                      <span className="font-mono text-indigo-600 font-bold">{manualStudent.rollNumber || 'AUTO'}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase block font-bold">DOB</span>
                      <span className="text-slate-900 font-bold">{manualStudent.dob || 'Not set'}</span>
                    </div>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase block font-bold">Contact Email</span>
                    <p className="text-xs text-slate-800 truncate font-mono">{manualStudent.email || 'No email assigned'}</p>
                  </div>
                  
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase block font-bold">Academic Institution</span>
                    <p className="text-xs text-slate-800 truncate font-bold">{schoolName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium justify-center pt-1">
                  <ShieldCheck size={14} className="text-emerald-500" />
                  <span>Encrypted Firestore User Provisioning</span>
                </div>
              </div>
            </div>

          </div>
        ) : (
          /* SUCCESS SCREEN */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-8 text-center"
          >
            <div className="w-16 h-16 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 size={36} />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                Candidate Registered Successfully
              </span>
              <h2 className="text-3xl font-serif font-black text-slate-900">{createdStudentData.name}</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Candidate profile committed to Firestore student database. The candidate can now access assigned exams.
              </p>
            </div>

            {/* Summary Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-left space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-sans uppercase block font-bold">Register Number</span>
                  <span className="text-indigo-600 font-bold block truncate">{createdStudentData.rollNumber}</span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-sans uppercase block font-bold">Academic Grade</span>
                  <span className="text-slate-900 font-bold block truncate">{createdStudentData.class} - Sec {createdStudentData.section}</span>
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-sans uppercase block font-bold">Assigned Email</span>
                <span className="text-slate-900 font-bold block truncate">{createdStudentData.email || 'None'}</span>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-sans uppercase block font-bold">Generated UID</span>
                <span className="text-slate-600 text-[11px] block truncate">{createdStudentData.uid}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-slate-100">
              <Button
                onClick={handleCopySummary}
                variant="outline"
                className="w-full sm:flex-1 h-12 bg-white border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                {copied ? 'Copied to Clipboard' : 'Copy Record Pass'}
              </Button>
              <Button
                onClick={() => setCreatedStudentData(null)}
                className="w-full sm:flex-1 h-12 bg-indigo-600 hover:bg-slate-900 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-100"
              >
                <UserPlus size={16} /> Register Another Candidate
              </Button>
            </div>

            <div className="pt-2">
              <Button
                variant="ghost"
                onClick={handleBackToRoster}
                className="text-xs text-slate-500 hover:text-slate-900 font-bold cursor-pointer"
              >
                ← Return to Candidate Roster
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
