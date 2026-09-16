// PUBLIC SURFACE of the `exam-session` feature.
//
// Sitting an exam: the interface plus its in-exam tools and sync/offline machinery.
//
// Other features must import from here and nowhere else — reaching into
// `features/exam-session/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { ExamInstructionsScreen } from './components/ExamInstructionsScreen';
export type { ExamInstructionsScreenProps } from './components/ExamInstructionsScreen';
export { ExamInterface } from './components/ExamInterface';
export { ExamSyncProvider, useExamSync } from './components/ExamSyncContext';
export { LazyExamAsset } from './components/LazyExamAsset';
export { OfflineSubmissionSafeWall } from './components/OfflineSubmissionSafeWall';
export { PeriodicTableHelper } from './components/PeriodicTableHelper';
export { ScratchpadCanvas } from './components/ScratchpadCanvas';
