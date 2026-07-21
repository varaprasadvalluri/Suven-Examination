const fs = require('fs');
let content = fs.readFileSync('src/components/ExamInterface.tsx', 'utf8');

// Fix proctoring logs collection name
content = content.replace(/collection\(db, 'proctor_logs'\)/g, "collection(db, 'proctoring_logs')");

// Replace the return layout
const returnStart = content.indexOf('  return (\n    <div className="max-w-7xl mx-auto space-y-6 pb-20 px-4">');
if (returnStart === -1) {
  console.log("Could not find return start!");
  process.exit(1);
}

// Find the start of the Modals
const dialogStart = content.indexOf('      <Dialog open={isSubmitConfirmOpen} onOpenChange={setIsSubmitConfirmOpen}>', returnStart);
if (dialogStart === -1) {
  console.log("Could not find dialog start!");
  process.exit(1);
}

const newLayout = `  return (
    <div className="min-h-screen bg-[#0f111a] text-slate-200 font-sans selection:bg-indigo-500/30 flex flex-col absolute inset-0 overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-[#171a26] border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
         <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
               <div className="h-8 w-8 bg-amber-400 rounded flex items-center justify-center font-black text-slate-900 shadow-md shadow-amber-500/10">
                 S
               </div>
               <h1 className="font-bold text-slate-100 text-sm md:text-base tracking-wide">{exam?.title || "Mock Test"}</h1>
            </div>
            {/* Subject Pills */}
            <div className="hidden md:flex items-center gap-2 border-l border-slate-800 pl-6 ml-2">
              {uniqueSubjects.map((sub, i) => {
                 const colors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
                 const color = colors[i % colors.length];
                 const isActive = currentSubject === sub;
                 const subQIdx = questions.map((q, idx) => (q.subject || exam?.subject || 'General') === sub ? idx : -1).filter(idx => idx !== -1);
                 const subAnsCount = subQIdx.filter(idx => answers[idx] !== null && answers[idx] !== undefined).length;
                 
                 return (
                   <button 
                     key={sub}
                     onClick={() => jumpToSubject(sub)}
                     className={\`h-8 px-4 rounded-full border text-[11px] font-bold flex items-center gap-2 transition-all cursor-pointer
                       \${isActive ? 'bg-slate-800 border-indigo-500/50 text-white shadow-sm' : 'border-slate-800/80 text-slate-400 hover:bg-slate-800/50'}\`}
                   >
                     <div className={\`h-1.5 w-1.5 rounded-full \${color}\`} />
                     {sub}
                     <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[9px] ml-1">{subAnsCount}/{subQIdx.length}</span>
                   </button>
                 )
              })}
            </div>
         </div>

         <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-500 hidden sm:flex items-center gap-1.5">
               <Circle size={8} className={isSynced ? 'text-slate-600 fill-slate-700' : 'text-amber-500 fill-amber-500'} /> 
               {isSynced ? 'Auto-save' : 'Saving...'}
            </span>
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full text-[10px] font-bold hidden sm:flex items-center gap-1.5">
               <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Proctored
            </span>
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-1.5 rounded-lg text-slate-200 font-mono font-bold text-sm shadow-inner shadow-black/20">
               <Clock size={14} className="text-slate-500" />
               {formatTime(timeLeft)}
            </div>
            <Button onClick={() => setIsSubmitConfirmOpen(true)} className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-6 h-9 text-xs rounded-md shadow-lg shadow-amber-500/10 cursor-pointer border-none">
               Submit Exam
            </Button>
         </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
         {/* Left Main Area */}
         <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto bg-[#0b0d14]">
            {/* Top meta */}
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-3">
                 <span className="bg-[#171a26] border border-slate-800 px-3 py-1.5 rounded text-xs font-bold text-slate-300">Q {currentIndex + 1} / {questions.length}</span>
                 {answers[currentIndex] !== null && answers[currentIndex] !== undefined ? (
                   <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider">Answered</span>
                 ) : markedForReview[currentIndex] ? (
                   <span className="bg-purple-500/20 text-purple-400 border border-purple-500/20 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider">Review</span>
                 ) : (
                   <span className="bg-rose-500/20 text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider">Not Answered</span>
                 )}
               </div>
               <div className="text-xs font-bold font-mono tracking-wider bg-[#171a26] border border-slate-800 px-3 py-1.5 rounded flex gap-2">
                 <span className="text-emerald-400">+{currentQuestion?.marks || 4}</span> <span className="text-slate-700">|</span> <span className="text-rose-500">-1</span>
               </div>
            </div>

            {/* Question Box */}
            <div className="flex-1 bg-[#171a26] border border-slate-800 rounded-2xl p-6 md:p-10 flex flex-col overflow-y-auto shadow-xl shadow-black/10">
               <div className="flex items-center gap-3 mb-8">
                 <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-bold px-3 py-1 rounded-full">{currentSubject}</Badge>
                 <span className="text-xs text-slate-500 font-medium">
                    {currentQuestion?.type === 'single' ? 'Single Correct · MCQ' : currentQuestion?.type === 'multiple' ? 'Multiple Correct · MCQ' : 'Subjective / Numerical'}
                 </span>
               </div>
               
               <div className="text-base md:text-lg font-semibold text-slate-200 leading-relaxed mb-10 whitespace-pre-wrap">
                  {currentQuestion?.text}
               </div>
               
               {currentQuestion?.imageUrl && (
                  <div className="mb-10 max-w-2xl rounded-xl overflow-hidden border border-slate-800">
                     <img src={currentQuestion.imageUrl} alt="Question Graphic" className="w-full h-auto" />
                  </div>
               )}

               <div className="space-y-3 mt-auto">
                 {currentQuestion?.options.map((opt, idx) => {
                    const letters = ['A', 'B', 'C', 'D', 'E'];
                    const letter = letters[idx];
                    const isSelected = Array.isArray(answers[currentIndex]) 
                      ? (answers[currentIndex]).includes(idx) 
                      : answers[currentIndex] === idx;

                    return (
                      <button 
                         key={idx}
                         onClick={() => currentQuestion.type === 'multiple' ? handleCheckboxToggle(idx) : handleAnswer(idx)}
                         className={\`w-full text-left p-4 rounded-xl border flex items-center gap-4 transition-all cursor-pointer
                           \${isSelected ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-200' : 'bg-slate-900/50 border-slate-800/60 text-slate-300 hover:bg-slate-800 hover:border-slate-700'}\`}
                      >
                         <div className={\`h-7 w-7 rounded-full border flex items-center justify-center font-bold text-xs shrink-0
                           \${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}\`}>
                           {letter}
                         </div>
                         <span className="text-sm font-medium leading-relaxed">{opt}</span>
                      </button>
                    )
                 })}
               </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between mt-6 shrink-0 gap-4">
               <div className="flex gap-3">
                  <Button onClick={handleClearResponse} variant="outline" className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200 bg-transparent h-11 px-4 md:px-6 rounded-xl font-bold text-xs cursor-pointer">Clear Response</Button>
                  <Button onClick={handleMarkForReview} variant="outline" className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200 bg-transparent h-11 px-4 md:px-6 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer">
                     <div className="h-1.5 w-1.5 rounded-full bg-amber-400 hidden md:block" /> Mark for Review
                  </Button>
               </div>
               <div className="flex gap-3">
                  <Button onClick={() => setCurrentIndex(c => Math.max(0, c - 1))} disabled={currentIndex === 0} variant="outline" className="border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-slate-100 bg-transparent h-11 px-4 md:px-6 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer">
                    <ArrowLeft size={16} /> <span className="hidden md:inline">Previous</span>
                  </Button>
                  <Button onClick={handleSaveAndNext} className="bg-amber-400 hover:bg-amber-500 text-slate-950 h-11 px-6 md:px-8 rounded-xl font-black text-xs flex items-center gap-2 cursor-pointer border-none shadow-lg shadow-amber-500/10">
                    Save & Next <ArrowRight size={16} />
                  </Button>
               </div>
            </div>
         </div>

         {/* Right Sidebar */}
         <div className="w-80 bg-[#171a26] border-l border-slate-800 flex flex-col shrink-0">
            <div className="p-4 grid grid-cols-2 gap-3 shrink-0 border-b border-slate-800/50 bg-[#131620]">
               <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-3 flex flex-col justify-center items-center">
                  <span className="block text-xl font-black text-emerald-500">{counts.answered + counts.answeredMarkedReview}</span>
                  <span className="text-[9px] text-emerald-400/80 font-bold uppercase tracking-wider mt-1">Answered</span>
               </div>
               <div className="bg-rose-500/20 border border-rose-500/30 rounded-xl p-3 flex flex-col justify-center items-center">
                  <span className="block text-xl font-black text-rose-500">{counts.notAnswered}</span>
                  <span className="text-[9px] text-rose-400/80 font-bold uppercase tracking-wider mt-1">Not Ans.</span>
               </div>
               <div className="bg-purple-500/20 border border-purple-500/30 rounded-xl p-3 flex flex-col justify-center items-center">
                  <span className="block text-xl font-black text-purple-400">{counts.markedReview}</span>
                  <span className="text-[9px] text-purple-300/80 font-bold uppercase tracking-wider mt-1">Review</span>
               </div>
               <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 flex flex-col justify-center items-center">
                  <span className="block text-xl font-black text-slate-300">{counts.notVisited}</span>
                  <span className="text-[9px] text-slate-400/80 font-bold uppercase tracking-wider mt-1">Unvisited</span>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-8 bg-[#171a26]">
               {uniqueSubjects.map((sub, sIdx) => {
                  const subColor = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'][sIdx % 4];
                  return (
                    <div key={sub} className="space-y-4">
                       <div className="flex items-center gap-2 text-[10px] font-black tracking-widest text-slate-400 uppercase">
                          <div className={\`h-1.5 w-1.5 rounded-full \${subColor}\`} />
                          {sub}
                       </div>
                       <div className="grid grid-cols-5 gap-2.5">
                          {questions.map((q, i) => {
                             if ((q.subject || exam?.subject || 'General') !== sub) return null;
                             const isAns = answers[i] !== null && answers[i] !== undefined;
                             const isVis = visited[i];
                             const isMarked = markedForReview[i];
                             
                             let bgColor = 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700/50 shadow-sm';
                             if (isAns) bgColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30';
                             if (!isAns && isVis) bgColor = 'bg-rose-500/20 border-rose-500/40 text-rose-400 hover:bg-rose-500/30';
                             if (isMarked) bgColor = 'bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30';
                             if (i === currentIndex) bgColor = 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20 ring-2 ring-indigo-500/30 ring-offset-2 ring-offset-[#171a26]';

                             return (
                               <button
                                 key={i}
                                 onClick={() => setCurrentIndex(i)}
                                 className={\`h-10 w-full rounded-lg border flex items-center justify-center text-xs font-bold transition-all cursor-pointer \${bgColor}\`}
                               >
                                 {i + 1}
                               </button>
                             );
                          })}
                       </div>
                    </div>
                  )
               })}
            </div>
         </div>
      </div>

`;

const replacedContent = content.substring(0, returnStart) + newLayout + content.substring(dialogStart);

fs.writeFileSync('src/components/ExamInterface.tsx', replacedContent);
console.log("ExamInterface patched layout");
