import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/services/api.js';
const req = (path, body) => request(path, body, { mode: 'mock' });
const api = {
 getIncidents: status => req('/incidents' + (status ? '?status=' + status : '')),
 getResponders: status => req('/responders' + (status ? '?status=' + status : '')),
 getDispatchLogs: () => req('/dispatch/logs'),
 createIncident: body => req('/incidents', body),
 matchIncident: incident_id => req('/dispatch/match', { incident_id }),
 confirmDispatch: (incident_id, assignment_id) => req('/dispatch/confirm', { incident_id, assignment_id }),
 resolveIncident: incident_id => req('/dispatch/resolve', { incident_id }),
};

test('mock contract and full dispatch lifecycle', async () => {
  const incidents = await api.getIncidents();
  assert.deepEqual(Object.keys(incidents[0]).sort(), ['id','type','severity','lat','lon','status','reported_at','assigned_responder_id'].sort());
  const responders = await api.getResponders();
  assert.deepEqual(Object.keys(responders[0]).sort(), ['id','name','type','lat','lon','status','last_updated_at','current_incident_id'].sort());
  const incident = await api.createIncident({type:'medical',severity:4,lat:12.97,lon:77.59});
  assert.equal(incident.status,'pending');
  const assigned = await api.matchIncident(incident.id);
  assert.equal(assigned.status,'assigned');
  assert.ok(assigned.assigned_responder_id);
  assert.equal((await api.getResponders()).find(r=>r.id===assigned.assigned_responder_id).current_incident_id,incident.id);
  await assert.rejects(api.matchIncident(incident.id), /already assigned/);
  await api.confirmDispatch(incident.id, assigned.assignment_id);
  assert.equal((await api.getResponders()).find(r=>r.id===assigned.assigned_responder_id).status,'en_route');
  await api.resolveIncident(incident.id);
  assert.equal((await api.getIncidents('resolved')).find(i=>i.id===incident.id).status,'resolved');
  const released=(await api.getResponders()).find(r=>r.id===assigned.assigned_responder_id);
  assert.equal(released.status,'available');assert.equal(released.current_incident_id,null);
  const logs=(await api.getDispatchLogs()).filter(l=>l.incident_id===incident.id);
  assert.deepEqual(logs.map(l=>l.action),['assigned','resolved']);
  assert.deepEqual(Object.keys(logs[0]).sort(),['id','incident_id','responder_id','action','timestamp'].sort());
});

test('capacity exhaustion returns an actionable error', async()=>{
 const available=await api.getResponders('available');
 for(let i=0;i<available.length;i++){
   const incident=await api.createIncident({type:'other',severity:1,lat:12.97,lon:77.59});
   await api.matchIncident(incident.id);
 }
 const extra=await api.createIncident({type:'fire',severity:5,lat:12.97,lon:77.59});
 await assert.rejects(api.matchIncident(extra.id),/No responder available/);
 assert.equal((await api.getIncidents('pending')).find(i=>i.id===extra.id).assigned_responder_id,null);
});

test('live API rejects HTTP 200 business failures and malformed match responses', async () => {
 for (const data of [{ok:false,message:'no responder available'}, {ok:false,reason:'stale_assignment'}, {success:false,error:'failed'}]) {
  await assert.rejects(request('/dispatch/match', {incident_id:'test'}, {mode:'live',fetcher:async()=>new Response(JSON.stringify(data),{status:200})}));
 }
 await assert.rejects(request('/dispatch/match', {incident_id:'test'}, {mode:'live',fetcher:async()=>new Response('not json',{status:200})}));
 await assert.rejects(request('/incidents', undefined, {mode:'live',fetcher:async()=>{throw new Error('Network offline')}}), /Network offline/);
});
