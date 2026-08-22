import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Loader2, Plus, Trash2, Settings2 } from 'lucide-react';
import { NamedListItem } from '../services/api';

interface ManageNamedListDialogProps {
  title: string;
  description?: string;
  items: NamedListItem[];
  loading: boolean;
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: string, name: string) => Promise<void>;
  triggerLabel?: string;
}

// Shared "add / delete a named entry" dialog, backing both the Subject Categories manager
// (AdminCreateExam.tsx, AdminExams.tsx, ExamQuestions.tsx) and the Academic Levels manager
// (AdminSchoolManagement.tsx). UX mirrors SyllabusTracker.tsx's existing add/delete pattern:
// input+submit to add, trash icon + native confirm() to delete — same shape admins already
// know from that screen.
export const ManageNamedListDialog: React.FC<ManageNamedListDialogProps> = ({
  title,
  description,
  items,
  loading,
  onAdd,
  onRemove,
  triggerLabel = 'Manage'
}) => {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsSaving(true);
    try {
      await onAdd(newName.trim());
      setNewName('');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Existing exams/students that already reference it keep their stored value unchanged.`)) return;
    await onRemove(id, name);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer border-slate-200"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[420px] rounded-3xl border border-slate-200 shadow-2xl bg-white p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-slate-900">{title}</DialogTitle>
          {description && <DialogDescription className="text-slate-500 text-xs font-bold">{description}</DialogDescription>}
        </DialogHeader>

        <form onSubmit={handleAdd} className="flex gap-2 mt-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. B.Tech"
            className="h-10 text-sm"
          />
          <Button type="submit" disabled={isSaving || !newName.trim()} className="h-10 px-4 rounded-lg text-xs font-bold shrink-0 cursor-pointer">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </form>

        <div className="max-h-[240px] overflow-y-auto mt-3 space-y-1">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No entries yet — add one above.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-slate-50">
                <span className="text-sm font-semibold text-slate-800">{item.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id, item.name)}
                  className="text-slate-400 hover:text-red-600 cursor-pointer p-1"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9 rounded-lg text-xs font-bold cursor-pointer">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
