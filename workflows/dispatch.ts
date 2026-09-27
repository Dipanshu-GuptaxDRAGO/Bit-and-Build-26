import { sleep } from 'workflow';

export async function monitorDispatch(incidentId: string) {
  'use workflow';
  // Covers requests cold-starting/enqueuing before their assignment commits.
  await sleep('1s');
  let idle = 0;
  while (true) {
    try {
      const state = await reconcile(incidentId);
      if (state.done) return;
      if (state.idle) { if (++idle >= 30) return; } else idle = 0;
      await sleep(state.delay);
    } catch {
      // Retry after the SDK's step retries are exhausted as well. No process
      // timer or running server is required while this workflow sleeps.
      await sleep('5s');
    }
  }
}

async function reconcile(incidentId: string) {
  'use step';
  process.env.DISPATCH_RUNTIME = 'workflow';
  const { default: dispatch } = await import('../database/database/src/services/dispatch.js');
  const { default: Incident } = await import('../database/database/src/models/incident.js');
  await dispatch.processQueuedDispatches();
  let incident = await Incident.findById(incidentId);
  if (!incident || incident.status === 'resolved') return { done: true, idle: false, delay: 1000 };
  if (incident.status === 'assigned' && incident.confirmation_deadline) {
    await dispatch.handleTimeout(incidentId, incident.assignment_id);
  } else if (incident.status === 'pending' && incident.dispatch_retry_at) {
    await dispatch.dispatchMatch(incidentId, { recovery: true });
  }
  incident = await Incident.findById(incidentId);
  if (incident.status === 'resolved' || (incident.status === 'assigned' && !incident.confirmation_deadline)) return { done: true, idle: false, delay: 1000 };
  const delay = incident.confirmation_deadline ? Math.max(100, new Date(incident.confirmation_deadline).getTime() - Date.now()) : 1000;
  return { done: false, idle: incident.status === 'pending' && !incident.dispatch_retry_at, delay };
}
