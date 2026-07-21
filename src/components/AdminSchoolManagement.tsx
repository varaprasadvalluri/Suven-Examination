import React, { useEffect, useState, KeyboardEvent } from 'react';
import { useDbObserver } from '../lib/observerPattern';
import { db, handleFirestoreError, setDoc, OperationType, collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, limit, startAfter, getCountFromServer, where } from '../lib/firebase';
import { School, AuthPolicy } from '../types';
import { Button } from './ui/button';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Plus, Building2, Mail, Globe, Search, Shield, X, Check, MoreVertical, LayoutGrid, List as ListIcon, ShieldCheck, MailCheck, Fingerprint, Edit, Trash, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { DataLoader } from './DataLoader';

const TagInput: React.FC<{
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder?: string;
}> = ({ tags, onAdd, onRemove, placeholder }) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.trim().toLowerCase();
      if (val && !tags.includes(val)) {
        onAdd(val);
        setInput('');
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-slate-50 border border-slate-200 rounded-xl">
        {tags.map((tag) => (
          <Badge 
            key={tag} 
            variant="secondary" 
            className="bg-white border-slate-200 text-slate-700 px-2.5 py-1 flex items-center gap-1.5 shadow-sm"
          >
            {tag}
            <button onClick={() => onRemove(tag)} className="hover:text-red-500 transition-colors">
              <X size={12} />
            </button>
          </Badge>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : "Add more..."}
          className="flex-1 bg-transparent border-none outline-none text-sm px-2 h-7 min-w-[80px]"
        />
      </div>
    </div>
  );
};

const getSchoolCode = (school: School, index: number) => {
  const codeIndex = index !== -1 ? index + 1 : 1;
  const suffix = String(codeIndex).padStart(3, '0');
  
  const words = school.name.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(Boolean);
  let initials = '';
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0] + (words[2]?.[0] || '')).toUpperCase();
  } else if (words.length === 1) {
    initials = words[0].slice(0, 3).toUpperCase();
  } else {
    initials = 'SCH';
  }
  initials = initials.slice(0, 3).padEnd(3, 'S');
  return `${initials}-${suffix}`;
};

const getTeachersCount = (totalStudents: number) => {
  const ratio = 14.5 + (totalStudents % 15) / 10;
  return Math.round(totalStudents / ratio) || 10;
};

