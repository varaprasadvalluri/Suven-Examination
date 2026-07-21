import React, { Component, ErrorInfo, ReactNode } from 'react';
import { 
  ShieldAlert, 
  WifiOff, 
  FileQuestion, 
  ServerCrash, 
  RefreshCw, 
  LogIn 
} from 'lucide-react';

// Custom event interface for global HTTP interceptor
interface HttpErrorDetail {
  status: number | 'offline';
  url?: string;
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorType: 'runtime' | 'http' | 'offline' | null;
  httpStatus: number | null;
  errorMessage: string;
}

// Preserve original fetch definition to restore on unmount if necessary
const originalFetch = window.fetch;

export class RootSafetyWrapper extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorType: null,
      httpStatus: null,
      errorMessage: ''
    };
  }

  // React Error Boundary lifecycle method to catch rendering-level crashes
  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      errorType: 'runtime',
      errorMessage: error.message || 'A critical frontend crash was caught by the Safety Hub.'
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[CRITICAL RUNTIME ERROR CAUGHT BY SAFETY WRAPPER]:', error, errorInfo);
  }

  // Handlers for dynamic state updates from events
  handleGlobalHttpError = (event: Event): void => {
    const customEvent = event as CustomEvent<HttpErrorDetail>;
    const { status } = customEvent.detail;

    if (status === 'offline') {
      this.setState({
        hasError: true,
        errorType: 'offline',
        httpStatus: null
      });
    } else {
      this.setState({
        hasError: true,
        errorType: 'http',
        httpStatus: status
      });
    }
  };

  handleOfflineEvent = (): void => {
    this.setState({
      hasError: true,
      errorType: 'offline',
      httpStatus: null
    });
  };

  handleOnlineEvent = (): void => {
    // Automatically dismiss the offline modal if internet connection recovers
    if (this.state.errorType === 'offline') {
      this.handleReset();
    }
  };

  componentDidMount(): void {
    // 1. Listen for custom intercepted HTTP events
    window.addEventListener('global-http-error', this.handleGlobalHttpError);

    // 2. Listen for standard browser connection events
    window.addEventListener('offline', this.handleOfflineEvent);
    window.addEventListener('online', this.handleOnlineEvent);

    // 3. Check current state on mount
    if (!navigator.onLine) {
      this.handleOfflineEvent();
    }

    // 4. Overwrite standard window.fetch to automatically intercept unhandled status codes globally
    try {
      const customFetch = async function (...args: any[]) {
        try {
          const response = await originalFetch.apply(window, args as any);
          
          if (!response.ok) {
            const status = response.status;
            
            // Intercept unhandled critical status codes
            if ([400, 401, 403, 404, 500].includes(status)) {
              const event = new CustomEvent<HttpErrorDetail>('global-http-error', { 
                detail: { status, url: response.url } 
              });
              window.dispatchEvent(event);
            }
          }
          return response;
        } catch (err) {
          // Handle failed connection / network interruption gracefully
          if (!navigator.onLine) {
            const event = new CustomEvent<HttpErrorDetail>('global-http-error', { 
              detail: { status: 'offline' } 
            });
            window.dispatchEvent(event);
          }
          throw err;
        }
      };

      // Try direct assignment
      (window as any).fetch = customFetch;
    } catch (err) {
      console.warn('[RootSafetyWrapper] Unable to override window.fetch directly. Trying Object.defineProperty...', err);
      try {
        const customFetch = async function (...args: any[]) {
          try {
            const response = await originalFetch.apply(window, args as any);
            
            if (!response.ok) {
              const status = response.status;
              
              // Intercept unhandled critical status codes
              if ([400, 401, 403, 404, 500].includes(status)) {
                const event = new CustomEvent<HttpErrorDetail>('global-http-error', { 
                  detail: { status, url: response.url } 
                });
                window.dispatchEvent(event);
              }
            }
            return response;
          } catch (err) {
            // Handle failed connection / network interruption gracefully
            if (!navigator.onLine) {
              const event = new CustomEvent<HttpErrorDetail>('global-http-error', { 
                detail: { status: 'offline' } 
              });
              window.dispatchEvent(event);
            }
            throw err;
          }
        };

        Object.defineProperty(window, 'fetch', {
          value: customFetch,
          configurable: true,
          writable: true,
          enumerable: true
        });
      } catch (err2) {
        console.warn('[RootSafetyWrapper] Could not intercept window.fetch globally due to strict environment restrictions. Utilizing fallback inline interceptions.', err2);
      }
    }
  }

  componentWillUnmount(): void {
    // Clean up event listeners and restore standard fetch
    window.removeEventListener('global-http-error', this.handleGlobalHttpError);
    window.removeEventListener('offline', this.handleOfflineEvent);
    window.removeEventListener('online', this.handleOnlineEvent);
    try {
      (window as any).fetch = originalFetch;
    } catch (e) {
      try {
        Object.defineProperty(window, 'fetch', {
          value: originalFetch,
          configurable: true,
          writable: true,
          enumerable: true
        });
      } catch (e2) {}
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      errorType: null,
      httpStatus: null,
      errorMessage: ''
    });
  };

  handleRecoveryAction = (): void => {
    const { errorType, httpStatus } = this.state;

    if (errorType === 'http' && (httpStatus === 401 || httpStatus === 403)) {
      // Session expiry: Route back to root login landing page safely
      window.location.href = '/';
    } else {
      // Dynamic fallback: fully reload the webpage context to reset standard state machines
      window.location.reload();
    }
  };

  render() {
    const { hasError, errorType, httpStatus } = this.state;

    if (hasError) {
      // Config mapping variables
      let title = 'System Advisory';
      let description = 'The application encountered an unexpected situation.';
      let actionLabel = 'Refresh Page';
      let IconComponent = ServerCrash;
      let themeColorClass = 'text-indigo-600 bg-indigo-50 border-indigo-200';
      let btnColorClass = 'bg-indigo-600 hover:bg-indigo-700 border-indigo-850';

      // 1. Offline Mode
      if (errorType === 'offline') {
        title = 'Network Disconnected';
        description = 'Please check your internet connection.';
        actionLabel = 'Retry Connection';
        IconComponent = WifiOff;
        themeColorClass = 'text-amber-600 bg-amber-50 border-amber-200';
        btnColorClass = 'bg-amber-500 hover:bg-amber-600 border-amber-700';
      }
      // 2. HTTP Exception Code Handling
      else if (errorType === 'http') {
        if (httpStatus === 401 || httpStatus === 403) {
          title = 'Session Expired';
          description = 'Your session has expired. Please log in again.';
          actionLabel = 'Go to Login';
          IconComponent = ShieldAlert;
          themeColorClass = 'text-rose-600 bg-rose-50 border-rose-200';
          btnColorClass = 'bg-rose-600 hover:bg-rose-700 border-rose-850';
        } else if (httpStatus === 404) {
          title = 'Data Not Found';
          description = 'The requested page or data could not be found.';
          actionLabel = 'Refresh Page';
          IconComponent = FileQuestion;
          themeColorClass = 'text-slate-600 bg-slate-50 border-slate-200';
          btnColorClass = 'bg-slate-700 hover:bg-slate-800 border-slate-900';
        } else {
          // 400, 500, or any other unhandled HTTP errors
          title = 'Server Error Encountered';
          description = 'The server encountered an error. Please try refreshing the page.';
          actionLabel = 'Refresh Page';
          IconComponent = ServerCrash;
          themeColorClass = 'text-indigo-600 bg-indigo-50 border-indigo-200';
          btnColorClass = 'bg-indigo-600 hover:bg-indigo-700 border-indigo-850';
        }
      }
      // 3. React Runtime Render-Level Crashes
      else if (errorType === 'runtime') {
        title = 'System Interrupted';
        description = 'The server encountered an error. Please try refreshing the page.';
        actionLabel = 'Refresh Page';
        IconComponent = ServerCrash;
        themeColorClass = 'text-indigo-600 bg-indigo-50 border-indigo-200';
        btnColorClass = 'bg-indigo-600 hover:bg-indigo-700 border-indigo-850';
      }

      return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-300">
          <div 
            id="safety-error-card"
            className="w-full max-w-md bg-white border-2 border-b-[8px] border-slate-200 rounded-[32px] p-8 md:p-10 text-center space-y-6 shadow-2xl relative overflow-hidden"
          >
            {/* Ambient Background Decorative Glow */}
            <div className="absolute -top-16 -right-16 w-32 h-32 bg-slate-100 rounded-full blur-2xl pointer-events-none" />
            
            {/* Visual Icon Header */}
            <div className="flex flex-col items-center justify-center space-y-3.5 relative z-10">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 border-b-[4px] ${themeColorClass}`}>
                <IconComponent className="h-8 w-8" />
              </div>
              
              <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase">
                {errorType === 'http' ? `HTTP STATUS NODE ${httpStatus}` : 'PORTAL DIAGNOSTIC'}
              </span>
            </div>

            {/* Content Text Fields */}
            <div className="space-y-2.5">
              <h2 className="text-2xl font-black font-display text-slate-950 uppercase tracking-tight">
                {title}
              </h2>
              <p className="text-slate-600 font-semibold text-xs leading-relaxed max-w-sm mx-auto">
                {description}
              </p>
            </div>

            {/* Interactive Recovery Action Button */}
            <div className="pt-2 flex flex-col gap-3">
              <button
                id="safety-error-action-btn"
                onClick={this.handleRecoveryAction}
                className={`w-full h-12 text-white font-extrabold rounded-xl border-b-[5px] hover:scale-[1.01] active:scale-[0.99] transition-transform duration-100 flex items-center justify-center gap-2 ${btnColorClass}`}
              >
                {httpStatus === 401 || httpStatus === 403 ? (
                  <LogIn className="h-4 w-4" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {actionLabel}
              </button>

              <button
                id="safety-error-dismiss-btn"
                onClick={this.handleReset}
                className="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold rounded-lg text-xs border border-slate-200 hover:text-slate-800 transition-colors"
              >
                Dismiss Advisory
              </button>
            </div>

            {/* Safe Humble Identifier Disclaimer */}
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              SuvenEdu Safety Node • Active Guard Rails Active
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
