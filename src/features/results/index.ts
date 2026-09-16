// PUBLIC SURFACE of the `results` feature.
//
// Result viewing, reachable by any authenticated role for an attempt they may see.
//
// Other features must import from here and nowhere else — reaching into
// `features/results/components/...` directly is what turns feature folders back into one
// tangled folder with extra nesting. Enforced by eslint-plugin-boundaries.

export { ResultDetails } from './components/ResultDetails';
