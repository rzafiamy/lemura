import { IScratchpadAdapter } from '../types/index.js';

/**
 * In-memory scratchpad adapter, keyed by sessionId.
 * Ideal for testing or single-process usage.
 */
export class InMemoryScratchpadAdapter implements IScratchpadAdapter {
    private store = new Map<string, string>();

    async read(sessionId: string): Promise<string | undefined> {
        return this.store.get(sessionId);
    }

    async write(sessionId: string, content: string): Promise<void> {
        this.store.set(sessionId, content);
    }

    async clear(sessionId: string): Promise<void> {
        this.store.delete(sessionId);
    }

    async healthCheck(): Promise<boolean> {
        return true;
    }
}
