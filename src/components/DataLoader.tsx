import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertCircle, RefreshCw, ServerCrash } from 'lucide-react';
import { Button } from './ui/button';

interface DataLoaderProps {
  isLoading: boolean;
  error: Error | string | null;
  onRetry?: () => void;
  loadingMessage?: string;
  children: React.ReactNode;
}

export const DataLoader: React.FC<DataLoaderProps> = ({
  isLoading,
  error,
  onRetry,
  loadingMessage = "Synchronizing with secure academic cloud...",
  children,
}) => {
  return (
    <div className="relative min-h-[300px] w-full">
      <AnimatePresence mode="wait">
        {isLoading ? (
          /* 1. Initial State & 2. Background Overlay while fetching */
          <motion.div
            key="loading-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
            className="absolute inset-0 z-50 min-h-[400px] bg-slate-50/95 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 rounded-3xl"
            id="data-loader-overlay"
          >
            <div className="flex flex-col items-center gap-6 max-w-sm text-center">
              {/* Spinning/Rotating Indicator */}
              <div className="relative flex items-center justify-center">
                {/* Background glow animation */}
                <motion.div
                  className="absolute w-20 h-20 bg-indigo-500/10 rounded-full blur-xl"
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 0.8, 0.5],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                
                {/* Rotating outer ring */}
                <motion.div
                  className="w-16 h-16 rounded-full border-4 border-slate-100 border-t-indigo-600 border-r-indigo-600"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />

                {/* Inner rotating ring in opposite direction */}
                <motion.div
                  className="absolute w-10 h-10 rounded-full border-4 border-slate-150 border-b-rose-500 border-l-rose-500"
                  animate={{ rotate: -360 }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />

                {/* Centered logo icon */}
                <Loader2 className="absolute h-5 w-5 text-indigo-600 animate-spin" />
              </div>

              <div className="space-y-2">
                <motion.p
                  className="text-xs font-black uppercase tracking-[0.2em] text-slate-700 font-mono"
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                >
                  {loadingMessage}
                </motion.p>
                <p className="text-[11px] font-semibold text-slate-400">
                  Securing authentication tokens and fetching registry data packages...
                </p>
              </div>
            </div>
          </motion.div>
        ) : error ? (
          /* 4. Error Handling screen with Retry option */
          <motion.div
            key="error-state"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center min-h-[400px] p-4"
            id="data-loader-error"
          >
            <div className="w-full max-w-md bg-white border border-rose-100 rounded-[32px] p-8 text-center shadow-2xl shadow-rose-150/40 border-t-8 border-t-rose-500 space-y-6">
              <div className="h-16 w-16 bg-rose-50 border-2 border-rose-100 text-rose-500 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                <ServerCrash className="h-8 w-8 animate-bounce" />
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-black text-rose-950 uppercase tracking-tight">
                  Database Retrieval Interrupted
                </h3>
                <p className="text-slate-500 text-xs font-medium leading-relaxed px-2">
                  A connection disruption or secure credential verification failure occurred while downloading content from academic servers.
                </p>
              </div>

              <div className="bg-rose-50/50 border border-rose-100/60 p-4 rounded-2xl text-left font-mono">
                <p className="text-[10px] font-black uppercase tracking-wider text-rose-600 flex items-center gap-1.5 mb-1">
                  <AlertCircle className="h-3 w-3" /> Diagnostics Payload:
                </p>
                <p className="text-[11px] text-rose-800 font-semibold break-all leading-relaxed">
                  {typeof error === 'string' ? error : error.message || "Unknown communication failure"}
                </p>
              </div>

              {onRetry && (
                <Button
                  onClick={onRetry}
                  variant="outline"
                  className="w-full h-11 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 font-bold uppercase text-xs tracking-wider rounded-xl gap-2 shadow-sm active:scale-[0.98] transition-transform"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry Sync Operation
                </Button>
              )}
            </div>
          </motion.div>
        ) : (
          /* 3. Transition: smooth fade-in reveal of the fully populated actual UI */
          <motion.div
            key="actual-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.6, ease: "easeOut" } }}
            className="w-full h-full"
            id="data-loader-content"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
