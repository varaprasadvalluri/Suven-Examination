import { academicLevelDao } from '../../dao';
import { createNamedListController } from './createNamedListController';

// Admin-managed list of student "Academic Level"/class values (Play Class, LKG, …,
// Intermediate 2nd Year, and whatever an admin adds, e.g. "B.Tech", "Degree"). Replaces the
// hardcoded ACADEMIC_LEVELS arrays previously duplicated in SchoolStudentOnboarding.tsx and
// SchoolCandidateOnboarding.tsx. Unlike Subject Categories, 'school' needs READ access too
// (it picks from this list when onboarding a student) — write stays admin-only.
export default createNamedListController({
  dao: academicLevelDao,
  collectionName: 'academic_levels',
  basePath: '/api/v1/academic-levels',
  readRoles: ['admin', 'school'],
  writeRoles: ['admin']
});
