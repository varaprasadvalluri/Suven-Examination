import React, { useState, useRef } from 'react';
import { MathRenderer } from './MathRenderer';
import { ToggleLeft, HelpCircle, Sparkles, BookOpen, Layers } from 'lucide-react';

interface MathInputToolbarProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  inputId: string;
  className?: string;
  isTextArea?: boolean;
}

interface MathSymbol {
  label: string;      // What's displayed on the button (rendered using KaTeX or clean text)
  latex: string;      // What gets inserted
  tooltip: string;    // Action description
}

interface Category {
  id: string;
  name: string;
  symbols: MathSymbol[];
}

export const MathInputToolbar: React.FC<MathInputToolbarProps> = ({
  value,
  onChange,
  placeholder = "Type your solution in LaTeX or use the toolbar...",
  inputId,
  className = '',
  isTextArea = true
}) => {
  const [activeTab, setActiveTab] = useState<string>('basic');
  const [showHelper, setShowHelper] = useState<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const categories: Category[] = [
    {
      id: 'basic',
      name: 'Basic Math',
      symbols: [
        { label: '+', latex: ' + ', tooltip: 'Add' },
        { label: '-', latex: ' - ', tooltip: 'Subtract' },
        { label: '\\times', latex: ' \\times ', tooltip: 'Multiply' },
        { label: '\\div', latex: ' \\div ', tooltip: 'Divide' },
        { label: '=', latex: ' = ', tooltip: 'Equals' },
        { label: '\\neq', latex: ' \\neq ', tooltip: 'Not Equal' },
        { label: '\\pm', latex: ' \\pm ', tooltip: 'Plus-Minus' },
        { label: '\\approx', latex: ' \\approx ', tooltip: 'Approximately' },
        { label: '\\infty', latex: '\\infty', tooltip: 'Infinity' },
        { label: '<', latex: ' < ', tooltip: 'Less Than' },
        { label: '>', latex: ' > ', tooltip: 'Greater Than' },
        { label: '\\le', latex: ' \\le ', tooltip: 'Less Or Equal' },
        { label: '\\ge', latex: ' \\ge ', tooltip: 'Greater Or Equal' },
      ]
    },
    {
      id: 'algebra',
      name: 'Algebra & Powers',
      symbols: [
        { label: 'x^2', latex: 'x^2', tooltip: 'Square' },
        { label: 'x^3', latex: 'x^3', tooltip: 'Cube' },
        { label: 'x^n', latex: 'x^{n}', tooltip: 'Exponent Power' },
        { label: 'x_i', latex: 'x_{i}', tooltip: 'Subscript' },
        { label: '\\frac{a}{b}', latex: '\\frac{a}{b}', tooltip: 'Fraction' },
        { label: '\\sqrt{x}', latex: '\\sqrt{x}', tooltip: 'Square Root' },
        { label: '\\sqrt[n]{x}', latex: '\\sqrt[n]{x}', tooltip: 'N-th Root' },
        { label: '\\log_{b}(x)', latex: '\\log_{b}(x)', tooltip: 'Logarithm' },
        { label: '\\ln(x)', latex: '\\ln(x)', tooltip: 'Natural Log' },
        { label: '\\pi', latex: '\\pi', tooltip: 'Pi' },
        { label: '\\theta', latex: '\\theta', tooltip: 'Theta' },
      ]
    },
    {
      id: 'calculus',
      name: 'Calculus',
      symbols: [
        { label: '\\int', latex: '\\int ', tooltip: 'Integral' },
        { label: '\\int_{a}^{b}', latex: '\\int_{a}^{b} x \\, dx', tooltip: 'Definite Integral' },
        { label: '\\Sigma', latex: '\\sum_{i=1}^{n} ', tooltip: 'Summation' },
        { label: '\\Pi', latex: '\\prod_{i=1}^{n} ', tooltip: 'Product Series' },
        { label: '\\frac{dy}{dx}', latex: '\\frac{dy}{dx}', tooltip: 'Derivative' },
        { label: '\\frac{\\partial y}{\\partial x}', latex: '\\frac{\\partial y}{\\partial x}', tooltip: 'Partial Derivative' },
        { label: '\\lim_{x \\to x_0}', latex: '\\lim_{x \\to 0} ', tooltip: 'Limit' },
        { label: '\\Delta', latex: '\\Delta', tooltip: 'Delta Difference' },
        { label: '\\nabla', latex: '\\nabla', tooltip: 'Nabla Gradient' },
      ]
    },
    {
      id: 'greek',
      name: 'Greek Letters',
      symbols: [
        { label: '\\alpha', latex: '\\alpha', tooltip: 'Alpha' },
        { label: '\\beta', latex: '\\beta', tooltip: 'Beta' },
        { label: '\\gamma', latex: '\\gamma', tooltip: 'Gamma' },
        { label: '\\delta', latex: '\\delta', tooltip: 'Delta' },
        { label: '\\epsilon', latex: '\\epsilon', tooltip: 'Epsilon' },
        { label: '\\lambda', latex: '\\lambda', tooltip: 'Lambda' },
        { label: '\\mu', latex: '\\mu', tooltip: 'Mu' },
        { label: '\\sigma', latex: '\\sigma', tooltip: 'Sigma' },
        { label: '\\omega', latex: '\\omega', tooltip: 'Omega' },
        { label: '\\phi', latex: '\\phi', tooltip: 'Phi' },
        { label: '\\psi', latex: '\\psi', tooltip: 'Psi' },
      ]
    },
    {
      id: 'advanced',
      name: 'Matrices & Sets',
      symbols: [
        { label: '[A]', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', tooltip: '2x2 Matrix' },
        { label: '\\cup', latex: ' \\cup ', tooltip: 'Union' },
        { label: '\\cap', latex: ' \\cap ', tooltip: 'Intersection' },
        { label: '\\in', latex: ' \\in ', tooltip: 'Element Of' },
        { label: '\\notin', latex: ' \\notin ', tooltip: 'Not Element Of' },
        { label: '\\subset', latex: ' \\subset ', tooltip: 'Subset Of' },
        { label: '\\forall', latex: ' \\forall ', tooltip: 'For All' },
        { label: '\\exists', latex: ' \\exists ', tooltip: 'There Exists' },
      ]
    }
  ];

  const handleInsertSymbol = (latexCode: string) => {
    const input = document.getElementById(inputId) as HTMLTextAreaElement | HTMLInputElement;
    if (input) {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const text = input.value;
      
      const before = text.substring(0, start);
      const after = text.substring(end, text.length);
      const newValue = before + latexCode + after;
      
      onChange(newValue);
      
      // Keep focus on input and update caret position
      setTimeout(() => {
        input.focus();
        const newCursorPos = start + latexCode.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
      }, 20);
    } else {
      onChange(value + latexCode);
    }
  };

  // Autocorrect system to easily convert natural inputs to proper LaTeX during typing!
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    let text = e.target.value;
    
    // Auto-replace shortcuts followed by space
    const autocorrects: Record<string, string> = {
      'alpha ': '\\alpha ',
      'beta ': '\\beta ',
      'gamma ': '\\gamma ',
      'theta ': '\\theta ',
      'pi ': '\\pi ',
      'sqrt ': '\\sqrt{x} ',
      'int ': '\\int ',
      'sum ': '\\sum ',
      'prod ': '\\prod ',
      'delta ': '\\delta ',
      'inf ': '\\infty ',
      'pm ': '\\pm ',
      'div ': '\\div ',
      'times ': '\\times '
    };

    let modified = false;
    for (const [key, val] of Object.entries(autocorrects)) {
      if (text.includes(key)) {
        text = text.replaceAll(key, val);
        modified = true;
      }
    }

    onChange(text);
  };

  const activeCategory = categories.find(c => c.id === activeTab) || categories[0];

  return (
    <div className={`space-y-4 border border-slate-200/80 rounded-3xl p-5 bg-slate-50/50 shadow-xs ${className}`}>
      
      {/* Category selector pill tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveTab(c.id)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === c.id 
                  ? 'bg-indigo-600 text-white shadow-xs' 
                  : 'bg-white text-slate-500 hover:text-slate-800 border border-slate-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        
        <button
          onClick={() => setShowHelper(!showHelper)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ${
            showHelper 
              ? 'bg-amber-500 text-white border-amber-500' 
              : 'bg-white text-slate-400 hover:text-slate-600 border-slate-200'
          }`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {showHelper ? "Hide Guide" : "View Help"}
        </button>
      </div>

      {/* Keyboard Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-11 gap-2 min-h-[48px] p-2 bg-white rounded-2xl border border-slate-250">
        {activeCategory.symbols.map((sym, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleInsertSymbol(sym.latex)}
            className="flex flex-col items-center justify-center h-12 bg-slate-50/70 hover:bg-slate-900 text-slate-800 hover:text-white border border-slate-200 hover:border-slate-900 rounded-xl transition-all shadow-xs active:translate-y-0.5 hover:scale-105 group cursor-pointer"
            title={sym.tooltip}
          >
            <span className="text-xs transition-transform duration-200 group-hover:scale-110">
              <MathRenderer math={sym.label} />
            </span>
          </button>
        ))}
      </div>

      {/* Helper Panel */}
      {showHelper && (
        <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-2xl text-amber-900 text-xs leading-relaxed space-y-2 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 font-black uppercase text-[10px] tracking-wider text-amber-800 mb-1">
            <Sparkles className="h-4 w-4" /> LaTeX Conversion Superpowers
          </div>
          <p className="font-medium text-slate-600">
            You can type standard LaTeX strings, or write natural shorthand math directly in the inputs. The portal will automatically format variables.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-mono mt-1 text-slate-700 bg-white/70 p-3 rounded-xl border border-amber-100">
            <div>• <code className="bg-slate-100 px-1 py-0.5 rounded font-bold">\frac&#123;a&#125;&#123;b&#125;</code> &rarr; Fractions</div>
            <div>• <code className="bg-slate-100 px-1 py-0.5 rounded font-bold">x^2</code> &rarr; Exponents</div>
            <div>• <code className="bg-slate-100 px-1 py-0.5 rounded font-bold">\sqrt&#123;x&#125;</code> &rarr; Roots</div>
            <div>• Auto Shortcuts: Type <code className="bg-slate-100 px-1.5 py-0.5 rounded font-bold">pi </code> or <code className="bg-slate-100 px-1.5 py-0.5 rounded font-bold">sqrt </code> with spaces.</div>
          </div>
        </div>
      )}

      {/* Input wrapper */}
      <div className="space-y-4">
        <label className="block text-[10.5px] font-black uppercase text-slate-400 tracking-wider">Formula / Solution Editor</label>
        {isTextArea ? (
          <textarea
            id={inputId}
            value={value}
            onChange={handleInputChange}
            placeholder={placeholder}
            className="w-full min-h-[100px] p-4 bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-600 text-slate-800 font-mono text-sm leading-relaxed rounded-2xl focus:ring-0 focus:outline-none transition-colors shadow-xs"
          />
        ) : (
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={handleInputChange}
            placeholder={placeholder}
            className="w-full h-12 px-4 bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-600 text-slate-800 font-mono text-sm rounded-xl focus:ring-0 focus:outline-none transition-colors shadow-xs"
          />
        )}

        {/* Dynamic Formatting Preview Pane */}
        <div className="p-5 border-2 border-indigo-100 bg-white rounded-2xl shadow-xs transition-all relative">
          <div className="absolute right-3.5 top-3.5 flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full pointer-events-none">
            <span className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-heartbeat" />
            <span className="text-[9px] font-black uppercase text-indigo-700 tracking-wider">Visual Formula Renderer</span>
          </div>
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none mb-3">Live Active Preview</p>
          <div className="min-h-[50px] flex items-center justify-center p-3 text-slate-800 bg-slate-50/50 border border-dashed border-slate-100 rounded-xl overflow-x-auto text-lg font-semibold selection:bg-indigo-100">
            {value.trim() ? (
              <MathRenderer math={value} block={true} />
            ) : (
              <span className="text-xs text-slate-400 italic">Formatting preview outputs will materialise here interactively in real time.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
