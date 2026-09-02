import { StrictMode } from 'react';
import { MotionConfig } from 'motion/react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { RootSafetyWrapper } from './components/RootSafetyWrapper.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootSafetyWrapper>
      <ErrorBoundary>
        {/* "user" honours prefers-reduced-motion at the OS level for every motion.*
            component in the app, so transforms/animations are skipped for students who
            asked their device for reduced motion (vestibular safety). */}
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </ErrorBoundary>
    </RootSafetyWrapper>
  </StrictMode>
);
