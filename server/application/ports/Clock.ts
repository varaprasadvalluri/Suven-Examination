// Reading "now" is I/O against the world, the same as reading a database. Behind a port it
// can be frozen in tests instead of forcing them to work around whatever the wall clock says.
export interface Clock {
  now(): Date;
  timestamp(): number;
}
