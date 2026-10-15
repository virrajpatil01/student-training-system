import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../supabase";
import { fetchAllRows } from "../utils/studentMetrics";
import { getApiUrl } from "../config/api";
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

function extractContact(student) {
  let email =
    student.email ||
    student.extra_fields?.email ||
    student.extra_fields?.Email ||
    student.extra_fields?.["email_address"] ||
    "";

  let phone =
    student.phone ||
    student.extra_fields?.phone ||
    student.extra_fields?.Phone ||
    student.extra_fields?.contact ||
    student.extra_fields?.["phone_number"] ||
    student.extra_fields?.mobile ||
    "";

  let cleanName = student.name || "Unnamed Student";

  // If email or phone missing, check if formatted into name string
  if ((!email || !phone) && typeof student.name === "string" && student.name.includes("(")) {
    const match = student.name.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      cleanName = match[1].trim();
      const details = match[2];
      const parts = details.split("|").map((p) => p.trim());
      for (const part of parts) {
        const lower = part.toLowerCase();
        if (!email && (lower.includes("email") || lower.includes("@"))) {
          email = part.replace(/^email\s*(address)?\s*:\s*/i, "").trim();
        } else if (!phone && (lower.includes("phone") || lower.includes("contact") || lower.includes("mobile") || /^\+?[\d\s-]{7,15}$/.test(part))) {
          phone = part.replace(/^phone\s*(number)?\s*:\s*/i, "").trim();
        }
      }
    }
  }

  return { email: email || "—", phone: phone || "—", cleanName };
}

