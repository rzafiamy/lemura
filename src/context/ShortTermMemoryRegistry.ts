import { IStorageAdapter, STMItem } from '../types/index.js';
import { randomUUID } from 'crypto';

export interface STMRegistryConfig {
    /**
     * The storage backend to use for Short Term Memory items.
     */
    storage: IStorageAdapter;

    /**
     * The maximum number of tokens allowed for a 'text' type STM item.
     * If an item exceeds this, it may be rejected or truncated.
     * Default: 100000
     */
    maxTextTokens?: number;
}

/**
 * Registry for Short Term Memory (STM).
 * Manages the storage and retrieval of large context variables like long texts or blobs.
 * Generates '[STM:uuid]' references to be used within the ReAct agent context.
 */
export class ShortTermMemoryRegistry {
    private storage: IStorageAdapter;
    private maxTextTokens: number;

    constructor(config: STMRegistryConfig) {
        this.storage = config.storage;
        this.maxTextTokens = config.maxTextTokens ?? 100000;
    }

    /**
     * Registers a new memory item and returns its reference string.
     * 
     * @param content - The raw content to store
     * @param type - The type of content ('text' or 'blob')
     * @param metadata - Optional metadata (e.g. sandwich layers, original filename)
     * @param estimateTokens - Optional function to estimate token count for 'text' type
     * @returns A reference string formatted as '[STM:uuid]'
     * @throws {Error} if a text item exceeds the maxTextTokens limit
     */
    async register(
        content: any,
        type: 'text' | 'blob',
        metadata?: Record<string, unknown>,
        estimateTokens?: (text: string) => number
    ): Promise<string> {
        if (type === 'text') {
            const tokenCount = estimateTokens ? estimateTokens(content) : Math.ceil(String(content).length / 4);
            if (tokenCount > this.maxTextTokens) {
                throw new Error(`Text content exceeds max tokens limit of ${this.maxTextTokens} (estimated ${tokenCount})`);
            }
        }

        const id = randomUUID();
        const item: STMItem = {
            id,
            content,
            type,
            ...(metadata !== undefined ? { metadata } : {})
        };

        await this.storage.set(id, item);
        return `[STM:${id}]`;
    }

    /**
     * Updates an existing STM item's content or metadata.
     * 
     * @param id - The UUID of the item to update
     * @param updates - Partial updates to apply (content or metadata)
     */
    async update(id: string, updates: { content?: any; metadata?: Record<string, unknown> }): Promise<void> {
        const item = await this.storage.get(id);
        if (!item) throw new Error(`STM item not found for update: ${id}`);

        const updatedItem: STMItem = {
            ...item,
            ...(updates.content !== undefined ? { content: updates.content } : {}),
            ...(updates.metadata !== undefined ? { metadata: { ...item.metadata, ...updates.metadata } } : {})
        };

        await this.storage.set(id, updatedItem);
    }


    /**
     * Retrieves an STM item by its full reference string (e.g., '[STM:uuid]').
     * 
     * @param ref - The full reference string
     * @returns The STMItem or undefined if not found
     */
    async getByRef(ref: string): Promise<STMItem | undefined> {
        const match = ref.match(/^\[STM:(.+)\]$/);
        if (!match || !match[1]) return undefined;
        return this.storage.get(match[1]);
    }

    /**
     * Deletes an STM item by its ID.
     * 
     * @param id - The UUID of the item to delete
     */
    async delete(id: string): Promise<void> {
        await this.storage.delete(id);
    }
}
