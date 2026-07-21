/**
 * Unified API Service Layer (ES Module Wrapper)
 * Bridges the TS service module to maintain precise physical alignment with the
 * requested `src/services/api.js` file path structure.
 */

import * as api from './api.ts';

export const {
  db,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  cloudinaryApi,
  authApi,
  gatekeeperApi,
  examsApi,
  schoolsService,
  examsService,
  attemptsService,
  performanceInterceptor,
  requestCache,
  examAnswerQueue,
  circuitBreaker
} = api;

export default api;
