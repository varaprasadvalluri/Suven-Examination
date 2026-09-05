// PUBLIC SURFACE of the `admin` feature.
//
// Admin-only back-office screens (route gate: roles={['admin']}).
//
// Other features must import from here and nowhere else — reaching into
// `features/admin/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { AdminAnalytics } from './components/AdminAnalytics';
export { AdminCloudBilling } from './components/AdminCloudBilling';
export { AdminOverview } from './components/AdminOverview';
export { AdminSchoolManagement } from './components/AdminSchoolManagement';
export { AdminSchoolOnboarding } from './components/AdminSchoolOnboarding';
