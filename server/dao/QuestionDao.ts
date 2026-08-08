import { DocRecord } from './SchoolDao';

// Data-access contract for `questions`. Deliberately does NOT include answer-key
// sanitization — that's authorization logic (shouldSanitizeQuestionsForExam / status ===
// 'completed' gate), which stays in the controller, same as a Spring @Repository never
// deciding what a caller is allowed to see.
export interface QuestionDao {
  findByExamId(examId: string): Promise<DocRecord[]>;
}
