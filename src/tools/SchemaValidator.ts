/**
 * Standalone JSON Schema validator for tool parameter validation.
 *
 * Supports a meaningful subset of JSON Schema Draft-07 sufficient for
 * all common tool parameter shapes — with zero external dependencies.
 *
 * Supported keywords:
 *  - type (string, number, integer, boolean, object, array, null)
 *  - required, properties, additionalProperties
 *  - items (array element schema)
 *  - enum
 *  - minLength, maxLength (string)
 *  - minimum, maximum, exclusiveMinimum, exclusiveMaximum (number)
 *  - minItems, maxItems (array)
 *  - minProperties, maxProperties (object)
 *  - pattern (string regex)
 *  - oneOf, anyOf, allOf
 *
 * @example
 * const errors = validateJsonSchema({ name: 'Alice', age: 30 }, schema);
 * if (errors.length > 0) throw new LemuraToolValidationError(errors.join('; '));
 */

export interface SchemaValidationError {
    path: string;
    message: string;
}

// Bare minimum JSON Schema shape we validate against
type JSONSchemaNode = Record<string, unknown>;

function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function matchesType(value: unknown, requiredType: string): boolean {
    const t = typeOf(value);
    if (requiredType === 'integer') return t === 'number' && Number.isInteger(value);
    return t === requiredType;
}

/**
 * Recursively validates a value against a JSON Schema node.
 *
 * @param value - The value to validate
 * @param schema - The JSON Schema node
 * @param path - Dotted path for error reporting (e.g. "params.items[0].name")
 * @returns Array of validation errors (empty = valid)
 */
