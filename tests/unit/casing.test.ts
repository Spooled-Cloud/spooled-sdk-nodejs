/**
 * Casing utility tests
 */

import { describe, it, expect } from 'vitest';
import {
  camelToSnake,
  snakeToCamel,
  toSnakeCase,
  toCamelCase,
  convertRequest,
  convertResponse,
  convertQueryParams,
} from '../../src/utils/casing.js';

describe('Casing', () => {
  describe('camelToSnake', () => {
    it('should convert camelCase to snake_case', () => {
      expect(camelToSnake('camelCase')).toBe('camel_case');
      expect(camelToSnake('myVariableName')).toBe('my_variable_name');
      expect(camelToSnake('XMLParser')).toBe('_x_m_l_parser');
    });

    it('should handle already snake_case', () => {
      expect(camelToSnake('already_snake')).toBe('already_snake');
    });

    it('should handle single word', () => {
      expect(camelToSnake('word')).toBe('word');
    });
  });

  describe('snakeToCamel', () => {
    it('should convert snake_case to camelCase', () => {
      expect(snakeToCamel('snake_case')).toBe('snakeCase');
      expect(snakeToCamel('my_variable_name')).toBe('myVariableName');
    });

    it('should handle already camelCase', () => {
      expect(snakeToCamel('alreadyCamel')).toBe('alreadyCamel');
    });

    it('should handle single word', () => {
      expect(snakeToCamel('word')).toBe('word');
    });
  });

  describe('toSnakeCase', () => {
    it('should convert object keys to snake_case', () => {
      const input = {
        queueName: 'my-queue',
        maxRetries: 3,
      };

      const output = toSnakeCase(input);
      expect(output).toEqual({
        queue_name: 'my-queue',
        max_retries: 3,
      });
    });

    it('should handle nested objects', () => {
      const input = {
        outerKey: {
          innerKey: 'value',
        },
      };

      const output = toSnakeCase(input);
      expect(output).toEqual({
        outer_key: {
          inner_key: 'value',
        },
      });
    });

    it('should handle arrays', () => {
      const input = {
        jobList: [{ jobId: '1' }, { jobId: '2' }],
      };

      const output = toSnakeCase(input);
      expect(output).toEqual({
        job_list: [{ job_id: '1' }, { job_id: '2' }],
      });
    });

    it('should NOT convert values under skip keys', () => {
      const input = {
        queueName: 'my-queue',
        payload: {
          customData: 'value',
          nestedObject: { anotherKey: 'value' },
        },
      };

      const output = toSnakeCase(input);
      expect(output).toEqual({
        queue_name: 'my-queue',
        payload: {
          customData: 'value',
          nestedObject: { anotherKey: 'value' },
        },
      });
    });

    it('should preserve values under metadata key', () => {
      const input = {
        jobId: '123',
        metadata: {
          userId: 'user_123',
          customField: 'value',
        },
      };

      const output = toSnakeCase(input);
      expect(output).toEqual({
        job_id: '123',
        metadata: {
          userId: 'user_123',
          customField: 'value',
        },
      });
    });

    it('should handle null and undefined', () => {
      expect(toSnakeCase(null)).toBeNull();
      expect(toSnakeCase(undefined)).toBeUndefined();
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const input = { createdAt: date };
      const output = toSnakeCase(input);
      expect(output).toEqual({ created_at: '2024-01-01T00:00:00.000Z' });
    });

    it('should handle primitives', () => {
      expect(toSnakeCase('string')).toBe('string');
      expect(toSnakeCase(123)).toBe(123);
      expect(toSnakeCase(true)).toBe(true);
    });
  });

  describe('toCamelCase', () => {
    it('should convert object keys to camelCase', () => {
      const input = {
        queue_name: 'my-queue',
        max_retries: 3,
      };

      const output = toCamelCase(input);
      expect(output).toEqual({
        queueName: 'my-queue',
        maxRetries: 3,
      });
    });

    it('should handle nested objects', () => {
      const input = {
        outer_key: {
          inner_key: 'value',
        },
      };

      const output = toCamelCase(input);
      expect(output).toEqual({
        outerKey: {
          innerKey: 'value',
        },
      });
    });

    it('should handle arrays', () => {
      const input = {
        job_list: [{ job_id: '1' }, { job_id: '2' }],
      };

      const output = toCamelCase(input);
      expect(output).toEqual({
        jobList: [{ jobId: '1' }, { jobId: '2' }],
      });
    });

    it('should NOT convert values under skip keys', () => {
      const input = {
        queue_name: 'my-queue',
        result: {
          custom_data: 'value',
          nested_object: { another_key: 'value' },
        },
      };

      const output = toCamelCase(input);
      expect(output).toEqual({
        queueName: 'my-queue',
        result: {
          custom_data: 'value',
          nested_object: { another_key: 'value' },
        },
      });
    });

    it('should preserve tags values', () => {
      const input = {
        job_id: '123',
        tags: {
          tag_key: 'tag_value',
          another_tag: 'another_value',
        },
      };

      const output = toCamelCase(input);
      expect(output).toEqual({
        jobId: '123',
        tags: {
          tag_key: 'tag_value',
          another_tag: 'another_value',
        },
      });
    });
  });

  describe('convertRequest', () => {
    it('should be an alias for toSnakeCase', () => {
      const input = { queueName: 'test' };
      expect(convertRequest(input)).toEqual(toSnakeCase(input));
    });
  });

  describe('convertResponse', () => {
    it('should be an alias for toCamelCase', () => {
      const input = { queue_name: 'test' };
      expect(convertResponse(input)).toEqual(toCamelCase(input));
    });
  });

  describe('convertQueryParams', () => {
    it('should convert keys to snake_case and values to strings', () => {
      const input = {
        queueName: 'my-queue',
        limit: 10,
        includeMetadata: true,
      };

      const output = convertQueryParams(input);
      expect(output).toEqual({
        queue_name: 'my-queue',
        limit: '10',
        include_metadata: 'true',
      });
    });

    it('should filter out undefined values', () => {
      const input = {
        queueName: 'my-queue',
        status: undefined,
      };

      const output = convertQueryParams(input);
      expect(output).toEqual({
        queue_name: 'my-queue',
      });
      expect('status' in output).toBe(false);
    });
  });
});
