const fs = require('fs');
let code = fs.readFileSync('src/components/AdminExams.tsx', 'utf8');

const target = `      <ConfirmationDialog`;

const replacement = `      {/* Preview Exam Dialog */}
      {previewExam && (
        <Dialog open={!!previewExam} onOpenChange={(open) => !open && setPreviewExam(null)}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white border-0 shadow-2xl rounded-2xl">
            <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-display font-black text-slate-900">{previewExam.title}</DialogTitle>
                  <DialogDescription className="text-xs font-semibold text-slate-500">
                    {previewExam.questions?.length || 0} Questions • {previewExam.totalMarks} Marks • {previewExam.duration} Mins
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/30">
              {previewExam.questions && previewExam.questions.length > 0 ? (
                previewExam.questions.map((q, idx) => (
                  <div key={q.id || idx} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="h-8 w-8 shrink-0 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500">
                        {idx + 1}
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <h4 className="text-sm font-semibold text-slate-800 leading-relaxed break-words">{q.text}</h4>
                          <span className="shrink-0 bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider whitespace-nowrap">
                            {q.marks} Marks
                          </span>
                        </div>
                        
                        {q.imageUrl && (
                          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex justify-center max-h-48 relative">
                            <img src={q.imageUrl} alt="Question visual" className="object-contain w-full h-full" loading="lazy" />
                          </div>
                        )}
                        
                        {q.type === 'numerical' ? (
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Correct Value:</span>
                            <span className="text-sm font-bold text-slate-900">{q.numericalAnswer}</span>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {q.options.map((opt, optIdx) => (
                              <div 
                                key={optIdx} 
                                className={\`flex items-center gap-3 p-3 rounded-xl border text-sm transition-colors \${
                                  q.correctAnswerIndex === optIdx 
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 font-semibold' 
                                    : 'bg-white border-slate-200 text-slate-600'
                                }\`}
                              >
                                <div className={\`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold \${
                                  q.correctAnswerIndex === optIdx 
                                    ? 'bg-emerald-500 text-white' 
                                    : 'bg-slate-100 text-slate-500'
                                }\`}>
                                  {String.fromCharCode(65 + optIdx)}
                                </div>
                                <span className="break-words">{opt}</span>
                                {q.correctAnswerIndex === optIdx && (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto shrink-0" />
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {q.explanation && (
                          <div className="mt-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                            <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">Explanation</h5>
                            <p className="text-xs text-indigo-900/80 leading-relaxed font-medium">{q.explanation}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                    <ClipboardList className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-900">No Questions Found</p>
                  <p className="text-xs text-slate-500 mt-1">This assessment blueprint currently has zero configured questions.</p>
                </div>
              )}
            </div>
            
            <DialogFooter className="p-6 bg-slate-50 border-t border-slate-100">
              <Button onClick={() => setPreviewExam(null)} className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-colors">
                Close Preview
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationDialog`;

code = code.replace(target, replacement);
fs.writeFileSync('src/components/AdminExams.tsx', code);
console.log("Updated!");
