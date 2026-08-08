/**
 * Gang of Four (GoF) Observer Pattern Implementation for Enterprise-grade State Sync
 * 
 * Defines standard:
 * - DbObserver: Interface for entities that react to state changes.
 * - DbSubject: Class for registering, removing, and broadcasting changes to observers.
 * - GlobalDbSubject: Singleton Subject for coordinating CRUD notifications application-wide.
 * - useDbObserver: React custom hook for effortless, declarative UI observer binding.
 */

import { useEffect, useRef } from 'react';

export type CrudType = 'create' | 'update' | 'delete' | 'set';

export interface CrudUpdateEvent {
  type: CrudType;
  collectionName: string;
  docId?: string;
}

export interface DbObserver {
  onUpdate(event: CrudUpdateEvent): void;
}

export class DbSubject {
  private observers: Set<DbObserver> = new Set();

  /**
   * Registers a new database observer (Attach operation)
   */
  public attach(observer: DbObserver): void {
    this.observers.add(observer);
  }

  /**
   * Unregisters an observer (Detach operation)
   */
  public detach(observer: DbObserver): void {
    this.observers.delete(observer);
  }

  /**
   * Notifies all registered observers of a database event
   */
  public notify(event: CrudUpdateEvent): void {
    this.observers.forEach(observer => {
      try {
        observer.onUpdate(event);
      } catch (err) {
        console.error('[DbSubject] Observer failed to handle update:', err);
      }
    });
  }
}

/**
 * Concrete Singleton Subject
 * Enforces uniform database state propagation across all decoupled application modules.
 */
export class GlobalDbSubject extends DbSubject {
  private static instance: GlobalDbSubject | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): GlobalDbSubject {
    if (!GlobalDbSubject.instance) {
      GlobalDbSubject.instance = new GlobalDbSubject();
    }
    return GlobalDbSubject.instance;
  }
}

/**
 * Custom React Hook: useDbObserver
 * Binds components to the database update stream. When CRUD operations occur on specified 
 * collections, the component automatically executes a callback to refresh state, removing
 * the need for manual state propagation or custom refresh buttons.
 * 
 * @param collections Array of target collection names to observe. If empty, observes all collections.
 * @param onRefresh Callback function to trigger state reload.
 */
export function useDbObserver(collections: string[], onRefresh: (event: CrudUpdateEvent) => void) {
  // Use a ref for the callback to prevent unnecessary subscription churn
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  // Use a ref for collections to avoid infinite effect triggers
  const collectionsStr = collections.join(',');

  useEffect(() => {
    const observer: DbObserver = {
      onUpdate: (event) => {
        const list = collectionsStr ? collectionsStr.split(',') : [];
        if (list.length === 0 || list.includes(event.collectionName)) {
          callbackRef.current(event);
        }
      }
    };

    const subject = GlobalDbSubject.getInstance();
    subject.attach(observer);

    return () => {
      subject.detach(observer);
    };
  }, [collectionsStr]);
}
