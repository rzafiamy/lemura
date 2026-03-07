/**
 * Interface for Short Term Memory storage adapters.
 * Implementations handle the persistence of STM variables.
 */
export interface IStorageAdapter {
    /**
     * Retrieves content by its unique ID.
     *
     * @param id - The unique identifier of the stored content
     * @returns The content or undefined if it does not exist
     */
    get(id: string): Promise<any | undefined>;

    /**
     * Saves content returning a stable ID if none was provided, or using the given ID.
     *
     * @param id - An optional unique identifier. If not provided, one should be generated.
     * @param content - The content to be stored
     * @param metadata - Optional metadata about the content (e.g. type, size)
     * @returns A promise that resolves to the ID under which it was saved
     */
    set(id: string | undefined, content: any, metadata?: Record<string, unknown>): Promise<string>;

    /**
     * Deletes content by its unique ID.
     *
     * @param id - The unique identifier of the content to delete
     * @returns Resolves when deletion is complete
     */
    delete(id: string): Promise<void>;

    /**
     * Optional health check for remote storage adapters.
     *
     * @returns true if storage is accessible, false otherwise
     */
    healthCheck?(): Promise<boolean>;
}

/**
 * Represents an item stored in Short Term Memory.
 */
export interface STMItem {
    id: string;
    content: any;
    type: 'text' | 'blob';
    metadata?: Record<string, unknown>;
}
