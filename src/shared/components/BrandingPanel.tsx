import React from 'react';

/**
 * The dark marketing panel on the left of the sign-in and secure-link-entry screens.
 *
 * This markup existed twice, character for character, in LoginPage.tsx and
 * StudentLinkEntry.tsx — 57 lines of brand copy, statistics and decorative geometry. Two
 * copies of a brand surface is how the two screens drift: a stat updated in one place and
 * not the other, and nobody notices because the screens are reached by different users.
 *
 * Kept deliberately prop-less. Both callers render it identically today, and inventing
 * configuration for a variation nobody has asked for would trade one problem for a worse one.
 */
export const BrandingPanel: React.FC = () => (
  <div className="w-full lg:w-[45%] bg-[#0B1E3F] p-8 md:p-12 lg:p-16 flex flex-col justify-between relative text-white min-h-[450px] lg:min-h-screen overflow-hidden">
    {/* Subtle decorative glowing lights */}
    <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
    <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />

    {/* Abstract curve decorations in background (recreating the circles in Figma left design) */}
    <div className="absolute top-0 right-0 w-[450px] h-[450px] rounded-full border border-white/[0.03] translate-x-1/3 -translate-y-1/3 pointer-events-none" />
    <div className="absolute top-0 right-0 w-[550px] h-[550px] rounded-full border border-white/[0.02] translate-x-1/4 -translate-y-1/4 pointer-events-none" />
    <div className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full border border-white/[0.03] -translate-x-1/3 translate-y-1/3 pointer-events-none" />

    {/* Header branding on left corner */}
    <div className="flex items-center gap-3 relative z-10">
      <div className="h-10 w-10 rounded-xl bg-[#f2a81e] flex items-center justify-center font-black text-white text-lg shadow-md shadow-[#f2a81e]/20">
        S
      </div>
      <div>
        <span className="font-sans font-extrabold text-sm uppercase tracking-wider text-white block leading-none">SUVEN EDU</span>
        <span className="text-[11px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5">EXAM PORTAL</span>
      </div>
    </div>

    {/* Welcoming Messages (Figma matches) */}
    <div className="my-auto py-8 lg:py-0 relative z-10">
      <span className="text-[#38bdf8] font-extrabold text-[12px] md:text-[11px] uppercase tracking-[0.2em] block mb-3">WELCOME BACK</span>
      <h1 className="text-3xl md:text-4.5xl font-extrabold text-white tracking-tight leading-[1.15] mb-4">
        Your academic
        <br />
        journey,
        <br />
        <span className="text-[#f2a81e]">simplified.</span>
      </h1>
      <p className="text-xs md:text-sm text-slate-300 leading-relaxed max-w-sm font-medium mt-6 opacity-80">
        Conduct, manage, and analyze examinations with one unified platform built for modern schools.
      </p>
    </div>

    {/* Bottom Section: Translucent Stats Card & Social proof */}
    <div className="space-y-6 relative z-10 mt-auto">
      <div className="grid grid-cols-3 gap-2 bg-white/[0.04] border border-white/10 rounded-2xl p-5 backdrop-blur-md text-center">
        <div>
          <span className="text-xl font-black text-white block tracking-tight">12,400+</span>
          <span className="text-[11px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-0.5">Students</span>
        </div>
        <div className="border-x border-white/10">
          <span className="text-xl font-black text-white block tracking-tight">340+</span>
          <span className="text-[11px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-0.5">Teachers</span>
        </div>
        <div>
          <span className="text-xl font-black text-white block tracking-tight">98%</span>
          <span className="text-[11px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-0.5">Satisfaction</span>
        </div>
      </div>

      {/* Overlapping colored circle avatars */}
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 border border-[#0B1E3F]" />
          <div className="w-6 h-6 rounded-full bg-cyan-400 border border-[#0B1E3F]" />
          <div className="w-6 h-6 rounded-full bg-emerald-500 border border-[#0B1E3F]" />
        </div>
        <span className="text-xs text-slate-300 font-semibold opacity-90">Trusted by 50+ schools nationwide</span>
      </div>
    </div>
  </div>
);
