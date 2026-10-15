import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../supabase";
import { fetchAllRows, computeMetrics } from "../utils/studentMetrics";
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

function Trainers() {
  const navigate = useNavigate();
  const [trainers, setTrainers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  // Search & Filter & Sort & View Mode
  const [search, setSearch] = useState("");
  const [specFilter, setSpecFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");
  const [viewMode, setViewMode] = useState("cards"); // 'cards' | 'table'

  // Profile Modal State
  const [selectedTrainer, setSelectedTrainer] = useState(null);

  // Trainer modal state (Add / Edit)
  const [dialogTrainer, setDialogTrainer] = useState(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [customSpec, setCustomSpec] = useState("");
  const [capacity, setCapacity] = useState(30);

  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyTrainerId, setBusyTrainerId] = useState(null);

  // Bulk Upload Modal state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkParsedData, setBulkParsedData] = useState([]);
  const [bulkFileError, setBulkFileError] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const [trainersRes, coursesRes, batchesRes, assignmentsRes, studentsRes] = await Promise.all([
        fetchAllRows(() =>
          supabase
            .from("trainers")
            .select("id, name, email, specialization, capacity, created_at")
            .order("name", { ascending: true })
        ),
        fetchAllRows(() =>
          supabase.from("roles").select("id, role_name").order("role_name", { ascending: true })
        ),
        fetchAllRows(() =>
          supabase
            .from("batches")
            .select("id, batch_name, batch_type, role_id, trainer_id, capacity, status, created_at")
            .order("batch_name", { ascending: true })
        ),
        fetchAllRows(() =>
          supabase.from("batch_students").select("id, batch_id, student_id")
        ),
        fetchAllRows(() =>
          supabase.from("students").select("id, name, role_id")
        ),
      ]);

      const cleanCourses = filterSystemRoles(coursesRes);
      const metrics = computeMetrics({
        students: studentsRes,
        batches: batchesRes,
        assignments: assignmentsRes,
        trainers: trainersRes,
        roles: cleanCourses,
      });

      setTrainers(metrics.enrichedTrainers);
      setCourses(cleanCourses);
    } catch (error) {
      console.error("Unable to load trainers data:", error?.message || error);
      setTrainers([]);
      setLoadError(error?.message || "Unable to load trainers. Please check table access.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime subscription across trainers, batches, and batch_students
  useEffect(() => {
    const channel = supabase
      .channel("trainers-page-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "trainers" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "batches" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "batch_students" }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Keep selectedTrainer updated with fresh live state
  useEffect(() => {
    if (selectedTrainer) {
      const refreshed = trainers.find((t) => String(t.id) === String(selectedTrainer.id));
      if (refreshed) {
        setSelectedTrainer(refreshed);
      }
    }
  }, [trainers]);

  // Filtered & Sorted Trainers
  const filteredTrainers = useMemo(() => {
    let result = [...trainers];

    // Search query
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.email.toLowerCase().includes(q) ||
          (t.specialization || "").toLowerCase().includes(q)
      );
    }

    // Specialization filter
    if (specFilter !== "all") {
      const target = specFilter.toLowerCase();
      result = result.filter((t) =>
        (t.specialization || "").toLowerCase().includes(target)
      );
    }

    // Sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case "name_asc":
          return a.name.localeCompare(b.name);
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "capacity_desc":
          return (b.targetCapacity ?? 30) - (a.targetCapacity ?? 30);
        case "capacity_asc":
          return (a.targetCapacity ?? 30) - (b.targetCapacity ?? 30);
        case "assigned_desc":
          return (b.assignedStudents ?? 0) - (a.assignedStudents ?? 0);
        case "remaining_desc":
          return (b.remainingCapacity ?? 0) - (a.remainingCapacity ?? 0);
        case "batches_desc":
          return b.batchCount - a.batchCount;
        case "newest":
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        default:
          return 0;
      }
    });

    return result;
  }, [trainers, search, specFilter, sortBy]);

  // Metrics
  const totalTrainers = trainers.length;
  const totalCapacitySum = trainers.reduce((acc, t) => acc + (t.targetCapacity || 30), 0);
  const totalAssignedStudentsSum = trainers.reduce((acc, t) => acc + (t.assignedStudents || 0), 0);
  const overCapacityCount = trainers.filter((t) => t.isOverCapacity).length;

  function openAddDialog() {
    setDialogTrainer(null);
    setName("");
    setEmail("");
    setSelectedCourses([]);
    setCustomSpec("");
    setCapacity(30);
    setFormError("");
    setNotice("");
  }

  function openEditDialog(trainer) {
    setDialogTrainer(trainer);
    setName(trainer.name || "");
    setEmail(trainer.email || "");

    const specs = (trainer.specialization || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const knownCourseNames = courses.map((c) => c.role_name);
    const matched = specs.filter((s) => knownCourseNames.includes(s));
    const extras = specs.filter((s) => !knownCourseNames.includes(s));

    setSelectedCourses(matched);
    setCustomSpec(extras.join(", "));
    setCapacity(trainer.capacity ?? 30);
    setFormError("");
    setNotice("");
  }

  function closeDialog() {
    if (saving) return;
    setDialogTrainer(undefined);
    setFormError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const parsedCapacity = parseInt(capacity, 10);

    const allSpecs = [
      ...selectedCourses,
      ...customSpec
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ];
    const uniqueSpecs = Array.from(new Set(allSpecs));
    const finalSpecialization = uniqueSpecs.join(", ");

    if (!normalizedName) {
      setFormError("Trainer name is required.");
      return;
    }
    if (normalizedName.length < 2) {
      setFormError("Trainer name must be at least 2 characters.");
      return;
    }
    if (!normalizedEmail) {
      setFormError("Email address is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (Number.isNaN(parsedCapacity) || parsedCapacity < 1) {
      setFormError("Capacity must be at least 1 student.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: normalizedName,
        email: normalizedEmail,
        specialization: finalSpecialization || "General",
        capacity: parsedCapacity,
      };

      if (dialogTrainer) {
        const { error } = await supabase
          .from("trainers")
          .update(payload)
          .eq("id", dialogTrainer.id);

        if (error) {
          if (error.code === "23505") {
            setFormError("A trainer with this email address already exists.");
          } else {
            setFormError(error.message);
          }
          return;
        }
      } else {
        const { error } = await supabase.from("trainers").insert(payload);

        if (error) {
          if (error.code === "23505") {
            setFormError("A trainer with this email address already exists.");
          } else {
            setFormError(error.message);
          }
          return;
        }
      }

      setDialogTrainer(undefined);
      setNotice(
        dialogTrainer ? "Trainer updated successfully." : "Trainer added successfully.",
      );
      setLoading(true);
      await loadData();
    } catch (error) {
      console.error("Unable to save trainer:", error);
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(trainer) {
    if (!window.confirm(`Are you sure you want to delete trainer "${trainer.name}"?`)) {
      return;
    }

    setNotice("");
    setLoadError("");
    setBusyTrainerId(trainer.id);

    try {
      // Check if assigned to any batch
      const { count, error: checkErr } = await supabase
        .from("batches")
        .select("*", { count: "exact", head: true })
        .eq("trainer_id", trainer.id);

      if (checkErr) throw checkErr;
      if (count > 0) {
        setLoadError(
          `Cannot delete trainer "${trainer.name}" because they are currently assigned to ${count} batch(es). Please reassign the batches first.`,
        );
        return;
      }

      const { error } = await supabase
        .from("trainers")
        .delete()
        .eq("id", trainer.id);

      if (error) throw error;

      setNotice("Trainer deleted successfully.");
      if (selectedTrainer?.id === trainer.id) {
        setSelectedTrainer(null);
      }
      setLoading(true);
      await loadData();
    } catch (error) {
      console.error("Unable to delete trainer:", error);
      setLoadError("Unable to delete trainer. Please try again.");
    } finally {
      setBusyTrainerId(null);
    }
  }

  // ============================================================================
  // Bulk Excel Upload Handlers for Trainers
  // ============================================================================
  function downloadTrainerTemplate() {
    const courseExamples = courses.map((c) => c.role_name).slice(0, 3).join(", ");
    const templateData = [
      {
        "Trainer Name": "Dr. Sarah Connor",
        Email: "sarah.connor@example.com",
        Specialization: courseExamples || "Data Analytics, Machine Learning",
        Capacity: 35,
      },
      {
        "Trainer Name": "Prof. Alan Turing",
        Email: "alan.turing@example.com",
        Specialization: "Data Science",
        Capacity: 30,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trainers Template");
    XLSX.writeFile(wb, "Trainers_Bulk_Upload_Template.xlsx");
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBulkFileError("");
    setBulkParsedData([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (!rows || rows.length === 0) {
          setBulkFileError("The uploaded file contains no data rows.");
          return;
        }

        const existingEmails = new Set(trainers.map((t) => (t.email || "").toLowerCase()));
        const seenInFile = new Set();

        const parsed = rows.map((row, idx) => {
          const tName = String(
            row["Trainer Name"] || row["trainer name"] || row["Name"] || row["name"] || "",
          ).trim();
          const tEmail = String(
            row["Email"] || row["email"] || row["Email Address"] || "",
          ).trim().toLowerCase();
          const tSpec = String(
            row["Specialization"] || row["specialization"] || row["Courses"] || "",
          ).trim();
          const tCapRaw = row["Capacity"] || row["capacity"] || 30;
          const tCap = parseInt(tCapRaw, 10);

          let error = null;
          if (!tName || tName.length < 2) {
            error = "Name must be at least 2 characters";
          } else if (!tEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tEmail)) {
            error = "Invalid email format";
          } else if (existingEmails.has(tEmail)) {
            error = "Email already registered in system";
          } else if (seenInFile.has(tEmail)) {
            error = "Duplicate email within file";
          } else if (Number.isNaN(tCap) || tCap < 1) {
            error = "Capacity must be a positive integer";
          }

          if (!error) {
            seenInFile.add(tEmail);
          }

          return {
            rowNumber: idx + 2,
            name: tName,
            email: tEmail,
            specialization: tSpec || "General",
            capacity: Number.isNaN(tCap) || tCap < 1 ? 30 : tCap,
            error,
            isValid: !error,
          };
        });

        setBulkParsedData(parsed);
      } catch (err) {
        console.error("Error reading file:", err);
        setBulkFileError("Failed to parse file. Please upload a valid .xlsx or .csv file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleBulkImportConfirm() {
    const validRows = bulkParsedData.filter((r) => r.isValid);
    if (validRows.length === 0) {
      setBulkFileError("No valid rows to import.");
      return;
    }

    setBulkImporting(true);
    setBulkFileError("");

    try {
      const recordsToInsert = validRows.map((r) => ({
        name: r.name,
        email: r.email,
        specialization: r.specialization,
        capacity: r.capacity,
      }));

      const { data, error } = await supabase
        .from("trainers")
        .insert(recordsToInsert)
        .select("id");

      if (error) throw error;

      setNotice(`Successfully imported ${data?.length || validRows.length} trainers!`);
      setBulkModalOpen(false);
      setBulkParsedData([]);
      await loadData();
    } catch (err) {
      console.error("Bulk import error:", err);
      setBulkFileError(err.message || "Failed to import trainers into Supabase.");
    } finally {
      setBulkImporting(false);
    }
  }

  const dialogOpen = dialogTrainer !== undefined;
  const validBulkCount = bulkParsedData.filter((r) => r.isValid).length;

  return (
    <section className="dashboard-content management-page">
      {/* Page Heading Row */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Trainer Management</h1>
          <p className="dashboard-welcome">
            Configure faculty profiles, course specializations, and student capacity workloads.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="secondary-action-button"
            onClick={() => {
              setBulkModalOpen(true);
              setBulkParsedData([]);
              setBulkFileError("");
            }}
            type="button"
          >
            📥 Bulk Excel Upload
          </button>
          <button
            className="primary-action-button"
            onClick={openAddDialog}
            type="button"
          >
            <span aria-hidden="true">+</span> Add Trainer
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
                d="M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.79.84l-.04.08h-3.4l-.04-.08a1.7 1.7 0 0 0-1.79-.84l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.6 15l-.08-.04v-3.4l.08-.04a1.7 1.7 0 0 0 .34-1.88l-.06-.06 1.7-2.94.08.02a1.7 1.7 0 0 0 1.79-.84l.04-.08h3.4l.04.08a1.7 1.7 0 0 0 1.79.84l.08-.02 1.7 2.94-.06.06a1.7 1.7 0 0 0-.34 1.88l.08.04v3.4l-.08.04Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Total Trainers</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalTrainers}</p>
            <span className="kpi-detail">Instructors</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
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
          <p className="kpi-label">Target Capacity</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalCapacitySum}</p>
            <span className="kpi-detail">Target seats</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Assigned Students</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalAssignedStudentsSum}</p>
            <span className="kpi-detail">Across cohorts</span>
          </div>
        </article>

        <article className="kpi-card">
          <div
            className={`kpi-icon ${overCapacityCount > 0 ? "kpi-icon-amber" : "kpi-icon-violet"}`}
            aria-hidden="true"
            style={overCapacityCount > 0 ? { background: "#fee2e2", color: "#ef4444" } : {}}
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Over Capacity</p>
          <div className="kpi-value-row">
            <p className="kpi-value" style={overCapacityCount > 0 ? { color: "#ef4444" } : {}}>
              {loading ? "…" : overCapacityCount}
            </p>
            <span className="kpi-detail">
              {overCapacityCount > 0 ? "Faculty exceeded" : "All within limit"}
            </span>
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
              aria-label="Search trainers"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by trainer name, email, or specialization..."
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
              <span className="batches-filter-label-prefix">Specialization:</span>
              <select
                aria-label="Filter by specialization"
                className="batches-filter-select"
                onChange={(e) => setSpecFilter(e.target.value)}
                value={specFilter}
              >
                <option value="all">All Specializations</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.role_name}>
                    {c.role_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Sort:</span>
              <select
                aria-label="Sort trainers"
                className="batches-filter-select"
                onChange={(e) => setSortBy(e.target.value)}
                value={sortBy}
              >
                <option value="name_asc">Name (A → Z)</option>
                <option value="name_desc">Name (Z → A)</option>
                <option value="assigned_desc">Most Assigned Students</option>
                <option value="remaining_desc">Most Available Seats</option>
                <option value="capacity_desc">Highest Target Capacity</option>
                <option value="capacity_asc">Lowest Target Capacity</option>
                <option value="batches_desc">Most Batches Assigned</option>
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
            Showing <strong className="batches-count-pill">{filteredTrainers.length}</strong> of{" "}
            <strong>{trainers.length}</strong> total instructors
          </span>
          {(search || specFilter !== "all") && (
            <button
              className="table-action"
              onClick={() => {
                setSearch("");
                setSpecFilter("all");
              }}
              type="button"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Trainers Display: Cards vs Table */}
      {loading ? (
        <div className="recent-students-card" style={{ padding: "60px 20px", textAlign: "center" }}>
          <div className="button-spinner" style={{ margin: "0 auto 16px", width: "28px", height: "28px", color: "#315ce8" }} />
          <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>Loading trainers…</p>
        </div>
      ) : filteredTrainers.length === 0 ? (
        <div className="batches-empty-card">
          <h2 className="batches-empty-title">No Trainers Found</h2>
          <p className="batches-empty-desc">
            {search || specFilter !== "all"
              ? "No instructors match your current filters."
              : "Add your first trainer to start assigning cohorts."}
          </p>
          <button className="primary-action-button" onClick={openAddDialog} type="button">
            + Add Trainer
          </button>
        </div>
      ) : viewMode === "cards" ? (
        /* Cards View (3 cards per row on desktop) */
        <div className="batches-grid">
          {filteredTrainers.map((trainer) => (
            <article
              key={trainer.id}
              className="batch-card"
              onClick={() => setSelectedTrainer(trainer)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedTrainer(trainer);
                }
              }}
            >
              <div className="batch-card-header">
                <div className="batch-card-title-group">
                  <h2 className="batch-card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="student-avatar" aria-hidden="true" style={{ width: "32px", height: "32px", fontSize: "14px" }}>
                      {trainer.name?.charAt(0).toLocaleUpperCase() || "T"}
                    </span>
                    {trainer.name}
                  </h2>
                  <span style={{ fontSize: "13px", color: "#64748b" }}>
                    {trainer.email}
                  </span>
                </div>
                {trainer.isOverCapacity ? (
                  <span
                    className="batch-status-badge"
                    style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" }}
                  >
                    <span className="batch-status-dot" aria-hidden="true" style={{ background: "#b91c1c" }} />
                    ⚠️ Over Capacity (+{trainer.assignedStudents - trainer.targetCapacity})
                  </span>
                ) : trainer.remainingCapacity === 0 ? (
                  <span
                    className="batch-status-badge"
                    style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" }}
                  >
                    <span className="batch-status-dot" aria-hidden="true" style={{ background: "#b45309" }} />
                    Capacity Full
                  </span>
                ) : (
                  <span className="batch-status-badge status-active">
                    <span className="batch-status-dot" aria-hidden="true" />
                    {trainer.batchCount > 0 ? `${trainer.batchCount} Batch(es)` : "Available"}
                  </span>
                )}
              </div>

              <div className="batch-card-body">
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Specializations:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {(trainer.specialization || "General")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((spec, i) => (
                        <span key={i} className="field-tag" style={{ fontSize: "11px" }}>
                          {spec}
                        </span>
                      ))}
                  </div>
                </div>

                <div className="batch-card-capacity-box">
                  <div className="batch-capacity-numbers" style={{ marginBottom: "4px" }}>
                    <span className="batch-capacity-count">
                      <strong>Target Capacity:</strong>
                    </span>
                    <span className="batch-available-seats" style={{ fontSize: "13px", fontWeight: 700 }}>
                      {trainer.targetCapacity} students
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
                    <span>
                      Assigned: <strong style={{ color: trainer.isOverCapacity ? "#dc2626" : "#1e293b" }}>{trainer.assignedStudents}</strong>
                    </span>
                    <span>
                      {trainer.isOverCapacity ? (
                        <strong style={{ color: "#dc2626" }}>Over by {trainer.assignedStudents - trainer.targetCapacity}</strong>
                      ) : (
                        <span>Remaining: <strong style={{ color: "#10b981" }}>{trainer.remainingCapacity}</strong></span>
                      )}
                    </span>
                  </div>

                  <div className="batch-progress-track">
                    <div
                      className="batch-progress-fill"
                      style={{
                        width: `${Math.min(100, trainer.fillPercent)}%`,
                        background: trainer.isOverCapacity
                          ? "#ef4444"
                          : trainer.fillPercent >= 80
                            ? "#f59e0b"
                            : "#315ce8",
                      }}
                    />
                  </div>

                  <div className="batch-capacity-footer">
                    <span>{trainer.batchCount} active batch(es)</span>
                    <span>Joined {formatDate(trainer.created_at)}</span>
                  </div>
                </div>
              </div>

              <div className="batch-card-footer" onClick={(e) => e.stopPropagation()}>
                <button
                  className="batch-card-view-btn"
                  onClick={() => setSelectedTrainer(trainer)}
                  type="button"
                >
                  View Profile →
                </button>

                <div className="batch-card-actions">
                  <button
                    className="batch-btn-subtle"
                    onClick={() => openEditDialog(trainer)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="batch-btn-subtle btn-danger"
                    disabled={busyTrainerId === trainer.id}
                    onClick={() => handleDelete(trainer)}
                    type="button"
                  >
                    {busyTrainerId === trainer.id ? "…" : "Delete"}
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
                  <th scope="col">Trainer Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Course Specializations</th>
                  <th scope="col">Target Capacity</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Batches</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrainers.map((trainer) => (
                  <tr key={trainer.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="student-avatar" aria-hidden="true" style={{ width: "28px", height: "28px", fontSize: "12px" }}>
                          {trainer.name?.charAt(0).toLocaleUpperCase() || "T"}
                        </span>
                        <span style={{ fontWeight: 700, color: "#1e293b" }}>{trainer.name}</span>
                      </div>
                    </td>
                    <td>{trainer.email}</td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {(trainer.specialization || "General")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((spec, i) => (
                            <span key={i} className="field-tag" style={{ fontSize: "11px" }}>
                              {spec}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>{trainer.targetCapacity} seats</td>
                    <td>
                      <strong style={{ color: trainer.isOverCapacity ? "#dc2626" : "#1e293b" }}>
                        {trainer.assignedStudents}
                      </strong>
                    </td>
                    <td>
                      {trainer.isOverCapacity ? (
                        <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "12px" }}>
                          0 (Over by {trainer.assignedStudents - trainer.targetCapacity})
                        </span>
                      ) : (
                        <span style={{ color: "#10b981", fontWeight: 600 }}>
                          {trainer.remainingCapacity} open
                        </span>
                      )}
                    </td>
                    <td>{trainer.batchCount} batch(es)</td>
                    <td>
                      {trainer.isOverCapacity ? (
                        <span
                          className="batch-status-badge"
                          style={{ background: "#fee2e2", color: "#b91c1c", fontSize: "11px", padding: "2px 8px" }}
                        >
                          ⚠️ Over Capacity
                        </span>
                      ) : trainer.remainingCapacity === 0 ? (
                        <span
                          className="batch-status-badge"
                          style={{ background: "#fef3c7", color: "#b45309", fontSize: "11px", padding: "2px 8px" }}
                        >
                          Full
                        </span>
                      ) : (
                        <span className="batch-status-badge status-active" style={{ fontSize: "11px", padding: "2px 8px" }}>
                          Available
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="management-actions">
                        <button
                          className="table-action"
                          onClick={() => setSelectedTrainer(trainer)}
                          type="button"
                        >
                          View Profile
                        </button>
                        <button
                          className="table-action"
                          onClick={() => openEditDialog(trainer)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="table-action table-action-danger"
                          disabled={busyTrainerId === trainer.id}
                          onClick={() => handleDelete(trainer)}
                          type="button"
                        >
                          {busyTrainerId === trainer.id ? "Deleting…" : "Delete"}
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

      {/* Interactive Trainer Profile Modal */}
      {selectedTrainer && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedTrainer(null);
          }}
        >
          <section
            aria-labelledby="trainer-details-title"
            aria-modal="true"
            className="management-modal batch-details-modal"
            role="dialog"
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">INSTRUCTOR PROFILE</p>
                <h2 id="trainer-details-title">{selectedTrainer.name}</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setSelectedTrainer(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="batch-details-content">
              {/* Quick KPI stats */}
              <div className="batch-details-kpi-grid">
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Full Name</div>
                  <div className="batch-details-kpi-val" style={{ fontSize: "16px" }}>
                    {selectedTrainer.name}
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Target Capacity</div>
                  <div className="batch-details-kpi-val">
                    {selectedTrainer.targetCapacity} seats
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Assigned Students</div>
                  <div
                    className="batch-details-kpi-val"
                    style={selectedTrainer.isOverCapacity ? { color: "#dc2626" } : {}}
                  >
                    {selectedTrainer.assignedStudents} students
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Remaining Capacity</div>
                  <div
                    className="batch-details-kpi-val"
                    style={{ fontSize: "15px", color: selectedTrainer.isOverCapacity ? "#dc2626" : "#10b981" }}
                  >
                    {selectedTrainer.isOverCapacity
                      ? `0 (${selectedTrainer.assignedStudents - selectedTrainer.targetCapacity} over)`
                      : `${selectedTrainer.remainingCapacity} seats open`}
                  </div>
                </div>
              </div>

              {/* Over-capacity warning banner */}
              {selectedTrainer.isOverCapacity && (
                <div
                  style={{
                    background: "#fee2e2",
                    border: "1px solid #fca5a5",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    color: "#991b1b",
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <span style={{ fontSize: "22px" }} aria-hidden="true">⚠️</span>
                  <div>
                    <strong style={{ display: "block", fontSize: "14px" }}>
                      Target Capacity Exceeded
                    </strong>
                    <span style={{ fontSize: "13px" }}>
                      This faculty member currently teaches <strong>{selectedTrainer.assignedStudents}</strong> students across active cohorts, exceeding their Target Capacity of <strong>{selectedTrainer.targetCapacity}</strong> by <strong>{selectedTrainer.assignedStudents - selectedTrainer.targetCapacity}</strong> students.
                    </span>
                  </div>
                </div>
              )}

              {/* Contact & Specialization */}
              <div className="batch-details-info-grid">
                <div className="batch-details-section-card">
                  <h3 className="batch-details-section-title">
                    <span>📧 Contact Information</span>
                  </h3>
                  <dl className="batch-details-dl">
                    <div className="batch-details-dl-row">
                      <dt>Email</dt>
                      <dd>{selectedTrainer.email}</dd>
                    </div>
                    <div className="batch-details-dl-row">
                      <dt>Status</dt>
                      <dd>
                        <span className="batch-status-badge status-active">
                          <span className="batch-status-dot" aria-hidden="true" />
                          Active Instructor
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="batch-details-section-card">
                  <h3 className="batch-details-section-title">
                    <span>🎓 Specializations</span>
                  </h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                    {(selectedTrainer.specialization || "General")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((spec, i) => (
                        <span key={i} className="field-tag" style={{ background: "#edf2ff", color: "#315ce8" }}>
                          {spec}
                        </span>
                      ))}
                  </div>
                </div>
              </div>

              {/* Batches taught by this trainer */}
              <div className="batch-students-section">
                <div className="batch-students-header">
                  <div className="batch-students-title-row">
                    <h3 className="batch-students-title">Assigned Training Batches</h3>
                    <span className="batch-students-count-badge">
                      {selectedTrainer.batches?.length || 0} batches
                    </span>
                  </div>
                </div>

                <div className="batch-students-table-wrap">
                  {(!selectedTrainer.batches || selectedTrainer.batches.length === 0) ? (
                    <div className="batch-students-empty">
                      No batches are currently assigned to this instructor.
                    </div>
                  ) : (
                    <table className="students-table management-table">
                      <thead>
                        <tr>
                          <th scope="col">Batch Name</th>
                          <th scope="col">Batch Capacity</th>
                          <th scope="col">Students in Batch</th>
                          <th scope="col">Status</th>
                          <th scope="col" style={{ textAlign: "right" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTrainer.batches.map((b) => (
                          <tr key={b.id}>
                            <td style={{ fontWeight: 700 }}>{b.batch_name}</td>
                            <td>{b.capacity} seats</td>
                            <td>
                              <span style={{ fontWeight: 600, color: "#1e293b" }}>
                                {b.assignedCount || 0} students
                              </span>
                            </td>
                            <td>
                              <span className={`batch-status-badge status-${(b.status || "active").toLowerCase()}`}>
                                <span className="batch-status-dot" aria-hidden="true" />
                                {b.status || "Active"}
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="table-action"
                                onClick={() => {
                                  setSelectedTrainer(null);
                                  navigate(`/batches/${b.id}`);
                                }}
                                type="button"
                              >
                                View Batch →
                              </button>
                            </td>
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
                onClick={() => setSelectedTrainer(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="primary-action-button"
                onClick={() => {
                  const t = selectedTrainer;
                  setSelectedTrainer(null);
                  openEditDialog(t);
                }}
                type="button"
              >
                Edit Trainer
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Add / Edit Trainer Modal with Course Checkboxes */}
      {dialogOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-labelledby="trainer-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "560px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">TRAINER DETAILS</p>
                <h2 id="trainer-dialog-title">
                  {dialogTrainer ? "Edit Trainer" : "Add Trainer"}
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
              <div className="management-form-grid">
                <div className="management-form-field">
                  <label htmlFor="trainer-name">Full Name *</label>
                  <input
                    autoFocus
                    id="trainer-name"
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Rahul Patil"
                    required
                    value={name}
                  />
                </div>

                <div className="management-form-field">
                  <label htmlFor="trainer-email">Email Address *</label>
                  <input
                    id="trainer-email"
                    maxLength={150}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="e.g. rahul.patil@example.com"
                    required
                    type="email"
                    value={email}
                  />
                </div>

                <div className="management-form-field" style={{ gridColumn: "1 / -1" }}>
                  <label>Course Specializations</label>
                  <span style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px", display: "block" }}>
                    Select courses this trainer is qualified to teach:
                  </span>
                  <div className="trainer-courses-checkbox-grid">
                    {courses.map((course) => {
                      const cName = course.role_name;
                      const isChecked = selectedCourses.includes(cName);
                      return (
                        <label key={course.id} className="trainer-course-checkbox-item">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedCourses((prev) => [...prev, cName]);
                              } else {
                                setSelectedCourses((prev) => prev.filter((c) => c !== cName));
                              }
                            }}
                          />
                          <span>{cName}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="management-form-field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="trainer-custom-spec">Additional Specializations (Optional)</label>
                  <input
                    id="trainer-custom-spec"
                    maxLength={200}
                    onChange={(event) => setCustomSpec(event.target.value)}
                    placeholder="e.g. Cloud Architecture, DevOps"
                    value={customSpec}
                  />
                </div>

                <div className="management-form-field">
                  <label htmlFor="trainer-capacity">Maximum Student Capacity *</label>
                  <input
                    id="trainer-capacity"
                    max={500}
                    min={1}
                    onChange={(event) => setCapacity(event.target.value)}
                    placeholder="30"
                    required
                    type="number"
                    value={capacity}
                  />
                </div>
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
                    ? "Saving…"
                    : dialogTrainer
                      ? "Save Changes"
                      : "Add Trainer"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Bulk Excel Upload Modal for Trainers */}
      {bulkModalOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !bulkImporting) {
              setBulkModalOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="bulk-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "660px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">DATA IMPORT</p>
                <h2 id="bulk-dialog-title">Bulk Upload Trainers</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                disabled={bulkImporting}
                onClick={() => setBulkModalOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 16px" }}>
              Upload an Excel (.xlsx, .xls) or CSV file with trainer details.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <button
                type="button"
                className="secondary-action-button"
                style={{ fontSize: "12px", padding: "6px 12px" }}
                onClick={downloadTrainerTemplate}
              >
                📄 Download Excel Template
              </button>
            </div>

            <label className="bulk-upload-dropzone">
              <svg className="bulk-upload-icon" viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0-3 3m3-3v12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>
                Click to browse or drag & drop Excel / CSV file
              </span>
              <span style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                Supported formats: .xlsx, .xls, .csv
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={handleFileChange}
                disabled={bulkImporting}
              />
            </label>

            {bulkFileError && (
              <p className="management-form-error" role="alert">
                {bulkFileError}
              </p>
            )}

            {bulkParsedData.length > 0 && (
              <div style={{ marginTop: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                    File Preview ({bulkParsedData.length} records parsed)
                  </span>
                  <span style={{ fontSize: "12px", color: validBulkCount === bulkParsedData.length ? "#059669" : "#d97706" }}>
                    {validBulkCount} valid, {bulkParsedData.length - validBulkCount} with issues
                  </span>
                </div>

                <div className="bulk-preview-table-wrap">
                  <table className="students-table management-table" style={{ fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Specialization</th>
                        <th>Capacity</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkParsedData.slice(0, 50).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td style={{ fontWeight: 600 }}>{row.name || "—"}</td>
                          <td>{row.email || "—"}</td>
                          <td>{row.specialization}</td>
                          <td>{row.capacity}</td>
                          <td>
                            {row.isValid ? (
                              <span className="badge-valid">✓ Ready</span>
                            ) : (
                              <span className="badge-invalid" title={row.error}>
                                ⚠ {row.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="management-modal-actions" style={{ marginTop: "16px" }}>
              <button
                type="button"
                className="secondary-action-button"
                disabled={bulkImporting}
                onClick={() => setBulkModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action-button"
                disabled={bulkImporting || validBulkCount === 0}
                onClick={handleBulkImportConfirm}
              >
                {bulkImporting
                  ? "Importing Trainers…"
                  : `Confirm Import (${validBulkCount} Trainers)`}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default Trainers;