export function validateJsonSchema(
    value: unknown,
    schema: JSONSchemaNode,
    path = ''
): SchemaValidationError[] {
    const errors: SchemaValidationError[] = [];

    // --- type ---
    if (schema['type'] !== undefined) {
        const expectedType = schema['type'] as string | string[];
        const types = Array.isArray(expectedType) ? expectedType : [expectedType];
        if (!types.some(t => matchesType(value, t))) {
            errors.push({
                path,
                message: `Expected type '${types.join('|')}', got '${typeOf(value)}'`
            });
            // Stop further checks if type is wrong (most sub-checks are type-specific)
            return errors;
        }
    }

    // --- enum ---
    if (schema['enum'] !== undefined) {
        const allowed = schema['enum'] as unknown[];
        if (!allowed.some(a => JSON.stringify(a) === JSON.stringify(value))) {
            errors.push({ path, message: `Value must be one of: ${JSON.stringify(allowed)}` });
        }
    }

    // --- const ---
    if ('const' in schema) {
        if (JSON.stringify(schema['const']) !== JSON.stringify(value)) {
            errors.push({ path, message: `Value must equal ${JSON.stringify(schema['const'])}` });
        }
    }

    // --- string ---
    if (typeof value === 'string') {
        if (schema['minLength'] !== undefined && value.length < (schema['minLength'] as number)) {
            errors.push({ path, message: `String too short (min ${schema['minLength']}, got ${value.length})` });
        }
        if (schema['maxLength'] !== undefined && value.length > (schema['maxLength'] as number)) {
            errors.push({ path, message: `String too long (max ${schema['maxLength']}, got ${value.length})` });
        }
        if (schema['pattern'] !== undefined) {
            try {
                const re = new RegExp(schema['pattern'] as string);
                if (!re.test(value)) {
                    errors.push({ path, message: `String does not match pattern /${schema['pattern']}/` });
                }
            } catch {
                // invalid pattern — skip
            }
        }
    }

    // --- number / integer ---
    if (typeof value === 'number') {
        if (schema['minimum'] !== undefined && value < (schema['minimum'] as number)) {
            errors.push({ path, message: `Value ${value} is less than minimum ${schema['minimum']}` });
        }
        if (schema['maximum'] !== undefined && value > (schema['maximum'] as number)) {
            errors.push({ path, message: `Value ${value} exceeds maximum ${schema['maximum']}` });
        }
        if (schema['exclusiveMinimum'] !== undefined && value <= (schema['exclusiveMinimum'] as number)) {
            errors.push({ path, message: `Value ${value} must be > ${schema['exclusiveMinimum']}` });
        }
        if (schema['exclusiveMaximum'] !== undefined && value >= (schema['exclusiveMaximum'] as number)) {
            errors.push({ path, message: `Value ${value} must be < ${schema['exclusiveMaximum']}` });
        }
    }

    // --- array ---
    if (Array.isArray(value)) {
        if (schema['minItems'] !== undefined && value.length < (schema['minItems'] as number)) {
            errors.push({ path, message: `Array too short (min ${schema['minItems']} items)` });
        }
        if (schema['maxItems'] !== undefined && value.length > (schema['maxItems'] as number)) {
            errors.push({ path, message: `Array too long (max ${schema['maxItems']} items)` });
        }
        if (schema['items'] !== undefined) {
            const itemSchema = schema['items'] as JSONSchemaNode;
            value.forEach((item, idx) => {
                const childErrors = validateJsonSchema(item, itemSchema, `${path}[${idx}]`);
                errors.push(...childErrors);
            });
        }
    }

    // --- object ---
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const props = (schema['properties'] as Record<string, JSONSchemaNode> | undefined) || {};
        const required = (schema['required'] as string[] | undefined) || [];

        // required
        for (const key of required) {
            if (!(key in obj)) {
                errors.push({ path: path ? `${path}.${key}` : key, message: `Required property '${key}' is missing` });
            }
        }

        // known properties
        for (const [key, propSchema] of Object.entries(props)) {
            if (key in obj) {
                const childErrors = validateJsonSchema(obj[key], propSchema, path ? `${path}.${key}` : key);
                errors.push(...childErrors);
            }
        }

        // additionalProperties = false
        if (schema['additionalProperties'] === false) {
            for (const key of Object.keys(obj)) {
                if (!(key in props)) {
                    errors.push({ path: path ? `${path}.${key}` : key, message: `Additional property '${key}' is not allowed` });
                }
            }
        } else if (schema['additionalProperties'] !== undefined && typeof schema['additionalProperties'] === 'object') {
            const addlSchema = schema['additionalProperties'] as JSONSchemaNode;
            for (const [key, val] of Object.entries(obj)) {
                if (!(key in props)) {
                    const childErrors = validateJsonSchema(val, addlSchema, path ? `${path}.${key}` : key);
                    errors.push(...childErrors);
                }
            }
        }

        if (schema['minProperties'] !== undefined && Object.keys(obj).length < (schema['minProperties'] as number)) {
            errors.push({ path, message: `Object has fewer than ${schema['minProperties']} properties` });
        }
        if (schema['maxProperties'] !== undefined && Object.keys(obj).length > (schema['maxProperties'] as number)) {
            errors.push({ path, message: `Object has more than ${schema['maxProperties']} properties` });
        }
    }

    // --- composition keywords ---
    if (schema['allOf'] !== undefined) {
        for (const subSchema of schema['allOf'] as JSONSchemaNode[]) {
            errors.push(...validateJsonSchema(value, subSchema, path));
        }
    }

    if (schema['anyOf'] !== undefined) {
        const subSchemas = schema['anyOf'] as JSONSchemaNode[];
        const anyPassed = subSchemas.some(s => validateJsonSchema(value, s, path).length === 0);
        if (!anyPassed) {
            errors.push({ path, message: 'Value does not match any of the anyOf schemas' });
        }
    }

    if (schema['oneOf'] !== undefined) {
        const subSchemas = schema['oneOf'] as JSONSchemaNode[];
        const passing = subSchemas.filter(s => validateJsonSchema(value, s, path).length === 0);
        if (passing.length !== 1) {
            errors.push({
                path,
                message: `Value must match exactly one of the oneOf schemas (matched ${passing.length})`
            });
        }
    }

    if (schema['not'] !== undefined) {
        const subErrors = validateJsonSchema(value, schema['not'] as JSONSchemaNode, path);
        if (subErrors.length === 0) {
            errors.push({ path, message: 'Value must NOT match the not schema' });
        }
    }

    return errors;
}
