import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../supabase";
import { fetchAllRows } from "../utils/studentMetrics";
import { BACKEND_URL as API_BASE_URL } from "../config/api";
import { filterSystemRoles } from "../config/formConfig";

function Shuffle() {
  const location = useLocation();

  // State
  const [batches, setBatches] = useState([]);
  const [batchesSummary, setBatchesSummary] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(
    location.state?.batchId || "",
  );
  const [stats, setStats] = useState({
    totalStudents: 0,
    assignedStudents: 0,
    unassignedStudents: 0,
    totalBatches: 0,
    totalTrainers: 0,
  });

  const [assignments, setAssignments] = useState([]);
  const [unassignedList, setUnassignedList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shuffling, setShuffling] = useState(false);
  const [activeAction, setActiveAction] = useState(""); // "all" | "batch" | "course"
  const [courses, setCourses] = useState([]);
  const [selectedCourseShuffleId, setSelectedCourseShuffleId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  // Interactive filtering & search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCourseFilter, setSelectedCourseFilter] = useState("ALL");
  const [selectedTrainerFilter, setSelectedTrainerFilter] = useState("ALL");
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [lastSummaryModal, setLastSummaryModal] = useState(null);

  // Load assignments and statistics from backend
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      // 1. Fetch full assignments summary from Python backend
      const res = await fetch(`${API_BASE_URL}/shuffle/assignments`, {
        method: "GET",
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAssignments(data.assignments || []);
          setUnassignedList(data.unassigned_students || []);
          setBatchesSummary(data.batches_summary || []);
          if (data.stats) {
            setStats(data.stats);
          }
        }
      }

      // 2. Fetch active batches for dropdown picker
      const { data: batchesData, error: batchesError } = await supabase
        .from("batches")
        .select("id, batch_name, batch_type, status, capacity, role_id, trainer_id")
        .order("batch_name", { ascending: true });

      if (batchesError) throw batchesError;

      const activeBatches = (batchesData || []).filter(
        (b) => String(b.status || "").toLowerCase() !== "cancelled",
      );
      setBatches(activeBatches);
      const navBatchId = location.state?.batchId;
      if (activeBatches.length > 0) {
        setSelectedBatchId((prev) => prev || navBatchId || activeBatches[0].id);
      }

      // 3. Fetch courses/roles for course-wise shuffle
      const { data: rolesData } = await supabase
        .from("roles")
        .select("id, role_name")
        .order("role_name", { ascending: true });

      const cleanRoles = filterSystemRoles(rolesData || []);
      if (cleanRoles.length > 0) {
        setCourses(cleanRoles);
        setSelectedCourseShuffleId((prev) => prev || cleanRoles[0].id);
      }
    } catch (err) {
      console.error("Unable to load initial shuffle data:", err?.message || err);
      // Fallback count check if backend was temporarily unreachable
      try {
        const [studentRows, assignmentRows] = await Promise.all([
          fetchAllRows(() => supabase.from("students").select("id")),
          fetchAllRows(() => supabase.from("batch_students").select("student_id")),
        ]);
        const uniqueStudentIds = new Set((studentRows || []).map((s) => s.id));
        const uniqueAssigned = new Set((assignmentRows || []).map((a) => a.student_id)).size;
        const total = uniqueStudentIds.size;
        setStats((prev) => ({
          ...prev,
          totalStudents: total,
          assignedStudents: uniqueAssigned,
          unassignedStudents: Math.max(0, total - uniqueAssigned),
        }));
      } catch (fallbackErr) {
        console.warn("Fallback query failed:", fallbackErr);
      }
      setErrorMessage(`Note: Backend shuffle service can be reached at ${API_BASE_URL}.`);
    } finally {
      setLoading(false);
    }
  }, [location.state]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Execute Shuffle All Batches
  async function handleShuffleAll() {
    setNotice("");
    setErrorMessage("");
    setShuffling(true);
    setActiveAction("all");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setErrorMessage("Your Supabase login session is missing. Please log in again.");
        return;
      }

      const headers = {
        "Content-Type": "application/json",
      };
      if (session.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`${API_BASE_URL}/shuffle/all`, {
        method: "POST",
        headers,
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.detail ||
            result?.message ||
            `Shuffle operation failed with status ${response.status}`,
        );
      }

      const newlyAssigned = result?.newly_assigned_count ?? result?.students_assigned ?? 0;
      const unassignedCount = result?.unassigned_count ?? result?.remaining_students ?? 0;
      const trainersCount = result?.trainers_assigned_to_batches_count ?? 0;

      setNotice(
        `✓ Shuffle complete! Assigned ${newlyAssigned} students across batches. Assigned trainers to ${trainersCount} batches.`,
      );

      setLastSummaryModal({
        title: "Shuffle All Batches Completed",
        newlyAssigned,
        totalAssigned: result?.assigned_count ?? result?.students_assigned ?? newlyAssigned,
        unassignedCount,
        trainersAssigned: trainersCount,
        message: result?.message,
      });

      // Reload assignments list & stats
      await loadInitialData();
    } catch (err) {
      console.error("Shuffle All error:", err);
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        setErrorMessage(
          `Shuffle service is not reachable. Please ensure the Python backend is running on ${API_BASE_URL}.`,
        );
      } else {
        setErrorMessage(err.message || "Failed to execute shuffle operation.");
      }
    } finally {
      setShuffling(false);
      setActiveAction("");
    }
  }

  // Execute Shuffle for Selected Batch
  async function handleShuffleBatch() {
    if (!selectedBatchId) {
      setErrorMessage("Please select a target batch to shuffle.");
      return;
    }

    setNotice("");
    setErrorMessage("");
    setShuffling(true);
    setActiveAction("batch");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setErrorMessage("Your Supabase login session is missing. Please log in again.");
        return;
      }

      const headers = {
        "Content-Type": "application/json",
      };
      if (session.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(
        `${API_BASE_URL}/shuffle/batch/${selectedBatchId}`,
        {
          method: "POST",
          headers,
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.detail ||
            result?.message ||
            `Batch shuffle failed with status ${response.status}`,
        );
      }

      const count = result?.assigned_count ?? 0;
      setNotice(`✓ Batch shuffle complete! Assigned ${count} students.`);

      setLastSummaryModal({
        title: "Selected Batch Shuffled Successfully",
        newlyAssigned: count,
        totalAssigned: count,
        unassignedCount: result?.unassigned_count ?? 0,
        message: result?.message,
      });

      // Reload assignments list & stats
      await loadInitialData();
    } catch (err) {
      console.error("Shuffle Batch error:", err);
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        setErrorMessage(
          `Shuffle service is not reachable. Please start the Python backend on ${API_BASE_URL}.`,
        );
      } else {
        setErrorMessage(err.message || "Failed to execute batch shuffle.");
      }
    } finally {
      setShuffling(false);
      setActiveAction("");
    }
  }

  // Execute Shuffle for Selected Course
  async function handleShuffleCourse() {
    if (!selectedCourseShuffleId) {
      setErrorMessage("Please select a target course to shuffle.");
      return;
    }

    setNotice("");
    setErrorMessage("");
    setShuffling(true);
    setActiveAction("course");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setErrorMessage("Your Supabase login session is missing. Please log in again.");
        return;
      }

      const headers = {
        "Content-Type": "application/json",
      };
      if (session.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(
        `${API_BASE_URL}/shuffle/course/${selectedCourseShuffleId}`,
        {
          method: "POST",
          headers,
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.detail ||
            result?.message ||
            `Course shuffle failed with status ${response.status}`,
        );
      }

      const newlyAssigned = result?.newly_assigned_count ?? 0;
      const courseName =
        courses.find((c) => c.id === selectedCourseShuffleId)?.role_name || "Course";
      setNotice(`✓ ${courseName} shuffle complete! Assigned ${newlyAssigned} students.`);

      setLastSummaryModal({
        title: `${courseName} Shuffle Completed`,
        newlyAssigned,
        totalAssigned: result?.assigned_count,
        unassignedCount: result?.unassigned_count ?? 0,
        message: result?.message,
      });

      // Reload assignments list & stats
      await loadInitialData();
    } catch (err) {
      console.error("Shuffle Course error:", err);
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        setErrorMessage(
          `Shuffle service is not reachable. Please start the Python backend on ${API_BASE_URL}.`,
        );
      } else {
        setErrorMessage(err.message || "Failed to execute course shuffle.");
      }
    } finally {
      setShuffling(false);
      setActiveAction("");
    }
  }

  // Multi-sheet Excel Export
  function handleExportExcel() {
    if (assignments.length === 0 && unassignedList.length === 0) {
      setErrorMessage("No student assignment records available to export.");
      return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Student Assignments Sheet
    const assignmentsRows = assignments.map((item, index) => ({
      "S.No": index + 1,
      "Student Name": item.student_name || "—",
      "Course / Role": item.course_name || item.role_name || "—",
      "Assigned Batch": item.batch_name || "—",
      "Batch Type": item.batch_type === "all_role" ? "All Courses" : "Course-wise",
      "Assigned Trainer": item.trainer_name || "Unassigned",
      "Trainer Specialization": item.trainer_specialization || "General",
      "Trainer Email": item.trainer_email || "—",
      "Status": "Assigned",
      "Assigned Date": item.assigned_at
        ? new Date(item.assigned_at).toLocaleDateString()
        : new Date().toLocaleDateString(),
    }));
    const wsAssignments = XLSX.utils.json_to_sheet(assignmentsRows);
    XLSX.utils.book_append_sheet(wb, wsAssignments, "Student Assignments");

    // 2. Batch Summary Sheet
    if (batchesSummary && batchesSummary.length > 0) {
      const batchRows = batchesSummary.map((b, index) => ({
        "S.No": index + 1,
        "Batch Name": b.batch_name,
        "Batch Type": b.batch_type === "all_role" ? "All Courses" : "Course-wise",
        "Course": b.course_name,
        "Assigned Trainer": b.trainer_name,
        "Trainer Email": b.trainer_email,
        "Batch Capacity": b.capacity,
        "Assigned Students": b.assigned_students,
        "Available Seats": b.available_seats,
        "Status": b.status,
      }));
      const wsBatches = XLSX.utils.json_to_sheet(batchRows);
      XLSX.utils.book_append_sheet(wb, wsBatches, "Batch Summary");
    }

    // 3. Unassigned Students Sheet (if any)
    if (unassignedList && unassignedList.length > 0) {
      const unassignedRows = unassignedList.map((item, index) => ({
        "S.No": index + 1,
        "Student Name": item.student_name,
        "Course": item.course_name || item.role_name,
        "Reason / Note": item.reason || "Awaiting allocation",
      }));
      const wsUnassigned = XLSX.utils.json_to_sheet(unassignedRows);
      XLSX.utils.book_append_sheet(wb, wsUnassigned, "Unassigned Students");
    }

    const dateStr = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `Student_Shuffle_Assignments_${dateStr}.xlsx`);
    setNotice("✓ Excel report downloaded successfully.");
  }

  // Derive unique courses & trainers for dynamic filter chips
  const uniqueCourses = useMemo(() => {
    const set = new Set();
    assignments.forEach((a) => {
      const c = a.course_name || a.role_name;
      if (c && c !== "—") set.add(c);
    });
    return Array.from(set).sort();
  }, [assignments]);

  const uniqueTrainers = useMemo(() => {
    const set = new Set();
    assignments.forEach((a) => {
      if (a.trainer_name && a.trainer_name !== "Unassigned") {
        set.add(a.trainer_name);
      }
    });
    return Array.from(set).sort();
  }, [assignments]);

  // Filtered assignments based on search, course chip, and trainer dropdown
  const filteredAssignments = useMemo(() => {
    return assignments.filter((item) => {
      // Course filter
      const course = (item.course_name || item.role_name || "").toLowerCase();
      if (
        selectedCourseFilter !== "ALL" &&
        course !== selectedCourseFilter.toLowerCase()
      ) {
        return false;
      }

      // Trainer filter
      if (
        selectedTrainerFilter !== "ALL" &&
        item.trainer_name !== selectedTrainerFilter
      ) {
        return false;
      }

      // Text Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const sName = (item.student_name || "").toLowerCase();
        const bName = (item.batch_name || "").toLowerCase();
        const tName = (item.trainer_name || "").toLowerCase();
        const tSpec = (item.trainer_specialization || "").toLowerCase();
        return (
          sName.includes(query) ||
          bName.includes(query) ||
          course.includes(query) ||
          tName.includes(query) ||
          tSpec.includes(query)
        );
      }

      return true;
    });
  }, [assignments, selectedCourseFilter, selectedTrainerFilter, searchQuery]);

  return (
    <section className="dashboard-content management-page">
      {/* Page Header */}
      <div className="page-heading-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <p className="eyebrow" style={{ margin: 0 }}>DISTRIBUTION ENGINE</p>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "#f0fdf4",
                color: "#166534",
                border: "1px solid #bbf7d0",
                fontSize: "11px",
                fontWeight: "600",
                padding: "2px 8px",
                borderRadius: "12px",
              }}
            >
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} />
              Direct Trainer Assignment Active
            </span>
          </div>
          <h1>Student & Trainer Shuffle System</h1>
          <p className="dashboard-welcome">
            Automated, constraint-checked distribution of students into batches with direct trainer assignments.
          </p>
        </div>

        {/* Global Header Actions */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="shuffle-excel-btn"
            disabled={loading || (assignments.length === 0 && unassignedList.length === 0)}
            onClick={handleExportExcel}
            type="button"
            title="Download full assignment report as Excel spreadsheet"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export to Excel
          </button>
        </div>
      </div>

      {/* Alerts */}
      {errorMessage && (
        <p className="admin-alert" role="alert">
          {errorMessage}
        </p>
      )}
      {notice && (
        <p className="management-notice" role="status">
          {notice}
        </p>
      )}

      {/* Control Card for Shuffling */}
      <section className="shuffle-controls-card">
        <div className="shuffle-actions-row">
          <div className="shuffle-main-actions">
            <button
              className="primary-action-button"
              disabled={shuffling || loading}
              onClick={handleShuffleAll}
              type="button"
              style={{
                padding: "0 22px",
                height: "42px",
                fontSize: "13px",
                fontWeight: "700",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {shuffling && activeAction === "all" ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  Shuffling All Batches…
                </>
              ) : (
                <>
                  <span aria-hidden="true">⚡</span>
                  Shuffle All Batches
                </>
              )}
            </button>

            <span style={{ fontSize: "12px", color: "#64748b" }}>
              Randomizes unassigned students & auto-assigns matching trainers
            </span>
          </div>

          <div className="shuffle-divider" aria-hidden="true" />

          {/* Batch Selector */}
          <div className="shuffle-batch-picker">
            <label
              htmlFor="select-batch"
              style={{ fontSize: "13px", fontWeight: "600", color: "#334155" }}
            >
              Target Batch:
            </label>
            <select
              className="shuffle-batch-select"
              disabled={shuffling || loading || batches.length === 0}
              id="select-batch"
              onChange={(e) => setSelectedBatchId(e.target.value)}
              value={selectedBatchId}
            >
              {batches.length === 0 ? (
                <option value="">No active batches</option>
              ) : (
                batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batch_name} ({b.capacity} cap)
                  </option>
                ))
              )}
            </select>

            <button
              className="secondary-action-button"
              disabled={shuffling || loading || !selectedBatchId}
              onClick={handleShuffleBatch}
              type="button"
              style={{ height: "42px", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              {shuffling && activeAction === "batch" ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  Shuffling…
                </>
              ) : (
                <>
                  <span aria-hidden="true">🎯</span>
                  Shuffle Selected Batch
                </>
              )}
            </button>
          </div>

          <div className="shuffle-divider" aria-hidden="true" />

          {/* Course Selector */}
          <div className="shuffle-batch-picker">
            <label
              htmlFor="select-course-shuffle"
              style={{ fontSize: "13px", fontWeight: "600", color: "#334155" }}
            >
              Target Course:
            </label>
            <select
              className="shuffle-batch-select"
              disabled={shuffling || loading || courses.length === 0}
              id="select-course-shuffle"
              onChange={(e) => setSelectedCourseShuffleId(e.target.value)}
              value={selectedCourseShuffleId}
            >
              {courses.length === 0 ? (
                <option value="">No courses available</option>
              ) : (
                courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.role_name}
                  </option>
                ))
              )}
            </select>

            <button
              className="secondary-action-button"
              disabled={shuffling || loading || !selectedCourseShuffleId}
              onClick={handleShuffleCourse}
              type="button"
              style={{ height: "42px", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              {shuffling && activeAction === "course" ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  Shuffling…
                </>
              ) : (
                <>
                  <span aria-hidden="true">🎓</span>
                  Shuffle Course
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* KPI Metric Cards */}
      <section className="kpi-grid">
        <article className="kpi-card">
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
            <p className="kpi-value">{loading ? "…" : stats.totalStudents}</p>
            <span className="kpi-detail">Enrolled</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6 9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Assigned Students</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.assignedStudents}</p>
            <span
              className="kpi-detail"
              style={{
                color: "#059669",
                background: "#ecfdf5",
                padding: "2px 6px",
                borderRadius: "4px",
                fontWeight: "600",
              }}
            >
              {stats.totalStudents > 0
                ? `${Math.round((stats.assignedStudents / stats.totalStudents) * 100)}% Placed`
                : "0%"}
            </span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Unassigned Students</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.unassignedStudents}</p>
            <span className="kpi-detail">Awaiting batch</span>
          </div>
        </article>

        <article className="kpi-card">
          <div
            className="kpi-icon"
            style={{ background: "#ede9fe", color: "#6d28d9" }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </div>
          <p className="kpi-label">Active Batches & Trainers</p>
          <div className="kpi-value-row">
            <p className="kpi-value" style={{ fontSize: "20px" }}>
              {batches.length} <span style={{ fontSize: "14px", fontWeight: "500", color: "#64748b" }}>Batches</span>
            </p>
            <span className="kpi-detail">{stats.totalTrainers ?? 0} Trainers</span>
          </div>
        </article>
      </section>

      {/* Interactive Filter & Search Bar */}
      <section className="shuffle-filter-deck">
        <div className="shuffle-search-wrap">
          <svg className="shuffle-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" strokeWidth="2" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" />
          </svg>
          <input
            type="search"
            className="shuffle-search-input"
            placeholder="Search student, course, batch, or trainer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Dynamic Course Filter Chips */}
        <div className="shuffle-chip-group">
          <button
            type="button"
            className={`shuffle-chip-btn ${selectedCourseFilter === "ALL" ? "active" : ""}`}
            onClick={() => setSelectedCourseFilter("ALL")}
          >
            All Courses ({assignments.length})
          </button>
          {uniqueCourses.map((c) => {
            const cnt = assignments.filter((a) => (a.course_name || a.role_name) === c).length;
            return (
              <button
                key={c}
                type="button"
                className={`shuffle-chip-btn ${selectedCourseFilter === c ? "active" : ""}`}
                onClick={() => setSelectedCourseFilter(c)}
              >
                {c} ({cnt})
              </button>
            );
          })}
        </div>

        {/* Trainer Filter Dropdown */}
        {uniqueTrainers.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="trainer-filter" style={{ fontSize: "12px", fontWeight: "600", color: "#64748b" }}>
              Trainer:
            </label>
            <select
              id="trainer-filter"
              value={selectedTrainerFilter}
              onChange={(e) => setSelectedTrainerFilter(e.target.value)}
              style={{
                height: "36px",
                padding: "0 10px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
                color: "#1e293b",
                background: "#fff",
              }}
            >
              <option value="ALL">All Trainers ({uniqueTrainers.length})</option>
              {uniqueTrainers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Assignment Results Table */}
      <section className="recent-students-card management-table-card">
        <div className="section-heading">
          <div>
            <h2>Student & Trainer Assignment Results</h2>
            <p>Students placed into training batches with their directly assigned trainers</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="section-count">
              Showing {filteredAssignments.length} of {assignments.length} assignments
            </span>
          </div>
        </div>

        <div className="students-table-wrap">
          <table className="students-table management-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Course</th>
                <th scope="col">Assigned Batch</th>
                <th scope="col">Assigned Trainer</th>
                <th scope="col">Trainer Specialization</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan="7">
                    {shuffling
                      ? "Processing shuffle operations…"
                      : searchQuery || selectedCourseFilter !== "ALL" || selectedTrainerFilter !== "ALL"
                        ? "No assignments matching current filters."
                        : "No student assignments yet. Click 'Shuffle All Batches' above to distribute students."}
                  </td>
                </tr>
              ) : (
                filteredAssignments.map((item, index) => {
                  const initials = (item.student_name || "S")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <tr key={`${item.student_id}-${item.batch_id}-${index}`}>
                      {/* Student Info */}
                      <td>
                        <div className="shuffle-student-cell">
                          <div className="shuffle-student-avatar" aria-hidden="true">
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{item.student_name}</div>
                            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                              ID: {item.student_id ? String(item.student_id).slice(0, 8) : "—"}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Course */}
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            border: "1px solid #dbeafe",
                            padding: "3px 10px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                          }}
                        >
                          {item.course_name || item.role_name}
                        </span>
                      </td>

                      {/* Batch */}
                      <td>
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>{item.batch_name}</div>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          {item.batch_type === "all_role" ? "All-Courses Batch" : "Course-Wise Batch"}
                        </span>
                      </td>

                      {/* Directly Assigned Trainer */}
                      <td>
                        <div className="shuffle-trainer-box">
                          <div className="shuffle-trainer-name">
                            <span
                              style={{
                                width: "20px",
                                height: "20px",
                                borderRadius: "50%",
                                background: "#fef3c7",
                                color: "#b45309",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "10px",
                                fontWeight: "700",
                              }}
                            >
                              T
                            </span>
                            {item.trainer_name || "Unassigned"}
                          </div>
                          {item.trainer_email && item.trainer_email !== "—" && (
                            <div className="shuffle-trainer-meta">{item.trainer_email}</div>
                          )}
                        </div>
                      </td>

                      {/* Trainer Specialization */}
                      <td>
                        <span className="shuffle-trainer-spec">
                          {item.trainer_specialization || "General"}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        <span className="shuffle-status-tag">Assigned</span>
                      </td>

                      {/* Row Action */}
                      <td>
                        <button
                          type="button"
                          className="table-action-button"
                          onClick={() => setSelectedStudentDetail(item)}
                          title="View complete assignment details"
                          style={{ fontSize: "12px" }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unassigned Students Section */}
      {unassignedList.length > 0 && (
        <section
          className="recent-students-card management-table-card"
          style={{ borderLeft: "4px solid #f59e0b" }}
        >
          <div className="section-heading">
            <div>
              <h2 style={{ color: "#b45309" }}>
                Unassigned Students ({unassignedList.length})
              </h2>
              <p>Students awaiting batch allocation or blocked by capacity constraints</p>
            </div>
            <div>
              <Link
                to="/batches"
                className="secondary-action-button"
                style={{ fontSize: "12px", textDecoration: "none" }}
              >
                + Create More Batches
              </Link>
            </div>
          </div>
          <div className="students-table-wrap">
            <table className="students-table management-table">
              <thead>
                <tr>
                  <th scope="col">Student Name</th>
                  <th scope="col">Course</th>
                  <th scope="col">Reason / Next Action</th>
                </tr>
              </thead>
              <tbody>
                {unassignedList.map((item, index) => (
                  <tr key={`${item.student_id}-${index}`}>
                    <td style={{ fontWeight: 600 }}>{item.student_name}</td>
                    <td>{item.course_name || item.role_name}</td>
                    <td style={{ color: "#d97706", fontWeight: 600, fontSize: "12px" }}>
                      {item.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Inspect Student Detail Modal */}
      {selectedStudentDetail && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedStudentDetail(null);
          }}
        >
          <section
            aria-labelledby="student-inspect-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "500px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">ASSIGNMENT INSPECTION</p>
                <h2 id="student-inspect-title">{selectedStudentDetail.student_name}</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setSelectedStudentDetail(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "8px 0 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>
                  Enrolled Course
                </div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b", marginTop: "2px" }}>
                  {selectedStudentDetail.course_name || selectedStudentDetail.role_name}
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>
                  Training Batch
                </div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b", marginTop: "2px" }}>
                  {selectedStudentDetail.batch_name}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Type: {selectedStudentDetail.batch_type === "all_role" ? "All Courses" : "Role-Wise"}
                </div>
              </div>

              <div style={{ background: "#f0fdf4", padding: "12px", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#166534", textTransform: "uppercase" }}>
                  Directly Assigned Trainer
                </div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#14532d", marginTop: "2px" }}>
                  {selectedStudentDetail.trainer_name}
                </div>
                <div style={{ fontSize: "12px", color: "#166534", marginTop: "4px" }}>
                  Email: {selectedStudentDetail.trainer_email || "—"}
                </div>
                <div style={{ fontSize: "12px", color: "#166534", marginTop: "2px" }}>
                  Specialization: {selectedStudentDetail.trainer_specialization || "General"}
                </div>
              </div>
            </div>

            <div className="management-modal-actions">
              <button
                className="secondary-action-button"
                onClick={() => setSelectedStudentDetail(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Shuffle Operation Summary Celebration Modal */}
      {lastSummaryModal && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLastSummaryModal(null);
          }}
        >
          <section
            aria-labelledby="summary-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "520px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow" style={{ color: "#059669" }}>OPERATION SUMMARY</p>
                <h2 id="summary-dialog-title">{lastSummaryModal.title}</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setLastSummaryModal(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "6px 0 16px" }}>
              <p style={{ fontSize: "14px", color: "#334155", lineHeight: "1.5", marginBottom: "16px" }}>
                {lastSummaryModal.message || "Students have been distributed fairly based on course matching and capacity limits."}
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "10px",
                  background: "#f8fafc",
                  padding: "14px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: "#059669" }}>
                    {lastSummaryModal.newlyAssigned}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Placed Students</div>
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: "#2563eb" }}>
                    {lastSummaryModal.trainersAssigned ?? 0}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Trainers Assigned</div>
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: lastSummaryModal.unassignedCount > 0 ? "#d97706" : "#64748b" }}>
                    {lastSummaryModal.unassignedCount}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Unassigned</div>
                </div>
              </div>
            </div>

            <div className="management-modal-actions">
              <button
                className="primary-action-button"
                onClick={() => setLastSummaryModal(null)}
                type="button"
              >
                Got It
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default Shuffle;
