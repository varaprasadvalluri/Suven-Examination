const fs = require('fs');
let content = fs.readFileSync('src/components/ExamInterface.tsx', 'utf8');

const injection = `
  useEffect(() => {
    if (!attemptId || !attempt || attempt.status === 'completed') return;

    const logActivity = async (type: string, description: string) => {
      try {
        const payload = {
          attemptId,
          studentId: attempt.studentId,
          examId: attempt.examId,
          type,
          description,
          timestamp: new Date().toISOString()
        };
        await addDoc(collection(db, 'proctoring_logs'), payload);
      } catch (err) {
        console.error("Proctoring log error:", err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        logActivity('tab_switch', 'Student switched tabs or minimized browser window.');
      }
    };

    const handleBlur = () => {
      logActivity('blur', 'Student lost focus of the exam window.');
    };

    const handleCopyPaste = (e) => {
      e.preventDefault();
      logActivity('copy_paste', \`Student attempted to \${e.type} content.\`);
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        logActivity('fullscreen_exit', 'Student exited fullscreen mode.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [attemptId, attempt]);

  return (
`;

content = content.replace(/return \(\s*<div className="min-h-screen/s, injection + '    <div className="min-h-screen');
fs.writeFileSync('src/components/ExamInterface.tsx', content);
console.log("Patched proctoring logs!");
