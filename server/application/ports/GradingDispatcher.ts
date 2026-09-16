// The DTO a submission is turned into before grading — deliberately just plain data (no
// Firestore doc references, no class instances), so it survives being serialized into a
// queue message and deserialized again on the worker side unchanged.
export interface GradingTaskDto {
  eventId: string;
  timestamp: string;
  examId: string;
  studentId: string;
  answers: any[];
  attemptId: string;
}

// "Get this attempt graded, not on this request thread." Submission depends on this promise
// only — whether it is honoured by a Cloud Tasks queue, some other broker, or by grading
// inline because no queue is configured, is an infrastructure decision the adapter makes.
export interface GradingDispatcher {
  dispatch(task: GradingTaskDto): Promise<void>;
}
