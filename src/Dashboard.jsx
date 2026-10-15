import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabase";
import { fetchSystemMetrics, extractContact } from "./utils/studentMetrics";

const currentDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
}).format(new Date());

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
}

function Dashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [dataWarning, setDataWarning] = useState(false);

  // Metrics
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalTrainers, setTotalTrainers] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [totalCapacity, setTotalCapacity] = useState(0);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);

  // Recent Students
  const [recentStudents, setRecentStudents] = useState([]);
  const [searchStudent, setSearchStudent] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Live Batches Snapshot

  const loadDashboardData = useCallback(async () => {
    try {
      const {
        students: allStudents,
        trainers: allTrainers,
        batches: allBatches,
        metrics,
      } = await fetchSystemMetrics();

      const batchesMap = new Map(allBatches.map((b) => [String(b.id), b.batch_name]));

      // Enrich recent students (most recent 8 registered students)
      const enrichedStudents = allStudents.slice(0, 8).map((s) => {
        const { email, phone } = extractContact(s);
        const roleName = Array.isArray(s.role)
          ? s.role[0]?.role_name || "—"
          : s?.role?.role_name || "—";
        const assignedBatchId = metrics.studentBatchMap.get(String(s.id));
        const batchName = assignedBatchId
          ? batchesMap.get(String(assignedBatchId)) || "Assigned Batch"
          : null;

        return {
          id: s.id,
          name: s.name || "Unnamed Student",
          email,
          phone,
          roleName,
          createdAt: s.created_at,
          batchName: batchName || null,
          isAssigned: Boolean(batchName),
        };
      });

      setTotalStudents(metrics.totalStudents);
      setTotalTrainers(metrics.totalTrainers);
      setTotalBatches(metrics.totalBatches);
      setTotalCapacity(metrics.totalCapacity);
      setEnrolledCount(metrics.enrolledStudents);
      setUnassignedCount(metrics.remainingStudents);
      setRecentStudents(enrichedStudents);
      setDataWarning(false);
    } catch (error) {
      console.error("Unable to load dashboard data:", error);
      setDataWarning(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Realtime updates subscription
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "students" }, () => loadDashboardData())
      .on("postgres_changes", { event: "*", schema: "public", table: "batch_students" }, () => loadDashboardData())
      .on("postgres_changes", { event: "*", schema: "public", table: "batches" }, () => loadDashboardData())
      .on("postgres_changes", { event: "*", schema: "public", table: "trainers" }, () => loadDashboardData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadDashboardData]);

  const filteredRecent = recentStudents.filter((s) => {
    if (!searchStudent.trim()) return true;
    const q = searchStudent.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      s.roleName.toLowerCase().includes(q)
    );
  });

  const capacityFillPercent =
    totalCapacity > 0 ? Math.min(100, Math.round((enrolledCount / totalCapacity) * 100)) : 0;

  return (
    <section className="dashboard-content">
      {/* Top Heading */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">COMMAND CENTER</p>
          <h1>Admin Dashboard</h1>
          <p className="dashboard-welcome">
            System overview, batch capacities, and real-time student registration metrics.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="dashboard-date">{currentDate}</span>
          <button
            className="secondary-action-button"
            onClick={loadDashboardData}
            style={{ padding: "6px 12px", minHeight: "36px", fontSize: "12px" }}
            title="Refresh dashboard data"
            type="button"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {dataWarning && (
        <p className="admin-alert" role="status">
          Some dashboard data could not be loaded. Check that the tables exist and are accessible.
        </p>
      )}

      {/* Interactive Clickable KPI Grid */}
      <div className="kpi-grid">
        <article
          className="kpi-card"
          onClick={() => navigate("/students")}
          role="button"
          style={{ cursor: "pointer" }}
          tabIndex={0}
          title="Click to view all students"
        >
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Total Students</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalStudents}</p>
            <span className="kpi-detail">Registered →</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => navigate("/batches")}
          role="button"
          style={{ cursor: "pointer" }}
          tabIndex={0}
          title="Click to view all batches"
        >
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M3 7h18M5 3h14v18H5zM8 11h8M8 15h5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Total Batches</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalBatches}</p>
            <span className="kpi-detail">Managed →</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => navigate("/batches")}
          role="button"
          style={{ cursor: "pointer" }}
          tabIndex={0}
          title="Click to view unassigned students"
        >
          <div className="kpi-icon kpi-icon-violet" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Remaining Students</p>
          <div className="kpi-value-row">
            <p className="kpi-value" style={{ color: unassignedCount > 0 ? "#4f46e5" : "#10b981" }}>
              {loading ? "…" : unassignedCount}
            </p>
            <span className="kpi-detail">{unassignedCount > 0 ? "Awaiting Batch →" : "All Assigned ✓"}</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => navigate("/trainers")}
          role="button"
          style={{ cursor: "pointer" }}
          tabIndex={0}
          title="Click to view trainers"
        >
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.79.84l-.04.08h-3.4l-.04-.08a1.7 1.7 0 0 0-1.79-.84l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.6 15l-.08-.04v-3.4l.08-.04a1.7 1.7 0 0 0 .34-1.88l-.06-.06 1.7-2.94.08.02a1.7 1.7 0 0 0 1.79-.84l.04-.08h3.4l.04.08a1.7 1.7 0 0 0 1.79.84l.08-.02 1.7 2.94-.06.06a1.7 1.7 0 0 0-.34 1.88l.08.04v3.4l-.08.04Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Active Trainers</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalTrainers}</p>
            <span className="kpi-detail">Instructors →</span>
          </div>
        </article>
      </div>

      {/* Quick Action Shortcuts Bar */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e8ecf3",
          borderRadius: "12px",
          padding: "16px 20px",
          marginBottom: "24px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          boxShadow: "0 2px 8px rgba(34, 53, 83, 0.03)",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
            ⚡ Quick Actions
          </h3>
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            Common administrative workflows and batch management
          </p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button
            className="primary-action-button"
            onClick={() => navigate("/shuffle")}
            style={{ fontSize: "12px", minHeight: "36px", padding: "0 12px" }}
            type="button"
          >
            ⚡ Batch Shuffle
          </button>
          <button
            className="secondary-action-button"
            onClick={() => navigate("/batches")}
            style={{ fontSize: "12px", minHeight: "36px", padding: "0 12px" }}
            type="button"
          >
            + Create Batch
          </button>
          <button
            className="secondary-action-button"
            onClick={() => navigate("/registration-links")}
            style={{ fontSize: "12px", minHeight: "36px", padding: "0 12px" }}
            type="button"
          >
            🔗 Registration Links
          </button>
          <button
            className="secondary-action-button"
            onClick={() => navigate("/reports")}
            style={{ fontSize: "12px", minHeight: "36px", padding: "0 12px" }}
            type="button"
          >
            📊 View Reports
          </button>
        </div>
      </div>

      {/* System Capacity Progress Meter */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e8ecf3",
          borderRadius: "12px",
          padding: "18px 20px",
          marginBottom: "24px",
          boxShadow: "0 2px 8px rgba(34, 53, 83, 0.03)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
              Overall Capacity Utilization
            </h3>
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
              Total batch intake limit vs enrolled student seats
            </p>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
            {enrolledCount} / {totalCapacity} seats ({capacityFillPercent}%)
          </span>
        </div>

        <div className="batch-progress-track" style={{ height: "10px", margin: "10px 0 6px" }}>
          <div
            className="batch-progress-fill fill-normal"
            style={{
              width: `${capacityFillPercent}%`,
              background: capacityFillPercent >= 85 ? "linear-gradient(90deg, #f59e0b, #ef4444)" : undefined,
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#64748b" }}>
          <span>Available Intake Capacity: <strong>{Math.max(0, totalCapacity - enrolledCount)} seats</strong></span>
          <span>Unassigned Students Waiting: <strong style={{ color: "#4f46e5" }}>{unassignedCount} students</strong></span>
        </div>
      </div>

      {/* Recent Student Registrations Table with Search & Interactive Quick View */}
      <section className="recent-students-card" aria-labelledby="recent-title">
        <div className="section-heading" style={{ flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 id="recent-title">Recent Student Registrations</h2>
            <p>Latest students registered via admission links</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              aria-label="Filter recent students"
              className="batch-students-search"
              onChange={(e) => setSearchStudent(e.target.value)}
              placeholder="Search recent students..."
              style={{ width: "220px", height: "36px" }}
              value={searchStudent}
            />
            <button
              className="secondary-action-button"
              onClick={() => navigate("/students")}
              style={{ minHeight: "36px", fontSize: "12px" }}
              type="button"
            >
              View All Students →
            </button>
          </div>
        </div>

        <div className="students-table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th scope="col">Student Name</th>
                <th scope="col">Course</th>
                <th scope="col">Batch Assignment</th>
                <th scope="col">Registration Date</th>
                <th scope="col" style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="table-empty" colSpan="5">
                    Loading student registrations…
                  </td>
                </tr>
              ) : filteredRecent.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan="5">
                    {recentStudents.length === 0
                      ? "No students registered yet."
                      : "No students matching your search."}
                  </td>
                </tr>
              ) : (
                filteredRecent.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <span className="student-avatar" aria-hidden="true">
                        {student.name?.charAt(0).toLocaleUpperCase() || "?"}
                      </span>
                      <span className="student-name">{student.name}</span>
                    </td>
                    <td>
                      <span className="field-tag">{student.roleName}</span>
                    </td>
                    <td>
                      {student.isAssigned ? (
                        <span className="batch-status status-active">
                          <span aria-hidden="true" />
                          {student.batchName}
                        </span>
                      ) : (
                        <span className="remaining-assignment-tag">
                          <span className="remaining-assignment-dot" aria-hidden="true" />
                          Awaiting Batch
                        </span>
                      )}
                    </td>
                    <td>{formatDate(student.createdAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="table-action"
                        onClick={() => setSelectedStudent(student)}
                        type="button"
                      >
                        Quick View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Quick Profile Modal */}
      {selectedStudent && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedStudent(null);
          }}
        >
          <section
            aria-labelledby="student-quick-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "480px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">STUDENT PROFILE</p>
                <h2 id="student-quick-title">{selectedStudent.name}</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setSelectedStudent(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <dl className="student-details-list" style={{ padding: "0 24px 20px" }}>
              <div>
                <dt>Full Name</dt>
                <dd>{selectedStudent.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{selectedStudent.email}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{selectedStudent.phone}</dd>
              </div>
              <div>
                <dt>Course</dt>
                <dd>
                  <span className="field-tag">{selectedStudent.roleName}</span>
                </dd>
              </div>
              <div>
                <dt>Batch Assignment</dt>
                <dd>
                  {selectedStudent.isAssigned ? (
                    <span className="batch-status status-active">
                      <span aria-hidden="true" />
                      {selectedStudent.batchName}
                    </span>
                  ) : (
                    <span className="remaining-assignment-tag">
                      <span className="remaining-assignment-dot" aria-hidden="true" />
                      Awaiting Batch
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Registration Date</dt>
                <dd>{formatDate(selectedStudent.createdAt)}</dd>
              </div>
            </dl>

            <div className="management-modal-actions">
              <button
                className="secondary-action-button"
                onClick={() => setSelectedStudent(null)}
                type="button"
              >
                Close
              </button>
              {!selectedStudent.isAssigned && (
                <button
                  className="primary-action-button"
                  onClick={() => {
                    setSelectedStudent(null);
                    navigate("/shuffle");
                  }}
                  type="button"
                >
                  Assign in Shuffle →
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default Dashboard;
