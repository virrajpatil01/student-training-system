import { useCallback, useEffect, useMemo, useState } from "react";
import KPICard from "../components/KPICard";
import { supabase } from "../supabase";
import { fetchAllRows } from "../utils/studentMetrics";

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

function getBatchTypeLabel(value) {
  if (value === "role_wise") return "Course-wise Batch";
  if (value === "all_role") return "All-courses Batch";
  return value || "—";
}

function getStatusBadgeClass(status) {
  const norm = String(status || "").toLowerCase();
  switch (norm) {
    case "active":
      return "status-active";
    case "completed":
      return "status-completed";
    case "cancelled":
      return "status-cancelled";
    default:
      return "status-upcoming";
  }
}

function Reports() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState("");

  // Raw Database Data
  const [students, setStudents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batchStudents, setBatchStudents] = useState([]);
  const [schedules, setSchedules] = useState([]);

  // Active Tab
  const [activeTab, setActiveTab] = useState("all");

  // Filters State
  const [filterRole, setFilterRole] = useState("");
  const [filterBatch, setFilterBatch] = useState("");
  const [filterTrainer, setFilterTrainer] = useState("");
  const [filterBatchStatus, setFilterBatchStatus] = useState("");
  const [searchStudent, setSearchStudent] = useState("");

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage("");

    try {
      const [
        studentsList,
        rolesRes,
        trainersRes,
        batchesRes,
        batchStudentsList,
        schedulesRes,
      ] = await Promise.all([
        fetchAllRows(() =>
          supabase
            .from("students")
            .select("id, name, role_id, created_at")
            .order("created_at", { ascending: false })
        ),
        supabase
          .from("roles")
          .select("id, role_name")
          .order("role_name", { ascending: true }),
        supabase
          .from("trainers")
          .select("id, name, specialization, capacity")
          .order("name", { ascending: true }),
        supabase
          .from("batches")
          .select(
            "id, batch_name, batch_type, role_id, trainer_id, capacity, status, created_at",
          )
          .order("batch_name", { ascending: true }),
        fetchAllRows(() => supabase.from("batch_students").select("id, batch_id, student_id")),
        supabase
          .from("schedules")
          .select(
            "id, batch_id, start_date, end_date, start_time, end_time, mode, location, created_at",
          )
          .order("start_date", { ascending: true }),
      ]);

      if (rolesRes.error) throw rolesRes.error;
      if (trainersRes.error) throw trainersRes.error;
      if (batchesRes.error) throw batchesRes.error;
      if (schedulesRes.error) throw schedulesRes.error;

      setStudents(studentsList || []);
      setRoles(rolesRes.data || []);
      setTrainers(trainersRes.data || []);
      setBatches(batchesRes.data || []);
      setBatchStudents(batchStudentsList || []);
      setSchedules(schedulesRes.data || []);

      setLastRefreshed(
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    } catch (err) {
      console.error("Unable to load reports data:", err);
      setErrorMessage(
        "Could not load reporting data. Please check table access and policies.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleClearFilters() {
    setFilterRole("");
    setFilterBatch("");
    setFilterTrainer("");
    setFilterBatchStatus("");
    setSearchStudent("");
  }

  // Precomputed Lookups & Calculations
  const {
    kpis,
    roleReportData,
    batchReportData,
    trainerReportData,
    studentReportData,
    scheduleReportData,
  } = useMemo(() => {
    // 1. Dictionaries
    const rMap = new Map();
    for (const r of roles) {
      rMap.set(String(r.id), r.role_name || r.name || "Unknown Course");
    }

    const tMap = new Map();
    for (const t of trainers) {
      tMap.set(String(t.id), t);
    }

    const bMap = new Map();
    for (const b of batches) {
      bMap.set(String(b.id), b);
    }

    // 2. Batch students mappings
    const sBatchMap = new Map();
    const bCountMap = new Map();
    const assignedSet = new Set();
    const eligibleBatchIds = new Set(
      batches
        .filter((b) => (b.status || "").toLowerCase() !== "cancelled")
        .map((b) => String(b.id)),
    );
    const validStudentIds = new Set(students.map((s) => String(s.id)));

    for (const bs of batchStudents) {
      const sid = bs.student_id ? String(bs.student_id) : null;
      const bid = bs.batch_id ? String(bs.batch_id) : null;
      if (sid && bid && validStudentIds.has(sid) && eligibleBatchIds.has(bid)) {
        assignedSet.add(sid);
        sBatchMap.set(sid, bid);
        bCountMap.set(bid, (bCountMap.get(bid) || 0) + 1);
      }
    }

    // 3. Top KPIs
    const totalStudents = validStudentIds.size;
    const totalRoles = roles.length;
    const totalTrainers = trainers.length;
    const totalBatches = eligibleBatchIds.size;
    const assignedCount = assignedSet.size;
    const unassignedCount = Math.max(0, totalStudents - assignedCount);

    const kpiSummary = {
      totalStudents,
      totalRoles,
      totalTrainers,
      totalBatches,
      assignedStudents: assignedCount,
      unassignedStudents: unassignedCount,
    };

    // 4. Course-wise Student Report
    const roleCounts = new Map();
    for (const s of students) {
      const rid = s.role_id ? String(s.role_id) : "unspecified";
      roleCounts.set(rid, (roleCounts.get(rid) || 0) + 1);
    }

    let roleReport = roles.map((role) => {
      const count = roleCounts.get(String(role.id)) || 0;
      const pct =
        totalStudents > 0
          ? ((count / totalStudents) * 100).toFixed(1)
          : "0.0";
      return {
        id: role.id,
        roleName: role.role_name || role.name || "Unnamed Course",
        count,
        percentage: `${pct}%`,
        pctValue: parseFloat(pct),
      };
    });

    const unspecifiedCount = roleCounts.get("unspecified") || 0;
    if (unspecifiedCount > 0) {
      const pct =
        totalStudents > 0
          ? ((unspecifiedCount / totalStudents) * 100).toFixed(1)
          : "0.0";
      roleReport.push({
        id: "unspecified",
        roleName: "Unspecified Course",
        count: unspecifiedCount,
        percentage: `${pct}%`,
        pctValue: parseFloat(pct),
      });
    }

    if (filterRole) {
      roleReport = roleReport.filter((r) => String(r.id) === String(filterRole));
    }

    // 5. Batch-wise Student Report
    let batchReport = batches.map((b) => {
      const assigned = bCountMap.get(String(b.id)) || 0;
      const capacity = Number(b.capacity) || 0;
      const available = Math.max(0, capacity - assigned);
      const isAllRole = b.batch_type === "all_role";
      const roleName = isAllRole
        ? "All Courses"
        : b.role_id
          ? rMap.get(String(b.role_id)) || "—"
          : "—";
      const tr = b.trainer_id ? tMap.get(String(b.trainer_id)) : null;
      const trainerName = tr?.name || "Unassigned";

      return {
        ...b,
        roleName,
        trainerName,
        assignedStudents: assigned,
        availableSeats: available,
        statusLabel: b.status ? b.status.charAt(0).toUpperCase() + b.status.slice(1) : "Upcoming",
      };
    });

    if (filterRole) {
      batchReport = batchReport.filter(
        (b) =>
          b.batch_type === "all_role" ||
          String(b.role_id) === String(filterRole),
      );
    }
    if (filterBatch) {
      batchReport = batchReport.filter((b) => String(b.id) === String(filterBatch));
    }
    if (filterTrainer) {
      batchReport = batchReport.filter(
        (b) => String(b.trainer_id) === String(filterTrainer),
      );
    }
    if (filterBatchStatus) {
      batchReport = batchReport.filter(
        (b) =>
          String(b.status || "").toLowerCase() ===
          filterBatchStatus.toLowerCase(),
      );
    }

    // 6. Trainer-wise Report
    let trainerReport = trainers.map((t) => {
      // Find all batches assigned to this trainer
      const trainerBatches = batches.filter(
        (b) => String(b.trainer_id) === String(t.id),
      );
      const assigned = trainerBatches.reduce(
        (sum, b) => sum + (bCountMap.get(String(b.id)) || 0),
        0,
      );
      const cap = Number(t.capacity) || 0;
      const available = Math.max(0, cap - assigned);

      return {
        ...t,
        assignedStudents: assigned,
        availableCapacity: available,
      };
    });

    if (filterTrainer) {
      trainerReport = trainerReport.filter(
        (t) => String(t.id) === String(filterTrainer),
      );
    }

    // 7. Student Assignment Report
    let studentReport = students.map((s) => {
      const assignedBatchId = sBatchMap.get(String(s.id));
      const assignedBatch = assignedBatchId
        ? bMap.get(assignedBatchId)
        : null;
      const tr =
        assignedBatch && assignedBatch.trainer_id
          ? tMap.get(String(assignedBatch.trainer_id))
          : null;

      return {
        id: s.id,
        name: s.name || "Unnamed Student",
        roleId: s.role_id,
        roleName: s.role_id ? rMap.get(String(s.role_id)) || "—" : "—",
        batchId: assignedBatchId || null,
        batchName: assignedBatch ? assignedBatch.batch_name : "Unassigned",
        isAssigned: Boolean(assignedBatch),
        trainerId: assignedBatch?.trainer_id || null,
        trainerName: assignedBatch ? tr?.name || "Unassigned" : "—",
        batchStatus: assignedBatch
          ? (assignedBatch.status ? assignedBatch.status.charAt(0).toUpperCase() + assignedBatch.status.slice(1) : "Upcoming")
          : "—",
      };
    });

    // Apply Student Search
    if (searchStudent.trim()) {
      const query = searchStudent.toLowerCase().trim();
      studentReport = studentReport.filter((s) =>
        s.name.toLowerCase().includes(query),
      );
    }
    // Apply Filters to Student Assignment Report
    if (filterRole) {
      studentReport = studentReport.filter(
        (s) => String(s.roleId) === String(filterRole),
      );
    }
    if (filterBatch) {
      if (filterBatch === "unassigned") {
        studentReport = studentReport.filter((s) => !s.isAssigned);
      } else {
        studentReport = studentReport.filter(
          (s) => String(s.batchId) === String(filterBatch),
        );
      }
    }
    if (filterTrainer) {
      studentReport = studentReport.filter(
        (s) => String(s.trainerId) === String(filterTrainer),
      );
    }
    if (filterBatchStatus) {
      studentReport = studentReport.filter(
        (s) =>
          s.isAssigned &&
          s.batchStatus.toLowerCase() === filterBatchStatus.toLowerCase(),
      );
    }

    // 8. Schedule Report
    let scheduleReport = schedules.map((sch) => {
      const b = bMap.get(String(sch.batch_id));
      const tr =
        b && b.trainer_id ? tMap.get(String(b.trainer_id)) : null;

      return {
        id: sch.id,
        batchId: sch.batch_id,
        batchName: b?.batch_name || "Unknown Batch",
        trainerId: b?.trainer_id,
        trainerName: b ? tr?.name || "Unassigned" : "—",
        startDate: formatDate(sch.start_date),
        endDate: formatDate(sch.end_date),
        startTime: formatTime(sch.start_time),
        endTime: formatTime(sch.end_time),
        mode: sch.mode || "Online",
        location: sch.location || "—",
      };
    });

    if (filterBatch) {
      scheduleReport = scheduleReport.filter(
        (sch) => String(sch.batchId) === String(filterBatch),
      );
    }
    if (filterTrainer) {
      scheduleReport = scheduleReport.filter(
        (sch) => String(sch.trainerId) === String(filterTrainer),
      );
    }

    return {
      rolesMap: rMap,
      trainersMap: tMap,
      batchesMap: bMap,
      studentBatchMap: sBatchMap,
      batchStudentCountMap: bCountMap,
      uniqueAssignedStudentIds: assignedSet,
      kpis: kpiSummary,
      roleReportData: roleReport,
      batchReportData: batchReport,
      trainerReportData: trainerReport,
      studentReportData: studentReport,
      scheduleReportData: scheduleReport,
    };
  }, [
    students,
    roles,
    trainers,
    batches,
    batchStudents,
    schedules,
    filterRole,
    filterBatch,
    filterTrainer,
    filterBatchStatus,
    searchStudent,
  ]);

  const hasActiveFilters = Boolean(
    filterRole ||
      filterBatch ||
      filterTrainer ||
      filterBatchStatus ||
      searchStudent,
  );

  return (
    <section className="dashboard-content reports-page">
      {/* Header */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">SYSTEM INSIGHTS</p>
          <h1>System Reports</h1>
          <p className="dashboard-welcome">
            Comprehensive analytics and breakdown of students, courses, batches,
            trainers, and schedules.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {lastRefreshed && (
            <span className="dashboard-date" title="Last data synchronization">
              Updated: {lastRefreshed}
            </span>
          )}
          <button
            className="refresh-reports-btn"
            disabled={refreshing || loading}
            onClick={() => loadData(true)}
            type="button"
          >
            <svg
              className={refreshing ? "button-spinner" : ""}
              viewBox="0 0 24 24"
              fill="none"
              style={{ width: "15px", height: "15px" }}
              aria-hidden="true"
            >
              <path
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh Reports"}
          </button>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <p className="admin-alert" role="alert">
          {errorMessage}
        </p>
      )}

      {/* 1. TOP KPI CARDS */}
      <div className="reports-kpi-grid">
        <KPICard
          detail="All registered"
          icon="students"
          label="Total Students"
          tone="blue"
          value={loading ? "…" : kpis.totalStudents}
        />
        <KPICard
          detail="Active courses"
          icon="roles"
          label="Total Courses"
          tone="violet"
          value={loading ? "…" : kpis.totalRoles}
        />
        <KPICard
          detail="Active trainers"
          icon="trainers"
          label="Total Trainers"
          tone="amber"
          value={loading ? "…" : kpis.totalTrainers}
        />
        <KPICard
          detail="Created batches"
          icon="batches"
          label="Total Batches"
          tone="green"
          value={loading ? "…" : kpis.totalBatches}
        />
        <KPICard
          detail="In batch_students"
          icon="assigned"
          label="Assigned Students"
          tone="emerald"
          value={loading ? "…" : kpis.assignedStudents}
        />
        <KPICard
          detail="Awaiting allocation"
          icon="unassigned"
          label="Unassigned Students"
          tone="rose"
          value={loading ? "…" : kpis.unassignedStudents}
        />
      </div>

      {/* Filter and Search Bar */}
      <section className="reports-filters-card" aria-label="Report Filters">
        <div className="reports-filters-row">
          {/* Course Filter */}
          <div className="reports-filter-group">
            <label htmlFor="filter-role">Course</label>
            <select
              id="filter-role"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
            >
              <option value="">All Courses</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role_name || r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Filter */}
          <div className="reports-filter-group">
            <label htmlFor="filter-batch">Batch</label>
            <select
              id="filter-batch"
              value={filterBatch}
              onChange={(e) => setFilterBatch(e.target.value)}
            >
              <option value="">All Batches</option>
              <option value="unassigned">— Only Unassigned —</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batch_name}
                </option>
              ))}
            </select>
          </div>

          {/* Trainer Filter */}
          <div className="reports-filter-group">
            <label htmlFor="filter-trainer">Trainer</label>
            <select
              id="filter-trainer"
              value={filterTrainer}
              onChange={(e) => setFilterTrainer(e.target.value)}
            >
              <option value="">All Trainers</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Status Filter */}
          <div className="reports-filter-group">
            <label htmlFor="filter-batch-status">Batch Status</label>
            <select
              id="filter-batch-status"
              value={filterBatchStatus}
              onChange={(e) => setFilterBatchStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Search by Student Name */}
          <div className="reports-filter-group" style={{ flex: 1.3 }}>
            <label htmlFor="search-student">Search Student</label>
            <input
              id="search-student"
              type="text"
              placeholder="Search by student name…"
              value={searchStudent}
              onChange={(e) => setSearchStudent(e.target.value)}
            />
          </div>

          {/* Filter Actions */}
          <div className="reports-filter-actions">
            {hasActiveFilters && (
              <button
                className="clear-filters-btn"
                onClick={handleClearFilters}
                type="button"
                title="Reset all active filters"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Tabs Switcher */}
      <nav className="reports-tabs-nav" aria-label="Reports Switcher">
        <button
          className={`reports-tab-btn ${activeTab === "all" ? "is-active" : ""}`}
          onClick={() => setActiveTab("all")}
          type="button"
        >
          All Reports
        </button>
        <button
          className={`reports-tab-btn ${activeTab === "role" ? "is-active" : ""}`}
          onClick={() => setActiveTab("role")}
          type="button"
        >
          Course-wise ({roleReportData.length})
        </button>
        <button
          className={`reports-tab-btn ${activeTab === "batch" ? "is-active" : ""}`}
          onClick={() => setActiveTab("batch")}
          type="button"
        >
          Batch-wise ({batchReportData.length})
        </button>
        <button
          className={`reports-tab-btn ${activeTab === "trainer" ? "is-active" : ""}`}
          onClick={() => setActiveTab("trainer")}
          type="button"
        >
          Trainer-wise ({trainerReportData.length})
        </button>
        <button
          className={`reports-tab-btn ${activeTab === "student" ? "is-active" : ""}`}
          onClick={() => setActiveTab("student")}
          type="button"
        >
          Student Assignments ({studentReportData.length})
        </button>
        <button
          className={`reports-tab-btn ${activeTab === "schedule" ? "is-active" : ""}`}
          onClick={() => setActiveTab("schedule")}
          type="button"
        >
          Schedules ({scheduleReportData.length})
        </button>
      </nav>

      {/* 2. COURSE-WISE STUDENT REPORT */}
      {(activeTab === "all" || activeTab === "role") && (
        <section className="recent-students-card report-section-card">
          <div className="section-heading">
            <div>
              <h2>Course-wise Students</h2>
              <p>Breakdown of registered students across each training course</p>
            </div>
            <span className="section-count">
              {roleReportData.length} {roleReportData.length === 1 ? "course" : "courses"}
            </span>
          </div>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Student Count</th>
                  <th scope="col" style={{ width: "38%" }}>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="3">
                      Loading course-wise data…
                    </td>
                  </tr>
                ) : roleReportData.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="3">
                      No courses match the selected filters.
                    </td>
                  </tr>
                ) : (
                  roleReportData.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 600, color: "#1e293b" }}>
                        {row.roleName}
                      </td>
                      <td style={{ fontWeight: 700 }}>{row.count}</td>
                      <td>
                        <div className="percentage-bar-wrap">
                          <div className="percentage-bar-bg">
                            <div
                              className="percentage-bar-fill"
                              style={{ width: `${Math.min(100, row.pctValue)}%` }}
                            />
                          </div>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b" }}>
                            {row.percentage}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3. BATCH-WISE STUDENT REPORT */}
      {(activeTab === "all" || activeTab === "batch") && (
        <section className="recent-students-card report-section-card">
          <div className="section-heading">
            <div>
              <h2>Batch-wise Student Report</h2>
              <p>Capacity, assigned students, available seats, and trainer per batch</p>
            </div>
            <span className="section-count">
              {batchReportData.length} {batchReportData.length === 1 ? "batch" : "batches"}
            </span>
          </div>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th scope="col">Batch Name</th>
                  <th scope="col">Batch Type</th>
                  <th scope="col">Course</th>
                  <th scope="col">Trainer</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Assigned Students</th>
                  <th scope="col">Available Seats</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="8">
                      Loading batch report data…
                    </td>
                  </tr>
                ) : batchReportData.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="8">
                      No batches match the selected filters.
                    </td>
                  </tr>
                ) : (
                  batchReportData.map((batch) => (
                    <tr key={batch.id}>
                      <td style={{ fontWeight: 600, color: "#1e293b" }}>
                        {batch.batch_name}
                      </td>
                      <td>{getBatchTypeLabel(batch.batch_type)}</td>
                      <td>{batch.roleName}</td>
                      <td>{batch.trainerName}</td>
                      <td style={{ fontWeight: 600 }}>{batch.capacity}</td>
                      <td style={{ fontWeight: 700, color: "#0f766e" }}>
                        {batch.assignedStudents}
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          color: batch.availableSeats === 0 ? "#b91c1c" : "#1e293b",
                        }}
                      >
                        {batch.availableSeats}
                      </td>
                      <td>
                        <span className={`link-status ${getStatusBadgeClass(batch.status)}`}>
                          <span aria-hidden="true" />
                          {batch.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. TRAINER-WISE REPORT */}
      {(activeTab === "all" || activeTab === "trainer") && (
        <section className="recent-students-card report-section-card">
          <div className="section-heading">
            <div>
              <h2>Trainer-wise Report</h2>
              <p>Trainer workload, assigned batch students, and remaining capacity</p>
            </div>
            <span className="section-count">
              {trainerReportData.length} {trainerReportData.length === 1 ? "trainer" : "trainers"}
            </span>
          </div>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th scope="col">Trainer</th>
                  <th scope="col">Specialization</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Assigned Students</th>
                  <th scope="col">Available Capacity</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="5">
                      Loading trainer report data…
                    </td>
                  </tr>
                ) : trainerReportData.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="5">
                      No trainers match the selected filters.
                    </td>
                  </tr>
                ) : (
                  trainerReportData.map((tr) => (
                    <tr key={tr.id}>
                      <td style={{ fontWeight: 600, color: "#1e293b" }}>
                        {tr.name}
                      </td>
                      <td>{tr.specialization || "General"}</td>
                      <td style={{ fontWeight: 600 }}>{tr.capacity}</td>
                      <td style={{ fontWeight: 700, color: "#0f766e" }}>
                        {tr.assignedStudents}
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          color: tr.availableCapacity === 0 ? "#b91c1c" : "#1e293b",
                        }}
                      >
                        {tr.availableCapacity}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 5. STUDENT ASSIGNMENT REPORT */}
      {(activeTab === "all" || activeTab === "student") && (
        <section className="recent-students-card report-section-card">
          <div className="section-heading">
            <div>
              <h2>Student Assignment Report</h2>
              <p>Individual student allocation status across batches and trainers</p>
            </div>
            <span className="section-count">
              {studentReportData.length} {studentReportData.length === 1 ? "student" : "students"}
            </span>
          </div>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th scope="col">Student Name</th>
                  <th scope="col">Course</th>
                  <th scope="col">Batch</th>
                  <th scope="col">Trainer</th>
                  <th scope="col">Batch Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="5">
                      Loading student assignments…
                    </td>
                  </tr>
                ) : studentReportData.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="5">
                      {searchStudent || hasActiveFilters
                        ? "No students match your search or filter criteria."
                        : "No students registered yet."}
                    </td>
                  </tr>
                ) : (
                  studentReportData.map((student) => (
                    <tr key={student.id}>
                      <td style={{ fontWeight: 600, color: "#1e293b" }}>
                        {student.name}
                      </td>
                      <td>{student.roleName}</td>
                      <td>
                        {student.isAssigned ? (
                          <span style={{ fontWeight: 600, color: "#0f766e" }}>
                            {student.batchName}
                          </span>
                        ) : (
                          <span className="badge-unassigned">Unassigned</span>
                        )}
                      </td>
                      <td>{student.trainerName}</td>
                      <td>
                        {student.isAssigned ? (
                          <span className={`link-status ${getStatusBadgeClass(student.batchStatus)}`}>
                            <span aria-hidden="true" />
                            {student.batchStatus}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 6. SCHEDULE REPORT */}
      {(activeTab === "all" || activeTab === "schedule") && (
        <section className="recent-students-card report-section-card">
          <div className="section-heading">
            <div>
              <h2>Schedule Report</h2>
              <p>Timelines, timings, mode, and venues for all batch training schedules</p>
            </div>
            <span className="section-count">
              {scheduleReportData.length} {scheduleReportData.length === 1 ? "schedule" : "schedules"}
            </span>
          </div>

          <div className="students-table-wrap">
            <table className="students-table">
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Trainer</th>
                  <th scope="col">Start Date</th>
                  <th scope="col">End Date</th>
                  <th scope="col">Start Time</th>
                  <th scope="col">End Time</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Location</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="8">
                      Loading schedules data…
                    </td>
                  </tr>
                ) : scheduleReportData.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="8">
                      No schedules match the selected filters.
                    </td>
                  </tr>
                ) : (
                  scheduleReportData.map((sch) => (
                    <tr key={sch.id}>
                      <td style={{ fontWeight: 600, color: "#1e293b" }}>
                        {sch.batchName}
                      </td>
                      <td>{sch.trainerName}</td>
                      <td>{sch.startDate}</td>
                      <td>{sch.endDate}</td>
                      <td>{sch.startTime}</td>
                      <td>{sch.endTime}</td>
                      <td>
                        <span
                          className={`schedule-mode-badge mode-${String(sch.mode || "").toLowerCase()}`}
                        >
                          {sch.mode}
                        </span>
                      </td>
                      <td>{sch.location}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

export default Reports;
