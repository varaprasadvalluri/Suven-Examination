import { toast } from 'sonner';

/**
 * Custom application exception carrying highly descriptive context
 */
export class CustomAppException extends Error {
  public action: string;
  public friendlyMessage: string;
  public technicalDetails: string;
  public code: string;

  constructor(
    action: string,
    friendlyMessage: string,
    technicalDetails: string,
    code: string = 'UNKNOWN_EXCEPTION'
  ) {
    super(friendlyMessage);
    this.name = 'CustomAppException';
    this.action = action;
    this.friendlyMessage = friendlyMessage;
    this.technicalDetails = technicalDetails;
    this.code = code;

    // Ensure raw stack trace is captured correctly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CustomAppException);
    }
  }
}

/**
 * Core Firebase & App Error dictionary to translate complex technical codes to human language
 */
export function mapToCustomException(error: any, actionContext: string): CustomAppException {
  const rawCode = error?.code || error?.name || 'UNKNOWN';
  const rawMessage = error?.message || String(error);
  
  let code = rawCode;
  let friendlyMessage = "An unexpected error occurred. Please verify your data and connection.";
  let technicalDetails = rawMessage;

  // 1. Firebase Authentication Errors
  if (rawCode === 'auth/email-already-in-use' || rawMessage.includes('email-already-in-use')) {
    code = 'auth/email-already-in-use';
    friendlyMessage = "This institutional email address is already registered. If you already created an account, please head to the Sign In tab instead of Sign Up.";
  } else if (rawCode === 'auth/invalid-email' || rawMessage.includes('invalid-email')) {
    code = 'auth/invalid-email';
    friendlyMessage = "The email address you entered has an invalid format. Please double-check for spelling mistakes, trailing spaces, or missing characters.";
  } else if (rawCode === 'auth/weak-password' || rawMessage.includes('weak-password')) {
    code = 'auth/weak-password';
    friendlyMessage = "The password provided is too simple or weak. To safeguard your account, please enter a stronger password containing at least 6 characters.";
  } else if (rawCode === 'auth/user-not-found' || rawMessage.includes('user-not-found') || rawCode === 'auth/invalid-credential' || rawMessage.includes('invalid-credential') || rawCode === 'auth/wrong-password' || rawMessage.includes('wrong-password')) {
    code = 'auth/invalid-credential';
    friendlyMessage = "Invalid credentials. The email address or password you entered is incorrect, or no profile matches these credentials under your chosen role.";
  } else if (rawCode === 'auth/too-many-requests' || rawMessage.includes('too-many-requests')) {
    code = 'auth/too-many-requests';
    friendlyMessage = "Too many login attempts detected. To protect your profile, access has been temporarily restricted. Please wait a minute and try again.";
  } else if (rawCode === 'auth/operation-not-allowed' || rawMessage.includes('operation-not-allowed')) {
    code = 'auth/operation-not-allowed';
    friendlyMessage = "The requested login method is currently disabled for this portal. Please contact the main administrator for support.";
  } else if (rawCode === 'auth/popup-closed-by-user' || rawMessage.includes('popup-closed-by-user')) {
    code = 'auth/popup-closed-by-user';
    friendlyMessage = "The authentication pop-up was closed before completion. Please try clicking the button again and leave the window open to finish.";
  }
  
  // 2. Firebase Firestore Database & Security Errors
  else if (rawCode === 'permission-denied' || rawMessage.includes('permission-denied') || rawMessage.includes('Missing or insufficient permissions')) {
    code = 'permission-denied';
    friendlyMessage = "Access Denied: You do not have the required institutional clearance or security role permissions to read or update this resource.";
  } else if (rawCode === 'unavailable' || rawMessage.includes('unavailable')) {
    code = 'unavailable';
    friendlyMessage = "The secure data server is temporarily offline or unreachable. Please check your network connection and retry the action.";
  } else if (rawCode === 'already-exists' || rawMessage.includes('already-exists')) {
    code = 'already-exists';
    friendlyMessage = "A duplicate entry was found. This database record already exists and cannot be created again with identical primary details.";
  } else if (rawCode === 'not-found' || rawMessage.includes('not-found')) {
    code = 'not-found';
    friendlyMessage = "The requested database record, institutional workspace, or exam could not be located. It may have been deleted or moved.";
  } else if (rawCode === 'resource-exhausted' || rawMessage.includes('resource-exhausted')) {
    code = 'resource-exhausted';
    friendlyMessage = "Server capacity quota reached. The application is receiving high traffic; please wait a brief moment before resubmitting.";
  }

  // 3. Custom Whitelist & Onboarding Exceptions
  else if (rawMessage.includes("Registration allowed only for onboarded schools")) {
    code = 'school/not-onboarded';
    friendlyMessage = "Your institutional email has not been onboarded or pre-registered by the System Administrator yet. Please request onboarding from the master administrator before registering.";
  } else if (rawMessage.includes("Registration allowed only for onboarded admins")) {
    code = 'admin/not-onboarded';
    friendlyMessage = "Your administrator email has not been pre-registered or authorized. Please verify with the system owners.";
  } else if (rawMessage.includes("Name must be at least")) {
    code = 'validation/invalid-name';
    friendlyMessage = "Registration failed: Your name must contain at least 3 alphabetical characters for audit records.";
  } else if (rawMessage.includes("Role Selection Required") || rawMessage.includes("Role selection is mandatory")) {
    code = 'validation/invalid-role';
    friendlyMessage = "No Access Role Selected. Please select whether you are signing in as a Teacher or an Institutional Administrator.";
  } else if (rawMessage.includes("pre-registered institution email")) {
    code = 'validation/missing-email';
    friendlyMessage = "An institutional email is required to proceed. Please input your registered organization email.";
  }

  // Fallback for general errors
  if (code === 'UNKNOWN' && rawMessage) {
    if (rawMessage.includes('Failed to fetch') || rawMessage.includes('NetworkError')) {
      code = 'network/failed-to-fetch';
      friendlyMessage = "A secure network connection could not be established. Please check your local Wi-Fi or cellular network connection and try again.";
    }
  }

  return new CustomAppException(
    actionContext,
    friendlyMessage,
    technicalDetails,
    code
  );
}

