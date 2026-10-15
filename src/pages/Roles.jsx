import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase";
import { filterSystemRoles } from "../config/formConfig";

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

function getErrorMessage(error) {
  return typeof error?.message === "string"
    ? error.message
    : "An unexpected error occurred.";
}

function getLocalCourseMeta(roleId) {
  try {
    const raw = localStorage.getItem(`course_meta_${roleId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLocalCourseMeta(roleId, meta) {
  try {
    localStorage.setItem(`course_meta_${roleId}`, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

function Roles() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  // Search & Sort & View Mode
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name_asc");
  const [viewMode, setViewMode] = useState("cards"); // 'cards' | 'table'

  // Dialog State (Add / Edit)
  const [dialogRole, setDialogRole] = useState(undefined);
  const [roleName, setRoleName] = useState("");
  const [roleCapacity, setRoleCapacity] = useState(40);
  const [roleDescription, setRoleDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState(null);

  // Course Details Modal State
  const [selectedRole, setSelectedRole] = useState(null);
  const [courseStudents, setCourseStudents] = useState([]);
  const [courseBatches, setCourseBatches] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsSearch, setDetailsSearch] = useState("");

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      let roleRows = [];
      try {
        const fullRoleRes = await supabase
          .from("roles")
          .select("id, role_name, capacity, description, created_at")
          .order("role_name", { ascending: true });
        if (fullRoleRes.error) throw fullRoleRes.error;
        roleRows = fullRoleRes.data || [];
      } catch {
        const fallbackRes = await supabase
          .from("roles")
          .select("id, role_name, created_at")
          .order("role_name", { ascending: true });
        if (fallbackRes.error) throw fallbackRes.error;
        roleRows = fallbackRes.data || [];
      }

      roleRows = filterSystemRoles(roleRows);

      const [studentsRes, batchesRes] = await Promise.all([
        supabase.from("students").select("id, name, role_id, created_at").order("created_at", { ascending: false }),
        supabase.from("batches").select("id, batch_name, role_id, capacity, status"),
      ]);

      if (studentsRes.error) throw studentsRes.error;

      const allStudents = studentsRes.data || [];
      const allBatches = batchesRes.data || [];

      // Map student counts and batch counts
      const studentMap = new Map();
      allStudents.forEach((s) => {
        if (s.role_id) {
          const rId = String(s.role_id);
          studentMap.set(rId, (studentMap.get(rId) || 0) + 1);
        }
      });

      const batchMap = new Map();
      allBatches.forEach((b) => {
        if (b.role_id) {
          const rId = String(b.role_id);
          batchMap.set(rId, (batchMap.get(rId) || 0) + 1);
        }
      });

      const enrichedRoles = roleRows.map((r) => {
        const meta = getLocalCourseMeta(r.id);
        const parsedCap = Number(r.capacity) || Number(meta?.capacity) || 40;
        const parsedDesc = r.description || meta?.description || "";
        return {
          ...r,
          capacity: parsedCap,
          description: parsedDesc,
          studentCount: studentMap.get(String(r.id)) || 0,
          batchCount: batchMap.get(String(r.id)) || 0,
        };
      });

      setRoles(enrichedRoles);
    } catch (error) {
      console.error("Unable to load roles:", error);
      setRoles([]);
      setLoadError("Unable to load courses. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  // Realtime subscription for automatic updates
  useEffect(() => {
    const channel = supabase
      .channel("roles-page-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "roles" }, () => loadRoles())
      .on("postgres_changes", { event: "*", schema: "public", table: "students" }, () => loadRoles())
      .on("postgres_changes", { event: "*", schema: "public", table: "batches" }, () => loadRoles())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRoles]);

  // Open course details modal and load students and batches for that course
  async function handleCourseClick(role) {
    setSelectedRole(role);
    setDetailsSearch("");
    setDetailsLoading(true);

    try {
      const [stuRes, batRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, name, created_at")
          .eq("role_id", role.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("batches")
          .select("id, batch_name, capacity, status")
          .eq("role_id", role.id)
          .order("batch_name", { ascending: true }),
      ]);

      setCourseStudents(stuRes.data || []);
      setCourseBatches(batRes.data || []);
    } catch (err) {
      console.error("Error loading course details:", err);
      setCourseStudents([]);
      setCourseBatches([]);
    } finally {
      setDetailsLoading(false);
    }
  }

  // Filtered & Sorted roles
  const filteredRoles = useMemo(() => {
    let result = [...roles];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) => r.role_name.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "name_asc":
          return a.role_name.localeCompare(b.role_name);
        case "name_desc":
          return b.role_name.localeCompare(a.role_name);
        case "students_desc":
          return b.studentCount - a.studentCount;
        case "students_asc":
          return a.studentCount - b.studentCount;
        case "newest":
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        default:
          return 0;
      }
    });

    return result;
  }, [roles, search, sortBy]);

  // Metrics
  const totalCourses = roles.length;
  const totalEnrolled = roles.reduce((acc, r) => acc + (r.studentCount || 0), 0);
  const avgStudents = totalCourses > 0 ? Math.round(totalEnrolled / totalCourses) : 0;
  const totalBatchesCount = roles.reduce((acc, r) => acc + (r.batchCount || 0), 0);

  function openAddDialog() {
    setDialogRole(null);
    setRoleName("");
    setRoleCapacity(40);
    setRoleDescription("");
    setFormError("");
    setNotice("");
  }

  function openEditDialog(role) {
    setDialogRole(role);
    setRoleName(role.role_name || "");
    setRoleCapacity(role.capacity || 40);
    setRoleDescription(role.description || "");
    setFormError("");
    setNotice("");
  }

  function closeDialog() {
    if (saving) return;
    setDialogRole(undefined);
    setFormError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    const normalizedName = roleName.trim();
    if (!normalizedName) {
      setFormError("Course name is required.");
      return;
    }
    if (normalizedName.length < 2) {
      setFormError("Course name must be at least 2 characters.");
      return;
    }

    const capNum = Math.max(1, parseInt(roleCapacity, 10) || 40);
    const descTrim = (roleDescription || "").trim();

    setSaving(true);
    try {
      const { data: existingRoles, error: checkError } = await supabase
        .from("roles")
        .select("id, role_name");

      if (checkError) throw checkError;

      const cleanExisting = filterSystemRoles(existingRoles || []);
      const duplicate = cleanExisting.some(
        (role) =>
          String(role.id) !== String(dialogRole?.id) &&
          role.role_name.trim().toLowerCase() === normalizedName.toLowerCase(),
      );

      if (duplicate) {
        setFormError("A course with this name already exists.");
        return;
      }

      if (dialogRole) {
        let updatedRole = null;
        try {
          const { data, error } = await supabase
            .from("roles")
            .update({ role_name: normalizedName, capacity: capNum, description: descTrim })
            .eq("id", dialogRole.id)
            .select("id")
            .maybeSingle();
          if (error) throw error;
          updatedRole = data;
        } catch {
          const { data, error } = await supabase
            .from("roles")
            .update({ role_name: normalizedName })
            .eq("id", dialogRole.id)
            .select("id")
            .maybeSingle();
          if (error) {
            setFormError(error.message);
            return;
          }
          updatedRole = data;
        }

        if (!updatedRole) {
          setFormError("No course was updated. Please check permissions.");
          return;
        }
        setLocalCourseMeta(dialogRole.id, { capacity: capNum, description: descTrim });
      } else {
        let newRole = null;
        try {
          const { data, error } = await supabase
            .from("roles")
            .insert({ role_name: normalizedName, capacity: capNum, description: descTrim })
            .select()
            .single();
          if (error) throw error;
          newRole = data;
        } catch {
          const { data, error } = await supabase
            .from("roles")
            .insert({ role_name: normalizedName })
            .select()
            .single();
          if (error) {
            setFormError(error.message);
            return;
          }
          newRole = data;
        }

        if (!newRole) {
          setFormError("Failed to add course. Please check permissions.");
          return;
        }
        setLocalCourseMeta(newRole.id, { capacity: capNum, description: descTrim });
      }

      setDialogRole(undefined);
      setNotice(
        dialogRole ? "Course updated successfully." : "Course added successfully.",
      );
      setLoading(true);
      await loadRoles();
    } catch (error) {
      console.error("Unable to save course:", error);
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role) {
    setNotice("");
    setLoadError("");
    setBusyRoleId(role.id);

    try {
      const { count, error: countError } = await supabase
        .from("students")
        .select("*", { count: "exact", head: true })
        .eq("role_id", role.id);

      if (countError) throw countError;
      if (count > 0) {
        setLoadError(
          `Cannot delete "${role.role_name}" because ${count} student(s) are enrolled in it.`,
        );
        return;
      }

      if (!window.confirm(`Are you sure you want to delete course "${role.role_name}"?`)) return;

      const { data, error } = await supabase
        .from("roles")
        .delete()
        .eq("id", role.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setLoadError("Unable to delete course. Please try again.");
        return;
      }

      setNotice("Course deleted successfully.");
      if (selectedRole?.id === role.id) {
        setSelectedRole(null);
      }
      setLoading(true);
      await loadRoles();
    } catch (error) {
      console.error("Unable to delete course:", error);
      setLoadError("Unable to delete course. Please try again.");
    } finally {
      setBusyRoleId(null);
    }
  }

  const filteredModalStudents = useMemo(() => {
    if (!detailsSearch.trim()) return courseStudents;
    const q = detailsSearch.toLowerCase();
    return courseStudents.filter((s) => s.name?.toLowerCase().includes(q));
  }, [courseStudents, detailsSearch]);

  const dialogOpen = dialogRole !== undefined;

  return (
    <section className="dashboard-content management-page">
      {/* Page Heading Row */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">COURSE CATALOG</p>
          <h1>Courses</h1>
          <p className="dashboard-welcome">
            Configure training courses, monitor enrollments, and coordinate cohort offerings.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="primary-action-button"
            onClick={openAddDialog}
            type="button"
          >
            <span aria-hidden="true">+</span> Add Course
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

      {/* Top KPI Metrics Row */}
      <div className="batches-kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5l-8-3ZM9 12l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Total Courses</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalCourses}</p>
            <span className="kpi-detail">Offered</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
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
          <p className="kpi-label">Total Enrolled</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalEnrolled}</p>
            <span className="kpi-detail">Students</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
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
          <p className="kpi-label">Active Batches</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalBatchesCount}</p>
            <span className="kpi-detail">Assigned</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-violet" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Average / Course</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : avgStudents}</p>
            <span className="kpi-detail">Students avg</span>
          </div>
        </article>
      </div>

      {/* Interactive Controls Toolbar */}
      <div className="batches-controls-card">
        <div className="batches-controls-row">
          <div className="batches-search-box">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              aria-label="Search courses"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search courses by name..."
              type="search"
              value={search}
            />
            {search && (
              <button
                aria-label="Clear search"
                className="batches-search-clear"
                onClick={() => setSearch("")}
                type="button"
              >
                ✕
              </button>
            )}
          </div>

          <div className="batches-filter-group">
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Sort:</span>
              <select
                aria-label="Sort courses"
                className="batches-filter-select"
                onChange={(e) => setSortBy(e.target.value)}
                value={sortBy}
              >
                <option value="name_asc">Course Name (A → Z)</option>
                <option value="name_desc">Course Name (Z → A)</option>
                <option value="students_desc">Most Enrolled Students</option>
                <option value="students_asc">Least Enrolled Students</option>
                <option value="newest">Recently Added</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div style={{ display: "inline-flex", background: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
              <button
                className="secondary-action-button"
                onClick={() => setViewMode("cards")}
                style={{
                  minHeight: "32px",
                  padding: "0 10px",
                  border: "none",
                  borderRadius: "6px",
                  background: viewMode === "cards" ? "#ffffff" : "transparent",
                  color: viewMode === "cards" ? "#315ce8" : "#64748b",
                  boxShadow: viewMode === "cards" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}
                type="button"
              >
                Cards View
              </button>
              <button
                className="secondary-action-button"
                onClick={() => setViewMode("table")}
                style={{
                  minHeight: "32px",
                  padding: "0 10px",
                  border: "none",
                  borderRadius: "6px",
                  background: viewMode === "table" ? "#ffffff" : "transparent",
                  color: viewMode === "table" ? "#315ce8" : "#64748b",
                  boxShadow: viewMode === "table" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}
                type="button"
              >
                Table View
              </button>
            </div>
          </div>
        </div>

        <div className="batches-meta-bar">
          <span>
            Showing <strong className="batches-count-pill">{filteredRoles.length}</strong> of{" "}
            <strong>{roles.length}</strong> total courses
          </span>
          {search && (
            <button
              className="table-action"
              onClick={() => setSearch("")}
              type="button"
            >
              Reset Search
            </button>
          )}
        </div>
      </div>

      {/* Courses Display: Cards View vs Table View */}
      {loading ? (
        <div className="recent-students-card" style={{ padding: "60px 20px", textAlign: "center" }}>
          <div className="button-spinner" style={{ margin: "0 auto 16px", width: "28px", height: "28px", color: "#315ce8" }} />
          <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>Loading courses…</p>
        </div>
      ) : filteredRoles.length === 0 ? (
        <div className="batches-empty-card">
          <h2 className="batches-empty-title">No Courses Found</h2>
          <p className="batches-empty-desc">
            {search ? "No courses match your search criteria." : "Get started by adding your first training course."}
          </p>
          <button className="primary-action-button" onClick={openAddDialog} type="button">
            + Add Course
          </button>
        </div>
      ) : viewMode === "cards" ? (
        /* Cards View (3 cards per row on desktop, matching Batches style) */
        <div className="batches-grid">
          {filteredRoles.map((role) => (
            <article
              key={role.id}
              className="batch-card"
              onClick={() => handleCourseClick(role)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCourseClick(role);
                }
              }}
            >
              <div className="batch-card-header">
                <div className="batch-card-title-group">
                  <h2 className="batch-card-title">{role.role_name}</h2>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    Created {formatDate(role.created_at)}
                  </span>
                </div>
                <span className="batch-status-badge status-active">
                  <span className="batch-status-dot" aria-hidden="true" />
                  Active Course
                </span>
              </div>

              <div className="batch-card-body">
                <div className="batch-card-capacity-box">
                  <div className="batch-capacity-numbers">
                    <span className="batch-capacity-count">
                      <strong>Enrolled Students:</strong>
                    </span>
                    <span className="batch-available-seats" style={{ fontSize: "13px" }}>
                      <strong>{role.studentCount}</strong> / {role.capacity || 40} seats
                    </span>
                  </div>

                  {(() => {
                    const cap = role.capacity || 40;
                    const pct = Math.round((role.studentCount / cap) * 100);
                    const fillClass = pct >= 100 ? "fill-danger" : pct >= 80 ? "fill-warning" : "fill-normal";
                    return (
                      <>
                        <div className="batch-progress-track">
                          <div
                            className={`batch-progress-fill ${fillClass}`}
                            style={{
                              width: `${Math.min(100, role.studentCount > 0 ? Math.max(6, (role.studentCount / cap) * 100) : 0)}%`,
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                          <span>Target: {cap} seats</span>
                          <span style={{ fontWeight: 600, color: pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#2563eb" }}>
                            {pct}% filled
                          </span>
                        </div>
                      </>
                    );
                  })()}

                  {role.description && (
                    <p style={{ fontSize: "12px", color: "#64748b", margin: "8px 0 0", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.4 }}>
                      {role.description}
                    </p>
                  )}

                  <div className="batch-capacity-footer">
                    <span>{role.batchCount} assigned batch{role.batchCount === 1 ? "" : "es"}</span>
                    <span>Click for students list</span>
                  </div>
                </div>
              </div>

              <div className="batch-card-footer" onClick={(e) => e.stopPropagation()}>
                <button
                  className="batch-card-view-btn"
                  onClick={() => handleCourseClick(role)}
                  type="button"
                >
                  View Course Details →
                </button>

                <div className="batch-card-actions">
                  <button
                    className="batch-btn-subtle"
                    onClick={() => openEditDialog(role)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="batch-btn-subtle btn-danger"
                    disabled={busyRoleId === role.id}
                    onClick={() => handleDelete(role)}
                    type="button"
                  >
                    {busyRoleId === role.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        /* Table View */
        <section className="recent-students-card management-table-card">
          <div className="students-table-wrap">
            <table className="students-table management-table">
              <thead>
                <tr>
                  <th scope="col">Course Name</th>
                  <th scope="col">Target Capacity</th>
                  <th scope="col">Enrolled Students</th>
                  <th scope="col">Batches Count</th>
                  <th scope="col">Created Date</th>
                  <th scope="col" style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <span style={{ fontWeight: 700, color: "#1e293b" }}>{role.role_name}</span>
                      {role.description && (
                        <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#64748b", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {role.description}
                        </p>
                      )}
                    </td>
                    <td>
                      <span className="field-tag" style={{ background: "#f1f5f9", color: "#334155", fontWeight: 600 }}>
                        🎯 {role.capacity || 40} seats
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="field-tag" style={{ fontWeight: 600 }}>
                          {role.studentCount} / {role.capacity || 40}
                        </span>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: Math.round((role.studentCount / (role.capacity || 40)) * 100) >= 100 ? "#ef4444" : "#2563eb" }}>
                          ({Math.round((role.studentCount / (role.capacity || 40)) * 100)}%)
                        </span>
                      </div>
                    </td>
                    <td>{role.batchCount} batches</td>
                    <td>{formatDate(role.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="management-actions">
                        <button
                          className="table-action"
                          onClick={() => handleCourseClick(role)}
                          type="button"
                        >
                          View Students
                        </button>
                        <button
                          className="table-action"
                          onClick={() => openEditDialog(role)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="table-action table-action-danger"
                          disabled={busyRoleId === role.id}
                          onClick={() => handleDelete(role)}
                          type="button"
                        >
                          {busyRoleId === role.id ? "Checking…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Course Details Modal with Enrolled Students */}
      {selectedRole && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedRole(null);
          }}
        >
          <section
            aria-labelledby="course-details-title"
            aria-modal="true"
            className="management-modal batch-details-modal"
            role="dialog"
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">COURSE DETAILS & STUDENTS</p>
                <h2 id="course-details-title">{selectedRole.role_name}</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setSelectedRole(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="batch-details-content">
              {/* Quick metrics */}
              <div className="batch-details-kpi-grid">
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Course Name</div>
                  <div className="batch-details-kpi-val" style={{ fontSize: "16px" }}>
                    {selectedRole.role_name}
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Enrolled Students</div>
                  <div className="batch-details-kpi-val">{courseStudents.length}</div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Target Capacity</div>
                  <div className="batch-details-kpi-val" style={{ color: "#2563eb" }}>
                    {selectedRole.capacity || 40} seats
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Capacity Filled</div>
                  <div className="batch-details-kpi-val" style={{ color: Math.round((courseStudents.length / (selectedRole.capacity || 40)) * 100) >= 100 ? "#ef4444" : "#16a34a" }}>
                    {Math.round((courseStudents.length / (selectedRole.capacity || 40)) * 100)}%
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Associated Batches</div>
                  <div className="batch-details-kpi-val">{courseBatches.length}</div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Creation Date</div>
                  <div className="batch-details-kpi-val" style={{ fontSize: "14px" }}>
                    {formatDate(selectedRole.created_at)}
                  </div>
                </div>
              </div>

              {/* Course Description / Overview */}
              {selectedRole.description && (
                <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    Course Overview & Syllabus:
                  </div>
                  <p style={{ margin: 0, fontSize: "13px", color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {selectedRole.description}
                  </p>
                </div>
              )}

              {/* Batches offering this course */}
              {courseBatches.length > 0 && (
                <div style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "6px" }}>
                    Assigned Cohorts & Batches:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {courseBatches.map((b) => (
                      <span key={b.id} className="field-tag" style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>
                        {b.batch_name} ({b.capacity} cap)
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Enrolled Students Directory */}
              <div className="batch-students-section">
                <div className="batch-students-header">
                  <div className="batch-students-title-row">
                    <h3 className="batch-students-title">Enrolled Students</h3>
                    <span className="batch-students-count-badge">
                      {courseStudents.length} students
                    </span>
                  </div>
                  {courseStudents.length > 5 && (
                    <input
                      aria-label="Filter students in course"
                      className="batch-students-search"
                      onChange={(e) => setDetailsSearch(e.target.value)}
                      placeholder="Search students..."
                      value={detailsSearch}
                    />
                  )}
                </div>

                <div className="batch-students-table-wrap">
                  {detailsLoading ? (
                    <div className="batch-students-empty">Loading enrolled students…</div>
                  ) : filteredModalStudents.length === 0 ? (
                    <div className="batch-students-empty">
                      {courseStudents.length === 0
                        ? "No students are currently enrolled in this course."
                        : "No students matching your search query."}
                    </div>
                  ) : (
                    <table className="students-table management-table">
                      <thead>
                        <tr>
                          <th scope="col">Student Name</th>
                          <th scope="col">Registration Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredModalStudents.map((stu) => (
                          <tr key={stu.id}>
                            <td>
                              <span className="student-avatar" aria-hidden="true">
                                {stu.name?.charAt(0).toLocaleUpperCase() || "?"}
                              </span>
                              <span className="student-name">{stu.name}</span>
                            </td>
                            <td>{formatDate(stu.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div
              className="management-modal-actions"
              style={{ padding: "16px 24px", borderTop: "1px solid #e2e8f0" }}
            >
              <button
                className="secondary-action-button"
                onClick={() => setSelectedRole(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="secondary-action-button"
                onClick={() => {
                  const r = selectedRole;
                  setSelectedRole(null);
                  openEditDialog(r);
                }}
                type="button"
              >
                Edit Course
              </button>
              <button
                className="primary-action-button"
                onClick={() => {
                  setSelectedRole(null);
                  navigate("/batches");
                }}
                type="button"
              >
                Manage Batches →
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Add / Edit Course Modal Dialog */}
      {dialogOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-labelledby="role-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "480px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">COURSE DETAILS</p>
                <h2 id="role-dialog-title">
                  {dialogRole ? "Edit Course" : "Add Course"}
                </h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                disabled={saving}
                onClick={closeDialog}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="management-form" onSubmit={handleSubmit}>
              <div className="management-form-field">
                <label htmlFor="role-name">Course Name *</label>
                <input
                  autoFocus
                  id="role-name"
                  maxLength={120}
                  onChange={(event) => setRoleName(event.target.value)}
                  placeholder="e.g. Data Analytics, Cloud Computing"
                  required
                  value={roleName}
                />
              </div>

              <div className="management-form-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label htmlFor="role-capacity">Course Target Capacity (Seats) *</label>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>Benchmark per course</span>
                </div>
                <input
                  id="role-capacity"
                  type="number"
                  min="1"
                  max="5000"
                  onChange={(event) => setRoleCapacity(event.target.value)}
                  placeholder="e.g. 40"
                  required
                  value={roleCapacity}
                />
                <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                  Total student target used for capacity progress bars and cohort planning.
                </span>
              </div>

              <div className="management-form-field">
                <label htmlFor="role-description">Course Details & Description</label>
                <textarea
                  id="role-description"
                  rows={3}
                  maxLength={500}
                  onChange={(event) => setRoleDescription(event.target.value)}
                  placeholder="Brief summary of syllabus, modules, or prerequisites..."
                  value={roleDescription}
                  style={{ resize: "vertical", fontSize: "13px" }}
                />
              </div>

              {formError && (
                <p className="management-form-error" role="alert">
                  {formError}
                </p>
              )}

              <div className="management-modal-actions">
                <button
                  className="secondary-action-button"
                  disabled={saving}
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-action-button"
                  disabled={saving}
                  type="submit"
                >
                  {saving
                    ? "Saving..."
                    : dialogRole
                      ? "Save Changes"
                      : "Add Course"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export default Roles;
