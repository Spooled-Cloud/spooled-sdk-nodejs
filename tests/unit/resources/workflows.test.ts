/**
 * Workflows Resource tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SpooledClient } from '../../../src/client.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('WorkflowsResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('create', () => {
    it('should create a workflow', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/workflows', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            workflow_id: 'workflow_123',
            job_ids: [
              { key: 'extract', job_id: 'job_1' },
              { key: 'transform', job_id: 'job_2' },
              { key: 'load', job_id: 'job_3' },
            ],
          });
        })
      );

      const client = createClient();
      const result = await client.workflows.create({
        name: 'ETL Pipeline',
        jobs: [
          { key: 'extract', queueName: 'etl', payload: { step: 'extract' } },
          { key: 'transform', queueName: 'etl', payload: { step: 'transform' }, dependsOn: ['extract'] },
          { key: 'load', queueName: 'etl', payload: { step: 'load' }, dependsOn: ['transform'] },
        ],
      });

      expect(receivedBody.name).toBe('ETL Pipeline');
      expect(receivedBody.jobs).toHaveLength(3);
      expect(result.workflowId).toBe('workflow_123');
      expect(result.jobIds).toHaveLength(3);
    });
  });

  describe('list', () => {
    it('should list workflows', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/workflows', () => {
          return HttpResponse.json([
            {
              id: 'workflow_1',
              name: 'Workflow 1',
              status: 'running',
              total_jobs: 5,
              completed_jobs: 3,
              failed_jobs: 0,
              progress_percent: 60,
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 'workflow_2',
              name: 'Workflow 2',
              status: 'completed',
              total_jobs: 3,
              completed_jobs: 3,
              failed_jobs: 0,
              progress_percent: 100,
              created_at: '2024-01-01T00:00:00Z',
              completed_at: '2024-01-01T01:00:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const workflows = await client.workflows.list();

      expect(workflows).toHaveLength(2);
      expect(workflows[0].status).toBe('running');
      expect(workflows[0].progressPercent).toBe(60);
      expect(workflows[1].status).toBe('completed');
    });
  });

  describe('get', () => {
    it('should get a workflow', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/workflows/workflow_123', () => {
          return HttpResponse.json({
            id: 'workflow_123',
            name: 'My Workflow',
            status: 'running',
            total_jobs: 5,
            completed_jobs: 2,
            failed_jobs: 1,
            progress_percent: 40,
            created_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const workflow = await client.workflows.get('workflow_123');

      expect(workflow.id).toBe('workflow_123');
      expect(workflow.totalJobs).toBe(5);
      expect(workflow.failedJobs).toBe(1);
    });
  });

  describe('cancel', () => {
    it('should cancel a workflow', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/workflows/workflow_123/cancel', () => {
          return HttpResponse.json({
            id: 'workflow_123',
            name: 'My Workflow',
            status: 'cancelled',
            total_jobs: 5,
            completed_jobs: 2,
            failed_jobs: 0,
            progress_percent: 40,
            created_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const workflow = await client.workflows.cancel('workflow_123');

      expect(workflow.status).toBe('cancelled');
    });
  });

  describe('job dependencies', () => {
    it('should get job dependencies', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/job_123/dependencies', () => {
          return HttpResponse.json({
            job_id: 'job_123',
            status: 'pending',
            dependencies: [
              { job_id: 'job_122', status: 'completed', dependency_type: 'completion' },
            ],
            dependents: [
              { job_id: 'job_124', status: 'pending', dependency_type: 'completion' },
            ],
          });
        })
      );

      const client = createClient();
      const deps = await client.workflows.jobs.getDependencies('job_123');

      expect(deps.jobId).toBe('job_123');
      expect(deps.dependencies).toHaveLength(1);
      expect(deps.dependencies[0].status).toBe('completed');
      expect(deps.dependents).toHaveLength(1);
    });

    it('should add job dependencies', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/job_123/dependencies', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            added: 2,
            dependencies: [
              { job_id: 'job_123', depends_on_job_id: 'job_121', dependency_type: 'completion' },
              { job_id: 'job_123', depends_on_job_id: 'job_122', dependency_type: 'completion' },
            ],
          });
        })
      );

      const client = createClient();
      const result = await client.workflows.jobs.addDependencies('job_123', {
        dependsOnJobIds: ['job_121', 'job_122'],
      });

      expect(receivedBody.depends_on_job_ids).toEqual(['job_121', 'job_122']);
      expect(result.added).toBe(2);
      expect(result.dependencies).toHaveLength(2);
    });
  });
});
