import React, { useState } from 'react';
import { Search, Check } from 'lucide-react';

export interface SearchableDropdownOption {
  id: string;
  label: React.ReactNode;
  searchText: string;
}

interface SearchableDropdownProps {
  options: SearchableDropdownOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  trigger: (args: { isOpen: boolean; toggle: () => void }) => React.ReactNode;
  panelClassName: string;
  searchPlaceholder: string;
  searchInputClassName: string;
  emptyText: string;
  optionClassName: (isSelected: boolean) => string;
  extraOption?: SearchableDropdownOption;
  maxVisible?: number;
  renderMore?: (hiddenCount: number, totalCount: number) => React.ReactNode;
  containerClassName?: string;
}

// Shared behavior behind every "toggle button + search-filtered option list" dropdown in the
// app (exam picker, school picker, ...): open/close state, outside-click dismissal, text
// filtering, and the visible-count cap. Rendering (trigger button, panel/option styling) stays
// fully caller-controlled via props so each existing usage keeps its exact look.
export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
  options,
  selectedId,
  onSelect,
  trigger,
  panelClassName,
  searchPlaceholder,
  searchInputClassName,
  emptyText,
  optionClassName,
  extraOption,
  maxVisible = 50,
  renderMore,
  containerClassName = 'relative'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');

  const close = () => {
    setIsOpen(false);
    setSearchText('');
  };

  const select = (id: string) => {
    onSelect(id);
    close();
  };

  const lowerSearch = searchText.toLowerCase();
  const matchedExtra = extraOption && extraOption.searchText.toLowerCase().includes(lowerSearch) ? extraOption : null;
  const filtered = options.filter((o) => o.searchText.toLowerCase().includes(lowerSearch));
  const sliced = filtered.slice(0, maxVisible);

  return (
    <div className={containerClassName}>
      {trigger({ isOpen, toggle: () => setIsOpen((prev) => !prev) })}

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={close} />
          <div className={panelClassName}>
            <div className="relative flex items-center shrink-0">
              <Search className="absolute left-3 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={searchPlaceholder}
                className={searchInputClassName}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {sliced.length === 0 && !matchedExtra ? (
                <div className="text-center py-6 text-xs text-slate-400 font-bold">{emptyText}</div>
              ) : (
                <>
                  {matchedExtra && (
                    <button
                      type="button"
                      onClick={() => select(matchedExtra.id)}
                      className={optionClassName(matchedExtra.id === selectedId)}
                    >
                      {matchedExtra.label}
                      {matchedExtra.id === selectedId && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                    </button>
                  )}
                  {sliced.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => select(option.id)}
                      className={optionClassName(option.id === selectedId)}
                    >
                      {option.label}
                      {option.id === selectedId && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                    </button>
                  ))}
                  {renderMore && filtered.length > maxVisible && renderMore(filtered.length - maxVisible, filtered.length)}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
