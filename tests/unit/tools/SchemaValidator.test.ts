import { describe, it, expect } from 'vitest';
import { validateJsonSchema } from '../../../src/tools/SchemaValidator.js';

describe('validateJsonSchema', () => {
    describe('type checking', () => {
        it('returns no errors when the value matches the expected primitive type', () => {
            // Arrange
            const schema = { type: 'string' };

            // Act
            const errors = validateJsonSchema('hello', schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports a type mismatch when a string is supplied where a number is expected', () => {
            // Arrange
            const schema = { type: 'number' };

            // Act
            const errors = validateJsonSchema('not-a-number', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain("Expected type 'number'");
            expect(errors[0]?.message).toContain("got 'string'");
        });

        it('treats null as the distinct null type rather than object', () => {
            // Arrange
            const schema = { type: 'null' };

            // Act
            const errors = validateJsonSchema(null, schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('treats arrays as the array type rather than object', () => {
            // Arrange
            const schema = { type: 'object' };

            // Act
            const errors = validateJsonSchema([1, 2, 3], schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain("got 'array'");
        });

        it('accepts an integer value for the integer type', () => {
            // Arrange
            const schema = { type: 'integer' };

            // Act
            const errors = validateJsonSchema(42, schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('rejects a fractional number for the integer type', () => {
            // Arrange
            const schema = { type: 'integer' };

            // Act
            const errors = validateJsonSchema(3.14, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain("Expected type 'integer'");
        });

        it('accepts a value matching any type in a union type array', () => {
            // Arrange
            const schema = { type: ['string', 'number'] };

            // Act
            const errors = validateJsonSchema(7, schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('stops further checks once the type is wrong', () => {
            // Arrange — minLength would also flag, but the type error short-circuits
            const schema = { type: 'string', minLength: 5 };

            // Act
            const errors = validateJsonSchema(123, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('Expected type');
        });
    });

    describe('enum and const', () => {
        it('returns no errors when the value is one of the allowed enum members', () => {
            // Arrange
            const schema = { enum: ['a', 'b', 'c'] };

            // Act
            const errors = validateJsonSchema('b', schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports an error when the value is outside the enum set', () => {
            // Arrange
            const schema = { enum: ['a', 'b'] };

            // Act
            const errors = validateJsonSchema('z', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('must be one of');
        });

        it('returns no errors when the value equals the const', () => {
            // Arrange
            const schema = { const: 42 };

            // Act
            const errors = validateJsonSchema(42, schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports an error when the value differs from the const', () => {
            // Arrange
            const schema = { const: 'fixed' };

            // Act
            const errors = validateJsonSchema('other', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('must equal');
        });
    });

    describe('string constraints', () => {
        it('reports an error when the string is shorter than minLength', () => {
            // Arrange
            const schema = { type: 'string', minLength: 5 };

            // Act
            const errors = validateJsonSchema('ab', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('too short');
        });

        it('reports an error when the string is longer than maxLength', () => {
            // Arrange
            const schema = { type: 'string', maxLength: 3 };

            // Act
            const errors = validateJsonSchema('toolong', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('too long');
        });

        it('returns no errors when the string matches the pattern', () => {
            // Arrange
            const schema = { type: 'string', pattern: '^[a-z]+$' };

            // Act
            const errors = validateJsonSchema('abc', schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports an error when the string does not match the pattern', () => {
            // Arrange
            const schema = { type: 'string', pattern: '^[a-z]+$' };

            // Act
            const errors = validateJsonSchema('ABC123', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('does not match pattern');
        });

        it('skips pattern checking silently when the pattern is an invalid regex', () => {
            // Arrange
            const schema = { type: 'string', pattern: '[' };

            // Act
            const errors = validateJsonSchema('anything', schema);

            // Assert
            expect(errors).toEqual([]);
        });
    });

    describe('number constraints', () => {
        it('reports an error when the number is below the minimum', () => {
            // Arrange
            const schema = { type: 'number', minimum: 10 };

            // Act
            const errors = validateJsonSchema(5, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('less than minimum');
        });

        it('reports an error when the number exceeds the maximum', () => {
            // Arrange
            const schema = { type: 'number', maximum: 10 };

            // Act
            const errors = validateJsonSchema(11, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('exceeds maximum');
        });

        it('reports an error when the number is not strictly above exclusiveMinimum', () => {
            // Arrange
            const schema = { type: 'number', exclusiveMinimum: 0 };

            // Act
            const errors = validateJsonSchema(0, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('must be >');
        });

        it('reports an error when the number is not strictly below exclusiveMaximum', () => {
            // Arrange
            const schema = { type: 'number', exclusiveMaximum: 100 };

            // Act
            const errors = validateJsonSchema(100, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('must be <');
        });

        it('returns no errors when the number is within all bounds', () => {
            // Arrange
            const schema = {
                type: 'number',
                minimum: 0,
                maximum: 10,
                exclusiveMinimum: -1,
                exclusiveMaximum: 11
            };

            // Act
            const errors = validateJsonSchema(5, schema);

            // Assert
            expect(errors).toEqual([]);
        });
    });

    describe('array constraints', () => {
        it('reports an error when the array has fewer than minItems', () => {
            // Arrange
            const schema = { type: 'array', minItems: 2 };

            // Act
            const errors = validateJsonSchema([1], schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('too short');
        });

        it('reports an error when the array has more than maxItems', () => {
            // Arrange
            const schema = { type: 'array', maxItems: 1 };

            // Act
            const errors = validateJsonSchema([1, 2], schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('too long');
        });

        it('validates each array element against the items schema with an indexed path', () => {
            // Arrange
            const schema = { type: 'array', items: { type: 'string' } };

            // Act
            const errors = validateJsonSchema(['ok', 99], schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.path).toBe('[1]');
        });
    });

    describe('object constraints', () => {
        it('reports a missing required property with a dotted path', () => {
            // Arrange
            const schema = {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } }
            };

            // Act
            const errors = validateJsonSchema({}, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain("Required property 'name' is missing");
            expect(errors[0]?.path).toBe('name');
        });

        it('recursively validates known properties and prefixes the nested path', () => {
            // Arrange
            const schema = {
                type: 'object',
                properties: { age: { type: 'integer' } }
            };

            // Act
            const errors = validateJsonSchema({ age: 'old' }, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.path).toBe('age');
        });

        it('rejects unknown keys when additionalProperties is false', () => {
            // Arrange
            const schema = {
                type: 'object',
                properties: { known: { type: 'string' } },
                additionalProperties: false
            };

            // Act
            const errors = validateJsonSchema({ known: 'x', extra: 1 }, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain("Additional property 'extra' is not allowed");
        });

        it('validates unknown keys against an additionalProperties schema', () => {
            // Arrange
            const schema = {
                type: 'object',
                properties: {},
                additionalProperties: { type: 'number' }
            };

            // Act
            const errors = validateJsonSchema({ a: 1, b: 'nope' }, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.path).toBe('b');
        });

        it('reports an error when the object has fewer than minProperties', () => {
            // Arrange
            const schema = { type: 'object', minProperties: 2 };

            // Act
            const errors = validateJsonSchema({ a: 1 }, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('fewer than 2 properties');
        });

        it('reports an error when the object has more than maxProperties', () => {
            // Arrange
            const schema = { type: 'object', maxProperties: 1 };

            // Act
            const errors = validateJsonSchema({ a: 1, b: 2 }, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('more than 1 properties');
        });

        it('builds nested paths for required properties inside a nested object', () => {
            // Arrange
            const schema = {
                type: 'object',
                properties: {
                    user: {
                        type: 'object',
                        required: ['id'],
                        properties: { id: { type: 'string' } }
                    }
                }
            };

            // Act
            const errors = validateJsonSchema({ user: {} }, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.path).toBe('user.id');
        });
    });

    describe('composition keywords', () => {
        it('aggregates errors from every allOf sub-schema', () => {
            // Arrange
            const schema = {
                allOf: [{ type: 'number' }, { minimum: 10 }]
            };

            // Act
            const errors = validateJsonSchema(5, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('less than minimum');
        });

        it('passes anyOf when at least one sub-schema matches', () => {
            // Arrange
            const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };

            // Act
            const errors = validateJsonSchema(42, schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports an error when no anyOf sub-schema matches', () => {
            // Arrange
            const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };

            // Act
            const errors = validateJsonSchema(true, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('does not match any of the anyOf');
        });

        it('passes oneOf when exactly one sub-schema matches', () => {
            // Arrange
            const schema = { oneOf: [{ type: 'string' }, { type: 'number' }] };

            // Act
            const errors = validateJsonSchema('only-string', schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports an error when more than one oneOf sub-schema matches', () => {
            // Arrange — an integer matches both 'number' and 'integer'
            const schema = { oneOf: [{ type: 'number' }, { type: 'integer' }] };

            // Act
            const errors = validateJsonSchema(7, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('exactly one of the oneOf');
            expect(errors[0]?.message).toContain('matched 2');
        });

        it('reports an error when no oneOf sub-schema matches', () => {
            // Arrange
            const schema = { oneOf: [{ type: 'string' }, { type: 'boolean' }] };

            // Act
            const errors = validateJsonSchema(42, schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('matched 0');
        });

        it('passes not when the value fails the negated schema', () => {
            // Arrange
            const schema = { not: { type: 'string' } };

            // Act
            const errors = validateJsonSchema(42, schema);

            // Assert
            expect(errors).toEqual([]);
        });

        it('reports an error when the value matches the negated not schema', () => {
            // Arrange
            const schema = { not: { type: 'string' } };

            // Act
            const errors = validateJsonSchema('matches', schema);

            // Assert
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain('must NOT match');
        });
    });

    it('returns no errors for an empty schema regardless of the value', () => {
        // Arrange
        const schema = {};

        // Act
        const errors = validateJsonSchema({ anything: [1, 2] }, schema);

        // Assert
        expect(errors).toEqual([]);
    });
});
