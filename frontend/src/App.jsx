import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Radio, Map as MapIcon, Flame, Users, Crosshair, Plus, X, Clock, Check, AlertTriangle, Shield, HeartPulse, Bell, LocateFixed } from 'lucide-react';
import OperationsMap from './components/OperationsMap';
import * as api from './services/api';
import './App.css';
const typeIcons = { fire: Flame, medical: HeartPulse, security: Shield, other: AlertTriangle };
const time = value => new Date(value).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' });
function Count({ value }) {
  const [shown, setShown] = useState(value); const previous = useRef(value);
  useEffect(() => { const start = performance.now(), from = previous.current; let frame; const tick = now => { const progress = Math.min((now-start)/240,1); setShown(Math.round(from+(value-from)*progress)); if(progress<1) frame=requestAnimationFrame(tick); }; frame=requestAnimationFrame(tick); previous.current=value; return ()=>cancelAnimationFrame(frame); }, [value]);
  return <>{shown}</>;
}
export default function App() {
  const [data,setData]=useState({incidents:[],responders:[],logs:[]});
  const [now,setNow]=useState(()=>Date.now()); const [lastSync,setLastSync]=useState(null); const [error,setError]=useState('');
  const [busy,setBusy]=useState({}); const [errors,setErrors]=useState({}); const [toast,setToast]=useState(null);
  const [view,setView]=useState('Operations'); const [filter,setFilter]=useState('all'); const [target,setTarget]=useState(null);
  const [report,setReport]=useState(false); const [location,setLocation]=useState(null); const [creating,setCreating]=useState(false); const [formError,setFormError]=useState('');
  const [incidentType,setIncidentType]=useState('fire'); const [severity,setSeverity]=useState(3);
  const [timings,setTimings]=useState({seen:new Map(),resolved:new Map()}); const [loaded,setLoaded]=useState(false);
  const seen=useRef(new Map()); const resolved=useRef(new Map()); const initialized=useRef(false); const inflight=useRef(null); const mounted=useRef(false); const actionLocks=useRef(new Set());
  const notify=useCallback((message,kind='success')=>setToast({message,kind,id:Date.now()}),[]);
  const refresh=useCallback(()=>{
    if(inflight.current) return inflight.current;
    const task=(async()=>{
      try {
        const [incidents,responders,logs]=await Promise.all([api.getIncidents(),api.getResponders(),api.getDispatchLogs()]);
        if(!mounted.current) return;
        const added=incidents.filter(i=>!seen.current.has(i.id));
        for(const i of incidents){if(!seen.current.has(i.id)) seen.current.set(i.id,Date.now()); if(i.status==='resolved'&&!resolved.current.has(i.id)) resolved.current.set(i.id,Date.now());}
        if(initialized.current && added.length) notify(added.length===1 ? `New ${added[0].type} incident reported: ${added[0].id}` : `${added.length} new incidents reported`, 'incident');
        initialized.current=true; setLoaded(true); setTimings({seen:new Map(seen.current),resolved:new Map(resolved.current)}); setData({incidents,responders,logs}); setLastSync(Date.now()); setError('');
      }catch(e){if(mounted.current)setError(e.message || 'Connection lost. Retrying automatically.');}
    })();
    inflight.current=task; task.finally(()=>{inflight.current=null;}); return task;
  },[notify]);
  useEffect(()=>{mounted.current=true; refresh(); const poll=setInterval(refresh,2500); const clock=setInterval(()=>setNow(Date.now()),1000);return()=>{mounted.current=false;clearInterval(poll);clearInterval(clock);};},[refresh]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),5000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{const escape=e=>{if(e.key==='Escape')setReport(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  async function action(i){
    const confirming = i.status === 'assigned' && !!i.confirmation_deadline;
    if(actionLocks.current.has(i.id))return;
    actionLocks.current.add(i.id);setBusy(b=>({...b,[i.id]:true}));setErrors(e=>({...e,[i.id]:''}));
    try{await (i.status==='pending'?api.matchIncident(i.id):confirming?api.confirmDispatch(i.id,i.assignment_id):api.resolveIncident(i.id)); if(inflight.current)await inflight.current;await refresh();notify(i.status==='pending'?`Dispatch accepted for ${i.id}`:confirming?`Assignment confirmed for ${i.id}`:`${i.id} marked resolved`);}
    catch(e){setErrors(old=>({...old,[i.id]:e.message}));notify(e.message,'error');}
    finally{actionLocks.current.delete(i.id);setBusy(b=>({...b,[i.id]:false}));}
  }
  async function submit(e){e.preventDefault();if(!location||creating)return;setCreating(true);setFormError('');try{await api.createIncident({type:incidentType,severity:Number(severity),lat:location[0],lon:location[1]});if(inflight.current)await inflight.current;await refresh();setReport(false);setLocation(null);notify('Incident reported. Awaiting dispatch.');}catch(e){setFormError(e.message);}finally{setCreating(false);}}
  const {incidents,responders,logs}=data;
  const active=incidents.filter(i=>i.status!=='resolved'); const pending=incidents.filter(i=>i.status==='pending'); const available=responders.filter(r=>r.status==='available');
  const durations=logs.filter(l=>l.action==='assigned').map(l=>{const i=incidents.find(i=>i.id===l.incident_id);return i?(new Date(l.timestamp)-new Date(i.reported_at))/1000:NaN;}).filter(n=>Number.isFinite(n)&&n>=0);
  const average=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null;
  const freshIds=new Set([...timings.seen].filter(([,t])=>now-t<5000).map(([id])=>id));
  const visible=incidents.filter(i=>(filter==='all'||i.status===filter)&&(i.status!=='resolved'||now-(timings.resolved.get(i.id)||0)<5000));
  const events=[...incidents.map(i=>({id:`new-${i.id}`,incident:i,action:'reported',timestamp:i.reported_at})),...logs.map(l=>({...l,id:`log-${l.id}`,incident:incidents.find(i=>i.id===l.incident_id),unit:responders.find(r=>r.id===l.responder_id)}))].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,100);
  const focus=i=>setTarget({position:[i.lat,i.lon]});
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><Activity size={25}/><span>WEB-SHOOTER <b>DISPATCH</b></span><span className="version mono">/ 01</span></div><div className="top-right"><span className={`connection ${error?'offline':''}`}><i/>{error?'Reconnecting':api.API_MODE==='mock'?'Simulation live':'Live feed'}</span><time className="mono">{time(now)} <small>IST</small></time><button className="icon-button" aria-label="Show activity feed" onClick={()=>setView('Operations')}><Bell size={18}/></button><div className="operator">OP</div></div></header>
    <div className="workspace"><nav className="rail" aria-label="Main navigation"><div className="rail-title">COMMAND</div>{[[MapIcon,'Operations'],[Flame,'Incidents'],[Users,'Responders']].map(([Icon,label])=><button key={label} className={view===label?'nav-item active':'nav-item'} onClick={()=>setView(label)} title={label}><Icon size={19}/><span>{label}</span>{label==='Incidents'&&<b>{pending.length}</b>}</button>)}<div className="rail-bottom"><Radio size={19}/><span>Bengaluru sector<small>12.9716 N<br/>77.5946 E</small></span><div className="mode-label">{api.API_MODE==='mock'?'Mock data service':'Backend connected'}</div></div></nav>
    <main className="main"><div className="page-heading"><div><div className="eyebrow"><span/> BENGALURU / CENTRAL COMMAND</div><h1>Live operations<span className="heading-slash">/</span><span className="heading-sub">City overview</span></h1></div><button className="primary report-button" onClick={()=>{setReport(!report);setFormError('');}}><Plus size={16}/> Report Incident</button></div>
      {error&&<div className="connection-error" role="alert"><AlertTriangle size={16}/> {error} Showing last received data; retrying every 2.5s.<button onClick={refresh}>Retry now</button></div>}
      <section className="map-section" aria-label="Live Bangalore dispatch map"><OperationsMap incidents={visible} responders={responders} freshIds={freshIds} onAction={action} busy={busy} errors={errors} target={target} picking={report} onPick={setLocation} location={report?location:null}/><div className="map-texture"/>
        <div className="map-toolbar"><div className="map-label"><Radio size={15}/><strong>Live field map</strong><span className="mono">BLR-01</span></div><div className="map-filters">{[['all','All incidents'],['pending','Pending'],['assigned','Assigned']].map(([value,label])=><button key={value} className={filter===value?'selected':''} onClick={()=>setFilter(value)}>{label}</button>)}</div></div>
        <button className="recenter icon-button" title="Recenter Bangalore" aria-label="Recenter Bangalore" onClick={()=>setTarget({position:[12.9716,77.5946],zoom:13})}><LocateFixed size={19}/></button>
        <div className="map-bottom"><div className="legend"><span><i className="diamond red"/>Pending</span><span><i className="diamond orange"/>Assigned</span><span><i className="dot blue"/>Available</span><span><i className="dot purple"/>Engaged</span><span><i className="dot gray"/>Busy</span><span><i className="diamond green"/>Resolved</span></div><span className="map-coords mono">12.9716° N / 77.5946° E</span></div>
        {report&&<form className="report-panel" onSubmit={submit}><div className="section-heading"><h2>Report incident</h2><button type="button" className="icon-button" aria-label="Close report form" onClick={()=>setReport(false)}><X size={18}/></button></div><p>Click the map to set the incident location.</p><label htmlFor="incident-type">Incident type</label><select id="incident-type" value={incidentType} onChange={e=>setIncidentType(e.target.value)}>{['fire','medical','security','other'].map(t=><option key={t}>{t}</option>)}</select><label htmlFor="severity">Severity <b className="mono">{severity} / 5</b></label><input id="severity" type="range" min="1" max="5" value={severity} onChange={e=>setSeverity(e.target.value)}/><div className="picked-location mono"><Crosshair size={16}/>{location?`${location[0].toFixed(5)}, ${location[1].toFixed(5)}`:'Choose a point on the map'}</div>{formError&&<p className="error-text" role="alert">{formError}</p>}<button className="primary full" disabled={!location||creating}>{creating?'Reporting…':'Report Incident'}</button></form>}
      </section>
      <section className="stats" aria-label="Dispatch statistics">{[[AlertTriangle,'Active Incidents',active.length,'critical',`${pending.length} awaiting dispatch`],[Users,'Available Responders',available.length,'info',`${responders.length} units in field`],[Clock,'Avg Response Time',average,'clear','Report to first assignment'],[Radio,'Assigned Incidents',incidents.filter(i=>i.status==='assigned').length,'progress','Units mobilized']].map(([Icon,label,value,color,note])=><div className={`stat ${color}`} key={label}><div className="stat-title">{label}<Icon size={16}/></div><div className="stat-value mono">{value===null?'—':<Count value={value}/>} {label==='Avg Response Time'&&<small>s</small>}</div><small>{note}</small></div>)}</section>
      <footer className="footer"><span><i className={error?'red':'green'}/>{lastSync?`Last sync ${time(lastSync)}`:'Connecting to data service…'}</span><span className="mono">Poll interval 2.5s <span className="footer-divider">/</span> {api.API_MODE==='mock'?'Demo environment':'Live environment'}</span></footer>
    </main>
    <aside className="feed-panel"><div className="section-heading"><div><h2>{view==='Operations'?'Activity feed':view}</h2><p>{view==='Operations'?'Dispatch timeline':view==='Incidents'?'Active incident queue':'Field unit roster'}</p></div><span className="feed-count mono">{view==='Operations'?events.length:view==='Incidents'?active.length:responders.length}</span></div>
      <div className="feed-summary"><span className="signal-dot"/>{pending.length?`${pending.length} incidents need attention`:'All incidents attended'}</div>
      <div className="feed-scroll">{!loaded&&!error&&<div className="empty">Connecting to dispatch service…</div>}
      {view==='Operations'&&events.map(e=>{const Icon=e.action==='resolved'?Check:e.action==='reported'?(typeIcons[e.incident?.type]||AlertTriangle):Radio;return <article className={`feed-entry ${e.action}`} key={e.id}><div className="event-icon"><Icon size={16}/></div><div><div className="event-meta"><span>{e.action==='reported'?'Incident reported':e.action==='assigned'?'Unit dispatched':e.action==='resolved'?'Incident resolved':e.action==='timeout'?'Dispatch timed out':'Unit reassigned'}</span><time className="mono">{time(e.timestamp)}</time></div><p>{e.action==='reported'?`New ${e.incident?.type} incident reported`:e.action==='resolved'?`Incident ${e.incident_id} resolved`:e.action==='timeout'?`Response window expired for ${e.responder_id}`:`${e.unit?.name||e.responder_id||'Responder'} ${e.action} to ${e.incident_id}`}</p><button className="event-link mono" onClick={()=>e.incident&&focus(e.incident)} disabled={!e.incident}><Crosshair size={11}/>{e.incident?.id||e.incident_id}</button>{e.incident?.severity>=4&&<span className="priority-label">High priority</span>}</div></article>;})}
      {view==='Incidents'&&(active.length?active.map(i=>{const Icon=typeIcons[i.type];return <article className="queue-card" key={i.id}><div className="queue-top"><Icon size={19}/><button className="text-button mono" onClick={()=>focus(i)}>{i.id}</button><span className={`badge ${i.status}`}>{i.status}</span></div><h3>{i.type} incident <span className="mono">S{i.severity}</span></h3><p className="mono">{i.lat.toFixed(4)}, {i.lon.toFixed(4)}</p><button className="secondary full" disabled={busy[i.id]} onClick={()=>action(i)}>{busy[i.id]?'Processing…':i.status==='pending'?'Dispatch Best Unit':i.confirmation_deadline?'Confirm Assignment':'Mark Resolved'}</button>{errors[i.id]&&<p className="error-text">{errors[i.id]}</p>}</article>}):<div className="empty">No active incidents. Systems nominal.</div>)}
      {view==='Responders'&&responders.map(r=><button className="roster-row" key={r.id} onClick={()=>focus(r)}><span className={`unit-dot ${r.status}`}/><div><strong>{r.name}</strong><small className="mono">{r.id} / {r.type}</small></div><span>{r.status.replace('_',' ')}</span></button>)}
      {view==='Operations'&&loaded&&!events.length&&<div className="empty">No active incidents. Systems nominal.</div>}</div>
      <div className="feed-footer"><Radio size={14}/><span>{api.API_MODE==='mock'?'Simulator generating field events':'Receiving dispatch events'}</span><span className="connection-dot"/></div>
    </aside></div>
    {toast&&<div className={`toast ${toast.kind}`} role="status"><span>{toast.kind==='error'?<AlertTriangle size={18}/>:toast.kind==='incident'?<Radio size={18}/>:<Check size={18}/>}</span>{toast.message}<button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={16}/></button></div>}
  </div>;
}


