// PUBLIC SURFACE of the `auth` feature.
//
// Login and role-selection screens.
//
// AuthContext deliberately does NOT live here: it is consumed by six features, and routing
// those through this barrel dragged LoginPage into every one of them — which closed a cycle
// (auth -> exam-session -> auth). Session state is app-wide infrastructure, so it sits in
// lib/, importable by any feature without crossing a feature boundary.
//
// Other features must import from here and nowhere else — reaching into
// `features/auth/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { LoginPage } from './components/LoginPage';
export { RoleSelection } from './components/RoleSelection';