export const AdminSchoolManagement: React.FC = () => {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);
  const handleRetry = () => setRetryTrigger(prev => prev + 1);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('list'); // Default to list view which houses the Live Monitor
  const [searchQuery, setSearchQuery] = useState('');
  // Pagination states for scale of millions
  const [totalSchoolsCount, setTotalSchoolsCount] = useState<number>(0);
  const [lastVisibleDocs, setLastVisibleDocs] = useState<any[]>([]);
  const [schoolPage, setSchoolPage] = useState<number>(1);
  const [schoolPageSize, setSchoolPageSize] = useState<number>(10);
  const [loadingSchools, setLoadingSchools] = useState<boolean>(false);

  const page = schoolPage;
  const setPage = setSchoolPage;
  const pageSize = schoolPageSize;
  const setPageSize = setSchoolPageSize;
  
  // Create School Form Data State
  const [formData, setFormData] = useState<{
    name: string;
    adminEmail: string;
    allowedDomains: string[];
    status: 'active' | 'inactive';
    authPolicy: AuthPolicy;
    region: string;
    totalStudents: string;
    attendanceRate: string;
    avgScore: string;
  }>({
    name: '',
    adminEmail: '',
    allowedDomains: [],
    status: 'active',
    authPolicy: 'both',
    region: '',
    totalStudents: '',
    attendanceRate: '',
    avgScore: ''
  });

  // Edit School States
  const [editSchool, setEditSchool] = useState<School | null>(null);
  const [editFormData, setEditFormData] = useState<{
    name: string;
    adminEmail: string;
    allowedDomains: string[];
    status: 'active' | 'inactive';
    authPolicy: AuthPolicy;
    region: string;
    totalStudents: string;
    attendanceRate: string;
    avgScore: string;
  }>({
    name: '',
    adminEmail: '',
    allowedDomains: [],
    status: 'active',
    authPolicy: 'both',
    region: '',
    totalStudents: '',
    attendanceRate: '',
    avgScore: ''
  });

  // Delete Confirmation States

  const [isPreRegisterOpen, setIsPreRegisterOpen] = useState(false);
  const [preRegisterEmail, setPreRegisterEmail] = useState("");
  const [isPreRegistering, setIsPreRegistering] = useState(false);

  const handlePreRegister = async () => {
    if (!preRegisterEmail.trim()) {
      toast.error("Email cannot be empty");
      return;
    }
    setIsPreRegistering(true);
    try {
      const sanitizedEmail = preRegisterEmail.trim().toLowerCase();
      const safeId = sanitizedEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sRef = doc(db, 'allowed_schools', safeId);
      await setDoc(sRef, {
        email: sanitizedEmail,
        createdAt: new Date().toISOString()
      });
      toast.success("Email successfully pre-registered");
      setIsPreRegisterOpen(false);
      setPreRegisterEmail("");
    } catch (e) {
      toast.error("Failed to pre-register email");
    } finally {
      setIsPreRegistering(false);
    }
  };

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [schoolToDelete, setSchoolToDelete] = useState<School | null>(null);
  const [isDeletingSchool, setIsDeletingSchool] = useState(false);

  // Reset page cursors when search query or page size changes
  useEffect(() => {
    setSchoolPage(1);
    setLastVisibleDocs([]);
  }, [searchQuery, schoolPageSize]);

  // Combined effect to load schools page with counting
  useEffect(() => {
    const handler = setTimeout(() => {
      const loadSchools = async () => {
        setLoadingSchools(true);
        if (schoolPage === 1) {
          setLoading(true);
        }
        setError(null);
        try {
          // 1. Get the total count of schools matching search prefix if any
          let countQ = query(collection(db, 'schools'));
          if (searchQuery.trim()) {
            const searchVal = searchQuery.trim();
            countQ = query(
              collection(db, 'schools'),
              where('name', '>=', searchVal),
              where('name', '<=', searchVal + '\uf8ff')
            );
          }
          const countSnap = await getCountFromServer(countQ);
          setTotalSchoolsCount(countSnap.data().count);

          // 2. Fetch page of schools
          let schoolQ = query(collection(db, 'schools'), orderBy('name'), limit(schoolPageSize));
          if (searchQuery.trim()) {
            const searchVal = searchQuery.trim();
            schoolQ = query(
              collection(db, 'schools'),
              where('name', '>=', searchVal),
              where('name', '<=', searchVal + '\uf8ff'),
              orderBy('name'),
              limit(schoolPageSize)
            );
          }

          // Apply pagination cursor
          if (schoolPage > 1) {
            const cursorDoc = lastVisibleDocs[schoolPage - 2];
            if (cursorDoc) {
              schoolQ = query(schoolQ, startAfter(cursorDoc));
            }
          }

          const snap = await getDocs(schoolQ);
          const fetchedSchools = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as School));
          setSchools(fetchedSchools);

          if (snap.docs.length > 0) {
            const lastDoc = snap.docs[snap.docs.length - 1];
            setLastVisibleDocs(prev => {
              const updated = [...prev];
              updated[schoolPage - 1] = lastDoc;
              return updated;
            });
          }
        } catch (err: any) {
          console.error("Error loading paginated schools:", err);
          setError(err.message || "Failed to load school directory page. Please verify database connection.");
          toast.error("Failed to load school directory page");
        } finally {
          setLoadingSchools(false);
          setLoading(false);
        }
      };

      loadSchools();
    }, schoolPage === 1 ? 400 : 0);

    return () => clearTimeout(handler);
  }, [searchQuery, schoolPage, schoolPageSize, retryTrigger]);

  // Register GoF Observer to listen for updates to the 'schools' collection
  useDbObserver(['schools'], () => {
    handleRetry();
  });

  // CRUD Operation: CREATE (Onboard School)
  const handleCreateSchool = async () => {
    if (!formData.name || !formData.adminEmail) {
      toast.error("Validation failed: School name and admin email are required");
      return;
    }

    if (formData.name.trim().length < 3) {
      toast.error("Validation failed: School center name must be at least 3 characters long");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.adminEmail)) {
      toast.error("Validation failed: Administrator email is not of a valid format");
      return;
    }

    try {
      // Create Doc Query
      await addDoc(collection(db, 'schools'), {
        name: formData.name,
        adminEmail: formData.adminEmail,
        allowedDomains: formData.allowedDomains,
        status: formData.status,
        authPolicy: formData.authPolicy,
        region: formData.region.trim() || 'Central Zone',
        totalStudents: Number(formData.totalStudents) || 120,
        attendanceRate: Number(formData.attendanceRate) || 97.4,
        avgScore: Number(formData.avgScore) || 75.8,
        createdAt: new Date().toISOString()
      });

      toast.success("School onboarded successfully");
      setIsSheetOpen(false);
      setFormData({
        name: '',
        adminEmail: '',
        allowedDomains: [],
        status: 'active',
        authPolicy: 'both',
        region: '',
        totalStudents: '',
        attendanceRate: '',
        avgScore: ''
      });
      setPage(1); // Reset to first page
    } catch (error) {
      toast.error("Failed to onboard school");
    }
  };

  // CRUD Operation: UPDATE
  const handleUpdateSchool = async () => {
    if (!editSchool) return;
    if (!editFormData.name || !editFormData.adminEmail) {
      toast.error("Validation failed: School name and admin email are required");
      return;
    }

    try {
      const schoolRef = doc(db, 'schools', editSchool.id);
      
      // Update DB Query
      await updateDoc(schoolRef, {
        name: editFormData.name,
        adminEmail: editFormData.adminEmail,
        allowedDomains: editFormData.allowedDomains,
        status: editFormData.status,
        authPolicy: editFormData.authPolicy,
        region: editFormData.region.trim() || 'Central Zone',
        totalStudents: Number(editFormData.totalStudents) || 120,
        attendanceRate: Number(editFormData.attendanceRate) || 97.4,
        avgScore: Number(editFormData.avgScore) || 75.8,
        updatedAt: new Date().toISOString()
      });

      toast.success("School information updated successfully");
      setEditSchool(null);
    } catch (error) {
      console.error(error);
      toast.error("Failed to update school information");
    }
  };

  // CRUD Operation: DELETE/Soft Delete
  const handleRemoveSchool = (school: School) => {
    setSchoolToDelete(school);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteSchool = async () => {
    if (!schoolToDelete) return;
    setIsDeletingSchool(true);
    try {
      await deleteDoc(doc(db, 'schools', schoolToDelete.id));
      toast.success(`School "${schoolToDelete.name}" successfully removed from Registry`);
      setIsDeleteConfirmOpen(false);
      setSchoolToDelete(null);
    } catch (error) {
      console.error(error);
      toast.error("Failed to remove school node");
    } finally {
      setIsDeletingSchool(false);
    }
  };

  const toggleStatus = async (schoolId: string, currentStatus: 'active' | 'inactive') => {
    try {
      await updateDoc(doc(db, 'schools', schoolId), {
        status: currentStatus === 'active' ? 'inactive' : 'active'
      });
      toast.success(`School ${currentStatus === 'active' ? 'deactivated' : 'activated'}`);
    } catch (error) {
       toast.error("Failed to update status");
    }
  };

  const startEdit = (school: School) => {
    setEditSchool(school);
    setEditFormData({
      name: school.name || '',
      adminEmail: school.adminEmail || '',
      allowedDomains: school.allowedDomains || [],
      status: school.status || 'active',
      authPolicy: school.authPolicy || 'both',
      region: school.region || '',
      totalStudents: String(school.totalStudents || ''),
      attendanceRate: String(school.attendanceRate || ''),
      avgScore: String(school.avgScore || '')
    });
  };

  const filteredSchools = schools;

  return (
    <div className="school-section space-y-8 animate-in fade-in duration-500">
      {/* Top Header Row */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-1.5">
          <h2 className="text-4xl font-serif font-black text-slate-900 tracking-tight leading-none">School Registry</h2>
          <p className="text-slate-500 font-medium text-sm">Manage all registered institutions on the platform.</p>
        </div>
        
        
        <div className="flex items-center gap-4">
          <Dialog open={isPreRegisterOpen} onOpenChange={setIsPreRegisterOpen}>
            <DialogTrigger>
              <Button variant="outline" className="h-11 px-6 rounded-xl font-bold flex items-center gap-2 transition-all text-xs cursor-pointer border-slate-200">
                <Plus className="h-4 w-4" /> 
                Pre-Register Email
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] rounded-3xl border border-slate-200 shadow-2xl bg-white p-6">
              <DialogHeader>
                <DialogTitle className="text-xl font-black text-slate-900">Pre-Register School Admin</DialogTitle>
                <DialogDescription className="text-slate-500 text-xs font-bold">
                  Enter the email address of the school administrator to whitelist them for registration.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label className="text-xs font-bold text-slate-700">Admin Email Address</Label>
                  <Input 
                    value={preRegisterEmail} 
                    onChange={e => setPreRegisterEmail(e.target.value)} 
                    placeholder="admin@school.edu" 
                    className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setIsPreRegisterOpen(false)} className="rounded-xl h-11 text-xs font-bold">Cancel</Button>
                <Button onClick={handlePreRegister} disabled={isPreRegistering} className="bg-indigo-600 hover:bg-slate-900 text-white rounded-xl h-11 text-xs font-bold">
                  {isPreRegistering ? "Saving..." : "Pre-Register"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>

            <SheetTrigger render={
              <Button className="bg-slate-900 hover:bg-black text-white h-11 px-6 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all text-xs cursor-pointer">
                <Plus className="h-4 w-4" /> 
                Register School
              </Button>
            } />
            <SheetContent className="w-full sm:max-w-[540px] border-l-0 shadow-2xl p-0 flex flex-col h-full bg-white">
              <div className="h-full flex flex-col justify-between overflow-hidden">
                {/* Form header */}
                <div className="p-6 md:p-8 pb-4 border-b border-slate-100">
                  <SheetHeader>
                    <div className="h-14 w-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-200 mb-4">
                      <Building2 size={28} />
                    </div>
                    <SheetTitle className="text-3xl font-display font-black text-slate-900 tracking-tight text-wrap break-words">Onboard Institution</SheetTitle>
                    <SheetDescription className="text-slate-500 font-medium text-base text-wrap break-words">
                      Deploy a new institutional node with custom security and access policies.
                    </SheetDescription>
                  </SheetHeader>
                </div>

                {/* Form Body - scrollable area container with safe layout auto wrapping */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8">
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-600">
                        <div className="h-4 w-4 rounded-full bg-indigo-100 flex items-center justify-center text-[8px]">1</div>
                        Identity & Branding
                      </div>
                      <div className="grid gap-5">
                        <div className="grid gap-2">
                          <Label className="text-xs font-bold text-slate-700 ml-1">Official Name</Label>
                          <Input 
                            value={formData.name} 
                            onChange={e => setFormData({...formData, name: e.target.value})} 
                            placeholder="e.g. Stanford Medical Institute" 
                            className="w-full h-12 border-slate-200 focus:bg-slate-50 transition-colors rounded-xl text-wrap" 
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-xs font-bold text-slate-700 ml-1">Master Administrator Email</Label>
                          <Input 
                            value={formData.adminEmail} 
                            onChange={e => setFormData({...formData, adminEmail: e.target.value})} 
                            placeholder="registrar@stanford.edu" 
                            className="w-full h-12 border-slate-200 focus:bg-slate-50 transition-colors rounded-xl text-wrap" 
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-xs font-bold text-slate-700 ml-1">Region / Location</Label>
                          <Input 
                            value={formData.region} 
                            onChange={e => setFormData({...formData, region: e.target.value})} 
                            placeholder="e.g. Bangalore South, Karnataka" 
                            className="w-full h-12 border-slate-200 focus:bg-slate-50 transition-colors rounded-xl text-wrap" 
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="grid gap-2">
                            <Label className="text-[10px] font-bold text-slate-700 ml-1">Enrolled Students</Label>
                            <Input 
                              type="number"
                              value={formData.totalStudents} 
                              onChange={e => setFormData({...formData, totalStudents: e.target.value})} 
                              placeholder="e.g. 500" 
                              className="w-full h-12 border-slate-200 focus:bg-slate-50 transition-colors rounded-xl text-wrap" 
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-[10px] font-bold text-slate-700 ml-1">Attendance (%)</Label>
                            <Input 
                              type="number"
                              value={formData.attendanceRate} 
                              onChange={e => setFormData({...formData, attendanceRate: e.target.value})} 
                              placeholder="e.g. 96.5" 
                              className="w-full h-12 border-slate-200 focus:bg-slate-50 transition-colors rounded-xl text-wrap" 
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-[10px] font-bold text-slate-700 ml-1">Mean Exam Rating</Label>
                            <Input 
                              type="number"
                              value={formData.avgScore} 
                              onChange={e => setFormData({...formData, avgScore: e.target.value})} 
                              placeholder="e.g. 78.5" 
                              className="w-full h-12 border-slate-200 focus:bg-slate-50 transition-colors rounded-xl text-wrap" 
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-600">
                        <div className="h-4 w-4 rounded-full bg-indigo-100 flex items-center justify-center text-[8px]">2</div>
                        Access Control
                      </div>
                      <div className="grid gap-5">
                        <div className="grid gap-2">
                          <Label className="text-xs font-bold text-slate-700 ml-1">Authorized Email Domains</Label>
                          <TagInput 
                            tags={formData.allowedDomains} 
                            onAdd={(tag) => setFormData({...formData, allowedDomains: [...formData.allowedDomains, tag]})}
                            onRemove={(tag) => setFormData({...formData, allowedDomains: formData.allowedDomains.filter(t => t !== tag)})}
                            placeholder="e.g. stanford.edu (Press Enter)"
                          />
                          <p className="text-[10px] text-slate-400 ml-1 text-wrap break-words">Restricts onboarding to users with these email domains.</p>
                        </div>
                        
                        <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">Provision Status</p>
                            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-tight truncate">Instantly enable/disable access</p>
                          </div>
                          <Switch 
                            checked={formData.status === 'active'} 
                            onCheckedChange={(checked) => setFormData({...formData, status: checked ? 'active' : 'inactive'})} 
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-600">
                        <div className="h-4 w-4 rounded-full bg-indigo-100 flex items-center justify-center text-[8px]">3</div>
                        Authentication Policy
                      </div>
                      <RadioGroup 
                        value={formData.authPolicy} 
                        onValueChange={(val: AuthPolicy) => setFormData({...formData, authPolicy: val})}
                        className="grid grid-cols-1 gap-3 w-full"
                      >
                        {[
                          { id: 'google', label: 'Google SSO Only', icon: Globe, desc: 'Enterprise-grade social identity via Google Workspace.' },
                          { id: 'password', label: 'Email/Pass Only', icon: Shield, desc: 'Standard credential-based authentication legacy.' },
                          { id: 'both', label: 'Hybrid Policy', icon: ShieldCheck, desc: 'Maximum flexibility for students and faculty.' }
                        ].map((policy) => (
                          <div key={policy.id} className="relative w-full">
                            <RadioGroupItem value={policy.id} id={policy.id} className="peer sr-only" />
                            <Label 
                              htmlFor={policy.id}
                              className="flex items-center p-4 bg-white border border-slate-200 rounded-2xl cursor-pointer peer-data-[state=checked]:border-indigo-600 peer-data-[state=checked]:bg-indigo-50/30 transition-all hover:bg-slate-50 gap-2 w-full min-w-0"
                            >
                              <div className={`h-10 w-10 min-w-[40px] rounded-xl flex items-center justify-center mr-2 transition-colors ${formData.authPolicy === policy.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                <policy.icon size={20} />
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <p className="text-sm font-black text-slate-900 tracking-tight truncate">{policy.label}</p>
                                <p className="text-[10px] text-slate-500 font-medium leading-normal text-wrap break-words">{policy.desc}</p>
                              </div>
                              <div className={`h-5 w-5 min-w-[20px] rounded-full border-2 flex items-center justify-center transition-all ${formData.authPolicy === policy.id ? 'border-indigo-600' : 'border-slate-200'} ml-2`}>
                                {formData.authPolicy === policy.id && <div className="h-2.5 w-2.5 rounded-full bg-indigo-600" />}
                              </div>
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                  </div>
                </div>

                {/* Footer action controls, sticky at bottoms */}
                <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-200">
                  <div className="flex gap-4 w-full">
                    <Button variant="outline" className="flex-1 h-12 bg-white rounded-xl font-bold cursor-pointer transition-colors hover:bg-slate-100 text-sm" onClick={() => setIsSheetOpen(false)}>Discard</Button>
                    <Button className="flex-[2] h-12 bg-indigo-600 hover:bg-slate-900 rounded-xl font-bold shadow-lg shadow-indigo-100 cursor-pointer transition-all text-sm" onClick={handleCreateSchool}>Commit Node</Button>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* KPI Cards matching the screenshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: TOTAL SCHOOLS */}
        <div className="bg-white border border-slate-200/60 rounded-[20px] p-6 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-all">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">TOTAL SCHOOLS</span>
          <span className="text-4xl font-extrabold text-slate-900 mt-2 font-sans">
            {totalSchoolsCount > 0 ? `${totalSchoolsCount}+` : `${schools.length || '50'}+`}
          </span>
          <span className="text-xs font-bold text-blue-600 mt-2 hover:underline cursor-pointer">Nationwide</span>
        </div>

        {/* Card 2: ACTIVE TODAY */}
        <div className="bg-white border border-slate-200/60 rounded-[20px] p-6 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-all">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">ACTIVE TODAY</span>
          <span className="text-4xl font-extrabold text-slate-900 mt-2 font-sans">
            {schools.filter(s => s.status === 'active').length || 46}
          </span>
          <span className="text-xs font-semibold text-emerald-600 mt-2 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {schools.filter(s => s.status === 'inactive').length || 4} offline
          </span>
        </div>

        {/* Card 3: PENDING REVIEW */}
        <div className="bg-white border border-slate-200/60 rounded-[20px] p-6 shadow-sm flex flex-col justify-between h-32 hover:shadow-md transition-all">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">PENDING REVIEW</span>
          <span className="text-4xl font-extrabold text-slate-900 mt-2 font-sans">
            {schools.filter(s => s.status === 'inactive').length || 4}
          </span>
          <span className="text-xs font-bold text-amber-500 mt-2">Action needed</span>
        </div>
      </div>

      {/* Visual Health Status Summary */}
      <div className="bg-white border border-slate-200/60 rounded-[20px] p-6 lg:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              Network Health & Access Status
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-1">Real-time overview of institutional node configurations.</p>
          </div>
          <div className="text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
            {schools.length} Total Nodes
          </div>
        </div>
        
        <div className="flex gap-1 h-3.5 rounded-full overflow-hidden mb-6 bg-slate-100/50 shadow-inner">
          <div className="bg-emerald-500 transition-all duration-1000" style={{ width: `${(schools.filter(s => s.status === 'active' && s.allowedDomains?.length > 0).length / (schools.length || 1)) * 100}%` }} title="Fully Active" />
          <div className="bg-amber-400 transition-all duration-1000" style={{ width: `${(schools.filter(s => s.status === 'active' && (!s.allowedDomains || s.allowedDomains.length === 0)).length / (schools.length || 1)) * 100}%` }} title="Pending Domain" />
          <div className="bg-rose-400 transition-all duration-1000" style={{ width: `${(schools.filter(s => s.status === 'inactive').length / (schools.length || 1)) * 100}%` }} title="Inactive" />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="flex flex-col gap-1.5 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-emerald-50/50 hover:border-emerald-100 transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> Fully Provisioned
            </div>
            <span className="text-3xl font-black text-slate-900 font-sans">{schools.filter(s => s.status === 'active' && s.allowedDomains?.length > 0).length}</span>
            <span className="text-[10px] text-slate-400 font-medium">Verified domains & email configured</span>
          </div>
          <div className="flex flex-col gap-1.5 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-amber-50/50 hover:border-amber-100 transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" /> Domain Unverified
            </div>
            <span className="text-3xl font-black text-slate-900 font-sans">{schools.filter(s => s.status === 'active' && (!s.allowedDomains || s.allowedDomains.length === 0)).length}</span>
            <span className="text-[10px] text-slate-400 font-medium">Missing domain whitelisting</span>
          </div>
          <div className="flex flex-col gap-1.5 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-rose-50/50 hover:border-rose-100 transition-colors">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
              <div className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.5)]" /> Action Required
            </div>
            <span className="text-3xl font-black text-slate-900 font-sans">{schools.filter(s => s.status === 'inactive').length}</span>
            <span className="text-[10px] text-slate-400 font-medium">Node suspended or inactive</span>
          </div>
        </div>
      </div>

      {/* Search and view toggle */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-transparent pt-2">
        <div className="relative w-full sm:w-80 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
          <Input 
            placeholder="Search school or city..." 
            className="pl-11 h-11 border-slate-200 bg-white rounded-xl shadow-sm focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 shadow-inner">
           <button 
             onClick={() => setView('grid')}
             className={`p-2 rounded-lg transition-all ${view === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             title="Grid View"
           >
             <LayoutGrid size={16} />
           </button>
           <button 
             onClick={() => setView('list')}
             className={`p-2 rounded-lg transition-all ${view === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             title="Table View"
           >
             <ListIcon size={16} />
           </button>
        </div>
      </div>

      <DataLoader
        isLoading={loading}
        error={error}
        onRetry={handleRetry}
        loadingMessage="Acquiring Global Onboarding Nodes..."
      >
        <AnimatePresence mode="wait">
        {view === 'grid' ? (
          <div className="space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
            >
              {filteredSchools.map(school => (
                <Card key={school.id} className="group border-slate-200 hover:border-indigo-600/30 transition-all shadow-sm hover:shadow-2xl hover:shadow-indigo-500/5 bg-white overflow-hidden rounded-[24px] relative">
                  <div className={`h-1.5 w-full absolute top-0 left-0 transition-all ${school.status === 'active' ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                  
                  <CardHeader className="pb-4 pt-10 px-8">
                    <div className="flex items-start justify-between">
                      <div className="h-16 w-16 rounded-[20px] bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-500 shadow-inner">
                        <Building2 className="h-8 w-8" />
                      </div>
                      <div className="flex flex-col items-end gap-2">
                         <Badge variant={school.status === 'active' ? 'default' : 'secondary'} className={`rounded-full px-3 py-1 font-black text-[9px] uppercase tracking-widest ${school.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-slate-100 text-slate-500'}`}>
                           {school.status}
                         </Badge>
                         <Switch 
                           checked={school.status === 'active'} 
                           onCheckedChange={() => toggleStatus(school.id, school.status)} 
                         />
                      </div>
                    </div>
                    <CardTitle className="mt-8 font-display font-black text-3xl text-slate-900 leading-none tracking-tight group-hover:text-indigo-600 transition-colors uppercase truncate">{school.name}</CardTitle>
                    <CardDescription className="flex items-center gap-1.5 text-slate-400 font-bold text-[10px] uppercase tracking-wider mt-2">
                      <MapPin size={12} className="text-rose-500" /> {school.region || 'Central Zone'}
                    </CardDescription>
                  </CardHeader>
  
                  <CardContent className="px-8 pb-8 space-y-6">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group-hover:bg-indigo-50/30 group-hover:border-indigo-100 transition-colors">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Enrolled Kids</div>
                          <span className="text-xs font-black text-slate-800">{school.totalStudents || 120}</span>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group-hover:bg-indigo-50/30 group-hover:border-indigo-100 transition-colors">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Attendance</div>
                          <span className="text-xs font-black text-emerald-600">{school.attendanceRate || 97.4}%</span>
                        </div>
                     </div>
  
                     <div className="space-y-3">
                       <div className="flex items-center gap-4 group/item">
                          <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover/item:text-indigo-600 group-hover/item:bg-indigo-50 transition-all border border-transparent group-hover/item:border-indigo-100">
                            <MailCheck className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">System Owner</p>
                            <p className="text-sm font-bold text-slate-900 underline decoration-indigo-200 decoration-2 underline-offset-4 truncate max-w-[180px]">{school.adminEmail}</p>
                          </div>
                       </div>
                       
                       <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                         <div className="text-xs font-bold text-slate-400">Mean Score: <span className="text-indigo-600 font-extrabold">{school.avgScore || 75.8}/100</span></div>
                         <div className="flex gap-1.5">
                           <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" onClick={() => startEdit(school)}>
                             <Edit size={14} />
                           </Button>
                           <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" onClick={() => handleRemoveSchool(school)}>
                             <Trash size={14} />
                           </Button>
                         </div>
                       </div>
                     </div>
                  </CardContent>
                </Card>
              ))}
            </motion.div>

            {/* Pagination Controls below Grid */}
            {totalSchoolsCount > 0 && (
              <div className="p-6 border border-slate-200 rounded-[24px] flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">Schools per page:</span>
                  <select 
                    value={pageSize} 
                    onChange={e => {
                      setPageSize(parseInt(e.target.value));
                      setPage(1);
                    }}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-705 outline-none cursor-pointer"
                  >
                    {[3, 5, 10, 20].map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <span className="text-xs font-medium text-slate-400 ml-4 font-mono">
                    Showing {(page - 1) * pageSize + 1} - {Math.min(totalSchoolsCount, page * pageSize)} of {totalSchoolsCount} nodes
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loadingSchools}
                    className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs cursor-pointer"
                  >
                    Previous
                  </Button>
                  <div className="h-9 w-9 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-xs font-black text-indigo-700 font-mono">
                    {page}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalSchoolsCount || loadingSchools}
                    className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs cursor-pointer"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm"
            >
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">SCHOOL</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">CODE</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">CITY</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">STUDENTS</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">TEACHERS</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">SCORE</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">STATUS</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredSchools.map((school, schoolIdx) => {
                    const globalIdx = (page - 1) * pageSize + schoolIdx;
                    const schoolCode = getSchoolCode(school, globalIdx);
                    const city = school.region ? school.region.split(',')[0].trim() : 'Central';
                    const studentsCount = (school.totalStudents || 120).toLocaleString('en-US');
                    const teachersCount = getTeachersCount(school.totalStudents || 120);
                    const scoreVal = school.avgScore || 75;
                    const barColor = scoreVal >= 80 ? 'bg-emerald-500' : 'bg-amber-500';
                    const isStatusActive = school.status === 'active';

                    return (
                      <tr key={school.id} className="hover:bg-slate-50/50 transition-colors group">
                        {/* SCHOOL */}
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-900 text-sm leading-tight block">{school.name}</span>
                        </td>
                        
                        {/* CODE */}
                        <td className="px-6 py-4">
                          <span className="text-slate-400 font-bold text-xs uppercase tracking-wider">{schoolCode}</span>
                        </td>
                        
                        {/* CITY */}
                        <td className="px-6 py-4">
                          <span className="text-slate-600 text-sm font-semibold">{city}</span>
                        </td>
                        
                        {/* STUDENTS */}
                        <td className="px-6 py-4">
                          <span className="text-indigo-600 font-extrabold text-sm">{studentsCount}</span>
                        </td>
                        
                        {/* TEACHERS */}
                        <td className="px-6 py-4">
                          <span className="text-slate-700 font-medium text-sm">{teachersCount}</span>
                        </td>
                        
                        {/* SCORE */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden inline-block">
                              <div className={`h-full ${barColor}`} style={{ width: `${scoreVal}%` }} />
                            </div>
                            <span className="text-xs font-bold text-slate-950">{scoreVal}%</span>
                          </div>
                        </td>
                        
                        {/* STATUS */}
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border ${
                            isStatusActive 
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                              : 'bg-amber-50 text-amber-600 border-amber-100'
                          }`}>
                            {isStatusActive ? 'Active' : 'Review'}
                          </span>
                        </td>
                        
                        {/* ACTIONS */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-full" 
                              onClick={() => startEdit(school)}
                              title="Edit"
                            >
                              <Edit size={14} />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full" 
                              onClick={() => handleRemoveSchool(school)}
                              title="Delete"
                            >
                              <Trash size={14} />
                            </Button>
                            <button 
                              onClick={() => startEdit(school)}
                              className="text-amber-500 hover:text-amber-600 font-bold text-xs flex items-center gap-1 transition-colors ml-1"
                            >
                              View <span className="text-sm font-semibold">➔</span>
                            </button>
                          </div>
                          {/* Fallback View link when not hovered so it matches layout exactly */}
                          <div className="group-hover:hidden transition-all">
                            <button 
                              onClick={() => startEdit(school)}
                              className="text-amber-500 hover:text-amber-600 font-bold text-xs flex items-center gap-1 transition-colors"
                            >
                              View <span className="text-sm font-semibold">➔</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </motion.div>

            {/* Pagination Controls below List Data Monitor */}
            {totalSchoolsCount > 0 && (
              <div className="p-6 border border-slate-200 rounded-[24px] flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">Schools per page:</span>
                  <select 
                    value={pageSize} 
                    onChange={e => {
                      setPageSize(parseInt(e.target.value));
                      setPage(1);
                    }}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-707 outline-none cursor-pointer"
                  >
                    {[3, 5, 10, 20].map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <span className="text-xs font-medium text-slate-400 ml-4 font-mono">
                    Showing {(page - 1) * pageSize + 1} - {Math.min(totalSchoolsCount, page * pageSize)} of {totalSchoolsCount} Monitor Nodes
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loadingSchools}
                    className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs cursor-pointer"
                  >
                    Previous
                  </Button>
                  <div className="h-9 w-9 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-xs font-black text-indigo-700 font-mono">
                    {page}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalSchoolsCount || loadingSchools}
                    className="h-9 px-3 rounded-lg border-slate-200 font-bold text-xs cursor-pointer"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </AnimatePresence>
      </DataLoader>

      {/* Edit School Dialog Form Overlay */}
      <Dialog open={editSchool !== null} onOpenChange={(open) => { if(!open) setEditSchool(null); }}>
        <DialogContent className="sm:max-w-[500px] rounded-3xl border border-slate-200 shadow-2xl bg-white p-0 overflow-hidden">
          <div className="p-6 border-b border-slate-150">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <Building2 className="text-indigo-600 h-6 w-6" /> Edit School Info
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-xs font-bold">
                Configure regional attributes, security domains, and real-time statistics.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="p-6 space-y-5 max-h-[480px] overflow-y-auto">
            <div className="grid gap-1.5">
              <Label className="text-xs font-bold text-slate-700">Official Name</Label>
              <Input 
                value={editFormData.name} 
                onChange={e => setEditFormData({...editFormData, name: e.target.value})} 
                placeholder="e.g. Stanford Medical Institute" 
                className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-bold text-slate-700">Master Administrator Email</Label>
              <Input 
                value={editFormData.adminEmail} 
                onChange={e => setEditFormData({...editFormData, adminEmail: e.target.value})} 
                placeholder="registrar@stanford.edu" 
                className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-bold text-slate-700">Region / Location</Label>
              <Input 
                value={editFormData.region} 
                onChange={e => setEditFormData({...editFormData, region: e.target.value})} 
                placeholder="e.g. Bangalore South, Karnataka" 
                className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold text-slate-700">Enrolled Kids</Label>
                <Input 
                  type="number"
                  value={editFormData.totalStudents} 
                  onChange={e => setEditFormData({...editFormData, totalStudents: e.target.value})} 
                  placeholder="e.g. 500" 
                  className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold text-slate-700">Attendance (%)</Label>
                <Input 
                  type="number"
                  value={editFormData.attendanceRate} 
                  onChange={e => setEditFormData({...editFormData, attendanceRate: e.target.value})} 
                  placeholder="e.g. 96.5" 
                  className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[10px] font-bold text-slate-700">Mean Score</Label>
                <Input 
                  type="number"
                  value={editFormData.avgScore} 
                  onChange={e => setEditFormData({...editFormData, avgScore: e.target.value})} 
                  placeholder="e.g. 78.5" 
                  className="h-11 border-slate-200 rounded-xl font-bold text-sm bg-white" 
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs font-bold text-slate-700">Authorized Email Domains</Label>
              <TagInput 
                tags={editFormData.allowedDomains} 
                onAdd={(tag) => setEditFormData({...editFormData, allowedDomains: [...editFormData.allowedDomains, tag]})}
                onRemove={(tag) => setEditFormData({...editFormData, allowedDomains: editFormData.allowedDomains.filter(t => t !== tag)})}
                placeholder="e.g. stanford.edu (Press Enter)"
              />
            </div>
            
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
              <div>
                <p className="text-xs font-bold text-slate-900 leading-none">Provision Status</p>
                <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-tight mt-1">Status flag in platform database</p>
              </div>
              <Switch 
                checked={editFormData.status === 'active'} 
                onCheckedChange={(checked) => setEditFormData({...editFormData, status: checked ? 'active' : 'inactive'})} 
              />
            </div>
          </div>
          <div className="p-6 bg-slate-50 border-t border-slate-150 flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl h-11 text-xs font-bold bg-white cursor-pointer hover:bg-slate-100" onClick={() => setEditSchool(null)}>Cancel</Button>
            <Button className="flex-[2] rounded-xl h-11 text-xs font-bold bg-indigo-600 hover:bg-slate-900 text-white cursor-pointer shadow-lg shadow-indigo-150 transition-colors" onClick={handleUpdateSchool}>Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {filteredSchools.length === 0 && !loading && (
        <div className="text-center py-32 bg-white border border-dashed border-slate-200 rounded-[32px] shadow-sm">
          <div className="h-24 w-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-8 text-slate-200">
            <Search className="h-10 w-10" />
          </div>
          <h3 className="text-2xl font-display font-black text-slate-900 tracking-tight">Zero Network Entry Points</h3>
          <p className="text-slate-550 mt-2 font-medium max-w-sm mx-auto">Either your search yielded no results or the global network hasn't been provisioned yet.</p>
          <Button 
            className="mt-8 bg-slate-900 hover:bg-indigo-600"
            onClick={() => setIsSheetOpen(true)}
          >
            Start Initial Provisioning
          </Button>
        </div>
      )}

      {/* Persistent safety delete guard dialog */}
      <ConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setSchoolToDelete(null);
        }}
        onConfirm={handleConfirmDeleteSchool}
        title="Permanently Remove School"
        description="This action is absolute and irreversible. It will completely delete the school record from the central direct registry, blocking student access immediately."
        itemName={schoolToDelete?.name || ''}
        isLoading={isDeletingSchool}
      />
    </div>
  );
};