/**
 * Handles, maps, logs the raw error to console for developers,
 * and broadcasts the custom error event for our global visual handler.
 */
export function handleErrorAndLog(error: any, actionContext: string): CustomAppException {
  // 1. Map to custom structured exception
  const customException = mapToCustomException(error, actionContext);

  // 2. Log full raw error details and stack trace to the console for developer debugging
  console.group(`[PORTAL ERROR HANDLER] Exception during: "${actionContext}"`);
  console.error("Action:", actionContext);
  console.error("Custom Code Mapping:", customException.code);
  console.error("Friendly Explanation:", customException.friendlyMessage);
  console.error("Raw Error Reference:", error);
  if (error?.stack) {
    console.error("Raw Stack Trace:\n", error.stack);
  }
  console.groupEnd();

  // 3. Display brief toast warning instantly
  toast.error(customException.friendlyMessage, {
    description: `Action: ${actionContext}`,
    duration: 5000,
  });

  // 4. Dispatch custom window event so centralized ErrorBoundary can show a rich, interactive diagnostic modal
  // Skip showing full crash modal for normal form validation / auth errors / background syncs, they are handled gracefully in UI
  const isBackgroundOrNonFatal = actionContext.includes('Sync') || 
                                actionContext.includes('Stream') || 
                                actionContext.includes('Lifecycle') ||
                                actionContext.includes('Background') ||
                                actionContext.includes('Queue') ||
                                customException.code.startsWith('auth/') ||
                                customException.code.startsWith('validation/') ||
                                customException.code.startsWith('school/');

  const isFatalCrash = !isBackgroundOrNonFatal;
                       
  if (isFatalCrash) {
    const event = new CustomEvent('app-custom-exception', {
      detail: {
        action: customException.action,
        friendlyMessage: customException.friendlyMessage,
        technicalDetails: customException.technicalDetails,
        code: customException.code,
      }
    });
    window.dispatchEvent(event);
  }

  return customException;
}

/**
 * Initialize global middleware to capture unhandled promise rejections or runtime exceptions
 */
export function initializeGlobalErrorMiddleware() {
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    // Prevent browser console from spamming duplicate generic errors if handled here
    event.preventDefault();
    
    const reason = event.reason;
    const msg = String(reason?.message || reason?.stack || reason || '');
    
    // Ignore benign background errors (e.g., dev websocket disconnections, aborted fetches, resize observers)
    if (
      !reason ||
      msg.includes('vite') ||
      msg.includes('WebSocket') ||
      msg.includes('websocket') ||
      msg.includes('ResizeObserver') ||
      msg.includes('canceled') ||
      msg.includes('aborted') ||
      msg.includes('AbortError')
    ) {
      console.warn('[Global Middleware] Suppressed benign background rejection:', reason);
      return;
    }
    
    // Guess action context based on stack or message if possible, or use standard fallback
    let context = "Asynchronous Server Syncing";
    if (reason?.stack) {
      const stackStr = String(reason.stack);
      if (stackStr.includes('signIn') || stackStr.includes('login') || stackStr.includes('Auth')) {
        context = "User Authentication Sequence";
      } else if (stackStr.includes('signUp') || stackStr.includes('register')) {
        context = "New Profile Registration";
      } else if (stackStr.includes('addDoc') || stackStr.includes('setDoc') || stackStr.includes('updateDoc') || stackStr.includes('schools')) {
        context = "Database Mutation Stream";
      } else if (stackStr.includes('exams') || stackStr.includes('questions')) {
        context = "Exam Resource Management";
      }
    }
    
    // Log to console without raising alarming toast popups for background rejections
    console.warn(`[Global Middleware] Handled unhandled promise rejection in context: "${context}"`, reason);
  };

  const handleGlobalError = (event: ErrorEvent) => {
    // Only capture uncaught errors related to auth, firebase, or critical state mutations
    const errorMsg = event.message || '';
    if (errorMsg.includes('Firebase') || errorMsg.includes('auth') || errorMsg.includes('permission') || errorMsg.includes('firestore')) {
      event.preventDefault();
      handleErrorAndLog(event.error || errorMsg, "Portal Lifecycle Operation");
    }
  };

  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleGlobalError);

  // Return a cleanup function
  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('error', handleGlobalError);
  };
}
