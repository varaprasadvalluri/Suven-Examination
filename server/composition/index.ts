// COMPOSITION ROOT — the only place in the server that knows which concrete adapter sits
// behind each port. Everything in application/ depends on the interfaces in
// application/ports/; only this file names the Firestore/Firebase/Cloud Tasks/Cloudinary
// implementations. Swapping an infrastructure choice (or the whole backend) means editing
// the lines below, not every controller's import.
//
// The dependency rule this enforces is checked by eslint-plugin-boundaries (see
// eslint.config.js): adapters/ may import anything, application/ may not import adapters/,
// and nothing but this directory may import adapters/out/.

// -- Persistence -----------------------------------------------------------------------
export { academicLevelDao } from '../adapters/out/firestore/FirestoreAcademicLevelDao';
export { adminStaffDao } from '../adapters/out/firestore/FirestoreAdminStaffDao';
export { attemptDao } from '../adapters/out/firestore/FirestoreAttemptDao';
export { examDao } from '../adapters/out/firestore/FirestoreExamDao';
export { invitationDao } from '../adapters/out/firestore/FirestoreInvitationDao';
export { loginOptionsDao } from '../adapters/out/firestore/FirestoreLoginOptionsDao';
export { questionDao } from '../adapters/out/firestore/FirestoreQuestionDao';
export { schoolDao } from '../adapters/out/firestore/FirestoreSchoolDao';
export { secureExamLinkDao } from '../adapters/out/firestore/FirestoreSecureExamLinkDao';
export { studentDao } from '../adapters/out/firestore/FirestoreStudentDao';
export { subjectCategoryDao } from '../adapters/out/firestore/FirestoreSubjectCategoryDao';

// -- Identity --------------------------------------------------------------------------
export { tokenVerifier } from '../adapters/out/firebase/FirebaseTokenVerifier';

// -- Generic document access -----------------------------------------------------------
export { documentStore } from '../adapters/out/firestore/FirestoreDocumentStore';

// -- Authorization ---------------------------------------------------------------------
// Bound helpers, not the instance: every existing call site reads as a plain function call,
// same shape it had before the service took a constructor dependency.
import { AuthorizationService } from '../application/services/authorization';
import { documentStore as documents } from '../adapters/out/firestore/FirestoreDocumentStore';

export const authorizationService = new AuthorizationService(documents);
export const sanitizeForPublicRead = authorizationService.sanitizeForPublicRead.bind(authorizationService);
export const scopeFieldFor = authorizationService.scopeFieldFor.bind(authorizationService);
export const scopeValueFor = authorizationService.scopeValueFor.bind(authorizationService);
export const injectReadScope = authorizationService.injectReadScope.bind(authorizationService);
export const authorizeWrite = authorizationService.authorizeWrite.bind(authorizationService);

// -- Clock -----------------------------------------------------------------------------
export { systemClock } from '../adapters/out/system/SystemClock';

// -- Grading ---------------------------------------------------------------------------
// Wiring order matters here and nowhere else: the Cloud Tasks dispatcher falls back to
// grading inline when no queue is configured, so it needs the grading use case, which needs
// scoring, which needs the attempt and question DAOs.
import { attemptDao as attempts } from '../adapters/out/firestore/FirestoreAttemptDao';
import { questionDao as questions } from '../adapters/out/firestore/FirestoreQuestionDao';
import { systemClock as clock } from '../adapters/out/system/SystemClock';
import { ScoreVerificationService } from '../application/services/scoreVerification';
import { GradeAttemptService } from '../application/services/GradeAttemptService';
import { CloudTasksGradingDispatcher } from '../adapters/out/cloudtasks/CloudTasksGradingDispatcher';
import { AttemptSubmissionService } from '../application/services/AttemptSubmissionService';

export const scoreVerificationService = new ScoreVerificationService(attempts, questions, clock);
export const gradeAttemptService = new GradeAttemptService(attempts, scoreVerificationService);
export const gradingDispatcher = new CloudTasksGradingDispatcher(gradeAttemptService);

// -- Submission ------------------------------------------------------------------------
export const attemptSubmissionService = new AttemptSubmissionService(attempts, documents, gradingDispatcher, authorizationService, clock);

// -- Media -----------------------------------------------------------------------------
// Both stores are live at once: assets predating the Firebase Storage migration still sit in
// Cloudinary. Cleanup is therefore routed by ownership rather than configuration, and callers
// deleting a question no longer need to know the `firebase:` prefix convention themselves.
import { cloudinaryMediaStore } from '../adapters/out/cloudinary/CloudinaryMediaStore';
import { firebaseStorageMediaStore } from '../adapters/out/firebase/FirebaseStorageMediaStore';
import { MediaCleanupResult } from '../application/ports/MediaStore';

export { cloudinaryMediaStore, firebaseStorageMediaStore };

// Ordered most-specific first: the Cloudinary store claims anything not prefixed, so it must
// be asked last.
const mediaStores = [firebaseStorageMediaStore, cloudinaryMediaStore];

export function deleteMediaAsset(publicId: string | undefined | null): Promise<MediaCleanupResult> {
  const store = publicId ? mediaStores.find((candidate) => candidate.owns(publicId)) : undefined;
  if (!store) {
    return Promise.resolve({ success: false, error: 'No media store owns this publicId' });
  }
  return store.delete(publicId as string);
}

// -- Student dashboard -----------------------------------------------------------------
import { StudentDashboardService } from '../application/services/StudentDashboardService';
import { examDao as exams } from '../adapters/out/firestore/FirestoreExamDao';
import { invitationDao as invitations } from '../adapters/out/firestore/FirestoreInvitationDao';
import { secureExamLinkDao as secureExamLinks } from '../adapters/out/firestore/FirestoreSecureExamLinkDao';

export const studentDashboardService = new StudentDashboardService(attempts, exams, invitations, secureExamLinks);
