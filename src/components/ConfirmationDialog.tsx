import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  itemName: string; // The exact name/title of the record to confirm deletion
  confirmKeyword?: string; // Optional keyword instead of itemName (e.g. "DELETE")
  isLoading?: boolean;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  confirmKeyword,
  isLoading = false
}) => {
  const [inputValue, setInputValue] = useState('');
  const targetWord = confirmKeyword || itemName;

  // Reset input when dialog state changes
  useEffect(() => {
    if (!isOpen) {
      setInputValue('');
    }
  }, [isOpen]);

  const isConfirmed = inputValue.trim().toLowerCase() === targetWord.trim().toLowerCase();

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConfirmed && !isLoading) {
      onConfirm();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-6 bg-white border border-slate-200 rounded-3xl shadow-2xl relative overflow-hidden">
        {/* Subtle background safety gradient/accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-red-600" />
        
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600 shadow-inner">
              <AlertTriangle className="h-5.5 w-5.5 animate-pulse" />
            </div>
            <DialogTitle className="text-lg font-bold text-slate-900 tracking-tight">
              {title}
            </DialogTitle>
          </div>
          
          <DialogDescription className="text-slate-600 text-sm leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirmSubmit} className="space-y-4 my-4">
          <div className="bg-red-50/50 border border-red-100 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5 uppercase tracking-wider">
              <ShieldAlert className="h-4 w-4" /> Double-Verification Protocol
            </p>
            <p className="text-slate-600 text-xs leading-normal">
              To permanently delete this, type <strong className="text-red-700 bg-red-50 border border-red-200/60 px-1.5 py-0.5 rounded font-mono select-all font-black">{targetWord}</strong> in the input field below:
            </p>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={`Type "${targetWord}" to confirm...`}
              className="mt-2 bg-white border-slate-200 focus:border-red-500 focus:ring-red-500 rounded-xl font-medium tracking-wide placeholder:text-slate-400"
              autoFocus
              disabled={isLoading}
            />
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
              className="w-full sm:w-auto h-10 border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 rounded-xl transition-all"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isConfirmed || isLoading}
              className={`w-full sm:w-auto h-10 font-bold text-white rounded-xl shadow-lg transition-all ${
                isConfirmed 
                  ? 'bg-red-600 hover:bg-red-700 shadow-red-100' 
                  : 'bg-slate-100 text-slate-400 border-none pointer-events-none shadow-none'
              }`}
            >
              {isLoading ? 'Permanently Deleting...' : 'Confirm Permanent Deletion'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
