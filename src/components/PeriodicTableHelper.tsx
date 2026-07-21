import React, { useState } from 'react';
import { Sparkles, Clipboard, Search } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

interface ChemElement {
  number: number;
  symbol: string;
  name: string;
  mass: number;
  group: 'alkali' | 'alkaline' | 'transition' | 'post-transition' | 'metalloid' | 'reactive-nonmetal' | 'noble-gas' | 'lanthanide' | 'actinide';
}

const CHEMICAL_ELEMENTS: ChemElement[] = [
  { number: 1, symbol: 'H', name: 'Hydrogen', mass: 1.008, group: 'reactive-nonmetal' },
  { number: 2, symbol: 'He', name: 'Helium', mass: 4.0026, group: 'noble-gas' },
  { number: 3, symbol: 'Li', name: 'Lithium', mass: 6.94, group: 'alkali' },
  { number: 4, symbol: 'Be', name: 'Beryllium', mass: 9.0122, group: 'alkaline' },
  { number: 5, symbol: 'B', name: 'Boron', mass: 10.81, group: 'metalloid' },
  { number: 6, symbol: 'C', name: 'Carbon', mass: 12.011, group: 'reactive-nonmetal' },
  { number: 7, symbol: 'N', name: 'Nitrogen', mass: 14.007, group: 'reactive-nonmetal' },
  { number: 8, symbol: 'O', name: 'Oxygen', mass: 15.999, group: 'reactive-nonmetal' },
  { number: 9, symbol: 'F', name: 'Fluorine', mass: 18.998, group: 'reactive-nonmetal' },
  { number: 10, symbol: 'Ne', name: 'Neon', mass: 20.180, group: 'noble-gas' },
  { number: 11, symbol: 'Na', name: 'Sodium', mass: 22.990, group: 'alkali' },
  { number: 12, symbol: 'Mg', name: 'Magnesium', mass: 24.305, group: 'alkaline' },
  { number: 13, symbol: 'Al', name: 'Aluminium', mass: 26.982, group: 'post-transition' },
  { number: 14, symbol: 'Si', name: 'Silicon', mass: 28.085, group: 'metalloid' },
  { number: 15, symbol: 'P', name: 'Phosphorus', mass: 30.974, group: 'reactive-nonmetal' },
  { number: 16, symbol: 'S', name: 'Sulfur', mass: 32.06, group: 'reactive-nonmetal' },
  { number: 17, symbol: 'Cl', name: 'Chlorine', mass: 35.45, group: 'reactive-nonmetal' },
  { number: 18, symbol: 'Ar', name: 'Argon', mass: 39.948, group: 'noble-gas' },
  { number: 19, symbol: 'K', name: 'Potassium', mass: 39.098, group: 'alkali' },
  { number: 20, symbol: 'Ca', name: 'Calcium', mass: 40.078, group: 'alkaline' },
  { number: 26, symbol: 'Fe', name: 'Iron', mass: 55.845, group: 'transition' },
  { number: 29, symbol: 'Cu', name: 'Copper', mass: 63.546, group: 'transition' },
  { number: 30, symbol: 'Zn', name: 'Zinc', mass: 65.38, group: 'transition' }
];

const GROUP_COLORS: Record<string, string> = {
  'reactive-nonmetal': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'noble-gas': 'bg-purple-50 text-purple-800 border-purple-200',
  'alkali': 'bg-rose-50 text-rose-850 border-rose-200',
  'alkaline': 'bg-amber-50 text-amber-800 border-amber-200',
  'metalloid': 'bg-teal-50 text-teal-850 border-teal-200',
  'post-transition': 'bg-blue-50 text-blue-800 border-blue-200',
  'transition': 'bg-sky-50 text-sky-850 border-sky-200'
};

