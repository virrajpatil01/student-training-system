import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function isUrl(str) {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  return s.startsWith("http://") || s.startsWith("https://") || s.includes("zoom.us") || s.includes("meet.google");
}

const MODE_OPTIONS = ["Online", "Offline", "Hybrid"];

function Schedules() {
  const [batches, setBatches] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyScheduleId, setBusyScheduleId] = useState(null);

  // Search & Filter & View state
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [batchFilter, setBatchFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("date_desc");
  const [viewMode, setViewMode] = useState("cards"); // 'cards' | 'table'
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Form state
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [batchId, setBatchId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [mode, setMode] = useState("Online");
  const [location, setLocation] = useState("");

  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  const formRef = useRef(null);

  // Fetch batches and schedules from Supabase
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session) {
        setLoadError("Your Supabase login session is missing. Please log in again.");
        return;
      }

      // 1. Fetch batches
      const { data: batchesData, error: batchesError } = await supabase
        .from("batches")
        .select("id, batch_name, status")
        .order("batch_name", { ascending: true });

      if (batchesError) throw batchesError;

      const activeBatches = (batchesData || []).filter(
        (b) => String(b.status || "").toLowerCase() !== "cancelled",
      );
      setBatches(activeBatches);

      // 2. Fetch schedules
      const { data: schedulesData, error: schedulesError } = await supabase
        .from("schedules")
        .select("id, batch_id, start_date, end_date, start_time, end_time, mode, location, created_at")
        .order("start_date", { ascending: false });

      if (schedulesError) throw schedulesError;

      // Map batch_name
      const batchesMap = new Map((batchesData || []).map((b) => [String(b.id), b.batch_name]));
      const enrichedSchedules = (schedulesData || []).map((s) => ({
        ...s,
        batchName: batchesMap.get(String(s.batch_id)) || "Unknown Batch",
      }));

      setSchedules(enrichedSchedules);
    } catch (err) {
      console.error("Unable to load schedules data:", err?.message || err);
      setLoadError(
        err?.message?.includes("security policy")
          ? "Unable to access schedules due to database security policies. Please check RLS."
          : "Unable to load batch schedules. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function resetForm() {
    setEditingScheduleId(null);
    setBatchId("");
    setStartDate("");
    setEndDate("");
    setStartTime("");
    setEndTime("");
    setMode("Online");
    setLocation("");
    setFormError("");
    setShowForm(false);
  }

  function handleEdit(schedule) {
    setNotice("");
    setFormError("");
    setEditingScheduleId(schedule.id);
    setBatchId(schedule.batch_id || "");
    setStartDate(schedule.start_date || "");
    setEndDate(schedule.end_date || "");
    setStartTime(schedule.start_time ? String(schedule.start_time).slice(0, 5) : "");
    setEndTime(schedule.end_time ? String(schedule.end_time).slice(0, 5) : "");
    setMode(schedule.mode || "Online");
    setLocation(schedule.location || "");
    setShowForm(true);

    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }

  async function handleCopyLocation(id, loc) {
    if (!loc) return;
    try {
      await navigator.clipboard.writeText(loc);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    // 1. Required field checks
    if (!batchId) {
      setFormError("Please select a batch.");
      return;
    }
    if (!startDate) {
      setFormError("Start date is required.");
      return;
    }
    if (!endDate) {
      setFormError("End date is required.");
      return;
    }
    if (!startTime) {
      setFormError("Start time is required.");
      return;
    }
    if (!endTime) {
      setFormError("End time is required.");
      return;
    }
    if (!mode) {
      setFormError("Mode is required.");
      return;
    }

    // 2. Date validation: end_date must not be before start_date
    if (endDate < startDate) {
      setFormError("End date cannot be earlier than start date.");
      return;
    }

    // 3. Time validation: if start_date === end_date, end_time must be later than start_time
    if (startDate === endDate && endTime <= startTime) {
      setFormError("End time must be later than start time for same-day schedules.");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setFormError("Your Supabase login session is missing. Please log in again.");
        return;
      }

      const payload = {
        batch_id: batchId,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
        end_time: endTime.length === 5 ? `${endTime}:00` : endTime,
        mode: mode,
        location: location.trim() || null,
      };

      if (editingScheduleId) {
        const { error } = await supabase
          .from("schedules")
          .update(payload)
          .eq("id", editingScheduleId);

        if (error) throw error;
        setNotice("Schedule updated successfully.");
      } else {
        const { error } = await supabase
          .from("schedules")
          .insert(payload);

        if (error) throw error;
        setNotice("Schedule saved successfully.");
      }

      resetForm();
      await loadData();
    } catch (err) {
      console.error("Unable to save schedule:", err);
      if (err.message && err.message.includes("security policy")) {
        setFormError(
          "Permission denied by database security policy. Please ensure authenticated RLS policies are applied to public.schedules.",
        );
      } else {
        setFormError(err.message || "Unable to save schedule. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(schedule) {
    setNotice("");
    setLoadError("");

    if (!window.confirm(`Are you sure you want to delete the schedule for "${schedule.batchName}"?`)) {
      return;
    }

    setBusyScheduleId(schedule.id);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setLoadError("Your Supabase login session is missing. Please log in again.");
        return;
      }

      const { error } = await supabase
        .from("schedules")
        .delete()
        .eq("id", schedule.id);

      if (error) throw error;

      setNotice("Schedule deleted successfully.");
      if (editingScheduleId === schedule.id) {
        resetForm();
      }
      await loadData();
    } catch (err) {
      console.error("Unable to delete schedule:", err);
      setLoadError(err.message || "Unable to delete schedule. Please try again.");
    } finally {
      setBusyScheduleId(null);
    }
  }

  // KPIs
  const stats = useMemo(() => {
    let online = 0;
    let offline = 0;
    let hybrid = 0;
    schedules.forEach((s) => {
      const m = String(s.mode || "").toLowerCase();
      if (m === "online") online++;
      else if (m === "offline") offline++;
      else if (m === "hybrid") hybrid++;
    });
    return {
      total: schedules.length,
      online,
      offline,
      hybrid,
    };
  }, [schedules]);

  // Filtered & Sorted Schedules
  const filteredSchedules = useMemo(() => {
    let list = [...schedules];

    // Filter by mode
    if (modeFilter !== "ALL") {
      list = list.filter((s) => String(s.mode || "").toLowerCase() === modeFilter.toLowerCase());
    }

    // Filter by batch
    if (batchFilter !== "ALL") {
      list = list.filter((s) => String(s.batch_id) === batchFilter);
    }

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.batchName?.toLowerCase().includes(q) ||
          s.location?.toLowerCase().includes(q) ||
          s.mode?.toLowerCase().includes(q),
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "date_asc") {
        return (a.start_date || "").localeCompare(b.start_date || "");
      }
      if (sortBy === "date_desc") {
        return (b.start_date || "").localeCompare(a.start_date || "");
      }
      if (sortBy === "batch_asc") {
        return (a.batchName || "").localeCompare(b.batchName || "");
      }
      return 0;
    });

    return list;
  }, [schedules, modeFilter, batchFilter, search, sortBy]);

  return (
    <section className="dashboard-content management-page">
      {/* Page Heading Row */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Batch Scheduling</h1>
          <p className="dashboard-welcome">
            Plan, coordinate, and supervise training cohorts, meeting rooms, and timing sessions.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="primary-action-button"
            onClick={() => {
              setShowForm((prev) => !prev);
              if (!showForm && editingScheduleId) resetForm();
            }}
            type="button"
          >
            <span aria-hidden="true">{showForm ? "✕" : "+"}</span>{" "}
            {showForm ? "Close Form" : "Schedule Session"}
          </button>
        </div>
      </div>

      {loadError && (
        <p className="admin-alert" role="alert">
          {loadError}
        </p>
      )}
      {notice && (
        <p className="management-notice" role="status">
          {notice}
        </p>
      )}

      {/* Top Metric Summary Cards */}
      <div className="batches-kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Total Schedules</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.total}</p>
            <span className="kpi-detail">Active</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Online Sessions</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.online}</p>
            <span className="kpi-detail">Virtual</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Offline Sessions</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.offline}</p>
            <span className="kpi-detail">On Campus</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Hybrid Sessions</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.hybrid}</p>
            <span className="kpi-detail">Blended</span>
          </div>
        </article>
      </div>

      {/* Schedule Form Card (Collapsible or when editing) */}
      {(showForm || editingScheduleId) && (
        <section className="schedule-form-card" ref={formRef} style={{ animation: "fadeIn 0.2s ease" }}>
          <div className="schedule-form-heading">
            <h2>{editingScheduleId ? "Edit Batch Schedule" : "Create New Batch Schedule"}</h2>
            <button
              className="table-action"
              onClick={resetForm}
              type="button"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="schedule-form-grid">
              <div className="management-form-field">
                <label htmlFor="schedule-batch">Target Batch *</label>
                <select
                  id="schedule-batch"
                  onChange={(e) => setBatchId(e.target.value)}
                  required
                  value={batchId}
                >
                  <option value="">Select Batch</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="management-form-field">
                <label htmlFor="schedule-mode">Delivery Mode *</label>
                <select
                  id="schedule-mode"
                  onChange={(e) => setMode(e.target.value)}
                  required
                  value={mode}
                >
                  {MODE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="management-form-field">
                <label htmlFor="schedule-location">Location / Meeting URL</label>
                <input
                  id="schedule-location"
                  maxLength={200}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Lab 402 or https://zoom.us/j/..."
                  value={location}
                />
              </div>

              <div className="management-form-field">
                <label htmlFor="schedule-start-date">Start Date *</label>
                <input
                  id="schedule-start-date"
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  type="date"
                  value={startDate}
                />
              </div>

              <div className="management-form-field">
                <label htmlFor="schedule-end-date">End Date *</label>
                <input
                  id="schedule-end-date"
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  type="date"
                  value={endDate}
                />
              </div>

              <div className="management-form-field">
                <label htmlFor="schedule-start-time">Start Time *</label>
                <input
                  id="schedule-start-time"
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  type="time"
                  value={startTime}
                />
              </div>

              <div className="management-form-field">
                <label htmlFor="schedule-end-time">End Time *</label>
                <input
                  id="schedule-end-time"
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  type="time"
                  value={endTime}
                />
              </div>
            </div>

            {formError && (
              <p className="admin-alert" role="alert" style={{ marginBottom: "16px" }}>
                {formError}
              </p>
            )}

            <div className="schedule-form-actions">
              <button
                className="primary-action-button"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? "Saving…"
                  : editingScheduleId
                    ? "Update Schedule"
                    : "Save Schedule"}
              </button>
              <button
                className="secondary-action-button"
                disabled={saving}
                onClick={resetForm}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Interactive Controls Toolbar */}
      <section className="batches-controls-card">
        <div className="batches-controls-row">
          {/* Search Box */}
          <div className="batches-search-box">
            <svg
              className="batches-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by batch, room, or link…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="batches-search-clear"
                onClick={() => setSearch("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Mode Filter */}
          <div className="batches-filter-group">
            <label htmlFor="sched-mode-filter">Mode:</label>
            <select
              id="sched-mode-filter"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
            >
              <option value="ALL">All Modes</option>
              <option value="Online">Online</option>
              <option value="Offline">Offline</option>
              <option value="Hybrid">Hybrid</option>
            </select>
          </div>

          {/* Batch Filter */}
          <div className="batches-filter-group">
            <label htmlFor="sched-batch-filter">Batch:</label>
            <select
              id="sched-batch-filter"
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
            >
              <option value="ALL">All Batches</option>
              {batches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.batch_name}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Control */}
          <div className="batches-filter-group">
            <label htmlFor="sched-sort">Sort:</label>
            <select
              id="sched-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="date_desc">Start Date (Newest first)</option>
              <option value="date_asc">Start Date (Earliest first)</option>
              <option value="batch_asc">Batch Name (A-Z)</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="batches-filter-group" style={{ marginLeft: "auto" }}>
            <div className="view-mode-toggle" style={{ display: "inline-flex", gap: "4px", background: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: viewMode === "cards" ? "#ffffff" : "transparent",
                  color: viewMode === "cards" ? "#0f172a" : "#64748b",
                  boxShadow: viewMode === "cards" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: viewMode === "table" ? "#ffffff" : "transparent",
                  color: viewMode === "table" ? "#0f172a" : "#64748b",
                  boxShadow: viewMode === "table" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                Table
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Content Rendering: Cards View or Table View */}
      {viewMode === "cards" ? (
        <>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
              Loading schedules…
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "48px 24px",
                background: "#ffffff",
                borderRadius: "12px",
                border: "1px dashed #cbd5e1",
                color: "#64748b",
                marginBottom: "28px",
              }}
            >
              <p style={{ fontSize: "16px", fontWeight: "600", color: "#334155", margin: "0 0 8px 0" }}>
                No batch schedules found
              </p>
              <p style={{ margin: "0 0 16px 0", fontSize: "14px" }}>
                {search || modeFilter !== "ALL" || batchFilter !== "ALL"
                  ? "Try adjusting your filters or search query."
                  : "Click '+ Schedule Session' above to schedule your first cohort."}
              </p>
              {!showForm && (
                <button
                  className="primary-action-button"
                  onClick={() => setShowForm(true)}
                  type="button"
                >
                  + Schedule Session
                </button>
              )}
            </div>
          ) : (
            <div className="schedules-grid">
              {filteredSchedules.map((schedule) => {
                const normMode = String(schedule.mode || "Online").toLowerCase();
                const modeClass =
                  normMode === "offline"
                    ? "schedule-mode-offline"
                    : normMode === "hybrid"
                    ? "schedule-mode-hybrid"
                    : "schedule-mode-online";
                const isLocationUrl = isUrl(schedule.location);
                const isCopied = copiedId === schedule.id;

                return (
                  <article key={schedule.id} className="schedule-card">
                    <div>
                      {/* Header */}
                      <div className="schedule-card-header">
                        <h3 className="schedule-batch-title">{schedule.batchName}</h3>
                        <span className={`schedule-mode-badge ${modeClass}`}>
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: "currentColor",
                            }}
                          />
                          {schedule.mode || "Online"}
                        </span>
                      </div>

                      {/* Meta info */}
                      <div className="schedule-meta-list">
                        <div className="schedule-meta-row">
                          <svg className="schedule-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          <span>
                            {formatDate(schedule.start_date)} – {formatDate(schedule.end_date)}
                          </span>
                        </div>

                        <div className="schedule-meta-row">
                          <svg className="schedule-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          <span>
                            {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                          </span>
                        </div>
                      </div>

                      {/* Location Box */}
                      {schedule.location ? (
                        <div className="schedule-location-box">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                            <svg
                              style={{ width: "16px", height: "16px", flexShrink: 0, color: "#64748b" }}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              {isLocationUrl ? (
                                <path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72" />
                              ) : (
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
                              )}
                            </svg>
                            <span className="schedule-location-text" title={schedule.location}>
                              {schedule.location}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {isLocationUrl && (
                              <a
                                href={schedule.location.startsWith("http") ? schedule.location : `https://${schedule.location}`}
                                target="_blank"
                                rel="noreferrer"
                                className="schedule-join-btn"
                              >
                                Join
                              </a>
                            )}
                            <button
                              type="button"
                              className="schedule-copy-btn"
                              onClick={() => handleCopyLocation(schedule.id, schedule.location)}
                              title={isCopied ? "Copied!" : "Copy location/link"}
                            >
                              {isCopied ? (
                                <span style={{ fontSize: "11px", fontWeight: "700", color: "#16a34a" }}>✓</span>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            background: "#f8fafc",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            fontSize: "12px",
                            color: "#94a3b8",
                            fontStyle: "italic",
                            marginBottom: "14px",
                          }}
                        >
                          No location / room specified
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="schedule-card-actions">
                      <button
                        className="table-action"
                        onClick={() => handleEdit(schedule)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="table-action table-action-danger"
                        disabled={busyScheduleId === schedule.id}
                        onClick={() => handleDelete(schedule)}
                        type="button"
                      >
                        {busyScheduleId === schedule.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Table View */
        <section className="recent-students-card management-table-card">
          <div className="section-heading">
            <div>
              <h2>Existing Schedules</h2>
              <p>Tabular view of all scheduled training batches and sessions</p>
            </div>
            <span className="section-count">
              {filteredSchedules.length} of {schedules.length} {schedules.length === 1 ? "schedule" : "schedules"}
            </span>
          </div>
          <div className="students-table-wrap">
            <table className="students-table management-table">
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Start Date</th>
                  <th scope="col">End Date</th>
                  <th scope="col">Start Time</th>
                  <th scope="col">End Time</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Location / Link</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="8">
                      Loading schedules…
                    </td>
                  </tr>
                ) : filteredSchedules.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="8">
                      No matching schedules found.
                    </td>
                  </tr>
                ) : (
                  filteredSchedules.map((schedule) => {
                    const normMode = String(schedule.mode || "Online").toLowerCase();
                    const modeClass =
                      normMode === "offline"
                        ? "schedule-mode-offline"
                        : normMode === "hybrid"
                        ? "schedule-mode-hybrid"
                        : "schedule-mode-online";
                    const isLocationUrl = isUrl(schedule.location);
                    const isCopied = copiedId === schedule.id;

                    return (
                      <tr key={schedule.id}>
                        <td>
                          <strong>{schedule.batchName}</strong>
                        </td>
                        <td>{formatDate(schedule.start_date)}</td>
                        <td>{formatDate(schedule.end_date)}</td>
                        <td>{formatTime(schedule.start_time)}</td>
                        <td>{formatTime(schedule.end_time)}</td>
                        <td>
                          <span className={`schedule-mode-badge ${modeClass}`}>
                            <span
                              style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                background: "currentColor",
                              }}
                            />
                            {schedule.mode || "Online"}
                          </span>
                        </td>
                        <td>
                          {schedule.location ? (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", maxWidth: "220px" }}>
                              <span
                                style={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontSize: "13px",
                                }}
                                title={schedule.location}
                              >
                                {schedule.location}
                              </span>
                              {isLocationUrl && (
                                <a
                                  href={schedule.location.startsWith("http") ? schedule.location : `https://${schedule.location}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="schedule-join-btn"
                                  style={{ padding: "2px 6px", fontSize: "11px" }}
                                >
                                  Join
                                </a>
                              )}
                              <button
                                type="button"
                                className="schedule-copy-btn"
                                onClick={() => handleCopyLocation(schedule.id, schedule.location)}
                                title={isCopied ? "Copied!" : "Copy"}
                              >
                                {isCopied ? "✓" : "📋"}
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>
                        <td>
                          <div className="management-actions">
                            <button
                              className="table-action"
                              onClick={() => handleEdit(schedule)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="table-action table-action-danger"
                              disabled={busyScheduleId === schedule.id}
                              onClick={() => handleDelete(schedule)}
                              type="button"
                            >
                              {busyScheduleId === schedule.id ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

export default Schedules;
