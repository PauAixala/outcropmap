/**
 * The only persistence API in the project, backed by the browser's localStorage. Everything else
 * goes through `StorageAdapter`, so tests can hand in an in-memory store and nothing has to know
 * where the data lives. Never call localStorage directly anywhere else.
 */

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const PREFIX = 'tfmv:';

export function createStorage(): StorageAdapter {
  function fullKey(key: string): string {
    return `${PREFIX}${key}`;
  }

  return {
    get<T>(key: string): Promise<T | undefined> {
      try {
        const raw = localStorage.getItem(fullKey(key));
        if (raw === null) return Promise.resolve(undefined);
        return Promise.resolve(JSON.parse(raw) as T);
      } catch {
        return Promise.resolve(undefined);
      }
    },
    set<T>(key: string, value: T): Promise<void> {
      localStorage.setItem(fullKey(key), JSON.stringify(value));
      return Promise.resolve();
    },
    remove(key: string): Promise<void> {
      localStorage.removeItem(fullKey(key));
      return Promise.resolve();
    },
    keys(): Promise<string[]> {
      const result: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null && key.startsWith(PREFIX)) result.push(key.slice(PREFIX.length));
      }
      return Promise.resolve(result);
    },
  };
}
