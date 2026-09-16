// PUBLIC SURFACE of the `student` feature.
//
// The student portal: dashboard and invite/secure-link entry.
//
// Other features must import from here and nowhere else — reaching into
// `features/student/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { StudentDashboard } from './components/StudentDashboard';
export { StudentLinkEntry } from './components/StudentLinkEntry';
export { useStudentExams } from './hooks/useStudentExams';
export type { ExamCandidate, UpcomingItem } from './hooks/useStudentExams';
