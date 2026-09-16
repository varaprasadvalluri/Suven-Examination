// Process lifecycle state, shared between server.ts (which owns the shutdown sequence) and
// routes/health.ts (which has to report it). Kept in its own module rather than exported from
// server.ts so the health router doesn't have to import the composition root back.
//
// The distinction this exists to serve: a process that is draining is still LIVE (it must
// finish the requests it already accepted) but is no longer READY (the load balancer should
// stop sending it new ones). Collapsing those two into a single /health that returns 500 is
// what turns an ordinary rolling deploy into user-visible 502s.

let draining = false;

export function beginDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}
