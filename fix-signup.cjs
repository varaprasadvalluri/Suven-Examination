const fs = require('fs');
let code = fs.readFileSync('src/components/LoginPage.tsx', 'utf8');

const targetCatch = `    } catch (error: any) {
      const mapped = handleErrorAndLog(error, "Authorized Portal Account Registration");
      setErrorMessage(mapped.friendlyMessage);
      setIsLoading(false);
    }`;

const replacement = `    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use' || (error.message && error.message.includes('email-already-in-use'))) {
        try {
          // Attempt to sign in instead if they are already registered
          await signInWithEmail(trimmedEmail, signUpPassword);
          toast.success("Account already exists. Successfully signed in!");
          return;
        } catch (signInErr: any) {
          // Fallback to original error if password is wrong
          const mapped = handleErrorAndLog(error, "Authorized Portal Account Registration");
          setErrorMessage("This email is already registered. Please use the Sign In tab if you forgot your password.");
          setIsLoading(false);
          return;
        }
      }
      
      const mapped = handleErrorAndLog(error, "Authorized Portal Account Registration");
      setErrorMessage(mapped.friendlyMessage);
      setIsLoading(false);
    }`;

code = code.replace(targetCatch, replacement);
fs.writeFileSync('src/components/LoginPage.tsx', code);
console.log("Fixed!");
