import { AlertCircle } from 'lucide-react';

interface FieldErrorProps {
  /** Must match the aria-describedby of the input this belongs to. */
  id: string;
  message?: string | null;
}

/**
 * Inline, persistent error text for a single form field.
 *
 * Validation failures used to be reported only through `toast.error`, which disappears after a
 * few seconds and never says which field is wrong — on a long form that leaves the user hunting.
 * `role="alert"` makes the message announced when it appears, and pairing `id` with the input's
 * `aria-describedby` ties it to the field for screen readers.
 */
export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-[12px] md:text-[11px] font-semibold text-rose-600 mt-1.5">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
