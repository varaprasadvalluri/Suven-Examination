const fs = require('fs');
let content = fs.readFileSync('src/components/ExamInterface.tsx', 'utf8');

// The problematic block is around line 1172:
//       } catch (err) {
//         console.error("Proctoring log error:", err);
//       }
//     };
//       } catch (err) {
//         console.error("Proctoring log error:", err);
//       }
//     };

content = content.replace(/      \} catch \(err\) \{\n        console.error\("Proctoring log error:", err\);\n      \}\n    \};\n      \} catch \(err\) \{\n        console.error\("Proctoring log error:", err\);\n      \}\n    \};/, 
`      } catch (err) {
        console.error("Proctoring log error:", err);
      }
    };`);
fs.writeFileSync('src/components/ExamInterface.tsx', content);
