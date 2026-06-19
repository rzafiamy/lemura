import { IMemoryStore, MemoryRecord, MemoryFilter } from '../../types/memory.js';
import { IStorageAdapter } from '../../types/storage.js';

interface IndexEntry {
    id: string;
    scope?: string;
    kind: MemoryRecord['kind'];
    tags: string[];
    entities: string[];
}

const DEFAULT_INDEX_KEY = '__lemura_memory_index__';

/**
 * Default {@link IMemoryStore}, implemented over any {@link IStorageAdapter}
 * (`get`/`set`/`delete`). This is the "Any storage" guarantee — the same memory
 * works against in-memory, IndexedDB, SQLite, Redis, or a Cordova file store with
 * zero code change.
 *
 * A lightweight index record (ids + their scope/kind/tags/entities) is kept under a
 * fixed key so `list(filter)` narrows candidates without scanning every record.
 *
 * @since 1.8.0
 */
export class StorageMemoryStore implements IMemoryStore {
    private indexKey: string;
    private indexLoaded = false;
    private index: IndexEntry[] = [];

    constructor(
        private storage: IStorageAdapter,
        indexKey = DEFAULT_INDEX_KEY
    ) {
        this.indexKey = indexKey;
    }

    private async loadIndex(): Promise<void> {
        if (this.indexLoaded) return;
        const stored = await this.storage.get(this.indexKey);
        this.index = Array.isArray(stored) ? (stored as IndexEntry[]) : [];
        this.indexLoaded = true;
    }

    private async saveIndex(): Promise<void> {
        await this.storage.set(this.indexKey, this.index);
    }

    async put(record: MemoryRecord): Promise<void> {
        await this.loadIndex();
        await this.storage.set(record.id, record);
        const entry: IndexEntry = {
            id: record.id,
            ...(record.scope !== undefined ? { scope: record.scope } : {}),
            kind: record.kind,
            tags: record.tags ?? [],
            entities: record.entities ?? [],
        };
        const existing = this.index.findIndex(e => e.id === record.id);
        if (existing !== -1) this.index[existing] = entry;
        else this.index.push(entry);
        await this.saveIndex();
    }

    async get(id: string): Promise<MemoryRecord | undefined> {
        const r = await this.storage.get(id);
        return r ? (r as MemoryRecord) : undefined;
    }

    async list(filter?: MemoryFilter): Promise<MemoryRecord[]> {
        await this.loadIndex();
        let entries = this.index;

        if (filter?.scope !== undefined) {
            entries = entries.filter(e => e.scope === filter.scope);
        }
        if (filter?.kinds && filter.kinds.length > 0) {
            const set = new Set(filter.kinds);
            entries = entries.filter(e => set.has(e.kind));
        }
        if (filter?.tags && filter.tags.length > 0) {
            entries = entries.filter(e => filter.tags!.some(t => e.tags.includes(t)));
        }
        if (filter?.entities && filter.entities.length > 0) {
            entries = entries.filter(e => filter.entities!.some(x => e.entities.includes(x)));
        }

        const limit = filter?.limit ?? 500;
        const slice = entries.slice(0, limit);

        const records = await Promise.all(slice.map(e => this.get(e.id)));
        return records.filter((r): r is MemoryRecord => r !== undefined);
    }

    async delete(id: string): Promise<void> {
        await this.loadIndex();
        await this.storage.delete(id);
        this.index = this.index.filter(e => e.id !== id);
        await this.saveIndex();
    }

    async healthCheck(): Promise<boolean> {
        return this.storage.healthCheck ? this.storage.healthCheck() : true;
    }
}
