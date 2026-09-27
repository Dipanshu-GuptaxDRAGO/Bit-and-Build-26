import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
const CENTER = [12.9716, 77.5946];
function Controls({ target, picking, onPick }) {
  const map = useMap();
  useEffect(() => { const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(map.getContainer()); return () => observer.disconnect(); }, [map]);
  useMapEvents({ click: e => { if (picking) onPick([e.latlng.lat, e.latlng.lng]); } });
  // Target changes only on an explicit user selection, never on polling.
  useEffect(() => { if (target) map.flyTo(target.position, target.zoom || 14, { duration: .6 }); }, [map, target]);
  return null;
}
function Contact({ item, incident, fresh, children }) {
  const icon = useMemo(() => L.divIcon({ className: 'contact-container', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20], html: `<div class="contact ${incident ? 'incident' : 'responder'} ${item.status} ${fresh ? 'fresh' : ''} ${incident && item.severity >= 4 ? 'high' : ''}"><span class="sonar"></span><svg viewBox="0 0 36 36" aria-hidden="true">${incident ? '<path class="shape" d="M18 5 31 18 18 31 5 18Z"/><path class="glyph" d="M18 11v9m0 4v1"/>' : '<circle class="shape" cx="18" cy="18" r="10"/><path class="notch" d="m18 3-5 9h10Z"/><circle class="core" cx="18" cy="18" r="3"/>'}</svg>${incident ? `<span class="marker-severity">${item.severity}</span>` : ''}</div>` }), [incident, item.status, item.severity, fresh]);
  return <Marker position={[item.lat, item.lon]} icon={icon} title={incident ? `${item.id}: ${item.type}, severity ${item.severity}, ${item.status}` : `${item.name}: ${item.status}`} alt={incident ? `${item.id} ${item.type} incident` : item.name}><Popup>{children}</Popup></Marker>;
}
export default function OperationsMap({ incidents, responders, freshIds, onAction, busy, errors, target, picking, onPick, location }) {
  return <MapContainer center={CENTER} zoom={13} zoomControl={true} className={picking ? 'picking' : ''}>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Controls target={target} picking={picking} onPick={onPick}/>
    {incidents.map(i => <Contact key={i.id} item={i} incident fresh={freshIds.has(i.id)}><div className="popup-heading"><strong>{i.type} incident</strong><span className={`badge ${i.status}`}>{i.status}</span></div><p className="mono">{i.id}</p><dl><dt>Severity</dt><dd>{i.severity} / 5</dd><dt>Coordinates</dt><dd>{i.lat.toFixed(5)}, {i.lon.toFixed(5)}</dd><dt>Reported</dt><dd>{new Date(i.reported_at).toLocaleString()}</dd><dt>Assigned unit</dt><dd>{i.assigned_responder_id || 'Awaiting dispatch'}</dd></dl>{i.status !== 'resolved' && <button className="primary full" disabled={!!busy[i.id]} onClick={() => onAction(i)}>{busy[i.id] ? 'Processing…' : i.status === 'pending' ? 'Dispatch Best Unit' : i.confirmation_deadline ? 'Confirm Assignment' : 'Mark Resolved'}</button>}{errors[i.id] && <p role="alert" className="error-text">{errors[i.id]}</p>}</Contact>)}
    {responders.map(r => <Contact key={r.id} item={r}><div className="popup-heading"><strong>{r.name}</strong><span className="badge">{r.status.replace('_', ' ')}</span></div><p className="mono">{r.id}</p><dl><dt>Type</dt><dd>{r.type}</dd><dt>Coordinates</dt><dd>{r.lat.toFixed(5)}, {r.lon.toFixed(5)}</dd><dt>Updated</dt><dd>{new Date(r.last_updated_at).toLocaleString()}</dd><dt>Incident</dt><dd>{r.current_incident_id || 'None'}</dd></dl></Contact>)}
    {location && <Marker position={location} icon={L.divIcon({className:'location-pin',html:'<span></span>',iconSize:[20,20]})}/>}
  </MapContainer>;
}



