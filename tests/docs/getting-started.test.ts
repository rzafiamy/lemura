import { describe, it, expect } from 'vitest';
import { ContextManager } from '../../src/context/ContextManager.js';

describe('Getting Started Doc Test', () => {
    it('should initialize a context manager without throwing', () => {
        const manager = new ContextManager();
        expect(manager).toBeDefined();
    });
});
