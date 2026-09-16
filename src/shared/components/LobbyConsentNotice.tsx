import React from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * The proctoring-consent notice shown above the "start exam" button.
 *
 * Identical in LoginPage and StudentLinkEntry — the two routes a student can reach an exam
 * through. This is consent copy, so the two screens saying subtly different things is a
 * problem well beyond tidiness: whichever wording a student saw is the one they agreed to.
 */
export const LobbyConsentNotice: React.FC = () => (
  <div className="bg-amber-50/60 border border-amber-100/80 p-3.5 rounded-2xl flex items-start gap-2.5 mt-5">
    <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
    <div className="text-[11px] md:text-[10px] font-semibold text-slate-700 leading-normal">
      <p className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px] md:text-[8px] mb-0.5">Lobby Verification Consent</p>
      By activating this exam, you agree to secure browser lockdowns and temporary test progress tracking.
    </div>
  </div>
);
