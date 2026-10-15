import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabase";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
}

function formatTime(value) {
  if (!value) return "—";
  const parts = String(value).split(":");
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  }
  return value;
}

function getBatchTypeLabel(dbValue) {
  if (dbValue === "role_wise") return "Role-wise Batch";
  if (dbValue === "all_role") return "All-role Batch";
  return dbValue || "—";
}

function getStatusLabel(dbValue) {
  const normalized = String(dbValue || "").toLowerCase();
  switch (normalized) {
    case "upcoming":
      return "Upcoming";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return dbValue || "Upcoming";
  }
}

function BatchDetails() {
  const { batchId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const [batch, setBatch] = useState(null);
  const [role, setRole] = useState(null);
  const [trainer, setTrainer] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [assignedStudents, setAssignedStudents] = useState([]);

  const loadBatchDetails = useCallback(async () => {
    if (!batchId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");
    setNotFound(false);

    try {
      // 1. Verify user session
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session) {
        throw new Error("Your Supabase login session is missing. Please log in again.");
      }

      // 2. Fetch the batch
      const { data: batchData, error: batchError } = await supabase
        .from("batches")
        .select("id, batch_name, batch_type, role_id, trainer_id, capacity, status, created_at")
        .eq("id", batchId)
        .maybeSingle();

      if (batchError) throw batchError;

      if (!batchData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setBatch(batchData);

      // 3. Fetch related entities in parallel: role, trainer, schedules, batch_students
      const promises = [];

      // Role
      if (batchData.role_id) {
        promises.push(
          supabase
            .from("roles")
            .select("id, role_name")
            .eq("id", batchData.role_id)
            .maybeSingle()
            .then((res) => ({ type: "role", data: res.data, error: res.error })),
        );
      } else {
        promises.push(Promise.resolve({ type: "role", data: null, error: null }));
      }

      // Trainer
      if (batchData.trainer_id) {
        promises.push(
          supabase
            .from("trainers")
            .select("id, name, email, specialization, capacity, created_at")
            .eq("id", batchData.trainer_id)
            .maybeSingle()
            .then((res) => ({ type: "trainer", data: res.data, error: res.error })),
        );
      } else {
        promises.push(Promise.resolve({ type: "trainer", data: null, error: null }));
      }

      // Schedules
      promises.push(
        supabase
          .from("schedules")
          .select("id, batch_id, start_date, end_date, start_time, end_time, mode, location, created_at")
          .eq("batch_id", batchId)
          .order("start_date", { ascending: true })
          .then((res) => ({ type: "schedules", data: res.data || [], error: res.error })),
      );

      // Batch students assignments
      promises.push(
        supabase
          .from("batch_students")
          .select("id, batch_id, student_id")
          .eq("batch_id", batchId)
          .then((res) => ({ type: "assignments", data: res.data || [], error: res.error })),
      );

      const results = await Promise.all(promises);

      let fetchedRole = null;
      let fetchedTrainer = null;
      let fetchedSchedules = [];
      let assignments = [];

      for (const res of results) {
        if (res.error) throw res.error;
        if (res.type === "role") fetchedRole = res.data;
        if (res.type === "trainer") fetchedTrainer = res.data;
        if (res.type === "schedules") fetchedSchedules = res.data;
        if (res.type === "assignments") assignments = res.data;
      }

      setRole(fetchedRole);
      setTrainer(fetchedTrainer);
      setSchedules(fetchedSchedules);

      // 4. Fetch student details for assigned students
      if (assignments.length > 0) {
        const studentIds = assignments.map((a) => a.student_id).filter(Boolean);

        if (studentIds.length > 0) {
          const { data: studentsData, error: studentsError } = await supabase
            .from("students")
            .select("id, name, created_at, role:roles(role_name)")
            .in("id", studentIds);

          if (studentsError) throw studentsError;

          const studentsMap = new Map((studentsData || []).map((s) => [String(s.id), s]));

          const enrichedStudents = assignments.map((assign) => {
            const studentInfo = studentsMap.get(String(assign.student_id));
            const roleName = Array.isArray(studentInfo?.role)
              ? studentInfo.role[0]?.role_name || "—"
              : studentInfo?.role?.role_name || "—";

            return {
              assignmentId: assign.id,
              studentId: assign.student_id,
              name: studentInfo?.name || "Unknown Student",
              roleName: roleName,
              assignedDate: studentInfo?.created_at || null,
            };
          });

          setAssignedStudents(enrichedStudents);
        } else {
          setAssignedStudents([]);
        }
      } else {
        setAssignedStudents([]);
      }
    } catch (err) {
      console.error("Unable to load batch details:", err?.message || err);
      setLoadError("Unable to load batch details.");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadBatchDetails();
  }, [loadBatchDetails]);

  // Calculations
  const capacity = batch?.capacity ?? 0;
  const assignedCount = assignedStudents.length;
  // Available Seats = batch.capacity - assigned student count, never show negative
  const availableSeats = Math.max(0, capacity - assignedCount);
  const isFull = capacity > 0 && availableSeats === 0;
  const isAllRole = batch?.batch_type === "all_role";

  // Actions
  function handleEditBatch() {
    navigate(`/batches?edit=${batchId}`);
  }

  function handleSchedule() {
    navigate("/schedules", { state: { batchId } });
  }

  function handleShuffle() {
    navigate("/shuffle", { state: { batchId } });
  }

  function handleBack() {
    navigate("/batches");
  }

  return (
    <section className="dashboard-content management-page batch-details-page">
      {/* Page Header */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">BATCH MANAGEMENT</p>
          <h1>{loading ? "Loading Batch..." : batch ? batch.batch_name : "Batch Details"}</h1>
          <p className="dashboard-welcome">
            Comprehensive overview of batch capacity, assigned students, trainer, and schedule.
          </p>
        </div>
        <div className="batch-header-actions">
          <button
            className="secondary-action-button"
            onClick={handleBack}
            type="button"
          >
            ← Back to Batches
          </button>
          <button
            className="secondary-action-button"
            onClick={handleSchedule}
            type="button"
          >
            Schedule
          </button>
          <button
            className="secondary-action-button"
            onClick={handleShuffle}
            type="button"
          >
            Shuffle
          </button>
          <button
            className="primary-action-button"
            disabled={!batch}
            onClick={handleEditBatch}
            type="button"
          >
            Edit Batch
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="recent-students-card" style={{ padding: "40px", textAlign: "center" }}>
          <div className="button-spinner" style={{ margin: "0 auto 16px", width: "24px", height: "24px", color: "#315ce8" }} />
          <p style={{ color: "#68758b", fontSize: "14px", margin: 0 }}>Loading batch details...</p>
        </div>
      )}

      {/* Error state */}
      {!loading && loadError && (
        <div className="admin-alert" role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{loadError}</span>
          <button className="secondary-action-button" onClick={loadBatchDetails} type="button" style={{ padding: "4px 12px", minHeight: "32px", fontSize: "12px" }}>
            Retry
          </button>
        </div>
      )}

      {/* Not found state */}
      {!loading && notFound && (
        <div className="recent-students-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔍</div>
          <h2 style={{ fontSize: "20px", color: "#1c2942", margin: "0 0 8px" }}>Batch not found.</h2>
          <p style={{ color: "#7a869b", fontSize: "14px", margin: "0 0 20px" }}>
            The requested batch could not be found or may have been deleted.
          </p>
          <button className="primary-action-button" onClick={handleBack} type="button">
            Back to Batches
          </button>
        </div>
      )}

      {/* Batch Content */}
      {!loading && !notFound && batch && (
        <>
          {/* Capacity Full Alert Banner */}
          {isFull && (
            <div className="admin-alert batch-full-alert" role="alert">
              <span className="batch-full-badge">⚠️ Batch Full</span>
              <span>
                This batch has reached its maximum student intake of <strong>{capacity} students</strong>. No available seats remaining.
              </span>
            </div>
          )}

          {/* Capacity Summary KPI Grid */}
          <section aria-label="Capacity Summary" className="kpi-grid">
            <article className="kpi-card">
              <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 7h18M5 3h14v18H5zM8 11h8M8 15h5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="kpi-label">Total Capacity</p>
              <div className="kpi-value-row">
                <p className="kpi-value">{capacity}</p>
                <span className="kpi-detail">Target limit</span>
              </div>
            </article>

            <article className="kpi-card">
              <div className="kpi-icon kpi-icon-violet" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="kpi-label">Assigned Students</p>
              <div className="kpi-value-row">
                <p className="kpi-value">{assignedCount}</p>
                <span className="kpi-detail">
                  {capacity > 0 ? `${Math.round((assignedCount / capacity) * 100)}% filled` : "—"}
                </span>
              </div>
            </article>

            <article className="kpi-card">
              <div className={`kpi-icon ${isFull ? "kpi-icon-amber" : "kpi-icon-green"}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5l-8-3ZM9 12l2 2 4-4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="kpi-label">Available Seats</p>
              <div className="kpi-value-row">
                <p className="kpi-value">{availableSeats}</p>
                {isFull ? (
                  <span className="batch-full-badge">Batch Full</span>
                ) : (
                  <span className="kpi-detail">{availableSeats} open</span>
                )}
              </div>
            </article>

            <article className="kpi-card">
              <div className="kpi-icon kpi-icon-green" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="kpi-label">Status</p>
              <div className="kpi-value-row">
                <span className={`batch-status status-${(batch.status || "upcoming").toLowerCase()}`}>
                  <span aria-hidden="true" />
                  {getStatusLabel(batch.status)}
                </span>
                <span className="kpi-detail">{getBatchTypeLabel(batch.batch_type)}</span>
              </div>
            </article>
          </section>

          {/* Two-Column Information Cards: Batch Info & Trainer Info */}
          <div className="batch-info-cards-grid">
            {/* 1. Batch Information */}
            <section className="recent-students-card batch-detail-card">
              <div className="section-heading">
                <div>
                  <h2>Batch Information</h2>
                  <p>Core configuration and assignment parameters</p>
                </div>
              </div>
              <dl className="student-details-list batch-dl">
                <div>
                  <dt>Batch Name</dt>
                  <dd>{batch.batch_name}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{isAllRole ? "All Roles" : role?.role_name || "—"}</dd>
                </div>
                <div>
                  <dt>Batch Type</dt>
                  <dd>{getBatchTypeLabel(batch.batch_type)}</dd>
                </div>
                <div>
                  <dt>Trainer</dt>
                  <dd>{trainer?.name || "Unassigned"}</dd>
                </div>
                <div>
                  <dt>Capacity</dt>
                  <dd>{capacity} students</dd>
                </div>
                <div>
                  <dt>Assigned Students</dt>
                  <dd>{assignedCount} students</dd>
                </div>
                <div>
                  <dt>Available Seats</dt>
                  <dd>
                    {availableSeats} seats {isFull && <span className="batch-full-badge">Batch Full</span>}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`batch-status status-${(batch.status || "upcoming").toLowerCase()}`}>
                      <span aria-hidden="true" />
                      {getStatusLabel(batch.status)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Created Date</dt>
                  <dd>{formatDate(batch.created_at)}</dd>
                </div>
              </dl>
            </section>

            {/* 2. Trainer Information */}
            <section className="recent-students-card batch-detail-card">
              <div className="section-heading">
                <div>
                  <h2>Trainer Information</h2>
                  <p>Assigned instructor profile and workload</p>
                </div>
              </div>
              {trainer ? (
                <dl className="student-details-list batch-dl">
                  <div>
                    <dt>Trainer Name</dt>
                    <dd>{trainer.name}</dd>
                  </div>
                  <div>
                    <dt>Trainer Email</dt>
                    <dd>{trainer.email}</dd>
                  </div>
                  <div>
                    <dt>Trainer Specialization</dt>
                    <dd>{trainer.specialization || "General"}</dd>
                  </div>
                  <div>
                    <dt>Trainer Capacity</dt>
                    <dd>{trainer.capacity ?? 30} students</dd>
                  </div>
                </dl>
              ) : (
                <div className="batch-unassigned-box">
                  <p>No trainer has been assigned to this batch.</p>
                  <button
                    className="secondary-action-button"
                    onClick={handleEditBatch}
                    style={{ marginTop: "12px", minHeight: "34px", fontSize: "12px" }}
                    type="button"
                  >
                    Assign Trainer
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* 3. Schedule Information Card */}
          <section className="recent-students-card batch-schedule-card">
            <div className="section-heading">
              <div>
                <h2>Schedule Information</h2>
                <p>Training timetable, dates, and classroom location</p>
              </div>
              <button
                className="secondary-action-button"
                onClick={handleSchedule}
                style={{ minHeight: "34px", fontSize: "12px" }}
                type="button"
              >
                {schedules.length > 0 ? "Manage Schedules" : "Create Schedule"}
              </button>
            </div>

            {schedules.length === 0 ? (
              <div className="batch-unassigned-box">
                <p>No schedule has been created for this batch.</p>
                <button
                  className="primary-action-button"
                  onClick={handleSchedule}
                  style={{ marginTop: "12px", minHeight: "34px", fontSize: "12px" }}
                  type="button"
                >
                  Create Schedule
                </button>
              </div>
            ) : (
              <div className="students-table-wrap">
                <table className="students-table management-table">
                  <thead>
                    <tr>
                      <th scope="col">Start Date</th>
                      <th scope="col">End Date</th>
                      <th scope="col">Start Time</th>
                      <th scope="col">End Time</th>
                      <th scope="col">Mode</th>
                      <th scope="col">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule.id}>
                        <td>{formatDate(schedule.start_date)}</td>
                        <td>{formatDate(schedule.end_date)}</td>
                        <td>{formatTime(schedule.start_time)}</td>
                        <td>{formatTime(schedule.end_time)}</td>
                        <td>
                          <span className={`schedule-mode-badge mode-${String(schedule.mode || "online").toLowerCase()}`}>
                            {schedule.mode || "Online"}
                          </span>
                        </td>
                        <td>{schedule.location || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 4. Student List Card */}
          <section className="recent-students-card management-table-card">
            <div className="section-heading">
              <div>
                <h2>Assigned Students</h2>
                <p>Students currently assigned to this batch</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="section-count">
                  {assignedCount} {assignedCount === 1 ? "student" : "students"}
                </span>
                <button
                  className="secondary-action-button"
                  onClick={handleShuffle}
                  style={{ minHeight: "34px", fontSize: "12px" }}
                  type="button"
                >
                  Shuffle Students
                </button>
              </div>
            </div>

            <div className="students-table-wrap">
              <table className="students-table management-table">
                <thead>
                  <tr>
                    <th scope="col">Student Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Assigned Date</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedStudents.length === 0 ? (
                    <tr>
                      <td className="table-empty" colSpan="3">
                        No students have been assigned to this batch yet.
                      </td>
                    </tr>
                  ) : (
                    assignedStudents.map((student) => (
                      <tr key={student.assignmentId || student.studentId}>
                        <td>
                          <span className="student-avatar" aria-hidden="true">
                            {student.name?.charAt(0).toUpperCase() || "?"}
                          </span>
                          <span className="student-name">{student.name}</span>
                        </td>
                        <td>{student.roleName}</td>
                        <td>{formatDate(student.assignedDate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

export default BatchDetails;
