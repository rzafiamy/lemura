import { IStorageAdapter } from '../types/index.js';
import { randomUUID } from 'crypto';

/**
 * An in-memory implementation of IStorageAdapter for holding Short Term Memory.
 * Ideal for testing or single-process lightweight usage.
 *
 * @example
 * const storage = new InMemoryStorageAdapter();
 * const id = await storage.set(undefined, 'my content', { type: 'text' });
 * const retrieved = await storage.get(id);
 */
export class InMemoryStorageAdapter implements IStorageAdapter {
    private store = new Map<string, { content: any; metadata?: Record<string, unknown> }>();

    /**
     * Retrieves stored content by ID.
     *
     * @param id - The identifier of the stored item
     * @returns The stored content or undefined if not found
     */
    async get(id: string): Promise<any | undefined> {
        return this.store.get(id)?.content;
    }

    /**
     * Returns the full item including metadata.
     *
     * @param id - The identifier of the stored item
     * @returns The complete item with content and metadata
     * @internal
     */
    async getFull(id: string): Promise<{ content: any; metadata?: Record<string, unknown> } | undefined> {
        return this.store.get(id);
    }

    /**
     * Stores content, generating an ID if none is provided.
     *
     * @param id - Optional provided ID. If omitted, a UUID is generated.
     * @param content - The content to store
     * @param metadata - Optional metadata
     * @returns The ID under which the content is stored
     */
    async set(id: string | undefined, content: any, metadata?: Record<string, unknown>): Promise<string> {
        const resolvedId = id ?? randomUUID();
        this.store.set(resolvedId, metadata !== undefined ? { content, metadata } : { content });
        return resolvedId;
    }

    /**
     * Deletes the content for the given ID.
     *
     * @param id - The identifier of the item to delete
     */
    async delete(id: string): Promise<void> {
        this.store.delete(id);
    }

    /**
     * Synchronous health check, always true for in-memory.
     *
     * @returns true
     */
    async healthCheck(): Promise<boolean> {
        return true;
    }
}
