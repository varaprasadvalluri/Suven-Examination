// PUBLIC SURFACE of the `staff` feature.
//
// Screens both admin and school reach (route gate: roles={['admin','school']}).
// Split out of admin/ because ten screens are genuinely shared — folding them into either
// role would force the other to reach across a feature boundary to use them.
//
// Other features must import from here and nowhere else — reaching into
// `features/staff/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { AdminCreateExam } from './components/AdminCreateExam';
export { AdminDispatchCenter } from './components/AdminDispatchCenter';
export { AdminExams } from './components/AdminExams';
export { AdminResults } from './components/AdminResults';
export { ExamQuestions } from './components/ExamQuestions';
export { LiveProctoringWall } from './components/LiveProctoringWall';
export { RankingEngine } from './components/RankingEngine';
export { SchoolCandidateOnboarding } from './components/SchoolCandidateOnboarding';
export { StudentExamHistory } from './components/StudentExamHistory';
export { SyllabusTracker } from './components/SyllabusTracker';
