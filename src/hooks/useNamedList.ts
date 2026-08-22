import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { NamedListItem, subjectCategoriesService, academicLevelsService } from '../services/api';

// Shared hook backing both useSubjectCategories() and useAcademicLevels() below — add/remove
// update local state directly from the create/delete response instead of refetching, so a
// newly-added category shows up in every open dropdown immediately (sidesteps the client
// requestCache's 15s TTL and the server write-queue's batched cache-invalidation lag).
function useNamedList(service: { list(): Promise<NamedListItem[]>; create(name: string): Promise<NamedListItem>; remove(id: string): Promise<void> }) {
  const [items, setItems] = useState<NamedListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await service.list();
      list.sort((a, b) => a.name.localeCompare(b.name));
      setItems(list);
    } catch (err) {
      console.error('Failed to load list:', err);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addItem = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const created = await service.create(trimmed);
        setItems((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Added "${trimmed}".`);
      } catch (err: any) {
        toast.error(err?.message || `Failed to add "${trimmed}".`);
      }
    },
    [service]
  );

  const removeItem = useCallback(
    async (id: string, name: string) => {
      try {
        await service.remove(id);
        setItems((prev) => prev.filter((item) => item.id !== id));
        toast.success(`Removed "${name}".`);
      } catch (err: any) {
        toast.error(err?.message || `Failed to remove "${name}".`);
      }
    },
    [service]
  );

  return { items, loading, reload, addItem, removeItem };
}

export function useSubjectCategories() {
  return useNamedList(subjectCategoriesService);
}

export function useAcademicLevels() {
  return useNamedList(academicLevelsService);
}
