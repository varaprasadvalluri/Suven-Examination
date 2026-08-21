// Composition root: the only place that knows the DAOs are Firestore-backed. Routes/
// controllers must import DAO singletons from here, never from a `Firestore*Dao` file
// directly — swapping the database later means changing the constructors below, not
// every controller's import line.
export { adminStaffDao } from './FirestoreAdminStaffDao';
export { attemptDao } from './FirestoreAttemptDao';
export { examDao } from './FirestoreExamDao';
export { invitationDao } from './FirestoreInvitationDao';
export { loginOptionsDao } from './FirestoreLoginOptionsDao';
export { questionDao } from './FirestoreQuestionDao';
export { schoolDao } from './FirestoreSchoolDao';
export { secureExamLinkDao } from './FirestoreSecureExamLinkDao';
export { studentDao } from './FirestoreStudentDao';