function Students() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalRoles, setTotalRoles] = useState(0);
  const [assignedCount, setAssignedCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  // Filters & Search & Sort
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  // Interactive Student Profile Modal
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Student row selection & bulk delete state
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectAllRef = useRef(null);

  // Bulk Excel Upload state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkParsedData, setBulkParsedData] = useState([]);
  const [bulkFileError, setBulkFileError] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [missingBulkCourses, setMissingBulkCourses] = useState([]);
  const [creatingMissingCourses, setCreatingMissingCourses] = useState(false);

  // Individual Add Student Modal state
  const [addStudentModalOpen, setAddStudentModalOpen] = useState(false);
  const [addStudentName, setAddStudentName] = useState("");
  const [addStudentRoleId, setAddStudentRoleId] = useState("");
  const [addStudentEmail, setAddStudentEmail] = useState("");
  const [addStudentPhone, setAddStudentPhone] = useState("");
  const [addStudentSaving, setAddStudentSaving] = useState(false);
  const [addStudentError, setAddStudentError] = useState("");

  // Inline Course Creation inside Add Student
  const [showCreateCourseInAdd, setShowCreateCourseInAdd] = useState(false);
  const [newCourseNameInAdd, setNewCourseNameInAdd] = useState("");
  const [newCourseCapacityInAdd, setNewCourseCapacityInAdd] = useState(40);
  const [newCourseDescriptionInAdd, setNewCourseDescriptionInAdd] = useState("");
  const [creatingCourseInAdd, setCreatingCourseInAdd] = useState(false);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const [rawStudents, rolesRes, assignmentsList, batchesRes] = await Promise.all([
        fetchAllRows(() =>
          supabase
            .from("students")
            .select("*, role:roles(role_name)")
            .order("created_at", { ascending: false })
        ),
        supabase.from("roles").select("id, role_name").order("role_name", { ascending: true }),
        fetchAllRows(() => supabase.from("batch_students").select("id, batch_id, student_id")),
        supabase.from("batches").select("id, batch_name"),
      ]);

      if (rolesRes.error) throw rolesRes.error;

      const rolesList = filterSystemRoles(rolesRes.data || []);
      const batchesList = batchesRes.data || [];

      // Map batch assignments
      const batchesMap = new Map(batchesList.map((b) => [String(b.id), b.batch_name]));
      const studentBatchMap = new Map();
      const assignedIds = new Set();

      assignmentsList.forEach((a) => {
        if (a.student_id) {
          const sId = String(a.student_id);
          assignedIds.add(sId);
          if (a.batch_id) {
            studentBatchMap.set(sId, batchesMap.get(String(a.batch_id)) || "Assigned Batch");
          }
        }
      });

      const rolesMap = new Map(rolesList.map((r) => [String(r.id), r.role_name]));

      const enrichedStudents = rawStudents.map((s) => {
        const { email, phone, cleanName } = extractContact(s);
        const roleName = Array.isArray(s.role)
          ? s.role[0]?.role_name || rolesMap.get(String(s.role_id)) || "—"
          : s?.role?.role_name || rolesMap.get(String(s.role_id)) || "—";

        const batchName = studentBatchMap.get(String(s.id));
        const isAssigned = assignedIds.has(String(s.id));

        return {
          id: s.id,
          name: cleanName || s.name || "Unnamed Student",
          email,
          phone,
          roleId: s.role_id,
          roleName,
          createdAt: s.created_at,
          batchName: batchName || null,
          isAssigned,
        };
      });

      setStudents(enrichedStudents);
      setRoles(rolesList);
      setTotalStudents(rawStudents.length);
      setTotalRoles(rolesList.length);
      setAssignedCount(enrichedStudents.filter((s) => s.isAssigned).length);
      setUnassignedCount(enrichedStudents.filter((s) => !s.isAssigned).length);
      setLoadError("");
    } catch (error) {
      console.error("Unable to load students:", error);
      setStudents([]);
      setLoadError("Unable to load students. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  // Realtime subscription for instant sync
  useEffect(() => {
    const channel = supabase
      .channel("students-page-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "students" }, () => loadStudents())
      .on("postgres_changes", { event: "*", schema: "public", table: "batch_students" }, () => loadStudents())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadStudents]);

  // Filtered & Sorted Students
  const filteredStudents = useMemo(() => {
    let result = [...students];

    // Search query
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          s.roleName.toLowerCase().includes(q)
      );
    }

    // Role / Course filter
    if (roleFilter !== "all") {
      result = result.filter((s) => String(s.roleId) === String(roleFilter));
    }

    // Assignment status filter
    if (assignmentFilter === "assigned") {
      result = result.filter((s) => s.isAssigned);
    } else if (assignmentFilter === "unassigned") {
      result = result.filter((s) => !s.isAssigned);
    }

    // Sort order
    result.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case "oldest":
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case "name_asc":
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        case "name_desc":
          return b.name.localeCompare(a.name, undefined, { numeric: true });
        default:
          return 0;
      }
    });

    return result;
  }, [students, search, roleFilter, assignmentFilter, sortBy]);

  // Visible student IDs in current filtered/searched view
  const visibleStudentIds = useMemo(
    () => filteredStudents.map((s) => String(s.id)),
    [filteredStudents]
  );

  const selectedVisibleCount = useMemo(
    () => visibleStudentIds.filter((id) => selectedStudentIds.includes(id)).length,
    [visibleStudentIds, selectedStudentIds]
  );

  const allVisibleSelected =
    visibleStudentIds.length > 0 && selectedVisibleCount === visibleStudentIds.length;
  const isIndeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleStudentIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const toggleStudentSelection = useCallback((studentId) => {
    const idStr = String(studentId);
    setSelectedStudentIds((prev) =>
      prev.includes(idStr) ? prev.filter((id) => id !== idStr) : [...prev, idStr]
    );
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedStudentIds((prev) =>
        prev.filter((id) => !visibleStudentIds.includes(id))
      );
    } else {
      setSelectedStudentIds((prev) => {
        const set = new Set(prev);
        visibleStudentIds.forEach((id) => set.add(id));
        return Array.from(set);
      });
    }
  }, [allVisibleSelected, visibleStudentIds]);

  async function handleConfirmBulkDelete() {
    if (selectedStudentIds.length === 0) return;
    setBulkDeleting(true);
    setErrorMessage("");
    setNotice("");

    const idsToDelete = [...selectedStudentIds];
    const count = idsToDelete.length;

    try {
      let backendSucceeded = false;

      // 1. Attempt backend endpoint first
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(getApiUrl("/students/bulk"), {
          method: "DELETE",
          headers,
          body: JSON.stringify({ student_ids: idsToDelete }),
        });

        if (res.ok) {
          const resData = await res.json();
          backendSucceeded = true;
          const deletedCount = resData.deleted_count || count;
          setNotice(`${deletedCount} student${deletedCount > 1 ? "s" : ""} deleted successfully.`);
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn("Backend bulk delete response:", res.status, errData);
          if (res.status === 403 && errData.detail) {
            throw new Error(errData.detail);
          }
        }
      } catch (backendErr) {
        if (backendErr.message?.includes("Row Level Security") || backendErr.message?.includes("Delete failed")) {
          throw backendErr;
        }
        console.warn("Backend unreachable or error, falling back to direct Supabase client:", backendErr.message);
      }

      // 2. Direct Supabase Client fallback (chunked in blocks of 100 to avoid PostgREST URI length limits)
      if (!backendSucceeded) {
        const CHUNK_SIZE = 100;
        let totalDeletedCount = 0;

        // Step A: Delete associated batch_students records first (Foreign Key constraint order) in chunks
        for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
          const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
          const { error: batchErr } = await supabase
            .from("batch_students")
            .delete()
            .in("student_id", chunk);

          if (batchErr) {
            console.error("STUDENT DELETE ERROR (batch_students):", batchErr);
            throw new Error(`Delete failed: ${batchErr.message || "Failed to remove batch assignments"}`);
          }
        }

        // Step B: Delete student records from students table in chunks
        for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
          const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
          const { data: deletedRows, error: studentErr } = await supabase
            .from("students")
            .delete()
            .in("id", chunk)
            .select("id");

          if (studentErr) {
            console.error("STUDENT DELETE ERROR (students):", studentErr);
            throw new Error(`Delete failed: ${studentErr.message || "Database error"}`);
          }

          if (deletedRows) {
            totalDeletedCount += deletedRows.length;
          }
        }

        // Detect if RLS blocked the deletion (0 rows deleted without explicit error)
        if (totalDeletedCount === 0) {
          console.error("STUDENT DELETE ERROR: 0 rows deleted. Supabase Row-Level Security (RLS) on public.students blocked deletion.");
          throw new Error("Delete failed: Row Level Security policy violation on students table. Please apply the authenticated DELETE policy in Supabase SQL Editor (see supabase/fix_students_delete_rls.sql).");
        }

        setNotice(`${totalDeletedCount} student${totalDeletedCount > 1 ? "s" : ""} deleted successfully.`);
      }

      // Step C: Reset selection and refetch fresh database records
      setSelectedStudentIds([]);
      setDeleteConfirmOpen(false);

      if (selectedStudent && idsToDelete.includes(String(selectedStudent.id))) {
        setSelectedStudent(null);
      }

      await loadStudents();
    } catch (err) {
      console.error("STUDENT DELETE ERROR:", err);
      setErrorMessage(err.message || "Failed to delete selected students. Please try again.");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDeleteStudent(student) {
    if (!window.confirm(`Are you sure you want to remove student "${student.name}"?`)) {
      return;
    }

    setDeletingId(student.id);
    setNotice("");
    setErrorMessage("");

    try {
      let backendSucceeded = false;

      // 1. Attempt backend endpoint first
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(getApiUrl(`/students/${student.id}`), {
          method: "DELETE",
          headers,
        });

        if (res.ok) {
          backendSucceeded = true;
          setNotice(`Student "${student.name}" deleted successfully.`);
        } else {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 403 && errData.detail) {
            throw new Error(errData.detail);
          }
        }
      } catch (backendErr) {
        if (backendErr.message?.includes("Row Level Security") || backendErr.message?.includes("Delete failed")) {
          throw backendErr;
        }
      }

      // 2. Direct Supabase Client fallback
      if (!backendSucceeded) {
        // Step A: Remove from batch_students if assigned
        const { error: batchErr } = await supabase
          .from("batch_students")
          .delete()
          .eq("student_id", student.id);

        if (batchErr) {
          console.error("STUDENT DELETE ERROR (batch_students):", batchErr);
          throw new Error(`Delete failed: ${batchErr.message}`);
        }

        // Step B: Delete student record
        const { data: deletedRows, error: studentErr } = await supabase
          .from("students")
          .delete()
          .eq("id", student.id)
          .select("id");

        if (studentErr) {
          console.error("STUDENT DELETE ERROR (students):", studentErr);
          throw new Error(`Delete failed: ${studentErr.message}`);
        }

        if (!deletedRows || deletedRows.length === 0) {
          console.error("STUDENT DELETE ERROR: 0 rows deleted. RLS policy violation on public.students.");
          throw new Error("Delete failed: Row Level Security policy violation on students table. Please apply the authenticated DELETE policy in Supabase SQL Editor (see supabase/fix_students_delete_rls.sql).");
        }

        setNotice(`Student "${student.name}" deleted successfully.`);
      }

      setSelectedStudentIds((prev) => prev.filter((id) => id !== String(student.id)));
      if (selectedStudent?.id === student.id) {
        setSelectedStudent(null);
      }
      await loadStudents();
    } catch (err) {
      console.error("STUDENT DELETE ERROR:", err);
      setErrorMessage(err.message || "Unable to delete student.");
    } finally {
      setDeletingId(null);
    }
  }

  // ============================================================================
  // Bulk Excel Upload Handlers for Students
  // ============================================================================
  function downloadStudentTemplate() {
    const courseExamples = roles.map((r) => r.role_name);
    const templateData = [
      {
        "Student Name": "Alex Johnson",
        Course: courseExamples[0] || "Web Development",
      },
      {
        "Student Name": "Maria Garcia",
        Course: courseExamples[1] || "Data Analytics",
      },
      {
        "Student Name": "David Chen",
        Course: courseExamples[0] || "Web Development",
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students Template");
    XLSX.writeFile(wb, "Students_Bulk_Upload_Template.xlsx");
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBulkFileError("");
    setBulkParsedData([]);

    const courseMap = new Map();
    for (const r of roles) {
      const norm = (r.role_name || "").trim().toLowerCase();
      courseMap.set(norm, r);
    }

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

        const parsed = rows.map((row, idx) => {
          const sName = String(
            row["Student Name"] ||
              row["student name"] ||
              row["Name"] ||
              row["name"] ||
              row["Full Name"] ||
              "",
          ).trim();
          const sCourse = String(
            row["Course"] ||
              row["course"] ||
              row["Role"] ||
              row["role"] ||
              row["Course Name"] ||
              "",
          ).trim();

          let error = null;
          let matchedRole = null;

          if (!sName || sName.length < 2) {
            error = "Name must be at least 2 characters";
          } else if (!sCourse) {
            error = "Course name is required";
          } else {
            matchedRole = courseMap.get(sCourse.toLowerCase());
            if (!matchedRole) {
              error = `Unknown course "${sCourse}"`;
            }
          }

          return {
            rowNumber: idx + 2,
            name: sName,
            courseName: sCourse,
            roleId: matchedRole?.id || null,
            roleName: matchedRole?.role_name || sCourse,
            error,
            isValid: !error,
          };
        });

        const unknownList = Array.from(
          new Set(
            parsed
              .filter((r) => r.error && r.error.startsWith('Unknown course "') && r.courseName)
              .map((r) => r.courseName)
          )
        );
        setMissingBulkCourses(unknownList);
        setBulkParsedData(parsed);
      } catch (err) {
        console.error("Error reading student file:", err);
        setBulkFileError("Failed to parse file. Please upload a valid .xlsx or .csv file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleCreateMissingBulkCourses() {
    if (missingBulkCourses.length === 0) return;
    setCreatingMissingCourses(true);
    setBulkFileError("");

    try {
      for (const cName of missingBulkCourses) {
        try {
          await supabase.from("roles").insert({ role_name: cName, capacity: 40 });
        } catch {
          await supabase.from("roles").insert({ role_name: cName });
        }
      }

      const { data: updatedRoles } = await supabase.from("roles").select("id, role_name");
      const cleanUpdated = filterSystemRoles(updatedRoles || []);
      const newMap = new Map(cleanUpdated.map((r) => [r.role_name.toLowerCase(), r]));
      setRoles(cleanUpdated);

      setBulkParsedData((prev) =>
        prev.map((r) => {
          if (r.error && r.error.startsWith('Unknown course "')) {
            const matched = newMap.get(r.courseName.toLowerCase());
            if (matched) {
              return {
                ...r,
                roleId: matched.id,
                roleName: matched.role_name,
                error: null,
                isValid: true,
              };
            }
          }
          return r;
        })
      );
      setMissingBulkCourses([]);
      setNotice(`Created ${missingBulkCourses.length} course(s) and marked all corresponding rows as Ready!`);
    } catch (err) {
      console.error("Failed creating missing courses:", err);
      setBulkFileError(err.message || "Failed to create missing courses.");
    } finally {
      setCreatingMissingCourses(false);
    }
  }

  async function handleCreateCourseInAddStudent() {
    const cName = (newCourseNameInAdd || "").trim();
    if (!cName || cName.length < 2) {
      setAddStudentError("Course name must be at least 2 characters.");
      return;
    }
    const cap = Math.max(1, parseInt(newCourseCapacityInAdd, 10) || 40);
    const desc = (newCourseDescriptionInAdd || "").trim();

    setCreatingCourseInAdd(true);
    setAddStudentError("");

    try {
      let createdRole = null;
      try {
        const { data, error } = await supabase
          .from("roles")
          .insert({ role_name: cName, capacity: cap, description: desc })
          .select()
          .single();
        if (error) throw error;
        createdRole = data;
      } catch {
        const { data, error } = await supabase
          .from("roles")
          .insert({ role_name: cName })
          .select()
          .single();
        if (error) throw error;
        createdRole = data;
      }

      if (createdRole) {
        try {
          localStorage.setItem(`course_meta_${createdRole.id}`, JSON.stringify({ capacity: cap, description: desc }));
        } catch {}
        setRoles((prev) => [...prev, createdRole]);
        setAddStudentRoleId(String(createdRole.id));
        setShowCreateCourseInAdd(false);
        setNewCourseNameInAdd("");
        setNewCourseCapacityInAdd(40);
        setNewCourseDescriptionInAdd("");
      }
    } catch (err) {
      console.error("Failed creating course in add student:", err);
      setAddStudentError(err.message || "Failed to create course.");
    } finally {
      setCreatingCourseInAdd(false);
    }
  }

  async function handleAddStudent(e) {
    e.preventDefault();
    const sName = (addStudentName || "").trim();
    if (!sName || sName.length < 2) {
      setAddStudentError("Student name must be at least 2 characters.");
      return;
    }
    if (!addStudentRoleId) {
      setAddStudentError("Please select a course for the student.");
      return;
    }

    setAddStudentSaving(true);
    setAddStudentError("");

    try {
      const extra = {};
      if (addStudentEmail.trim()) extra.email = addStudentEmail.trim();
      if (addStudentPhone.trim()) extra.phone = addStudentPhone.trim();

      const studentRecord = {
        name: sName,
        role_id: addStudentRoleId,
      };
      if (Object.keys(extra).length > 0) {
        studentRecord.extra_fields = extra;
      }

      let createdStudent = null;
      try {
        const { data, error } = await supabase.from("students").insert(studentRecord).select().single();
        if (error) throw error;
        createdStudent = data;
      } catch {
        const { data, error } = await supabase
          .from("students")
          .insert({ name: sName, role_id: addStudentRoleId })
          .select()
          .single();
        if (error) throw error;
        createdStudent = data;
      }

      // Auto-assign student via backend
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }
        await fetch(getApiUrl("/assign-student"), {
          method: "POST",
          headers,
          body: JSON.stringify({ student_id: createdStudent.id, role_id: addStudentRoleId }),
        });
      } catch {}

      setNotice(`Student "${sName}" added and queued for training!`);
      setAddStudentModalOpen(false);
      setAddStudentName("");
      setAddStudentEmail("");
      setAddStudentPhone("");
      await loadStudents();
    } catch (err) {
      console.error("Error adding student:", err);
      setAddStudentError(err.message || "Failed to add student.");
    } finally {
      setAddStudentSaving(false);
    }
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
        role_id: r.roleId,
      }));

      const { data, error } = await supabase
        .from("students")
        .insert(recordsToInsert)
        .select("id");

      if (error) throw error;

      setNotice(`Successfully imported ${data?.length || validRows.length} students!`);
      setBulkModalOpen(false);
      setBulkParsedData([]);
      await loadStudents();
    } catch (err) {
      console.error("Bulk import error:", err);
      setBulkFileError(err.message || "Failed to import students into Supabase.");
    } finally {
      setBulkImporting(false);
    }
  }

  const hasActiveFilters = Boolean(
    search.trim() || roleFilter !== "all" || assignmentFilter !== "all" || sortBy !== "newest"
  );

  function resetFilters() {
    setSearch("");
    setRoleFilter("all");
    setAssignmentFilter("all");
    setSortBy("newest");
  }

  const validBulkCount = bulkParsedData.filter((r) => r.isValid).length;

  return (
    <section className="dashboard-content management-page">
      {/* Page Heading Row */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Students Directory</h1>
          <p className="dashboard-welcome">
            Review registered students, monitor batch allocation, and manage course enrollments.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="primary-action-button"
            style={{ background: "#2563eb" }}
            onClick={() => {
              setAddStudentModalOpen(true);
              setAddStudentName("");
              setAddStudentRoleId(roles[0]?.id || "");
              setAddStudentEmail("");
              setAddStudentPhone("");
              setAddStudentError("");
              setShowCreateCourseInAdd(false);
            }}
            type="button"
          >
            ➕ Add Student
          </button>
          <button
            className="secondary-action-button"
            onClick={() => {
              setBulkModalOpen(true);
              setBulkParsedData([]);
              setBulkFileError("");
              setMissingBulkCourses([]);
            }}
            type="button"
          >
            📥 Bulk Excel Upload
          </button>
          <button
            className="primary-action-button"
            onClick={() => navigate("/shuffle")}
            type="button"
          >
            ⚡ Batch Shuffle
          </button>
        </div>
      </div>

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

      {/* KPI Cards Row */}
      <div className="batches-kpi-grid">
        <article
          className="kpi-card"
          onClick={() => {
            setAssignmentFilter("all");
            setRoleFilter("all");
          }}
          style={{ cursor: "pointer" }}
          title="Show all students"
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
          <p className="kpi-label">Total Registered</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalStudents}</p>
            <span className="kpi-detail">Students</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => setAssignmentFilter("assigned")}
          style={{ cursor: "pointer" }}
          title="Filter by assigned students"
        >
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">In Batches</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : assignedCount}</p>
            <span className="kpi-detail">Assigned →</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => setAssignmentFilter("unassigned")}
          style={{ cursor: "pointer" }}
          title="Filter by unassigned students"
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
            <span className="kpi-detail">Awaiting Batch →</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => navigate("/courses")}
          style={{ cursor: "pointer" }}
          title="View all courses"
        >
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
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
            <p className="kpi-value">{loading ? "…" : totalRoles}</p>
            <span className="kpi-detail">Catalog →</span>
          </div>
        </article>
      </div>

      {/* Filter and Search Controls Toolbar */}
      <div className="batches-controls-card">
        <div className="batches-controls-row">
          {/* Search Box */}
          <div className="batches-search-box">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              aria-label="Search students"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student name, email, or phone..."
              type="search"
              value={search}
            />
            {search && (
              <button
                aria-label="Clear search query"
                className="batches-search-clear"
                onClick={() => setSearch("")}
                type="button"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter by Course */}
          <div className="batches-filter-group">
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Course:</span>
              <select
                aria-label="Filter by course"
                className="batches-filter-select"
                onChange={(e) => setRoleFilter(e.target.value)}
                value={roleFilter}
              >
                <option value="all">All Courses</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.role_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Assignment Status */}
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Status:</span>
              <select
                aria-label="Filter by batch assignment status"
                className="batches-filter-select"
                onChange={(e) => setAssignmentFilter(e.target.value)}
                value={assignmentFilter}
              >
                <option value="all">All Statuses</option>
                <option value="assigned">In Batch</option>
                <option value="unassigned">Awaiting Batch (Unassigned)</option>
              </select>
            </div>

            {/* Sort by */}
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Sort:</span>
              <select
                aria-label="Sort students"
                className="batches-filter-select"
                onChange={(e) => setSortBy(e.target.value)}
                value={sortBy}
              >
                <option value="newest">Registration (Newest)</option>
                <option value="oldest">Registration (Oldest)</option>
                <option value="name_asc">Name (A → Z)</option>
                <option value="name_desc">Name (Z → A)</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                className="batches-reset-filters-btn"
                onClick={resetFilters}
                type="button"
              >
                <span>↺</span> Reset Filters
              </button>
            )}
          </div>
        </div>

        <div className="batches-meta-bar">
          <span>
            Showing <strong className="batches-count-pill">{filteredStudents.length}</strong> of{" "}
            <strong>{students.length}</strong> total registered students
          </span>
          {unassignedCount > 0 && (
            <span style={{ color: "#4f46e5", fontWeight: 600 }}>
              👥 {unassignedCount} students waiting for batch assignment
            </span>
          )}
        </div>
      </div>

      {/* Students Table Card */}
      <section className="recent-students-card management-table-card">
        {/* Top Selection Toolbar */}
        <div className="students-selection-bar">
          <div className="selection-bar-left">
            <label className="select-all-label">
              <input
                type="checkbox"
                ref={selectAllRef}
                checked={allVisibleSelected}
                onChange={handleToggleSelectAll}
                className="student-select-all-checkbox"
                disabled={visibleStudentIds.length === 0}
                aria-label="Select all visible students"
              />
              <span>Select All</span>
            </label>
            <span className="selected-count-label">
              {selectedStudentIds.length} Student{selectedStudentIds.length === 1 ? "" : "s"} Selected
            </span>
          </div>
          <div className="selection-bar-right">
            <button
              type="button"
              className="delete-selected-btn"
              disabled={selectedStudentIds.length === 0 || bulkDeleting}
              onClick={() => setDeleteConfirmOpen(true)}
              title={
                selectedStudentIds.length === 0
                  ? "Select one or more students to delete"
                  : `Delete ${selectedStudentIds.length} selected student${selectedStudentIds.length === 1 ? "" : "s"}`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" width="15" height="15" aria-hidden="true">
                <path
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Delete Selected</span>
            </button>
          </div>
        </div>

        <div className="students-table-wrap">
          <table className="students-table management-table">
            <thead>
              <tr>
                <th scope="col">Student Name</th>
                <th scope="col">Course</th>
                <th scope="col">Batch Assignment</th>
                <th scope="col">Registration Date</th>
                <th scope="col" style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="table-empty" colSpan="5">
                    Loading registered students…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td className="table-empty table-error" colSpan="5">
                    {loadError}
                  </td>
                </tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan="5">
                    {students.length === 0
                      ? "No students registered yet. Share a registration link or upload via Excel."
                      : "No students matching your filter criteria."}
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student) => {
                  const isSelected = selectedStudentIds.includes(String(student.id));
                  return (
                    <tr key={student.id} className={isSelected ? "student-row-selected" : ""}>
                      <td>
                        <div className="student-name-cell">
                          <input
                            type="checkbox"
                            className="student-row-checkbox"
                            aria-label={`Select student ${student.name}`}
                            checked={isSelected}
                            onChange={() => toggleStudentSelection(student.id)}
                          />
                          <span className="student-avatar" aria-hidden="true">
                            {student.name?.charAt(0).toLocaleUpperCase() || "?"}
                          </span>
                          <span className="student-name">{student.name}</span>
                        </div>
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
                        <div className="management-actions">
                          <button
                            className="table-action"
                            onClick={() => setSelectedStudent(student)}
                            type="button"
                          >
                            View Profile
                          </button>
                          <button
                            className="table-action table-action-danger"
                            disabled={deletingId === student.id}
                            onClick={() => handleDeleteStudent(student)}
                            type="button"
                          >
                            {deletingId === student.id ? "…" : "Delete"}
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

        {/* Bottom Actions Row */}
        <div className="students-table-bottom-bar">
          <button
            type="button"
            className="delete-selected-btn"
            disabled={selectedStudentIds.length === 0 || bulkDeleting}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15" aria-hidden="true">
              <path
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Delete Selected</span>
          </button>
        </div>
      </section>

      {/* Interactive Student Details Modal */}
      {selectedStudent && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedStudent(null);
          }}
        >
          <section
            aria-labelledby="student-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "520px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">STUDENT PROFILE</p>
                <h2 id="student-dialog-title">{selectedStudent.name}</h2>
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
                <dt>Enrolled Course</dt>
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
                      Awaiting Batch Allocation
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
              {!selectedStudent.isAssigned ? (
                <button
                  className="primary-action-button"
                  onClick={() => {
                    setSelectedStudent(null);
                    navigate("/shuffle");
                  }}
                  type="button"
                >
                  Allocate in Shuffle →
                </button>
              ) : (
                <button
                  className="primary-action-button"
                  onClick={() => {
                    setSelectedStudent(null);
                    navigate("/batches");
                  }}
                  type="button"
                >
                  View Batches →
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Delete Selected Confirmation Modal */}
      {deleteConfirmOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !bulkDeleting) {
              setDeleteConfirmOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="bulk-delete-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "460px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow" style={{ color: "#dc2626" }}>DELETE CONFIRMATION</p>
                <h2 id="bulk-delete-title">Delete Selected Students</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                disabled={bulkDeleting}
                onClick={() => setDeleteConfirmOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "0 24px 20px" }}>
              <p style={{ margin: "0 0 12px", fontSize: "14px", color: "#1e293b", lineHeight: "1.5" }}>
                Are you sure you want to delete <strong>{selectedStudentIds.length}</strong> selected student{selectedStudentIds.length === 1 ? "" : "s"}?
              </p>
              <p style={{ margin: 0, fontSize: "12px", color: "#64748b", lineHeight: "1.5" }}>
                This will delete their records and remove any assigned seats in batches. This action cannot be undone.
              </p>
            </div>

            <div className="management-modal-actions">
              <button
                className="secondary-action-button"
                disabled={bulkDeleting}
                onClick={() => setDeleteConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-action-button"
                style={{ background: "#dc2626", borderColor: "#dc2626" }}
                disabled={bulkDeleting}
                onClick={handleConfirmBulkDelete}
                type="button"
              >
                {bulkDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Mass Bulk Excel Upload Modal for Students */}
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
            aria-labelledby="student-bulk-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "660px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">DATA IMPORT</p>
                <h2 id="student-bulk-title">Bulk Upload Students</h2>
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
              Upload an Excel (.xlsx, .xls) or CSV file with student names and courses.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <button
                type="button"
                className="secondary-action-button"
                style={{ fontSize: "12px", padding: "6px 12px" }}
                onClick={downloadStudentTemplate}
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

            {missingBulkCourses.length > 0 && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px 16px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong style={{ fontSize: "13px", color: "#1e40af" }}>
                    ⚡ {missingBulkCourses.length} Unregistered Course{missingBulkCourses.length > 1 ? "s" : ""} Found:
                  </strong>
                  <div style={{ fontSize: "12px", color: "#3b82f6", marginTop: "2px" }}>
                    {missingBulkCourses.join(", ")}
                  </div>
                </div>
                <button
                  type="button"
                  className="primary-action-button"
                  style={{ fontSize: "12px", padding: "6px 12px", whiteSpace: "nowrap" }}
                  disabled={creatingMissingCourses}
                  onClick={handleCreateMissingBulkCourses}
                >
                  {creatingMissingCourses ? "Creating…" : "✨ Create Courses & Validate All"}
                </button>
              </div>
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
                        <th>Student Name</th>
                        <th>Course</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkParsedData.slice(0, 50).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td style={{ fontWeight: 600 }}>{row.name || "—"}</td>
                          <td>{row.courseName || "—"}</td>
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
                  ? "Importing Students…"
                  : `Confirm Import (${validBulkCount} Students)`}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Individual Add Student Modal */}
      {addStudentModalOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !addStudentSaving) {
              setAddStudentModalOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="add-student-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "480px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">ENROLLMENT</p>
                <h2 id="add-student-title">Add New Student</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                disabled={addStudentSaving}
                onClick={() => setAddStudentModalOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <form className="management-form" onSubmit={handleAddStudent}>
              <div className="management-form-field">
                <label htmlFor="student-add-name">Full Name *</label>
                <input
                  id="student-add-name"
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={addStudentName}
                  onChange={(e) => setAddStudentName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="management-form-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label htmlFor="student-add-role" style={{ margin: 0 }}>Course / Role *</label>
                  <button
                    type="button"
                    onClick={() => setShowCreateCourseInAdd(!showCreateCourseInAdd)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#2563eb",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {showCreateCourseInAdd ? "Cancel New Course" : "+ Create New Course"}
                  </button>
                </div>

                <select
                  id="student-add-role"
                  required={!showCreateCourseInAdd}
                  value={addStudentRoleId}
                  onChange={(e) => {
                    if (e.target.value === "__NEW__") {
                      setShowCreateCourseInAdd(true);
                    } else {
                      setAddStudentRoleId(e.target.value);
                    }
                  }}
                >
                  <option value="">Select Course...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.role_name}
                    </option>
                  ))}
                  <option value="__NEW__">➕ + Create New Course...</option>
                </select>
              </div>

              {/* Inline Create Course inside Add Student Modal */}
              {showCreateCourseInAdd && (
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#f8fafc",
                    borderRadius: "8px",
                    border: "1.5px dashed #93c5fd",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e3a8a" }}>
                      ✨ Create Course On The Fly
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCreateCourseInAdd(false)}
                      style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px" }}
                    >
                      ✕
                    </button>
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Course Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Cybersecurity, DevOps"
                      value={newCourseNameInAdd}
                      onChange={(e) => setNewCourseNameInAdd(e.target.value)}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", marginTop: "2px" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <div style={{ width: "130px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Target Seats</label>
                      <input
                        type="number"
                        min="1"
                        max="5000"
                        placeholder="e.g. 40"
                        value={newCourseCapacityInAdd}
                        onChange={(e) => setNewCourseCapacityInAdd(e.target.value)}
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", marginTop: "2px" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Details / Notes</label>
                      <input
                        type="text"
                        placeholder="Optional description"
                        value={newCourseDescriptionInAdd}
                        onChange={(e) => setNewCourseDescriptionInAdd(e.target.value)}
                        style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", marginTop: "2px" }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => setShowCreateCourseInAdd(false)}
                      className="secondary-action-button"
                      style={{ padding: "5px 10px", fontSize: "11px" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={creatingCourseInAdd}
                      onClick={handleCreateCourseInAddStudent}
                      className="primary-action-button"
                      style={{ padding: "5px 12px", fontSize: "11px" }}
                    >
                      {creatingCourseInAdd ? "Saving…" : "Save Course"}
                    </button>
                  </div>
                </div>
              )}

              <div className="management-form-field">
                <label htmlFor="student-add-email">Email Address (Optional)</label>
                <input
                  id="student-add-email"
                  type="email"
                  placeholder="student@example.com"
                  value={addStudentEmail}
                  onChange={(e) => setAddStudentEmail(e.target.value)}
                />
              </div>

              <div className="management-form-field">
                <label htmlFor="student-add-phone">Phone Number (Optional)</label>
                <input
                  id="student-add-phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={addStudentPhone}
                  onChange={(e) => setAddStudentPhone(e.target.value)}
                />
              </div>

              {addStudentError && (
                <p className="management-form-error" role="alert">
                  {addStudentError}
                </p>
              )}

              <div className="management-modal-actions">
                <button
                  type="button"
                  className="secondary-action-button"
                  disabled={addStudentSaving}
                  onClick={() => setAddStudentModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-action-button"
                  disabled={addStudentSaving}
                >
                  {addStudentSaving ? "Saving Student…" : "Enroll Student"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export default Students;
