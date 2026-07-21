const fs = require('fs');
let content = fs.readFileSync('src/components/ExamInterface.tsx', 'utf8');

const updatedLogActivity = `
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
        
        // Update the violations count on the attempt for the LiveProctoringWall
        const currentViolations = attempt.violationsCount || 0;
        await updateDoc(doc(db, 'attempts', attemptId), {
           violationsCount: currentViolations + 1,
           lastViolation: description,
           lastViolationTime: new Date().toISOString()
        });
      } catch (err) {
        console.error("Proctoring log error:", err);
      }
    };
`;

content = content.replace(/const logActivity = async [\s\S]*?\} catch \(err\) \{/s, updatedLogActivity.trim() + '\n      } catch (err) {');
fs.writeFileSync('src/components/ExamInterface.tsx', content);
console.log("Patched proctoring violations increment");
