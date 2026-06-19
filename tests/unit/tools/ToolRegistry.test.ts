import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../../../src/tools/ToolRegistry.js';
import {
    IToolDefinition,
    LemuraToolNotFoundError,
    LemuraToolValidationError,
    LemuraToolTimeoutError,
    ToolContext
} from '../../../src/types/index.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const context: ToolContext = {
    sessionId: 'test',
    turnIndex: 0,
    logger
};

function makeTool(overrides: Partial<IToolDefinition> = {}): IToolDefinition {
    return {
        name: 'echo',
        description: 'Echoes the input',
        parameters: {
            type: 'object',
            required: ['message'],
            properties: { message: { type: 'string' } }
        },
        execute: vi.fn(async (params: unknown) => params),
        ...overrides
    };
}

describe('ToolRegistry', () => {
    describe('registration', () => {
        it('registers tools passed to the constructor and exposes them via get', () => {
            // Arrange
            const tool = makeTool();

            // Act
            const registry = new ToolRegistry([tool]);

            // Assert
            expect(registry.get('echo')).toBe(tool);
        });

        it('throws when registering a tool whose name is already taken', () => {
            // Arrange
            const registry = new ToolRegistry([makeTool()]);

            // Act / Assert
            expect(() => registry.register(makeTool())).toThrow(LemuraToolNotFoundError);
        });

        it('unregisters a tool and reports whether it existed', () => {
            // Arrange
            const registry = new ToolRegistry([makeTool()]);

            // Act
            const removed = registry.unregister('echo');
            const removedAgain = registry.unregister('echo');

            // Assert
            expect(removed).toBe(true);
            expect(removedAgain).toBe(false);
            expect(registry.get('echo')).toBeUndefined();
        });

        it('returns all registered tools via getAll', () => {
            // Arrange
            const a = makeTool({ name: 'a' });
            const b = makeTool({ name: 'b' });

            // Act
            const registry = new ToolRegistry([a, b]);

            // Assert
            expect(registry.getAll()).toEqual([a, b]);
        });
    });

    describe('execute — validation', () => {
        it('throws LemuraToolNotFoundError when the tool is not registered', async () => {
            // Arrange
            const registry = new ToolRegistry();

            // Act / Assert
            await expect(registry.execute('missing', {}, context)).rejects.toThrow(LemuraToolNotFoundError);
        });

        it('throws LemuraToolValidationError before executing when a required param is missing', async () => {
            // Arrange
            const execute = vi.fn(async () => 'ok');
            const registry = new ToolRegistry([makeTool({ execute })]);

            // Act
            const promise = registry.execute('echo', {}, context);

            // Assert
            await expect(promise).rejects.toThrow(LemuraToolValidationError);
            expect(execute).not.toHaveBeenCalled();
        });

        it('includes the failing path in the validation error message', async () => {
            // Arrange
            const registry = new ToolRegistry([makeTool()]);

            // Act
            const promise = registry.execute('echo', { message: 123 }, context);

            // Assert
            await expect(promise).rejects.toThrow(/\[message\]/);
        });

        it('executes the tool and returns its result when params are valid', async () => {
            // Arrange
            const execute = vi.fn(async () => 'done');
            const registry = new ToolRegistry([makeTool({ execute })]);

            // Act
            const result = await registry.execute('echo', { message: 'hi' }, context);

            // Assert
            expect(result).toBe('done');
            expect(execute).toHaveBeenCalledWith({ message: 'hi' }, context);
        });

        it('skips schema validation when the tool declares no parameters object', async () => {
            // Arrange
            const execute = vi.fn(async () => 'ran');
            const tool = makeTool({ parameters: undefined as never, execute });
            const registry = new ToolRegistry([tool]);

            // Act
            const result = await registry.execute('echo', { anything: true }, context);

            // Assert
            expect(result).toBe('ran');
        });
    });

    describe('execute — error handling', () => {
        it('wraps a thrown execution error in LemuraToolValidationError', async () => {
            // Arrange
            const tool = makeTool({
                execute: vi.fn(async () => {
                    throw new Error('boom');
                })
            });
            const registry = new ToolRegistry([tool]);

            // Act
            const promise = registry.execute('echo', { message: 'x' }, context);

            // Assert
            await expect(promise).rejects.toThrow(/execution failed: boom/);
        });

        it('handles a non-Error thrown value by stringifying it', async () => {
            // Arrange
            const tool = makeTool({
                // eslint-disable-next-line @typescript-eslint/no-throw-literal
                execute: vi.fn(async () => {
                    throw 'string failure';
                })
            });
            const registry = new ToolRegistry([tool]);

            // Act
            const promise = registry.execute('echo', { message: 'x' }, context);

            // Assert
            await expect(promise).rejects.toThrow(/execution failed: string failure/);
        });
    });

    describe('execute — timeout', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('throws LemuraToolTimeoutError when execution exceeds the per-tool timeout', async () => {
            // Arrange
            const tool = makeTool({
                timeoutMs: 50,
                execute: () => new Promise(() => {
                    /* never resolves */
                })
            });
            const registry = new ToolRegistry([tool]);

            // Act
            const promise = registry.execute('echo', { message: 'x' }, context);
            const assertion = expect(promise).rejects.toThrow(LemuraToolTimeoutError);
            await vi.advanceTimersByTimeAsync(60);

            // Assert
            await assertion;
        });

        it('uses the registry default timeout when the tool defines none', async () => {
            // Arrange
            const tool = makeTool({
                execute: () => new Promise(() => {
                    /* never resolves */
                })
            });
            const registry = new ToolRegistry([tool], { defaultTimeoutMs: 100 });

            // Act
            const promise = registry.execute('echo', { message: 'x' }, context);
            const assertion = expect(promise).rejects.toThrow(LemuraToolTimeoutError);
            await vi.advanceTimersByTimeAsync(120);

            // Assert
            await assertion;
        });
    });

    describe('executeParallel', () => {
        it('returns results in input order for successful calls', async () => {
            // Arrange
            const tool = makeTool({ execute: vi.fn(async (p: unknown) => p) });
            const registry = new ToolRegistry([tool]);

            // Act
            const results = await registry.executeParallel(
                [
                    { id: '1', name: 'echo', params: { message: 'a' } },
                    { id: '2', name: 'echo', params: { message: 'b' } }
                ],
                context
            );

            // Assert
            expect(results).toEqual([
                { id: '1', result: { message: 'a' } },
                { id: '2', result: { message: 'b' } }
            ]);
        });

        it('captures per-call errors without aborting the other calls', async () => {
            // Arrange
            const registry = new ToolRegistry([makeTool()]);

            // Act
            const results = await registry.executeParallel(
                [
                    { id: '1', name: 'echo', params: { message: 'ok' } },
                    { id: '2', name: 'echo', params: {} }
                ],
                context
            );

            // Assert
            expect(results[0]?.result).toEqual({ message: 'ok' });
            expect(results[1]?.error).toBeInstanceOf(LemuraToolValidationError);
        });
    });
});
