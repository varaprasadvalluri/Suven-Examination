import { subjectCategoryDao } from '../../dao';
import { createNamedListController } from './createNamedListController';

// Admin-managed list of exam/question "Subject" values (Mathematics, Physics, … and whatever
// an admin adds, e.g. "B.Tech", "Degree"). Replaces the hardcoded SUBJECTS arrays previously
// duplicated in AdminCreateExam.tsx, AdminExams.tsx, and ExamQuestions.tsx. Read+write are both
// admin-only — none of those three dropdowns render for a 'school' session (canManage gates).
export default createNamedListController({
  dao: subjectCategoryDao,
  collectionName: 'subject_categories',
  basePath: '/api/v1/subject-categories',
  readRoles: ['admin'],
  writeRoles: ['admin']
});
