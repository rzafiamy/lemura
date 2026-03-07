/**
 * Base class for all custom errors thrown by lemura.
 *
 * @example
 * throw new LemuraError('Something went wrong', 'UNKNOWN_ERROR');
 */
export class LemuraError extends Error {
    /**
     * @param message - The error message
     * @param code - The error code for programmatic handling
     * @param problem - A clear description of the problem for the end user
     * @param hints - A list of suggestions to resolve the issue
     */
    constructor(
        message: string,
        public readonly code: string,
        public readonly problem?: string,
        public readonly hints: string[] = []
    ) {
        super(message);
        this.name = 'LemuraError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** Error thrown when context exceeds max tokens and cannot be compressed further */
export class LemuraContextOverflowError extends LemuraError {
    constructor(message: string) {
        super(message, 'CONTEXT_OVERFLOW');
        this.name = 'LemuraContextOverflowError';
    }
}

/** Error thrown when a requested tool is not found in the registry */
export class LemuraToolNotFoundError extends LemuraError {
    constructor(message: string) {
        super(message, 'TOOL_NOT_FOUND');
        this.name = 'LemuraToolNotFoundError';
    }
}

/** Error thrown when an adapter encounters an API or formatting issue */
export class LemuraAdapterError extends LemuraError {
    constructor(
        message: string,
        code = 'ADAPTER_ERROR',
        public cause?: any,
        problem?: string,
        hints: string[] = []
    ) {
        super(message, code, problem, hints);
        this.name = 'LemuraAdapterError';
    }
}

/** Error thrown when a skill cannot be parsed or injected */
export class LemuraSkillInjectionError extends LemuraError {
    constructor(message: string) {
        super(message, 'SKILL_INJECTION_FAILED');
        this.name = 'LemuraSkillInjectionError';
    }
}

/** Error thrown when the ReAct loop exceeds the configured max iterations */
export class LemuraMaxIterationsError extends LemuraError {
    constructor(message: string) {
        super(message, 'MAX_ITERATIONS_EXCEEDED');
        this.name = 'LemuraMaxIterationsError';
    }
}

/** Error thrown when tool parameters fail JSON schema validation */
export class LemuraToolValidationError extends LemuraError {
    constructor(message: string) {
        super(message, 'TOOL_VALIDATION_FAILED');
        this.name = 'LemuraToolValidationError';
    }
}

/** Error thrown when a tool execute function exceeds its timeout */
export class LemuraToolTimeoutError extends LemuraError {
    constructor(message: string) {
        super(message, 'TOOL_TIMEOUT');
        this.name = 'LemuraToolTimeoutError';
    }
}
