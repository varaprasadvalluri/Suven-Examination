import { createFirestoreNamedListDao, NamedListDao } from './createNamedListDao';

export const subjectCategoryDao: NamedListDao = createFirestoreNamedListDao('subject_categories');
