import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, addDoc, collection, setDoc, doc, serverTimestamp } from '../lib/firebase';
import { AuthPolicy } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { 
  Building2, 
  Globe, 
  X, 
  Check, 
  ArrowLeft, 
  Key, 
  Sparkles, 
  CheckCircle2, 
  Copy, 
  ExternalLink,
  Lock
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';

const TagInput: React.FC<{
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder?: string;
}> = ({ tags, onAdd, onRemove, placeholder }) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.trim().toLowerCase().replace(/^@/, '');
      if (val && !tags.includes(val)) {
        onAdd(val);
        setInput('');
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[44px] p-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-indigo-600 focus-within:bg-white transition-all">
        {tags.map((tag) => (
          <Badge 
            key={tag} 
            variant="secondary" 
            className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-2.5 py-1 flex items-center gap-1.5 rounded-lg font-mono text-xs"
          >
            @{tag}
            <button type="button" onClick={() => onRemove(tag)} className="hover:text-rose-600 transition-colors cursor-pointer ml-1">
              <X size={12} />
            </button>
          </Badge>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : "Add domain (press Enter)..."}
          className="flex-1 bg-transparent border-none outline-none text-xs px-2 h-7 min-w-[140px] text-slate-900 font-medium placeholder:text-slate-400"
        />
      </div>
      <p className="text-[11px] text-slate-500 font-medium">
        Press <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono text-slate-600">Enter</kbd> to restrict registration to domains like <span className="font-mono text-indigo-600 font-bold">dpsrkp.net</span>
      </p>
    </div>
  );
};

export const AdminSchoolOnboarding: React.FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createdSchoolData, setCreatedSchoolData] = useState<any | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedCreds, setCopiedCreds] = useState<boolean>(false);

  // Streamlined Form State
  const [formData, setFormData] = useState({
    name: '',
    board: 'CBSE',
    centerCode: '',
    city: '',
    state: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    allowedDomains: [] as string[],
    authPolicy: 'both' as AuthPolicy,
    totalStudents: 500,
  });

  // Deterministically generate center code as user types school name
  const generateCenterCodeFromName = (name: string) => {
    if (!name.trim()) return '';
    const words = name.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(Boolean);
    let initials = '';
    if (words.length >= 2) {
      initials = (words[0][0] + words[1][0] + (words[2]?.[0] || '')).toUpperCase();
    } else if (words.length === 1) {
      initials = words[0].slice(0, 3).toUpperCase();
    } else {
      initials = 'SCH';
    }
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    const num = Math.abs(hash % 900) + 100;
    return `${initials}-${num}`;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    const autoCode = generateCenterCodeFromName(newName);
    setFormData(prev => ({
      ...prev,
      name: newName,
      centerCode: autoCode
    }));
  };

  const isFormValid = formData.name.trim().length >= 3 && formData.adminEmail.trim().includes('@');

  // Submit School Registration
  const handleOnboardSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      toast.error("Please fill in the School Name and Admin Email.");
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading("Provisioning Institutional Node...");

    try {
      const generatedCode = formData.centerCode || generateCenterCodeFromName(formData.name) || `SCH-${Math.floor(100 + Math.random() * 900)}`;
      const generatedPassword = formData.adminPassword.trim() || `Suven@${Math.floor(1000 + Math.random() * 9000)}`;
      const adminName = formData.adminName.trim() || 'School Principal';

      const schoolPayload = {
        name: formData.name.trim(),
        board: formData.board,
        centerCode: generatedCode,
        address: formData.city ? `${formData.city}, ${formData.state}` : '',
        city: formData.city.trim(),
        state: formData.state.trim(),
        phone: '',
        website: '',
        adminName,
        adminEmail: formData.adminEmail.trim().toLowerCase(),
        adminPhone: '',
        allowedDomains: formData.allowedDomains,
        authPolicy: formData.authPolicy,
        status: 'active' as const,
        totalStudents: Number(formData.totalStudents) || 500,
        plan: 'Enterprise Scholar',
        maxConcurrentExams: 50,
        proctoringEnabled: true,
        aiAnalyticsEnabled: true,
        logoUrl: '',
        themeColor: 'indigo',
        subdomain: formData.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        welcomeNote: 'Welcome to the Official Institutional Examination & Analytics Portal.',
        region: formData.state ? `${formData.city}, ${formData.state}` : 'National Region',
        attendanceRate: 98,
        avgScore: 82,
        createdAt: new Date().toISOString(),
      };

      // 1. Add School Document to 'schools' collection
      const schoolDocRef = await addDoc(collection(db, 'schools'), schoolPayload);
      const newSchoolId = schoolDocRef.id;

      // 2. Pre-register allowed email in 'allowed_schools' collection
      const sanitizedEmail = formData.adminEmail.trim().toLowerCase();
      const safeEmailId = sanitizedEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
      await setDoc(doc(db, 'allowed_schools', safeEmailId), {
        email: sanitizedEmail,
        schoolId: newSchoolId,
        schoolName: formData.name.trim(),
        adminName,
        createdAt: serverTimestamp()
      });

      const portalUrl = `${window.location.origin}/portal/school/${newSchoolId}`;

      setCreatedSchoolData({
        id: newSchoolId,
        ...schoolPayload,
        tempPassword: generatedPassword,
        portalUrl,
      });

      toast.success(`School "${formData.name}" successfully onboarded!`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Failed to onboard school. Please check connection and retry.", { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyPortalLink = () => {
    if (!createdSchoolData) return;
    navigator.clipboard.writeText(createdSchoolData.portalUrl);
    setCopiedLink(true);
    toast.success("Institutional Portal URL copied!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCredentials = () => {
    if (!createdSchoolData) return;
    const credText = `SUVENEDU SCHOOL ADMIN CREDENTIALS\n` +
      `Institution: ${createdSchoolData.name}\n` +
      `Portal Link: ${createdSchoolData.portalUrl}\n` +
      `Admin Email: ${createdSchoolData.adminEmail}\n` +
      `Password: ${createdSchoolData.tempPassword}\n` +
      `Center Code: ${createdSchoolData.centerCode}`;
    navigator.clipboard.writeText(credText);
    setCopiedCreds(true);
    toast.success("Admin Credentials copied!");
    setTimeout(() => setCopiedCreds(false), 2000);
  };

  const handleResetForm = () => {
    setCreatedSchoolData(null);
    setFormData({
      name: '',
      board: 'CBSE',
      centerCode: '',
      city: '',
      state: '',
      adminName: '',
      adminEmail: '',
      adminPassword: '',
      allowedDomains: [],
      authPolicy: 'both',
      totalStudents: 500,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans -m-4 md:-m-6 lg:-m-10 p-4 md:p-8 lg:p-12 selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <div className="max-w-5xl mx-auto w-full flex items-center justify-between pb-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={() => navigate('/admin/schools')}
            className="h-10 px-4 bg-white border-slate-200 hover:bg-slate-100 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <ArrowLeft size={16} />
            Back to Registry
          </Button>
          <div className="hidden sm:block h-5 w-[1px] bg-slate-200" />
          <span className="text-xs font-bold text-slate-500">Institutional Fast Onboarding</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 px-3 py-1 rounded-full text-[11px] font-mono">
            Direct Firestore
          </Badge>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-5xl mx-auto w-full flex-1 pt-8">
        {!createdSchoolData ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Form Column (7 Cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6">
              <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-serif font-black text-slate-900 tracking-tight flex items-center gap-2.5">
                  <Building2 className="text-indigo-600" size={28} />
                  Onboard Institution
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  Quickly provision a school node with administrator login and whitelisted access.
                </p>
              </div>

              <form onSubmit={handleOnboardSchool} className="space-y-6 pt-2">
                {/* 1. Core Identity */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black">1</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">School Identity</h3>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">
                        School / Institution Name <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        value={formData.name}
                        onChange={handleNameChange}
                        placeholder="e.g. Delhi Public School, R.K. Puram"
                        required
                        className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-sm font-medium focus:border-indigo-600 focus:bg-white"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Affiliation Board</Label>
                        <select
                          value={formData.board}
                          onChange={(e) => setFormData({ ...formData, board: e.target.value })}
                          className="w-full h-11 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl px-3 text-xs font-medium focus:border-indigo-600 focus:bg-white outline-none"
                        >
                          <option value="CBSE">CBSE (Central Board)</option>
                          <option value="ICSE">ICSE / ISC</option>
                          <option value="IB">IB World School</option>
                          <option value="State Board">State Board</option>
                          <option value="Cambridge">Cambridge / IGCSE</option>
                          <option value="Autonomous">Autonomous College</option>
                        </select>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <Label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                            Center Code <Lock size={11} className="text-slate-400" />
                          </Label>
                          <span className="text-[10px] text-slate-400 font-medium">Auto-generated</span>
                        </div>
                        <Input
                          value={formData.centerCode || 'Pending School Name'}
                          readOnly
                          className="h-11 bg-slate-100 border-slate-200 text-slate-700 placeholder:text-slate-400 rounded-xl text-xs font-mono font-bold uppercase cursor-not-allowed select-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">City</Label>
                        <Input
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          placeholder="e.g. New Delhi"
                          className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">State / Region</Label>
                        <Input
                          value={formData.state}
                          onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                          placeholder="e.g. Delhi NCR"
                          className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Admin & Domain Whitelist */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black">2</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Admin & Access Controls</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Admin Full Name</Label>
                        <Input
                          value={formData.adminName}
                          onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                          placeholder="Dr. Rajesh Sharma"
                          className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs focus:border-indigo-600 focus:bg-white"
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-bold text-slate-700 mb-1.5 block">
                          Master Admin Email <span className="text-rose-500">*</span>
                        </Label>
                        <Input
                          type="email"
                          value={formData.adminEmail}
                          onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                          placeholder="principal@dpsrkp.net"
                          required
                          className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs font-medium focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Initial Passcode (Optional)</Label>
                      <Input
                        type="text"
                        value={formData.adminPassword}
                        onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                        placeholder="Leave blank to auto-generate secure password"
                        className="h-11 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-xs font-mono focus:border-indigo-600 focus:bg-white"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Whitelisted Email Domains</Label>
                      <TagInput
                        tags={formData.allowedDomains}
                        onAdd={(domain) => setFormData({ ...formData, allowedDomains: [...formData.allowedDomains, domain] })}
                        onRemove={(domain) => setFormData({ ...formData, allowedDomains: formData.allowedDomains.filter(d => d !== domain) })}
                        placeholder="e.g. dpsrkp.net"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-slate-700 mb-1.5 block">Authentication Policy</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'both', label: 'Google + Password' },
                          { id: 'google', label: 'Google SSO Only' },
                          { id: 'password', label: 'Password Only' }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setFormData({ ...formData, authPolicy: p.id as AuthPolicy })}
                            className={`p-2.5 rounded-xl border text-center text-xs font-bold transition-all cursor-pointer ${
                              formData.authPolicy === p.id
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-100'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Student Seats */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-black">3</span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Enrolled Student Seat Quota</h3>
                    </div>
                    <span className="text-xs font-mono font-bold text-indigo-600">
                      {Number(formData.totalStudents || 0).toLocaleString()} Seats
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                    <div className="sm:col-span-5">
                      <Input
                        type="number"
                        min={1}
                        max={100000}
                        value={formData.totalStudents || ''}
                        onChange={(e) => setFormData({ ...formData, totalStudents: Math.max(0, parseInt(e.target.value) || 0) })}
                        placeholder="e.g. 500"
                        className="h-11 bg-slate-50 border-slate-200 text-slate-900 font-bold rounded-xl text-sm focus:border-indigo-600 focus:bg-white"
                      />
                    </div>
                    <div className="sm:col-span-7 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Presets:</span>
                      {[250, 500, 1000, 2500, 5000].map((seats) => (
                        <button
                          key={seats}
                          type="button"
                          onClick={() => setFormData({ ...formData, totalStudents: seats })}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                            Number(formData.totalStudents) === seats
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {seats >= 1000 ? `${seats/1000}k` : seats}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Submit Action */}
                <div className="pt-4 border-t border-slate-100">
                  <Button
                    type="submit"
                    disabled={isSubmitting || !isFormValid}
                    className="w-full h-12 bg-indigo-600 hover:bg-slate-900 text-white rounded-2xl font-extrabold text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 transition-all cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>Provisioning School Node...</>
                    ) : (
                      <>
                        <Sparkles size={18} /> Provision & Register Institution
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
                    Live Node Preview
                  </span>
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                    Ready to Commit
                  </Badge>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-serif font-black shadow-md shadow-indigo-100 shrink-0">
                      {formData.name.trim() ? formData.name.trim()[0].toUpperCase() : 'S'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-base font-black text-slate-900 truncate">
                        {formData.name.trim() || 'Institution Name'}
                      </h4>
                      <p className="text-xs text-slate-500 truncate">
                        {formData.board} • {formData.city || 'Location Pending'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-200/60 font-medium">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase block font-bold">Center Code</span>
                      <span className="font-mono text-indigo-600 font-bold">{formData.centerCode || 'AUTO'}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase block font-bold">Candidate Seats</span>
                      <span className="text-slate-900 font-bold">{Number(formData.totalStudents || 0).toLocaleString()} Enrolled</span>
                    </div>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase block font-bold">Master Admin</span>
                    <p className="text-xs text-slate-800 truncate font-mono">{formData.adminEmail || 'admin@school.edu'}</p>
                  </div>
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
                Institution Onboarded
              </span>
              <h2 className="text-3xl font-serif font-black text-slate-900">{createdSchoolData.name}</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Institutional node successfully registered in SuvenEdu Firestore registry. Admin credentials and student entry URLs generated below.
              </p>
            </div>

            {/* Creds & Link Blocks */}
            <div className="space-y-4 text-left">
              {/* Portal URL */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                    <Globe size={14} className="text-indigo-600" /> Student Examination Entry Link
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCopyPortalLink}
                    className="h-8 text-xs font-bold text-indigo-600 hover:text-indigo-900 hover:bg-slate-100 cursor-pointer"
                  >
                    {copiedLink ? <Check size={14} className="mr-1 text-emerald-600" /> : <Copy size={14} className="mr-1" />}
                    {copiedLink ? "Copied!" : "Copy Link"}
                  </Button>
                </div>
                <div className="p-3 bg-white rounded-xl border border-slate-200 font-mono text-xs text-indigo-600 break-all font-semibold">
                  {createdSchoolData.portalUrl}
                </div>
              </div>

              {/* Admin Credentials */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                    <Key size={14} className="text-amber-600" /> Master Admin Login Credentials
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCopyCredentials}
                    className="h-8 text-xs font-bold text-amber-700 hover:text-amber-900 hover:bg-slate-100 cursor-pointer"
                  >
                    {copiedCreds ? <Check size={14} className="mr-1 text-emerald-600" /> : <Copy size={14} className="mr-1" />}
                    {copiedCreds ? "Copied!" : "Copy All Credentials"}
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] text-slate-400 font-sans uppercase block font-bold">Admin Email</span>
                    <span className="text-slate-900 font-bold block truncate">{createdSchoolData.adminEmail}</span>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] text-slate-400 font-sans uppercase block font-bold">Temporary Password</span>
                    <span className="text-emerald-600 font-bold block truncate">{createdSchoolData.tempPassword}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-slate-100">
              <Button
                onClick={() => window.open(createdSchoolData.portalUrl, '_blank')}
                className="w-full sm:flex-1 h-12 bg-indigo-600 hover:bg-slate-900 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-100"
              >
                <ExternalLink size={16} /> Launch Student Portal
              </Button>
              <Button
                variant="outline"
                onClick={handleResetForm}
                className="w-full sm:flex-1 h-12 bg-white border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs cursor-pointer"
              >
                Onboard Another School
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/schools')}
                className="w-full sm:flex-1 h-12 bg-white border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs cursor-pointer"
              >
                Return to Registry
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
