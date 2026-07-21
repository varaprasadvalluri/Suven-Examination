import React, { useState, useEffect, useRef } from 'react';
import { Terminal, RefreshCw, FileCode, CheckCircle } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

interface CodeEditorProps {
  value: string;
  onChange: (val: string) => void;
  questionId: string;
}

const TEMPLATES: Record<string, string> = {
  javascript: `// JavaScript Code Solver\nfunction solve(input) {\n    // Type your algorithm logic here\n    console.log("Analyzing input:", input);\n    return true;\n}`,
  python: `# Python 3 Engine Solver\ndef solve(input_val):\n    # Type your algorithm logic here\n    print(f"Analyzing input: {input_val}")\n    return True`,
  cpp: `// C++ Solver Core\n#include <iostream>\nusing namespace std;\n\nbool solve(string input) {\n    // Type your algorithm logic here\n    cout << "Analyzing input: " << input << endl;\n    return true;\n}`,
  java: `// Java Solver Environment\npublic class Solution {\n    public static boolean solve(String input) {\n        // Type your algorithm logic here\n        System.out.println("Analyzing input: " + input);\n        return true;\n    }\n}`
};

export const EmbeddedCodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, questionId }) => {
  const [language, setLanguage] = useState('python');
  const [lines, setLines] = useState<number[]>([1]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);

  // Initialize value if empty
  useEffect(() => {
    const savedCode = localStorage.getItem(`code_editor_${questionId}`);
    if (savedCode) {
      onChange(savedCode);
    } else if (!value.trim()) {
      onChange(TEMPLATES[language]);
    }
  }, [questionId]);

  // Sync line numbering based on newline content length
  useEffect(() => {
    const newlineCount = value.split('\n').length;
    const list = Array.from({ length: newlineCount }, (_, i) => i + 1);
    setLines(list);
  }, [value]);

  // Tab key interceptor to insert 4 spaces at caret, preventing focus switching
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentText = textarea.value;

      const newText = currentText.substring(0, start) + '    ' + currentText.substring(end);
      onChange(newText);

      // Restore cursor position
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 4;
      }, 0);
    }
  };

  const handleTextareaScroll = () => {
    const textarea = textareaRef.current;
    const lineNumbers = lineNumbersRef.current;
    if (textarea && lineNumbers) {
      lineNumbers.scrollTop = textarea.scrollTop;
    }
  };

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    if (!value.trim() || Object.values(TEMPLATES).includes(value)) {
      onChange(TEMPLATES[lang]);
    }
    toast.success(`Sandbox environment switched to: ${lang}`);
  };

  const syncLocalAutosave = () => {
    try {
      setSaveStatus('saving');
      localStorage.setItem(`code_editor_${questionId}`, value);
      setTimeout(() => {
        setSaveStatus('saved');
      }, 600);
    } catch (e) {
      console.error(e);
      setSaveStatus('idle');
    }
  };

  // Trigger auto-save locally after text modification stops
  useEffect(() => {
    if (!value) return;

    const timer = setTimeout(() => {
      syncLocalAutosave();
    }, 1200);

    return () => clearTimeout(timer);
  }, [value]);

  const restoreTemplate = () => {
    onChange(TEMPLATES[language]);
    toast.info(`Environment template reset: ${language}`);
  };

  return (
    <div className="border border-slate-200 rounded-[24px] overflow-hidden shadow-sm bg-[#1e1e1e] text-slate-100 flex flex-col h-[340px]">
      {/* Header bar */}
      <div className="bg-[#252526] border-b border-[#3c3c3c] px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-amber-500 animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">Target IDE Sandbox</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 border border-[#444] rounded-lg p-0.5 bg-[#1e1e1e]">
            {['python', 'javascript', 'cpp', 'java'].map(lang => (
              <button
                key={lang}
                onClick={() => handleLanguageChange(lang)}
                className={`px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${language === lang ? 'bg-[#37373d] text-white font-bold' : 'text-slate-400 hover:text-slate-250 hover:bg-[#37373d]/25'}`}
              >
                {lang === 'cpp' ? 'C++' : lang}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={restoreTemplate}
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-[#2d2d2d] rounded-md cursor-pointer"
            title="Reset template code"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>

          {/* Connected Autosave badge */}
          {saveStatus !== 'idle' && (
            <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[8.5px] font-bold ${saveStatus === 'saved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' : 'bg-amber-500/10 text-amber-400 animate-pulse border border-amber-500/25'}`}>
              <CheckCircle className="h-2.5 w-2.5" />
              <span>{saveStatus === 'saved' ? 'INDEXEDDB SYNCHRONIZED' : 'SAVING BUFFER...'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex flex-1 overflow-hidden relative font-mono text-sm">
        {/* Line Numbers column */}
        <div 
          ref={lineNumbersRef}
          className="w-10 bg-[#1e1e1e] py-4 border-r border-[#3c3c3c] text-right select-none pr-2.5 text-slate-500 overflow-hidden text-xs flex flex-col scrollbar-none"
        >
          {lines.map(num => (
            <span key={num} className="leading-6 block min-h-[24px]">
              {num}
            </span>
          ))}
        </div>

        {/* Text Area Code Inputs */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleTextareaScroll}
          spellCheck={false}
          className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] p-4 font-mono text-xs leading-6 resize-none outline-none border-none focus:ring-0 overflow-y-auto"
          placeholder="Write your solution program here..."
        />
      </div>

      {/* Footer bar */}
      <div className="bg-[#1e1e1e] border-t border-[#2d2d2d] px-4 py-1.5 flex items-center justify-between text-[10px] text-slate-500 shrink-0 font-mono">
        <div className="flex items-center gap-3">
          <span>Language: {language === 'cpp' ? 'C++' : language.toUpperCase()}</span>
          <span>Tab: 4 Spaces</span>
        </div>
        <span>Encoding: UTF-8</span>
      </div>
    </div>
  );
};
