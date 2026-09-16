import { createFirestoreNamedListDao, NamedListDao } from './createNamedListDao';

export const academicLevelDao: NamedListDao = createFirestoreNamedListDao('academic_levels');
