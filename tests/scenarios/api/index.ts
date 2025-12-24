// Export all API scenarios
export { booksCrudScenario } from './books-crud.scenario';
export { pagesCrudScenario } from './pages-crud.scenario';
export { processAIScenario } from './process-ai.scenario';

import { APIScenario } from '../../types';
import { booksCrudScenario } from './books-crud.scenario';
import { pagesCrudScenario } from './pages-crud.scenario';
import { processAIScenario } from './process-ai.scenario';

export const allAPIScenarios: APIScenario[] = [
  booksCrudScenario,
  pagesCrudScenario,
  processAIScenario
];