const COMMON_FORMULAS = [
  { name: 'Water', formula: 'H₂O', latex: 'H_2O' },
  { name: 'Carbon Dioxide', formula: 'CO₂', latex: 'CO_2' },
  { name: 'Glucose', formula: 'C₆H₁₂O₆', latex: 'C_6H_{12}O_6' },
  { name: 'Ethanol', formula: 'C₂H₅OH', latex: 'C_2H_5OH' },
  { name: 'Sulfuric Acid', formula: 'H₂SO₄', latex: 'H_2SO_4' },
  { name: 'Methane', formula: 'CH₄', latex: 'CH_4' },
  { name: 'Hydrochloric Acid', formula: 'HCl', latex: 'HCl' },
  { name: 'Sodium Hydroxide', formula: 'NaOH', latex: 'NaOH' }
];

interface PeriodicTableHelperProps {
  onInsertSymbol: (symbol: string) => void;
}

export const PeriodicTableHelper: React.FC<PeriodicTableHelperProps> = ({ onInsertSymbol }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const filteredElements = CHEMICAL_ELEMENTS.filter(el => {
    const matchesSearch = el.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          el.symbol.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          el.number.toString() === searchTerm;
    const matchesGroup = selectedGroup ? el.group === selectedGroup : true;
    return matchesSearch && matchesGroup;
  });

  // Convert numbers to subscript elements: eg "H2O" -> "H₂O"
  const makeSubscript = (text: string): string => {
    const subscriptMap: Record<string, string> = {
      '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
      '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉'
    };
    return text.split('').map(char => subscriptMap[char] || char).join('');
  };

  const handleElementClick = (symbol: string) => {
    onInsertSymbol(symbol);
    toast.success(`Inserted Element: ${symbol}`);
  };

  const handleFormulaClick = (formulaText: string) => {
    onInsertSymbol(formulaText);
    toast.success(`Inserted Formula: ${formulaText}`);
  };

  return (
    <div className="border border-slate-200 bg-white p-6 rounded-[28px] shadow-sm space-y-6">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <Sparkles className="h-4 w-4 text-emerald-600" />
        <h4 className="text-sm font-black uppercase text-slate-800 tracking-wider">Chemistry Formula Assistant & Tables</h4>
      </div>

      {/* Chem formula templates */}
      <div className="space-y-2">
        <label className="block text-[10px] uppercase font-black tracking-wider text-slate-400">Quick Insert Formula Units</label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_FORMULAS.map((f, idx) => (
            <button
              key={idx}
              onClick={() => handleFormulaClick(f.formula)}
              className="bg-slate-50 hover:bg-slate-900 text-slate-700 hover:text-white hover:border-slate-900 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all active:scale-95 flex items-center justify-between gap-2 shadow-xs group"
              title={`${f.name} - ${f.formula}`}
            >
              <span>{f.formula}</span>
              <span className="text-[9px] text-slate-400 font-normal group-hover:text-slate-300">({f.name})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Element list box */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search by Symbol, Name or Number (e.g. Na)"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 pl-9 pr-4 h-9 rounded-xl outline-none text-xs text-slate-800 shadow-xs focus:border-indigo-500 transition-all font-semibold"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {['alkali', 'transition', 'reactive-nonmetal', 'noble-gas'].map(grp => (
              <button
                key={grp}
                onClick={() => setSelectedGroup(selectedGroup === grp ? null : grp)}
                className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border cursor-pointer ${selectedGroup === grp ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-250 text-slate-500 hover:bg-slate-50'}`}
              >
                {grp.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5 select-none max-h-48 overflow-y-auto pr-1">
          {filteredElements.map((el) => {
            const colorClass = GROUP_COLORS[el.group] || 'bg-slate-50 text-slate-800 border-slate-200';
            return (
              <button
                key={el.number}
                type="button"
                onClick={() => handleElementClick(el.symbol)}
                className={`border p-2.5 rounded-xl flex flex-col items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xs cursor-pointer ${colorClass}`}
                title={`${el.name}: Group=${el.group}, AtomicMass=${el.mass}`}
              >
                <div className="flex items-center justify-between w-full text-[8px] font-bold opacity-60 leading-none">
                  <span>{el.number}</span>
                  <span>{Math.round(el.mass)}</span>
                </div>
                <span className="text-base font-black tracking-tight leading-none my-1.5">{el.symbol}</span>
                <span className="text-[8px] tracking-tight font-semibold line-clamp-1 opacity-70 leading-none">{el.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
