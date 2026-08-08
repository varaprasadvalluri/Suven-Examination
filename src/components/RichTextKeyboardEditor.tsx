import React, { useState, useEffect, useRef } from 'react';
import { Bold, Italic, Quote, List, Sparkles, Languages, CheckSquare, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

interface RichTextKeyboardEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

interface AccentModel {
  char: string;
  lang: 'French' | 'Spanish' | 'German';
}

const MULTI_LANG_ACCENTS: AccentModel[] = [
  // French
  { char: 'é', lang: 'French' }, { char: 'à', lang: 'French' }, { char: 'è', lang: 'French' }, { char: 'ù', lang: 'French' }, { char: 'ç', lang: 'French' }, { char: 'œ', lang: 'French' },
  // Spanish
  { char: 'á', lang: 'Spanish' }, { char: 'í', lang: 'Spanish' }, { char: 'ó', lang: 'Spanish' }, { char: 'ú', lang: 'Spanish' }, { char: 'ñ', lang: 'Spanish' }, { char: '¿', lang: 'Spanish' }, { char: '¡', lang: 'Spanish' },
  // German
  { char: 'ä', lang: 'German' }, { char: 'ö', lang: 'German' }, { char: 'ü', lang: 'German' }, { char: 'ß', lang: 'German' }
];

export const RichTextKeyboardEditor: React.FC<RichTextKeyboardEditorProps> = ({
  value,
  onChange,
  placeholder = "Draft your essay or short answer solution here...",
  className = ''
}) => {
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(true);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [readingTime, setReadingTime] = useState(0);
  const [activeLangFilter, setActiveLangFilter] = useState<'All' | 'French' | 'Spanish' | 'German'>('All');
  
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync metrics: word count, character count, estimation reading time (avg 200 words per minute)
  useEffect(() => {
    const chars = value.length;
    setCharCount(chars);

    const words = value.trim() === "" ? 0 : value.trim().split(/\s+/).length;
    setWordCount(words);

    const readSecs = Math.ceil((words / 200) * 60);
    setReadingTime(readSecs);
  }, [value]);

  const insertStyleWrapper = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);

    const newText = value.substring(0, start) + prefix + (selectedText || "text") + suffix + value.substring(end);
    onChange(newText);

    // Re-focus and set selections range
    setTimeout(() => {
      textarea.focus();
      const offset = prefix.length;
      textarea.setSelectionRange(start + offset, end + offset);
    }, 20);
  };

  const insertAccentCharacter = (char: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;

      const before = text.substring(0, start);
      const after = text.substring(end, text.length);
      const newValue = before + char + after;

      onChange(newValue);
      
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = start + char.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 20);
    } else {
      onChange(value + char);
    }
  };

  const filteredAccents = activeLangFilter === 'All' 
    ? MULTI_LANG_ACCENTS 
    : MULTI_LANG_ACCENTS.filter(item => item.lang === activeLangFilter);

  return (
    <div className={`space-y-4 border border-slate-200 p-5 bg-slate-50/50 rounded-3xl shadow-xs ${className}`}>
      {/* Editor top control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-xs">
          <button
            type="button"
            onClick={() => insertStyleWrapper('**', '**')}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-all cursor-pointer"
            title="Bold Selection"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertStyleWrapper('*', '*')}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-all cursor-pointer"
            title="Italic Selection"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertStyleWrapper('> ', '')}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-all cursor-pointer"
            title="Blockquote"
          >
            <Quote className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertStyleWrapper('- ', '')}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-all cursor-pointer"
            title="Unordered List"
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        {/* Spellcheck config and multi-key indicators */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none border border-slate-200 px-3 py-1.5 rounded-xl bg-white text-xs font-bold text-slate-600 hover:bg-slate-50">
            <input 
              type="checkbox" 
              checked={spellCheckEnabled} 
              onChange={() => setSpellCheckEnabled(!spellCheckEnabled)}
              className="rounded border-slate-300 text-indigo-600"
            />
            <span>Auto Spellcheck</span>
          </label>
        </div>
      </div>

      {/* Languages virtual character keyboard overlay */}
      <div className="space-y-2 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between gap-4 flex-wrap border-b border-slate-100 pb-2">
          <div className="flex items-center gap-1.5">
            <Languages className="h-4 w-4 text-indigo-600" />
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">Special Characters Keyboard Overlay</span>
          </div>

          <div className="flex gap-1">
            {['All', 'French', 'Spanish', 'German'].map(lang => (
              <button
                key={lang}
                type="button"
                onClick={() => setActiveLangFilter(lang as any)}
                className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider cursor-pointer border transition-colors ${activeLangFilter === lang ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1 font-sans">
          {filteredAccents.map((accent, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => insertAccentCharacter(accent.char)}
              className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-indigo-600 border border-slate-200 hover:border-indigo-600 text-slate-800 hover:text-white transition-all text-sm font-semibold flex items-center justify-center cursor-pointer shadow-xs active:scale-95"
              title={`${accent.lang} diacritic`}
            >
              {accent.char}
            </button>
          ))}
        </div>
      </div>

      {/* Primary textarea */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={spellCheckEnabled}
          placeholder={placeholder}
          className="w-full min-h-[160px] p-5 bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-600 text-slate-800 text-sm leading-relaxed rounded-2xl focus:ring-0 focus:outline-none transition-colors shadow-xs"
        />
      </div>

      {/* Metrics footer card */}
      <div className="p-4 border border-slate-150 rounded-2xl bg-white flex flex-wrap items-center justify-between gap-4 text-xs font-semibold text-slate-500 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <CheckSquare className="h-4 w-4 text-indigo-500" />
            <span>Words: <strong className="text-slate-800">{wordCount}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 bg-slate-300 rounded-full" />
            <span>Characters: <strong className="text-slate-800">{charCount}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-slate-400" />
          <span>Estimated reading duration: <strong className="text-slate-800">{readingTime}s</strong></span>
        </div>
      </div>
    </div>
  );
};
