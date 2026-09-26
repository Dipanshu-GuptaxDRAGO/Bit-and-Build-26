import { useState } from "react";
import "./App.css";

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [showDispatch, setShowDispatch] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [showCreateIncident, setShowCreateIncident] = useState(false);

  const [incidentType, setIncidentType] = useState("");
  const [incidentLocation, setIncidentLocation] = useState("");
  const [incidentPriority, setIncidentPriority] = useState("Medium");
  const [incidentDescription, setIncidentDescription] = useState("");

  const [incidents, setIncidents] = useState([
    {
      id: "INC-1042",
      type: "Suspicious Activity",
      location: "Sector 12",
      priority: "High",
      status: "Awaiting",
      time: "14:32",
    },
    {
      id: "INC-1041",
      type: "Unauthorized Entry",
      location: "Sector 8",
      priority: "Medium",
      status: "Responding",
      time: "14:25",
    },
    {
      id: "INC-1040",
      type: "Patrol Request",
      location: "Sector 4",
      priority: "Low",
      status: "Resolved",
      time: "14:10",
    },
  ]);

  const [responders, setResponders] = useState([
    {
      id: "TEAM-04",
      name: "Security Team 04",
      location: "Sector 10",
      distance: "1.2 km",
      eta: "4 min",
      status: "Available",
    },
    {
      id: "TEAM-07",
      name: "Security Team 07",
      location: "Sector 9",
      distance: "2.4 km",
      eta: "8 min",
      status: "Available",
    },
    {
      id: "TEAM-02",
      name: "Security Team 02",
      location: "Sector 12",
      distance: "0.8 km",
      eta: "2 min",
      status: "Responding",
    },
  ]);

  return (
    <div className="app">

      <aside className="sidebar">

        <div className="logo">
          <div className="logo-icon">⚡</div>

          <div>
            <h2>WEB-SHOOTER</h2>
            <span>DISPATCH</span>
          </div>
        </div>

        <nav>
          <button
            className={activePage === "Dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => setActivePage("Dashboard")}
          >
            <span>▦</span>
            Dashboard
          </button>

          <button
            className={activePage === "Incidents" ? "nav-item active" : "nav-item"}
            onClick={() => setActivePage("Incidents")}
          >
            <span>🚨</span>
            Incidents
          </button>

          <button
            className={activePage === "Responders" ? "nav-item active" : "nav-item"}
            onClick={() => setActivePage("Responders")}
          >
            <span>👮</span>
            Responders
          </button>

          <button
            className={activePage === "Dispatch" ? "nav-item active" : "nav-item"}
            onClick={() => setActivePage("Dispatch")}
          >
            <span>📡</span>
            Dispatch
          </button>

          <button
            className={activePage === "History" ? "nav-item active" : "nav-item"}
            onClick={() => setActivePage("History")}
          >
            <span>◷</span>
            History
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="system-status">
            <div className="status-dot"></div>

            <div>
              <strong>System Online</strong>
              <small>All services operational</small>
            </div>
          </div>
        </div>

      </aside>

      <main className="main">

        <header className="header">

          <div>
            <p className="breadcrumb">SECURITY OPERATIONS</p>
            <h1>{activePage}</h1>
          </div>

          <div className="header-right">

            <button className="notification">
              🔔
            </button>

            <div className="user">

              <div className="avatar">
                R
              </div>

              <div>
                <strong>Admin User</strong>
                <small>Dispatcher</small>
              </div>

            </div>

          </div>

        </header>

        {activePage === "Dashboard" && (

          <div className="content">

            <section className="stats">

              <div className="stat-card">
                <div className="stat-icon red">🚨</div>

                <div>
                  <span>Active Incidents</span>
                  <strong>12</strong>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon green">👮</div>

                <div>
                  <span>Available Responders</span>
                  <strong>28</strong>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon blue">📡</div>

                <div>
                  <span>Responding</span>
                  <strong>7</strong>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon orange">⚠️</div>

                <div>
                  <span>Unresolved</span>
                  <strong>3</strong>
                </div>
              </div>

            </section>

            <section className="dashboard-grid">

              <div className="panel incidents-panel">

                <div className="panel-header">

                  <div>
                    <h2>Active Incidents</h2>
                    <p>Live security incidents requiring attention</p>
                  </div>

                  <button className="view-button">
                    View All →
                  </button>

                </div>

                <div className="incident-list">

                  {incidents.map((incident) => (
                    <div className="table-row" key={incident.id}>

                      <div>{incident.id}</div>

                      <div>{incident.type}</div>

                      <div>{incident.location}</div>

                      <div>
                        <span className={`priority ${incident.priority.toLowerCase()}`}>
                          {incident.priority}
                        </span>
                      </div>

                      <div>
                        <span className={`status ${incident.status.toLowerCase()}`}>
                          {incident.status}
                        </span>
                      </div>

                      <div>{incident.time}</div>

                      <div>
                        <button
                          className="dispatch-small-button"
                          onClick={() => {
                            setSelectedIncident(incident);
                            setShowDispatch(true);
                          }}
                        >
                          Dispatch
                        </button>
                      </div>

                    </div>
                  ))}

                </div>

              </div>

              <div className="panel map-panel">

                <div className="panel-header">

                  <div>
                    <h2>Live Operations Map</h2>
                    <p>Real-time responder locations</p>
                  </div>

                  <span className="live">
                    ● LIVE
                  </span>

                </div>

                <div className="map">

                  <div className="road road-1"></div>
                  <div className="road road-2"></div>
                  <div className="road road-3"></div>
                  <div className="road road-4"></div>

                  <div className="map-marker marker-1">
                    🚨
                  </div>

                  <div className="map-marker marker-2">
                    👮
                  </div>

                  <div className="map-marker marker-3">
                    👮
                  </div>

                  <div className="map-marker marker-4">
                    🚨
                  </div>

                </div>

              </div>

            </section>

            <section className="panel responders-panel">

              <div className="panel-header">

                <div>
                  <h2>Available Responders</h2>
                  <p>Closest teams ready for dispatch</p>
                </div>

                <button
                  className="dispatch-small-button"
                  onClick={() => {
                    setSelectedIncident(incident);
                    setShowDispatch(true);
                  }}
                >
                  Dispatch
                </button>

              </div>

              <div className="responder-grid">

                {responders.map((responder) => (

                  <div className="responder-card" key={responder.id}>

                    <div className="responder-top">

                      <div className="responder-avatar">
                        👮
                      </div>

                      <span className={`availability ${responder.status.toLowerCase()}`}>
                        ● {responder.status}
                      </span>

                    </div>

                    <h3>
                      {responder.name}
                    </h3>

                    <p>
                      {responder.id}
                    </p>

                    <div className="responder-details">

                      <span>
                        📍 {responder.location}
                      </span>

                      <span>
                        📏 {responder.distance}
                      </span>

                      <span>
                        ⏱ ETA {responder.eta}
                      </span>

                    </div>

                    <button
                      className="dispatch-button"
                      onClick={() => setShowDispatch(true)}
                    >
                      Dispatch
                    </button>

                  </div>

                ))}

              </div>

            </section>

          </div>

        )}

        {activePage === "Incidents" && (

          <div className="page-content">

            <div className="page-heading">

              <div>
                <p className="breadcrumb">SECURITY OPERATIONS</p>
                <h2>Incident Management</h2>
                <p>Monitor and manage reported security incidents.</p>
              </div>

              <button
                className="create-button"
                onClick={() => setShowCreateIncident(true)}
              >
                + Create Incident
              </button>

            </div>


            <div className="incident-filters">

              <button className="filter active">
                All
              </button>

              <button className="filter">
                High Priority
              </button>

              <button className="filter">
                Awaiting
              </button>

              <button className="filter">
                Responding
              </button>

              <button className="filter">
                Resolved
              </button>

            </div>


            <div className="incident-table">

              <div className="table-header">

                <span>INCIDENT</span>
                <span>LOCATION</span>
                <span>PRIORITY</span>
                <span>STATUS</span>
                <span>TIME</span>

              </div>


              {incidents.map((incident) => (

                <div className="table-row" key={incident.id}>

                  <div>

                    <strong>
                      {incident.type}
                    </strong>

                    <small>
                      {incident.id}
                    </small>

                  </div>


                  <span>
                    📍 {incident.location}
                  </span>


                  <span className={`priority ${incident.priority.toLowerCase()}`}>
                    {incident.priority}
                  </span>


                  <span className={`status ${incident.status.toLowerCase()}`}>
                    {incident.status}
                  </span>


                  <span>
                    {incident.time}
                  </span>

                </div>

              ))}

            </div>

          </div>

        )}

      </main>

      {showDispatch && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              className="close-button"
              onClick={() => {
                setShowDispatch(false);
                setSelectedIncident(null);
              }}
            >
              ×
            </button>

            <div className="modal-icon">📡</div>

            <h2>Dispatch Responder</h2>

            {selectedIncident ? (
              <>
                <p>
                  Dispatch a responder to <strong>{selectedIncident.type}</strong>
                  <br />
                  <small>
                    {selectedIncident.id} • {selectedIncident.location} • {selectedIncident.priority} Priority
                  </small>
                </p>

                <div className="modal-teams">
                  {responders
                    .filter((responder) => responder.status === "Available")
                    .map((responder) => (
                      <button
                        className="team-option"
                        key={responder.id}
                        onClick={() => {
                          setIncidents((currentIncidents) =>
                            currentIncidents.map((incident) =>
                              incident.id === selectedIncident.id
                                ? { ...incident, status: "Responding" }
                                : incident
                            )
                          );

                          setResponders((currentResponders) =>
                            currentResponders.map((team) =>
                              team.id === responder.id
                                ? { ...team, status: "Responding" }
                                : team
                            )
                          );

                          setShowDispatch(false);
                          setSelectedIncident(null);
                        }}
                      >
                        <div>
                          <strong>{responder.name}</strong>
                          <small>
                            {responder.distance} away • ETA {responder.eta}
                          </small>
                        </div>
                        <span>→</span>
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <p>Please select an incident before dispatching a responder.</p>
            )}
          </div>
        </div>
      )}

      {showCreateIncident && (

        <div className="modal-overlay">

          <div className="modal create-modal">

            <button
              className="close-button"
              onClick={() => setShowCreateIncident(false)}
            >
              ×
            </button>

            <div className="modal-icon">
              🚨
            </div>

            <h2>
              Create New Incident
            </h2>

            <p>
              Enter the details of the reported security incident.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();

                const newIncident = {
                  id: `INC-${1043 + incidents.length - 3}`,
                  type: incidentType,
                  location: incidentLocation,
                  priority: incidentPriority,
                  status: "Awaiting",
                  time: new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })
                };

                setIncidents([newIncident, ...incidents]);

                setIncidentType("");
                setIncidentLocation("");
                setIncidentPriority("Medium");
                setIncidentDescription("");

                setShowCreateIncident(false);
              }}
            >

              <label>
                Incident Type
              </label>

              <input
                type="text"
                placeholder="e.g. Suspicious Activity"
                value={incidentType}
                onChange={(event) => setIncidentType(event.target.value)}
                required
              />

              <label>
                Location
              </label>

              <input
                type="text"
                placeholder="e.g. Sector 12"
                value={incidentLocation}
                onChange={(event) => setIncidentLocation(event.target.value)}
                required
              />

              <label>
                Priority
              </label>

              <select
                value={incidentPriority}
                onChange={(event) => setIncidentPriority(event.target.value)}
              >

                <option value="Low">
                  Low
                </option>

                <option value="Medium">
                  Medium
                </option>

                <option value="High">
                  High
                </option>

              </select>

              <label>
                Description
              </label>

              <textarea
                placeholder="Describe what happened..."
                rows="4"
                value={incidentDescription}
                onChange={(event) => setIncidentDescription(event.target.value)}
              ></textarea>

              <div className="form-buttons">

                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => setShowCreateIncident(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="submit-button"
                >
                  Create Incident
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>
  );

}

export default App;