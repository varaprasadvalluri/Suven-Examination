import { Clock } from '../../../application/ports/Clock';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  timestamp(): number {
    return Date.now();
  }
}

export const systemClock: Clock = new SystemClock();
