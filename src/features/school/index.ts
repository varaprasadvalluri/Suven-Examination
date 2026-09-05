// PUBLIC SURFACE of the `school` feature.
//
// School-only screens (a school administers its own students).
//
// Other features must import from here and nowhere else — reaching into
// `features/school/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { SchoolDashboard } from './components/SchoolDashboard';
export { SchoolStudentOnboarding } from './components/SchoolStudentOnboarding';
