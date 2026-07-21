export type UserRole = 'admin' | 'school' | 'student';
export type AppPermission = 'manage_exams' | 'view_results' | 'take_exams' | 'manage_students';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: AppPermission[];
  schoolId?: string;
  class?: string;
  section?: string;
  rollNumber?: string;
  createdAt: any;
}

export type AuthPolicy = 'google' | 'password' | 'both';

export interface School {
  id: string;
  name: string;
  adminEmail: string;
  allowedDomains: string[];
  status: 'active' | 'inactive';
  authPolicy: AuthPolicy;
  region?: string;
  totalStudents?: number;
  attendanceRate?: number;
  avgScore?: number;
  createdAt: any;
}

export interface Question {
  id?: string;
  text: string;
  options: string[];
  correctAnswerIndex: number;
  marks: number;
  subject?: string; // Optional: Physics, Chemistry, Mathematics, Biology, etc.
  type?: 'single' | 'multiple' | 'numerical' | 'math'; // Type of answer format
  numericalAnswer?: string; // Correct value for numerical type
  explanation?: string; // Step-by-step resolution details
  imageUrl?: string;
  imagePublicId?: string;
  audioUrl?: string;
}

export interface Exam {
  id: string;
  title: string;
  description: string;
  subject: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  creatorId: string;
  duration: number;
  totalMarks: number;
  createdAt: any;
  startTime?: any;
  endTime?: any;
  status: 'published' | 'draft';
  questions?: Question[];
  assignedSchoolIds?: string[];
}

export interface Attempt {
  id: string;
  examId: string;
  examTitle?: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  schoolId?: string;
  answers: (number | string | number[] | null)[];
  timePerQuestion?: Record<string, number>;
  violationsCount?: number;
  tabSwitches?: number;
  malpracticeScore?: number;
  accuracy?: number;
  avgTimePerCorrect?: number;
  score: number;
  startTime: any;
  endTime?: any;
  status: 'started' | 'in-progress' | 'completed';
  canReattempt?: boolean;
}

export interface Microschedule {
  id: string;
  studentId: string;
  date: string;
  topics: { title: string; completed: boolean; type: 'study' | 'practice' }[];
  assignedExams: string[];
}

export interface ErrorBookEntry {
  id: string;
  studentId: string;
  examId: string;
  questionId: string;
  questionText: string;
  selectedAnswer: number;
  correctAnswer: number;
  explanation: string;
  subject: string;
  imageUrl?: string;
  createdAt: any;
}

export interface ProctoringLog {
  id: string;
  attemptId: string;
  studentId: string;
  type: 'look_away' | 'multi_person' | 'tab_switch' | 'blur';
  timestamp: any;
  snapshotUrl?: string;
}
