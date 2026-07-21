import React, { Component, ErrorInfo, ReactNode } from 'react';
import { 
  ShieldAlert, 
  X, 
  Copy, 
  Check, 
  RefreshCw, 
  Terminal, 
  ChevronDown, 
  ChevronUp,
  AlertTriangle
} from 'lucide-react';
import { initializeGlobalErrorMiddleware } from '../lib/customErrors';

interface Props {
  children: ReactNode;
}

interface State {
  // Rendering boundary state
  hasRuntimeCrash: boolean;
  crashError: Error | null;

  // Global exception modal popup state
  activeException: {
    action: string;
    friendlyMessage: string;
    technicalDetails: string;
    code: string;
  } | null;

  showTechnicalDetails: boolean;
  isCopied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  private cleanupMiddleware: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasRuntimeCrash: false,
      crashError: null,
      activeException: null,
      showTechnicalDetails: false,
      isCopied: false
    };
  }

  // Catch rendering-level crashes
  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasRuntimeCrash: true,
      crashError: error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[CENTRAL RUNTIME RENDER CRASH CAUGHT BY ERROR BOUNDARY]:', error, errorInfo);
  }

  // Listen to custom exceptions dispatched from any async flow
  handleCustomException = (event: Event): void => {
    const customEvent = event as CustomEvent;
    if (customEvent.detail) {
      this.setState({
        activeException: {
          action: customEvent.detail.action || 'Portal Operation',
          friendlyMessage: customEvent.detail.friendlyMessage || 'An unexpected error occurred.',
          technicalDetails: customEvent.detail.technicalDetails || 'No technical logs provided.',
          code: customEvent.detail.code || 'UNKNOWN_CODE',
        },
        showTechnicalDetails: false,
        isCopied: false
      });
    }
  };

  componentDidMount(): void {
    // 1. Initialize our global error catching middleware
    this.cleanupMiddleware = initializeGlobalErrorMiddleware();

    // 2. Listen for custom mapped exceptions from database/auth triggers
    window.addEventListener('app-custom-exception', this.handleCustomException);
  }

  componentWillUnmount(): void {
    // Cleanup listeners
    if (this.cleanupMiddleware) {
      this.cleanupMiddleware();
    }
    window.removeEventListener('app-custom-exception', this.handleCustomException);
  }

  handleCopyDetails = async (): Promise<void> => {
    const { activeException, crashError } = this.state;
    const detailsText = activeException 
      ? `Action: ${activeException.action}\nCode: ${activeException.code}\nError: ${activeException.friendlyMessage}\nTechnical Logs: ${activeException.technicalDetails}`
      : crashError?.stack || crashError?.message || 'Unknown Crash';

    try {
      await navigator.clipboard.writeText(detailsText);
      this.setState({ isCopied: true });
      setTimeout(() => this.setState({ isCopied: false }), 2000);
    } catch (err) {
      console.warn('Failed to copy error details to clipboard', err);
    }
  };

  handleDismissException = (): void => {
    this.setState({
      activeException: null,
      showTechnicalDetails: false,
      isCopied: false
    });
  };

  handleReloadPage = (): void => {
    window.location.reload();
  };

  render() {
    const { hasRuntimeCrash, crashError, activeException, showTechnicalDetails, isCopied } = this.state;

    // 1. Handle Critical UI Render-Level Crashes
    if (hasRuntimeCrash) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
          <div 
            id="runtime-crash-boundary-card"
            className="w-full max-w-xl bg-white border-2 border-b-[8px] border-slate-200 rounded-[32px] p-8 md:p-10 shadow-2xl relative overflow-hidden text-center"
          >
            {/* Design accents */}
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-rose-50 rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col items-center justify-center space-y-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 border-2 border-b-[4px] border-rose-200 text-rose-600 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 animate-bounce" />
              </div>
              <span className="text-[10px] font-black tracking-widest text-rose-500 uppercase">
                CRITICAL RENDERING FAULT
              </span>
            </div>

            <div className="space-y-3 mb-8">
              <h2 className="text-2xl font-black font-display text-slate-900 uppercase tracking-tight">
                UI Interface Interrupted
              </h2>
              <p className="text-slate-600 font-semibold text-xs leading-relaxed max-w-md mx-auto">
                A rendering issue prevented the screen from loading correctly. Don't worry, all database connections and authentication sessions remain perfectly safe.
              </p>
            </div>

            {/* Accordion for developer diagnostics */}
            <div className="border border-slate-100 rounded-2xl bg-slate-50 overflow-hidden text-left mb-8 transition-all">
              <button
                type="button"
                onClick={() => this.setState({ showTechnicalDetails: !showTechnicalDetails })}
                className="w-full px-5 py-4 flex items-center justify-between text-xs font-black text-slate-700 uppercase tracking-wider hover:bg-slate-100 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-slate-400" />
                  Technical Stack Trace
                </span>
                {showTechnicalDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showTechnicalDetails && (
                <div className="px-5 pb-5 pt-1 border-t border-slate-200/60">
                  <pre className="text-[10px] font-mono font-medium text-rose-600 bg-rose-50/50 p-4 rounded-xl max-h-48 overflow-auto border border-rose-100 whitespace-pre-wrap leading-relaxed">
                    {crashError?.stack || crashError?.message || 'No stack trace found.'}
                  </pre>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={this.handleCopyDetails}
                      className="h-8 px-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] font-bold text-slate-600 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                    >
                      {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      {isCopied ? 'Copied Log' : 'Copy Stack Trace'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Recovery Action */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={this.handleReloadPage}
                className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl border-b-[5px] border-indigo-800 hover:scale-[1.01] active:scale-[0.99] transition-transform duration-100 flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Portal Instance
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasRuntimeCrash: false, crashError: null })}
                className="px-6 h-12 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:text-slate-900 transition-colors"
              >
                Dismiss Crash Fallback
              </button>
            </div>
          </div>
        </div>
      );
    }

    // 2. Render Children with dynamic Exception Intercept Overlay Dialog
    return (
      <>
        {this.props.children}

        {/* Centralized Mapped Custom Exception Modal Dialog Popup */}
        {activeException && (
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-300">
            <div 
              id="central-custom-exception-popup"
              className="w-full max-w-lg bg-white border-2 border-b-[8px] border-slate-300 rounded-[32px] p-8 md:p-10 shadow-2xl relative overflow-hidden space-y-6 animate-in zoom-in-95 duration-200"
            >
              {/* Corner Close Button */}
              <button
                type="button"
                onClick={this.handleDismissException}
                className="absolute top-6 right-6 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all active:scale-90"
                aria-label="Close Error Popup"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Ambient design background */}
              <div className="absolute -top-16 -left-16 w-32 h-32 bg-amber-50 rounded-full blur-2xl pointer-events-none" />

              {/* Header Icon Section */}
              <div className="flex flex-col items-center justify-center text-center space-y-3.5 relative z-10">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 border-2 border-b-[4px] border-amber-200 text-amber-500 flex items-center justify-center">
                  <ShieldAlert className="h-8 w-8" />
                </div>
                
                <div>
                  <span className="text-[10px] font-black tracking-widest text-amber-500 uppercase block mb-1">
                    Custom Operational Exception
                  </span>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500 font-mono">
                    Exception Code: {activeException.code}
                  </div>
                </div>
              </div>

              {/* Error explanation content */}
              <div className="space-y-3 text-center">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Failed Attempt: <span className="text-slate-800 font-extrabold">"{activeException.action}"</span>
                </div>
                <h3 className="text-xl font-black font-display text-slate-900 leading-tight">
                  Action Could Not Be Completed
                </h3>
                <p className="text-slate-600 font-semibold text-xs leading-relaxed max-w-sm mx-auto">
                  {activeException.friendlyMessage}
                </p>
              </div>

              {/* Collapsible Advanced / Technical details panel (designed perfectly for developers) */}
              <div className="border border-slate-100 rounded-2xl bg-slate-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => this.setState({ showTechnicalDetails: !showTechnicalDetails })}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-black text-slate-500 uppercase tracking-wider hover:bg-slate-100 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-slate-400" />
                    Developer Diagnostics (Raw Logs)
                  </span>
                  {showTechnicalDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {showTechnicalDetails && (
                  <div className="px-5 pb-5 pt-1 border-t border-slate-200/60">
                    <pre className="text-[10px] font-mono font-medium text-slate-600 bg-slate-100 p-3.5 rounded-xl max-h-36 overflow-auto border border-slate-200/60 whitespace-pre-wrap leading-relaxed">
                      {activeException.technicalDetails}
                    </pre>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={this.handleCopyDetails}
                        className="h-8 px-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] font-bold text-slate-600 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                      >
                        {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        {isCopied ? 'Copied Log' : 'Copy Raw Details'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Control Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={this.handleDismissException}
                  className="flex-1 h-12 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl border-b-[5px] border-slate-950 hover:scale-[1.01] active:scale-[0.99] transition-transform duration-100 flex items-center justify-center gap-2"
                >
                  Acknowledge & Close
                </button>
                <button
                  type="button"
                  onClick={this.handleReloadPage}
                  className="px-5 h-12 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-500 hover:text-slate-800 font-bold rounded-xl text-xs transition-colors"
                  title="Reload instance"
                >
                  <RefreshCw className="h-4 w-4 animate-spin-hover" />
                </button>
              </div>

              {/* Safe Humble Identifier Disclaimer */}
              <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider text-center">
                SuvenEdu Safety Node • Active Exception Mapped Successfully
              </p>
            </div>
          </div>
        )}
      </>
    );
  }
}
