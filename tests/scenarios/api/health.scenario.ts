import { APIScenario } from '../../types';

export const healthScenario: APIScenario = {
  name: 'API Health Check',
  agent: 'api',
  tags: ['api', 'health', 'quick'],
  // No setup/teardown - runs in HTTP-only mode

  steps: [
    {
      name: 'List books endpoint responds',
      method: 'GET',
      path: '/api/books',
      expect: {
        status: 200,
        body: (data: any) => {
          if (!Array.isArray(data)) throw new Error('Expected array');
          return true;
        }
      }
    },
    {
      name: 'Get prompts endpoint responds',
      method: 'GET',
      path: '/api/prompts',
      expect: {
        status: 200,
        body: (data: any) => {
          if (!Array.isArray(data)) throw new Error('Expected array');
          return true;
        }
      }
    },
    {
      name: 'Catalog endpoint responds',
      method: 'GET',
      path: '/api/catalog',
      expect: {
        status: 200,
        body: (data: any) => {
          if (!data.catalog) throw new Error('Expected catalog property');
          return true;
        }
      }
    }
  ]
};
