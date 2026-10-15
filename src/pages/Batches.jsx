import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { computeMetrics, fetchAllRows } from "../utils/studentMetrics";
import { getApiUrl, BACKEND_URL } from "../config/api";
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

// Database constraint values for batch_type
const BATCH_TYPE_ROLE_WISE = "role_wise";
const BATCH_TYPE_ALL_ROLE = "all_role";

// User-facing display options for batch_type
const BATCH_TYPE_OPTIONS = [
  { value: BATCH_TYPE_ROLE_WISE, label: "Course-wise Batch" },
  { value: BATCH_TYPE_ALL_ROLE, label: "All-courses Batch" },
];

// Database constraint values for status
const STATUS_UPCOMING = "upcoming";
const STATUS_ACTIVE = "active";
const STATUS_COMPLETED = "completed";
const STATUS_CANCELLED = "cancelled";

// User-facing display options for status
const STATUS_OPTIONS = [
  { value: STATUS_UPCOMING, label: "Upcoming" },
  { value: STATUS_ACTIVE, label: "Active" },
  { value: STATUS_COMPLETED, label: "Completed" },
  { value: STATUS_CANCELLED, label: "Cancelled" },
];

function getBatchTypeLabel(dbValue) {
  if (dbValue === BATCH_TYPE_ROLE_WISE) return "Course-wise Batch";
  if (dbValue === BATCH_TYPE_ALL_ROLE) return "All-courses Batch";
  return dbValue || "—";
}

function normalizeBatchType(value) {
  if (
    value === "Course-wise Batch" ||
    value === "Role-wise Batch" ||
    value === BATCH_TYPE_ROLE_WISE
  ) {
    return BATCH_TYPE_ROLE_WISE;
  }
  if (
    value === "All-courses Batch" ||
    value === "All-role Batch" ||
    value === BATCH_TYPE_ALL_ROLE
  ) {
    return BATCH_TYPE_ALL_ROLE;
  }
  return value || BATCH_TYPE_ROLE_WISE;
}

function getStatusLabel(dbValue) {
  const normalized = String(dbValue || "").toLowerCase();
  switch (normalized) {
    case STATUS_UPCOMING:
      return "Upcoming";
    case STATUS_ACTIVE:
      return "Active";
    case STATUS_COMPLETED:
      return "Completed";
    case STATUS_CANCELLED:
      return "Cancelled";
    default:
      return dbValue || "Upcoming";
  }
}

function normalizeStatus(value) {
  const normalized = String(value || "").toLowerCase().trim();
  if (
    normalized === STATUS_UPCOMING ||
    normalized === STATUS_ACTIVE ||
    normalized === STATUS_COMPLETED ||
    normalized === STATUS_CANCELLED
  ) {
    return normalized;
  }
  return STATUS_UPCOMING;
}

function extractContact(student) {
  const email =
    student.email ||
    student.extra_fields?.email ||
    student.extra_fields?.Email ||
    student.extra_fields?.["email_address"] ||
    "—";

  const phone =
    student.phone ||
    student.extra_fields?.phone ||
    student.extra_fields?.Phone ||
    student.extra_fields?.contact ||
    student.extra_fields?.["phone_number"] ||
    student.extra_fields?.mobile ||
    student.extra_fields?.Mobile ||
    "—";

  return { email, phone };
}

async function fetchBatchesData() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (!session) {
    throw new Error("Your Supabase login session is missing. Please log in again.");
  }

  const [batchesRes, rolesRes, trainersRes, assignmentsList, allStudents] = await Promise.all([
    supabase
      .from("batches")
      .select("id, batch_name, batch_type, role_id, trainer_id, capacity, status, created_at")
      .order("batch_name", { ascending: true }),
    supabase.from("roles").select("id, role_name").order("role_name", { ascending: true }),
    supabase.from("trainers").select("id, name, email, specialization, capacity").order("name", { ascending: true }),
    fetchAllRows(() => supabase.from("batch_students").select("id, batch_id, student_id")),
    fetchAllRows(() => supabase.from("students").select("*, role:roles(role_name)").order("created_at", { ascending: false })),
  ]);

  if (batchesRes.error) throw batchesRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (trainersRes.error) throw trainersRes.error;

  const rolesList = filterSystemRoles(rolesRes.data || []);
  const trainersList = trainersRes.data || [];

  const rolesMap = new Map(rolesList.map((r) => [String(r.id), r.role_name]));
  const trainersMap = new Map(trainersList.map((t) => [String(t.id), t]));

  // Compute canonical system metrics using shared rules
  const metrics = computeMetrics({
    students: allStudents,
    batches: batchesRes.data || [],
    assignments: assignmentsList,
    trainers: trainersList,
    roles: rolesList,
  });

  // Calculate unassigned students
  const unassignedStudents = allStudents
    .filter((s) => !metrics.enrolledStudentIdSet.has(String(s.id)))
    .map((s) => {
      const { email, phone } = extractContact(s);
      const roleName = Array.isArray(s.role)
        ? s.role[0]?.role_name || rolesMap.get(String(s.role_id)) || "Unassigned Course"
        : s?.role?.role_name || rolesMap.get(String(s.role_id)) || "Unassigned Course";

      return {
        id: s.id,
        name: s.name || "Unnamed Student",
        email,
        phone,
        roleId: s.role_id,
        roleName,
        createdAt: s.created_at,
        assignmentStatus: "Awaiting Batch",
      };
    });

  // Group unassigned students by their course/role
  const unassignedByRoleMap = new Map();
  rolesList.forEach((r) => {
    unassignedByRoleMap.set(String(r.id), {
      roleId: r.id,
      roleName: r.role_name,
      count: 0,
    });
  });

  unassignedStudents.forEach((s) => {
    const rId = String(s.roleId);
    if (unassignedByRoleMap.has(rId)) {
      unassignedByRoleMap.get(rId).count += 1;
    } else {
      unassignedByRoleMap.set(rId, {
        roleId: s.roleId || "other",
        roleName: s.roleName,
        count: 1,
      });
    }
  });

  const remainingByRole = Array.from(unassignedByRoleMap.values());

  const enrichedBatches = (batchesRes.data || []).map((batch) => {
    let cleanBatchName = (batch.batch_name || "").trim();
    const numMatch = cleanBatchName.match(/^(.*?)(?:\s*-\s*|\s+)Batch\s*(\d+)$/i);
    if (numMatch) {
      const rolePrefix = numMatch[1].trim();
      const numVal = parseInt(numMatch[2], 10);
      let letterSuffix = "";
      let temp = numVal;
      while (temp > 0) {
        temp--;
        letterSuffix = String.fromCharCode(65 + (temp % 26)) + letterSuffix;
        temp = Math.floor(temp / 26);
      }
      const autoName = `${rolePrefix} - Batch ${letterSuffix}`;
      if (autoName !== cleanBatchName) {
        cleanBatchName = autoName;
        supabase
          .from("batches")
          .update({ batch_name: autoName })
          .eq("id", batch.id)
          .then(() => {});
      }
    }

    const normalizedType = normalizeBatchType(batch.batch_type);
    const normalizedStat = normalizeStatus(batch.status);
    const isAllRole = normalizedType === BATCH_TYPE_ALL_ROLE;
    const trainerObj = batch.trainer_id ? trainersMap.get(String(batch.trainer_id)) : null;

    const currentStudents = metrics.batchStudentSetMap.get(String(batch.id))?.size || 0;
    const capacityVal = Math.max(0, Number(batch.capacity) || 0);
    const availableSeats = Math.max(0, capacityVal - currentStudents);
    const fillPercent = capacityVal > 0 ? Math.min(100, Math.round((currentStudents / capacityVal) * 100)) : 0;
    const isFull = capacityVal > 0 && availableSeats === 0;

    return {
      ...batch,
      batch_name: cleanBatchName,
      batch_type: normalizedType,
      batchTypeLabel: getBatchTypeLabel(normalizedType),
      status: normalizedStat,
      statusLabel: getStatusLabel(normalizedStat),
      roleName: isAllRole
        ? "All Courses"
        : batch.role_id
          ? rolesMap.get(String(batch.role_id)) || "Unknown Course"
          : "—",
      trainerName: trainerObj ? trainerObj.name : "Unassigned",
      trainerEmail: trainerObj ? trainerObj.email : "",
      trainerSpecialization: trainerObj ? trainerObj.specialization : "",
      currentStudents,
      capacity: capacityVal,
      availableSeats,
      fillPercent,
      isFull,
    };
  });

  // Sort batches strictly in alphabetical order by default
  enrichedBatches.sort((a, b) =>
    a.batch_name.localeCompare(b.batch_name, undefined, { numeric: true })
  );

  return {
    batches: enrichedBatches,
    roles: rolesList,
    trainers: metrics.enrichedTrainers || trainersList,
    assignments: assignmentsList,
    unassignedStudents,
    remainingByRole,
    totalRemainingCount: metrics.remainingStudents,
    metrics,
  };
}

function Batches() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [batches, setBatches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [unassignedStudents, setUnassignedStudents] = useState([]);
  const [remainingByRole, setRemainingByRole] = useState([]);
  const [totalRemainingCount, setTotalRemainingCount] = useState(0);
  const [metrics, setMetrics] = useState({
    totalStudents: 0,
    enrolledStudents: 0,
    remainingStudents: 0,
    totalBatches: 0,
    totalCapacity: 0,
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  // Search, Filter, Sort State
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");

  // Batch Details Modal State (on card click)
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [detailsStudents, setDetailsStudents] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsSearch, setDetailsSearch] = useState("");

  // Remaining Students Modal State (on remaining card click)
  const [remainingModalOpen, setRemainingModalOpen] = useState(false);
  const [remainingSearch, setRemainingSearch] = useState("");
  const [remainingRoleFilter, setRemainingRoleFilter] = useState("all");
  const [remainingSortBy, setRemainingSortBy] = useState("date_desc");

  // Create / Edit Batch Dialog State
  const [dialogBatch, setDialogBatch] = useState(undefined);
  const [batchName, setBatchName] = useState("");
  const [batchType, setBatchType] = useState(BATCH_TYPE_ROLE_WISE);
  const [roleId, setRoleId] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [capacity, setCapacity] = useState(30);
  const [status, setStatus] = useState(STATUS_UPCOMING);

  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyBatchId, setBusyBatchId] = useState(null);

  // Auto Create Role-wise Batches State
  const [autoCreateOpen, setAutoCreateOpen] = useState(false);
  const [autoCreateCapacity, setAutoCreateCapacity] = useState(5);
  const [autoCreateLoading, setAutoCreateLoading] = useState(false);
  const [autoCreateError, setAutoCreateError] = useState("");
  const [autoCreateSummary, setAutoCreateSummary] = useState(null);

  async function handleAutoCreateRoleWise(e) {
    if (e) e.preventDefault();
    setAutoCreateError("");
    setAutoCreateLoading(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        throw new Error("Your Supabase login session is missing. Please log in again.");
      }

      const headers = {
        "Content-Type": "application/json",
      };
      if (session.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(getApiUrl("/batches/auto-create-role-wise"), {
        method: "POST",
        headers,
        body: JSON.stringify({ batch_capacity: parseInt(autoCreateCapacity, 10) || 5 }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.detail || "Failed to auto-create batches.");
      }

      setAutoCreateSummary(result);
      setAutoCreateOpen(false);
      setNotice(result.message || "Batches auto-created successfully!");
      setLoading(true);
      await loadData();
    } catch (err) {
      console.error("Auto create batches error:", err);
      if (err.name === "TypeError" && err.message.includes("fetch")) {
        setAutoCreateError(
          `Backend service is not running. Please ensure the Python backend is active on ${BACKEND_URL}.`,
        );
      } else {
        setAutoCreateError(err.message || "Unable to auto-create batches.");
      }
    } finally {
      setAutoCreateLoading(false);
    }
  }

  const loadData = useCallback(async () => {
    try {
      const data = await fetchBatchesData();
      setLoadError("");
      setBatches(data.batches);
      setRoles(data.roles);
      setTrainers(data.trainers);
      setUnassignedStudents(data.unassignedStudents);
      setRemainingByRole(data.remainingByRole);
      setTotalRemainingCount(data.totalRemainingCount);
      if (data.metrics) {
        setMetrics(data.metrics);
      }
    } catch (error) {
      console.error("Unable to load batches:", error?.message || error);
      setBatches([]);
      setLoadError(
        error?.message?.includes("session")
          ? "Your Supabase login session is missing. Please log in again."
          : "Unable to load batches. Please check table access and policies.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        const data = await fetchBatchesData();
        if (isMounted) {
          setBatches(data.batches);
          setRoles(data.roles);
          setTrainers(data.trainers);
          setUnassignedStudents(data.unassignedStudents);
          setRemainingByRole(data.remainingByRole);
          setTotalRemainingCount(data.totalRemainingCount);
          if (data.metrics) {
            setMetrics(data.metrics);
          }
          setLoadError("");
        }
      } catch (error) {
        console.error("Unable to load batches:", error?.message || error);
        if (isMounted) {
          setBatches([]);
          setLoadError(
            error?.message?.includes("session")
              ? "Your Supabase login session is missing. Please log in again."
              : "Unable to load batches. Please check table access and policies.",
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadInitialData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Real-time automatic updates subscription on students, batch_students, batches
  useEffect(() => {
    const channel = supabase
      .channel("batches-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "batch_students" },
        () => {
          loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students" },
        () => {
          loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "batches" },
        () => {
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // If navigated with ?edit={batchId}, automatically open the edit modal
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId && batches.length > 0) {
      const target = batches.find((b) => String(b.id) === String(editId));
      if (target) {
        openEditDialog(target);
        setSearchParams({}, { replace: true });
      }
    }
  }, [batches, searchParams, setSearchParams]);

  // Card click behavior: open details modal and load assigned students
  async function handleCardClick(batch) {
    setSelectedBatch(batch);
    setDetailsSearch("");
    setDetailsLoading(true);

    try {
      const { data: assignments, error: assignErr } = await supabase
        .from("batch_students")
        .select("id, batch_id, student_id")
        .eq("batch_id", batch.id);

      if (assignErr) throw assignErr;

      const studentIds = (assignments || []).map((a) => a.student_id).filter(Boolean);
      if (studentIds.length > 0) {
        const { data: studentsData, error: stuErr } = await supabase
          .from("students")
          .select("id, name, created_at, role_id, role:roles(role_name)")
          .in("id", studentIds);

        if (stuErr) throw stuErr;

        const studentsMap = new Map((studentsData || []).map((s) => [String(s.id), s]));
        const enriched = (assignments || []).map((assign) => {
          const s = studentsMap.get(String(assign.student_id));
          const roleName = Array.isArray(s?.role)
            ? s.role[0]?.role_name || "—"
            : s?.role?.role_name || "—";
          return {
            assignmentId: assign.id,
            studentId: assign.student_id,
            name: s?.name || "Unknown Student",
            roleName: roleName,
            createdAt: s?.created_at || null,
          };
        });
        setDetailsStudents(enriched);
      } else {
        setDetailsStudents([]);
      }
    } catch (err) {
      console.error("Unable to load batch students:", err);
      setDetailsStudents([]);
    } finally {
      setDetailsLoading(false);
    }
  }

  function openAddDialog() {
    setDialogBatch(null);
    setBatchName("");
    setBatchType(BATCH_TYPE_ROLE_WISE);
    setRoleId(roles[0]?.id ? String(roles[0].id) : "");
    setTrainerId("");
    setCapacity(30);
    setStatus(STATUS_UPCOMING);
    setFormError("");
    setNotice("");
  }

  function openEditDialog(batch) {
    const normalizedType = normalizeBatchType(batch.batch_type);
    const normalizedStat = normalizeStatus(batch.status);
    setDialogBatch(batch);
    setBatchName(batch.batch_name || "");
    setBatchType(normalizedType);
    setRoleId(batch.role_id ? String(batch.role_id) : "");
    setTrainerId(batch.trainer_id ? String(batch.trainer_id) : "");
    setCapacity(batch.capacity ?? 30);
    setStatus(normalizedStat);
    setFormError("");
    setNotice("");
  }

  function closeDialog() {
    if (saving) return;
    setDialogBatch(undefined);
    setFormError("");
  }

  function handleOpenCourseRemaining(roleItem) {
    if (roleItem && roleItem.roleId) {
      setRemainingRoleFilter(String(roleItem.roleId));
    } else {
      setRemainingRoleFilter("all");
    }
    setRemainingSearch("");
    setRemainingModalOpen(true);
  }

  function handleBatchTypeChange(newType) {
    const normalized = normalizeBatchType(newType);
    setBatchType(normalized);
    if (normalized === BATCH_TYPE_ALL_ROLE) {
      setRoleId("");
    } else if (!roleId && roles.length > 0) {
      setRoleId(String(roles[0].id));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    const normalizedName = batchName.trim();
    const parsedCapacity = parseInt(capacity, 10);
    const dbBatchType = normalizeBatchType(batchType);
    const dbStatus = normalizeStatus(status);

    if (!normalizedName) {
      setFormError("Batch name is required.");
      return;
    }
    if (normalizedName.length < 2) {
      setFormError("Batch name must be at least 2 characters.");
      return;
    }

    if (
      dbBatchType !== BATCH_TYPE_ROLE_WISE &&
      dbBatchType !== BATCH_TYPE_ALL_ROLE
    ) {
      setFormError("Invalid batch type selected.");
      return;
    }

    if (
      dbStatus !== STATUS_UPCOMING &&
      dbStatus !== STATUS_ACTIVE &&
      dbStatus !== STATUS_COMPLETED &&
      dbStatus !== STATUS_CANCELLED
    ) {
      setFormError("Invalid status selected.");
      return;
    }

    if (dbBatchType === BATCH_TYPE_ROLE_WISE && !roleId) {
      setFormError("Please select a course for this course-wise batch.");
      return;
    }
    if (Number.isNaN(parsedCapacity) || parsedCapacity < 1) {
      setFormError("Capacity must be at least 1 student.");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        setFormError(sessionError.message);
        return;
      }
      if (!session) {
        setFormError("Your Supabase login session is missing. Please log in again.");
        return;
      }

      const duplicate = (batches || []).some(
        (b) =>
          String(b.id) !== String(dialogBatch?.id) &&
          b.batch_name?.trim().toLowerCase() === normalizedName.toLowerCase(),
      );

      if (duplicate) {
        setFormError("A batch with this name already exists.");
        return;
      }

      const payload = {
        batch_name: normalizedName,
        batch_type: dbBatchType,
        role_id: dbBatchType === BATCH_TYPE_ROLE_WISE ? (roleId || null) : null,
        trainer_id: trainerId ? trainerId : null,
        capacity: parsedCapacity,
        status: dbStatus,
      };

      if (dialogBatch) {
        const { data, error } = await supabase
          .from("batches")
          .update(payload)
          .eq("id", dialogBatch.id)
          .select("id")
          .maybeSingle();

        if (error) {
          console.error("Batch update error:", error?.message);
          if (
            error.code === "23505" ||
            error.message?.toLowerCase().includes("unique") ||
            error.message?.toLowerCase().includes("duplicate")
          ) {
            setFormError("A batch with this name already exists.");
          } else {
            setFormError(error.message);
          }
          return;
        }

        if (!data) {
          setFormError(
            "No batch was updated. Check that the batch exists and your admin account has permission to update it.",
          );
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("batches")
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error("Batch insert error:", error?.message);
          if (
            error.code === "23505" ||
            error.message?.toLowerCase().includes("unique") ||
            error.message?.toLowerCase().includes("duplicate")
          ) {
            setFormError("A batch with this name already exists.");
          } else {
            setFormError(error.message);
          }
          return;
        }

        if (!data) {
          setFormError(
            "Insert returned no batch. Check that your admin account has permission to insert batches.",
          );
          return;
        }

        // Automatic student assignment after batch creation
        if (data.role_id) {
          try {
            const assignRes = await fetch(getApiUrl("/batches/assign-unassigned"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({
                role_id: data.role_id,
                batch_id: data.id,
                default_capacity: data.capacity || parsedCapacity || 25,
              }),
            });
            const assignResult = await assignRes.json().catch(() => null);
            if (assignResult?.success && assignResult.students_assigned > 0) {
              setNotice(
                `✓ Batch created! Automatically assigned ${assignResult.students_assigned} unassigned students to ${assignResult.course} batches.` +
                (assignResult.batches_created > 0 ? ` (Created ${assignResult.batches_created} additional batches for overflow).` : "")
              );
            } else {
              setNotice("Batch created successfully.");
            }
          } catch (assignApiErr) {
            console.warn("Auto-assignment API call warning:", assignApiErr);
            setNotice("Batch created successfully.");
          }
        } else {
          setNotice("Batch created successfully.");
        }
      }

      setDialogBatch(undefined);
      if (dialogBatch) {
        setNotice("Batch updated successfully.");
      }
      setLoading(true);
      await loadData();
    } catch (error) {
      console.error("Unable to save batch:", error?.message || error);
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(batch) {
    setNotice("");
    setLoadError("");
    setBusyBatchId(batch.id);

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

      if (!window.confirm(`Are you sure you want to delete batch "${batch.batch_name}"?`)) {
        return;
      }

      const { data, error } = await supabase
        .from("batches")
        .delete()
        .eq("id", batch.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setLoadError("Unable to delete batch. Please try again.");
        return;
      }

      setNotice("Batch deleted successfully.");
      setLoading(true);
      await loadData();
    } catch (error) {
      console.error("Unable to delete batch:", error?.message || error);
      setLoadError("Unable to delete batch. Please try again.");
    } finally {
      setBusyBatchId(null);
    }
  }

  // Filter & Search & Sort Batches
  const filteredBatches = useMemo(() => {
    let result = [...batches];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (b) =>
          b.batch_name.toLowerCase().includes(q) ||
          b.roleName.toLowerCase().includes(q) ||
          b.trainerName.toLowerCase().includes(q)
      );
    }

    if (roleFilter !== "all") {
      result = result.filter((b) => {
        if (roleFilter === "all_role") return b.batch_type === BATCH_TYPE_ALL_ROLE;
        return String(b.role_id) === String(roleFilter);
      });
    }

    if (typeFilter !== "all") {
      result = result.filter((b) => b.batch_type === typeFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter((b) => b.status === statusFilter);
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "name_asc":
          return a.batch_name.localeCompare(b.batch_name, undefined, { numeric: true });
        case "name_desc":
          return b.batch_name.localeCompare(a.batch_name, undefined, { numeric: true });
        case "students_desc":
          return b.currentStudents - a.currentStudents;
        case "capacity_desc":
          return b.capacity - a.capacity;
        case "available_desc":
          return b.availableSeats - a.availableSeats;
        case "created_desc":
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        default:
          return 0;
      }
    });

    return result;
  }, [batches, search, roleFilter, typeFilter, statusFilter, sortBy]);

  // Filter Remaining Students in detailed modal
  const filteredRemainingStudents = useMemo(() => {
    let list = [...unassignedStudents];

    if (remainingSearch.trim()) {
      const q = remainingSearch.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q)
      );
    }

    if (remainingRoleFilter !== "all") {
      list = list.filter((s) => String(s.roleId) === String(remainingRoleFilter));
    }

    list.sort((a, b) => {
      switch (remainingSortBy) {
        case "date_desc":
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case "date_asc":
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case "name_asc":
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        case "name_desc":
          return b.name.localeCompare(a.name, undefined, { numeric: true });
        default:
          return 0;
      }
    });

    return list;
  }, [unassignedStudents, remainingSearch, remainingRoleFilter, remainingSortBy]);

  // KPI Metrics Calculation from shared definition
  const totalBatches = metrics.totalBatches;
  const totalCapacity = metrics.totalCapacity;
  const totalEnrolled = metrics.enrolledStudents;

  const hasActiveFilters = Boolean(
    search.trim() ||
    roleFilter !== "all" ||
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    sortBy !== "name_asc"
  );

  function resetFilters() {
    setSearch("");
    setRoleFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
    setSortBy("name_asc");
  }

  // Filter students within the batch details modal
  const filteredStudentsInBatch = useMemo(() => {
    if (!detailsSearch.trim()) return detailsStudents;
    const q = detailsSearch.trim().toLowerCase();
    return detailsStudents.filter((s) => s.name.toLowerCase().includes(q));
  }, [detailsStudents, detailsSearch]);

  const dialogOpen = dialogBatch !== undefined;

  return (
    <section className="dashboard-content management-page">
      {/* Top Heading Row */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Batches</h1>
          <p className="dashboard-welcome">
            Organize training cohorts, track batch capacities, and monitor student assignments.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="secondary-action-button"
            onClick={() => {
              setAutoCreateOpen(true);
              setAutoCreateError("");
              setAutoCreateCapacity(5);
            }}
            type="button"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <span aria-hidden="true">⚡</span> Auto Create Role-wise Batches
          </button>
          <button
            className="primary-action-button"
            onClick={openAddDialog}
            type="button"
          >
            <span aria-hidden="true">+</span> Create Batch
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

      {/* Top KPI Summary Grid */}
      <section aria-label="Batches Overview Metrics" className="batches-kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
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
            <span className="kpi-detail">Managed</span>
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
          <p className="kpi-label">Enrolled Students</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalEnrolled}</p>
            <span className="kpi-detail">In batches</span>
          </div>
        </article>

        <article
          className="kpi-card"
          onClick={() => setRemainingModalOpen(true)}
          style={{ cursor: "pointer" }}
          title="Click to view remaining students"
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
            <p className="kpi-value" style={{ color: "#4f46e5" }}>
              {loading ? "…" : totalRemainingCount}
            </p>
            <span className="kpi-detail">Awaiting batch</span>
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
          <p className="kpi-label">Total Capacity</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : totalCapacity}</p>
            <span className="kpi-detail">Seat limit</span>
          </div>
        </article>
      </section>

      {/* Controls & Filter Toolbar */}
      <div className="batches-controls-card">
        <div className="batches-controls-row">
          {/* Search Box */}
          <div className="batches-search-box">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle
                cx="10.8"
                cy="10.8"
                r="6.8"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="m16 16 4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <input
              aria-label="Search batches"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search batches by name, course, or trainer..."
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

          {/* Filter by Role / Course */}
          <div className="batches-filter-group">
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Course:</span>
              <select
                aria-label="Filter by role or course"
                className="batches-filter-select"
                onChange={(e) => setRoleFilter(e.target.value)}
                value={roleFilter}
              >
                <option value="all">All Courses</option>
                <option value="all_role">All-courses Batches</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.role_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Batch Type */}
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Type:</span>
              <select
                aria-label="Filter by batch type"
                className="batches-filter-select"
                onChange={(e) => setTypeFilter(e.target.value)}
                value={typeFilter}
              >
                <option value="all">All Types</option>
                <option value={BATCH_TYPE_ROLE_WISE}>Course-wise</option>
                <option value={BATCH_TYPE_ALL_ROLE}>All-courses</option>
              </select>
            </div>

            {/* Filter by Status */}
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Status:</span>
              <select
                aria-label="Filter by status"
                className="batches-filter-select"
                onChange={(e) => setStatusFilter(e.target.value)}
                value={statusFilter}
              >
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="batches-filter-select-wrap">
              <span className="batches-filter-label-prefix">Sort:</span>
              <select
                aria-label="Sort batches"
                className="batches-filter-select"
                onChange={(e) => setSortBy(e.target.value)}
                value={sortBy}
              >
                <option value="name_asc">Batch Name (A → Z)</option>
                <option value="name_desc">Batch Name (Z → A)</option>
                <option value="students_desc">Most Students</option>
                <option value="capacity_desc">Highest Capacity</option>
                <option value="available_desc">Most Available Seats</option>
                <option value="created_desc">Newest First</option>
              </select>
            </div>

            {/* Reset Filters Button */}
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

        {/* Meta count row */}
        <div className="batches-meta-bar">
          <span>
            Showing <strong className="batches-count-pill">{filteredBatches.length}</strong> of{" "}
            <strong>{batches.length}</strong> total batches
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#4f46e5", fontWeight: "600" }}>
              👥 {totalRemainingCount} remaining unassigned
            </span>
          </span>
        </div>
      </div>

      {/* Main Batches Content */}
      {loading ? (
        <div className="recent-students-card" style={{ padding: "60px 20px", textAlign: "center" }}>
          <div
            className="button-spinner"
            style={{ margin: "0 auto 16px", width: "28px", height: "28px", color: "#315ce8" }}
          />
          <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>
            Loading dynamic batches from Supabase...
          </p>
        </div>
      ) : batches.length === 0 ? (
        /* Empty State: No batches in database */
        <div className="batches-empty-card">
          <div className="batches-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2 className="batches-empty-title">No Batches Created Yet</h2>
          <p className="batches-empty-desc">
            {totalRemainingCount > 0
              ? `There are ${totalRemainingCount} registered students waiting for batch allocation. Create your first batch or auto-generate batches now.`
              : "Get started by creating your first training batch or automatically generate course-wise batches based on registered students."}
          </p>
          <div className="batches-empty-actions">
            <button
              className="primary-action-button"
              onClick={openAddDialog}
              type="button"
            >
              + Create First Batch
            </button>
            <button
              className="secondary-action-button"
              onClick={() => {
                setAutoCreateOpen(true);
                setAutoCreateError("");
                setAutoCreateCapacity(5);
              }}
              type="button"
            >
              ⚡ Auto Create Batches
            </button>
          </div>
        </div>
      ) : filteredBatches.length === 0 && hasActiveFilters ? (
        /* Empty State: Filters matched 0 batches */
        <div className="batches-empty-card">
          <div className="batches-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="batches-empty-title">No Batches Match Your Filters</h2>
          <p className="batches-empty-desc">
            We couldn't find any batches matching your current search or filter criteria.
            Try resetting your filters to see all batches.
          </p>
          <div className="batches-empty-actions">
            <button
              className="primary-action-button"
              onClick={resetFilters}
              type="button"
            >
              Reset All Filters
            </button>
          </div>
        </div>
      ) : (
        /* 
          Batches Grid:
          - Desktop: 3 cards per row
          - Tablet: 2 cards per row
          - Mobile: 1 card per row
          - Followed by the "Remaining Students" Card after normal batch cards!
        */
        <div className="batches-grid">
          {filteredBatches.map((batch) => (
            <article
              key={batch.id}
              className="batch-card"
              onClick={() => handleCardClick(batch)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick(batch);
                }
              }}
              role="button"
              tabIndex={0}
            >
              {/* Card Header: Batch Name, Course Badge, Status */}
              <div className="batch-card-header">
                <div className="batch-card-title-group">
                  <h2 className="batch-card-title">{batch.batch_name}</h2>
                  <span className="batch-card-course-badge">{batch.roleName}</span>
                </div>
                <span className={`batch-status-badge status-${batch.status}`}>
                  <span className="batch-status-dot" aria-hidden="true" />
                  {batch.statusLabel}
                </span>
              </div>

              {/* Card Body: Trainer, Type, Capacity UI */}
              <div className="batch-card-body">
                <div className="batch-card-info-item">
                  <span className="batch-info-label">Trainer:</span>
                  <span className={`batch-info-value ${!batch.trainer_id ? "is-unassigned" : ""}`}>
                    {batch.trainerName}
                  </span>
                </div>

                <div className="batch-card-info-item">
                  <span className="batch-info-label">Type:</span>
                  <span className="batch-info-value">{batch.batchTypeLabel}</span>
                </div>

                {/* Capacity UI Box */}
                <div className="batch-card-capacity-box">
                  <div className="batch-capacity-numbers">
                    <span className="batch-capacity-count">
                      <strong>Students:</strong> {batch.currentStudents} / {batch.capacity}
                    </span>
                    <span className={`batch-available-seats ${batch.isFull ? "is-full" : ""}`}>
                      <strong>Available Seats:</strong> {batch.availableSeats}
                    </span>
                  </div>

                  {/* Progress Indicator */}
                  <div
                    className="batch-progress-track"
                    aria-label={`Capacity: ${batch.currentStudents} of ${batch.capacity} students (${batch.fillPercent}% full)`}
                  >
                    <div
                      className={`batch-progress-fill ${
                        batch.isFull
                          ? "fill-full"
                          : batch.fillPercent >= 75
                          ? "fill-warning"
                          : "fill-normal"
                      }`}
                      style={{ width: `${Math.min(100, batch.fillPercent)}%` }}
                    />
                  </div>

                  <div className="batch-capacity-footer">
                    <span>{batch.fillPercent}% filled</span>
                    {batch.isFull ? (
                      <span className="batch-full-pill">Batch Full</span>
                    ) : (
                      <span>{batch.availableSeats} seats open</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer: View Details & Actions */}
              <div
                className="batch-card-footer"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="batch-card-view-btn"
                  onClick={() => handleCardClick(batch)}
                  type="button"
                >
                  View Details
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                <div className="batch-card-actions">
                  <button
                    className="batch-btn-subtle"
                    onClick={() => openEditDialog(batch)}
                    title="Edit Batch"
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="batch-btn-subtle btn-danger"
                    disabled={busyBatchId === batch.id}
                    onClick={() => handleDelete(batch)}
                    title="Delete Batch"
                    type="button"
                  >
                    {busyBatchId === batch.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ==============================================================================
          SEPARATE REMAINING STUDENTS CARDS PER COURSE
          (Dynamically generated for each course with remaining > 0 students)
          ============================================================================== */}
      {!loading && remainingByRole.filter((item) => item.count > 0).length > 0 && (
        <section className="remaining-students-section" aria-label="Remaining Students by Course" style={{ marginTop: "32px", marginBottom: "28px" }}>
          <div className="section-heading" style={{ marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", fontWeight: "800", color: "#1e293b", margin: "0 0 4px 0" }}>
                Remaining Students
              </h2>
              <p style={{ fontSize: "14px", color: "#64748b", margin: 0 }}>
                Unassigned students grouped by course. Click any course card to inspect student details.
              </p>
            </div>
            <span className="section-count" style={{ background: "#eef2ff", color: "#4f46e5", fontWeight: "700" }}>
              {totalRemainingCount} Total Unassigned
            </span>
          </div>

          <div className="remaining-cards-grid">
            {remainingByRole
              .filter((item) => item.count > 0)
              .map((item) => (
                <article
                  key={item.roleId}
                  className="remaining-course-card"
                  onClick={() => handleOpenCourseRemaining(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpenCourseRemaining(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={`Click to view unassigned students in ${item.roleName}`}
                >
                  <div className="remaining-course-card-top">
                    <span className="remaining-course-badge">{item.roleName}</span>
                    <span className="remaining-status-pill">● Unassigned</span>
                  </div>

                  <div className="remaining-course-card-body">
                    <p className="remaining-number">{item.count}</p>
                    <p className="remaining-label">Remaining Students</p>
                  </div>

                  <div className="remaining-course-card-footer">
                    <span>View {item.roleName} students</span>
                    <span aria-hidden="true">→</span>
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}

      {/* ==============================================================================
          REMAINING STUDENTS DETAILED MODAL VIEW
          ============================================================================== */}
      {remainingModalOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRemainingModalOpen(false);
          }}
        >
          <section
            aria-labelledby="remaining-dialog-title"
            aria-modal="true"
            className="management-modal remaining-modal"
            role="dialog"
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">UNASSIGNED REGISTRATIONS</p>
                <h2 id="remaining-dialog-title">
                  Remaining Students ({unassignedStudents.length})
                </h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setRemainingModalOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "0 24px 12px" }}>
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                The following students are registered in the system but not yet assigned to any batch.
                Use <strong>Batch Shuffle</strong> or create batches to assign them.
              </p>
            </div>

            {/* Modal Filters Toolbar */}
            <div className="remaining-modal-toolbar">
              <div className="batches-search-box" style={{ flex: "1 1 200px" }}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" />
                  <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input
                  aria-label="Search remaining students"
                  onChange={(e) => setRemainingSearch(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  type="search"
                  value={remainingSearch}
                />
                {remainingSearch && (
                  <button
                    aria-label="Clear search"
                    className="batches-search-clear"
                    onClick={() => setRemainingSearch("")}
                    type="button"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="batches-filter-select-wrap">
                <span className="batches-filter-label-prefix">Course:</span>
                <select
                  aria-label="Filter remaining students by course"
                  className="batches-filter-select"
                  onChange={(e) => setRemainingRoleFilter(e.target.value)}
                  value={remainingRoleFilter}
                >
                  <option value="all">All Courses</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.role_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="batches-filter-select-wrap">
                <span className="batches-filter-label-prefix">Sort:</span>
                <select
                  aria-label="Sort remaining students"
                  className="batches-filter-select"
                  onChange={(e) => setRemainingSortBy(e.target.value)}
                  value={remainingSortBy}
                >
                  <option value="date_desc">Registration (Newest)</option>
                  <option value="date_asc">Registration (Oldest)</option>
                  <option value="name_asc">Name (A → Z)</option>
                  <option value="name_desc">Name (Z → A)</option>
                </select>
              </div>

              {(remainingSearch || remainingRoleFilter !== "all" || remainingSortBy !== "date_desc") && (
                <button
                  className="batches-reset-filters-btn"
                  onClick={() => {
                    setRemainingSearch("");
                    setRemainingRoleFilter("all");
                    setRemainingSortBy("date_desc");
                  }}
                  type="button"
                >
                  ↺ Reset
                </button>
              )}
            </div>

            {/* Modal Table Wrap */}
            <div style={{ padding: "0 24px 20px" }}>
              <div
                className="batch-students-table-wrap"
                style={{
                  maxHeight: "360px",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                }}
              >
                {filteredRemainingStudents.length === 0 ? (
                  <div className="batch-students-empty">
                    {unassignedStudents.length === 0
                      ? "All registered students have been assigned to batches! 🎉"
                      : "No unassigned students match your current filters."}
                  </div>
                ) : (
                  <table className="students-table management-table">
                    <thead>
                      <tr>
                        <th scope="col">Student Name</th>
                        <th scope="col">Email</th>
                        <th scope="col">Phone</th>
                        <th scope="col">Course / Role</th>
                        <th scope="col">Registration Date</th>
                        <th scope="col">Assignment Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRemainingStudents.map((stu) => (
                        <tr key={stu.id}>
                          <td>
                            <span className="student-avatar" aria-hidden="true">
                              {stu.name?.charAt(0).toLocaleUpperCase() || "?"}
                            </span>
                            <span className="student-name">{stu.name}</span>
                          </td>
                          <td>{stu.email}</td>
                          <td>{stu.phone}</td>
                          <td>
                            <span className="field-tag">{stu.roleName}</span>
                          </td>
                          <td>{formatDate(stu.createdAt)}</td>
                          <td>
                            <span className="remaining-assignment-tag">
                              <span className="remaining-assignment-dot" aria-hidden="true" />
                              {stu.assignmentStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div
              className="management-modal-actions"
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                Showing <strong>{filteredRemainingStudents.length}</strong> of{" "}
                <strong>{unassignedStudents.length}</strong> remaining students
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="secondary-action-button"
                  onClick={() => setRemainingModalOpen(false)}
                  type="button"
                >
                  Close
                </button>
                <button
                  className="primary-action-button"
                  onClick={() => {
                    setRemainingModalOpen(false);
                    navigate("/shuffle");
                  }}
                  type="button"
                >
                  Go to Batch Shuffle →
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ==============================================================================
          BATCH DETAILS MODAL (Interactive overview with assigned students)
          ============================================================================== */}
      {selectedBatch && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedBatch(null);
          }}
        >
          <section
            aria-labelledby="batch-details-title"
            aria-modal="true"
            className="management-modal batch-details-modal"
            role="dialog"
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">BATCH OVERVIEW & DETAILS</p>
                <h2 id="batch-details-title">{selectedBatch.batch_name}</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setSelectedBatch(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="batch-details-content">
              {/* KPI Mini Grid */}
              <div className="batch-details-kpi-grid">
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Role / Course</div>
                  <div className="batch-details-kpi-val" style={{ fontSize: "15px" }}>
                    {selectedBatch.roleName}
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Batch Status</div>
                  <div>
                    <span className={`batch-status-badge status-${selectedBatch.status}`}>
                      <span className="batch-status-dot" aria-hidden="true" />
                      {selectedBatch.statusLabel}
                    </span>
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Enrolled / Capacity</div>
                  <div className="batch-details-kpi-val">
                    {selectedBatch.currentStudents} / {selectedBatch.capacity}
                  </div>
                </div>
                <div className="batch-details-kpi-box">
                  <div className="batch-details-kpi-label">Available Seats</div>
                  <div
                    className="batch-details-kpi-val"
                    style={{ color: selectedBatch.isFull ? "#e11d48" : "#0d9488" }}
                  >
                    {selectedBatch.availableSeats}
                  </div>
                </div>
              </div>

              {/* Capacity Progress Bar */}
              <div className="batch-card-capacity-box" style={{ margin: 0 }}>
                <div className="batch-capacity-numbers">
                  <span className="batch-capacity-count">
                    Capacity Utilization: <strong>{selectedBatch.fillPercent}% filled</strong>
                  </span>
                  <span className={`batch-available-seats ${selectedBatch.isFull ? "is-full" : ""}`}>
                    {selectedBatch.isFull
                      ? "Full (0 seats left)"
                      : `${selectedBatch.availableSeats} seats remaining`}
                  </span>
                </div>
                <div className="batch-progress-track">
                  <div
                    className={`batch-progress-fill ${
                      selectedBatch.isFull
                        ? "fill-full"
                        : selectedBatch.fillPercent >= 75
                        ? "fill-warning"
                        : "fill-normal"
                    }`}
                    style={{ width: `${Math.min(100, selectedBatch.fillPercent)}%` }}
                  />
                </div>
              </div>

              {/* Two Column Cards: Trainer Info & Batch Info */}
              <div className="batch-details-info-grid">
                <div className="batch-details-section-card">
                  <h3 className="batch-details-section-title">
                    <span>👨‍🏫 Trainer Information</span>
                  </h3>
                  <dl className="batch-details-dl">
                    <div className="batch-details-dl-row">
                      <dt>Trainer Name</dt>
                      <dd>{selectedBatch.trainerName}</dd>
                    </div>
                    <div className="batch-details-dl-row">
                      <dt>Email</dt>
                      <dd>{selectedBatch.trainerEmail || "—"}</dd>
                    </div>
                    <div className="batch-details-dl-row">
                      <dt>Specialization</dt>
                      <dd>{selectedBatch.trainerSpecialization || "General"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="batch-details-section-card">
                  <h3 className="batch-details-section-title">
                    <span>⚙️ Batch Parameters</span>
                  </h3>
                  <dl className="batch-details-dl">
                    <div className="batch-details-dl-row">
                      <dt>Batch Type</dt>
                      <dd>{selectedBatch.batchTypeLabel}</dd>
                    </div>
                    <div className="batch-details-dl-row">
                      <dt>Course</dt>
                      <dd>{selectedBatch.roleName}</dd>
                    </div>
                    <div className="batch-details-dl-row">
                      <dt>Created Date</dt>
                      <dd>{formatDate(selectedBatch.created_at)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Assigned Students List */}
              <div className="batch-students-section">
                <div className="batch-students-header">
                  <div className="batch-students-title-row">
                    <h3 className="batch-students-title">Assigned Students</h3>
                    <span className="batch-students-count-badge">
                      {detailsStudents.length} {detailsStudents.length === 1 ? "student" : "students"}
                    </span>
                  </div>
                  {detailsStudents.length > 5 && (
                    <input
                      aria-label="Filter students in batch"
                      className="batch-students-search"
                      onChange={(e) => setDetailsSearch(e.target.value)}
                      placeholder="Search student..."
                      value={detailsSearch}
                    />
                  )}
                </div>

                <div className="batch-students-table-wrap">
                  {detailsLoading ? (
                    <div className="batch-students-empty">Loading assigned students…</div>
                  ) : filteredStudentsInBatch.length === 0 ? (
                    <div className="batch-students-empty">
                      {detailsStudents.length === 0
                        ? "No students are currently assigned to this batch. Use Shuffle to assign registered students."
                        : "No students matching your search query."}
                    </div>
                  ) : (
                    <table className="students-table management-table">
                      <thead>
                        <tr>
                          <th scope="col">Student Name</th>
                          <th scope="col">Course</th>
                          <th scope="col">Registered Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudentsInBatch.map((stu) => (
                          <tr key={stu.assignmentId || stu.studentId}>
                            <td>
                              <span className="student-avatar" aria-hidden="true">
                                {stu.name?.charAt(0).toLocaleUpperCase() || "?"}
                              </span>
                              <span className="student-name">{stu.name}</span>
                            </td>
                            <td>
                              <span className="field-tag">{stu.roleName}</span>
                            </td>
                            <td>{formatDate(stu.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div
              className="management-modal-actions"
              style={{ padding: "16px 24px", borderTop: "1px solid #e2e8f0" }}
            >
              <button
                className="secondary-action-button"
                onClick={() => setSelectedBatch(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="secondary-action-button"
                onClick={() => {
                  const b = selectedBatch;
                  setSelectedBatch(null);
                  openEditDialog(b);
                }}
                type="button"
              >
                Edit Batch
              </button>
              <button
                className="primary-action-button"
                onClick={() => navigate(`/batches/${selectedBatch.id}`)}
                type="button"
              >
                Open Full Details Page →
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ==============================================================================
          ADD / EDIT BATCH MODAL DIALOG
          ============================================================================== */}
      {dialogOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            aria-labelledby="batch-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">BATCH DETAILS</p>
                <h2 id="batch-dialog-title">
                  {dialogBatch ? "Edit Batch" : "Create Batch"}
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
                  <label htmlFor="batch-name">Batch Name *</label>
                  <input
                    autoFocus
                    id="batch-name"
                    maxLength={120}
                    onChange={(event) => setBatchName(event.target.value)}
                    placeholder="e.g. Batch 1 or Data Analytics - Batch A"
                    required
                    value={batchName}
                  />
                </div>

                <div className="management-form-field">
                  <label htmlFor="batch-type">Batch Type *</label>
                  <select
                    id="batch-type"
                    onChange={(event) => handleBatchTypeChange(event.target.value)}
                    required
                    value={batchType}
                  >
                    {BATCH_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="management-form-field">
                  <label htmlFor="batch-role">
                    Course {batchType === BATCH_TYPE_ROLE_WISE ? "*" : "(Disabled for All-courses Batch)"}
                  </label>
                  <select
                    disabled={batchType === BATCH_TYPE_ALL_ROLE}
                    id="batch-role"
                    onChange={(event) => setRoleId(event.target.value)}
                    required={batchType === BATCH_TYPE_ROLE_WISE}
                    value={roleId}
                  >
                    {batchType === BATCH_TYPE_ALL_ROLE ? (
                      <option value="">Applies to all courses</option>
                    ) : (
                      <>
                        <option value="">Select a course</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.role_name}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                <div className="management-form-field">
                  <label htmlFor="batch-trainer">Trainer</label>
                  <select
                    id="batch-trainer"
                    onChange={(event) => setTrainerId(event.target.value)}
                    value={trainerId}
                  >
                    <option value="">Unassigned</option>
                    {(() => {
                      const selectedCourseName = roles.find((r) => String(r.id) === String(roleId))?.role_name;
                      const checkMatch = (tr) => {
                        if (!selectedCourseName || !tr.specialization) return false;
                        const specs = tr.specialization.split(",").map((s) => s.trim().toLowerCase());
                        const c = selectedCourseName.trim().toLowerCase();
                        return specs.some((s) => s === c || s.includes(c) || c.includes(s));
                      };

                      return trainers.map((trainer) => {
                        const isMatch = checkMatch(trainer);
                        const specInfo = isMatch
                          ? `⭐ Specializes in ${selectedCourseName}`
                          : trainer.specialization
                            ? `[${trainer.specialization}]`
                            : "";
                        const capInfo = trainer.targetCapacity != null
                          ? trainer.remainingCapacity <= 0
                            ? `⚠️ Full (${trainer.assignedStudents}/${trainer.targetCapacity})`
                            : `(${trainer.remainingCapacity} seats open • ${trainer.assignedStudents}/${trainer.targetCapacity})`
                          : "";
                        return (
                          <option key={trainer.id} value={trainer.id}>
                            {trainer.name} {capInfo} {specInfo}
                          </option>
                        );
                      });
                    })()}
                  </select>
                  {(() => {
                    const selTrainer = trainers.find((t) => String(t.id) === String(trainerId));
                    if (selTrainer && selTrainer.targetCapacity != null) {
                      if (selTrainer.isOverCapacity) {
                        return (
                          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#ef4444", fontWeight: 600 }}>
                            ⚠️ Caution: {selTrainer.name} is currently over capacity ({selTrainer.assignedStudents} assigned across active batches vs {selTrainer.targetCapacity} target).
                          </p>
                        );
                      }
                      if (selTrainer.remainingCapacity <= 0) {
                        return (
                          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#f59e0b", fontWeight: 600 }}>
                            ⚠️ Notice: {selTrainer.name} has reached their Target Capacity ({selTrainer.assignedStudents}/{selTrainer.targetCapacity} seats).
                          </p>
                        );
                      }
                      return (
                        <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#10b981", fontWeight: 500 }}>
                          ✓ {selTrainer.remainingCapacity} seats remaining under target capacity ({selTrainer.assignedStudents}/{selTrainer.targetCapacity}).
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div className="management-form-field">
                  <label htmlFor="batch-capacity">Student Capacity *</label>
                  <input
                    id="batch-capacity"
                    max={500}
                    min={1}
                    onChange={(event) => setCapacity(event.target.value)}
                    placeholder="25"
                    required
                    type="number"
                    value={capacity}
                  />
                </div>

                <div className="management-form-field">
                  <label htmlFor="batch-status">Status *</label>
                  <select
                    id="batch-status"
                    onChange={(event) => setStatus(event.target.value)}
                    required
                    value={status}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
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
                    ? "Saving..."
                    : dialogBatch
                      ? "Save Changes"
                      : "Create Batch"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ==============================================================================
          AUTO CREATE ROLE-WISE BATCHES CONFIRMATION MODAL
          ============================================================================== */}
      {autoCreateOpen && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !autoCreateLoading) setAutoCreateOpen(false);
          }}
        >
          <section
            aria-labelledby="auto-create-dialog-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "520px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">AUTOMATED GENERATION</p>
                <h2 id="auto-create-dialog-title">Auto Create Role-wise Batches</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                disabled={autoCreateLoading}
                onClick={() => setAutoCreateOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleAutoCreateRoleWise} className="management-form">
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b", marginBottom: "6px" }}>
                  Create role-wise batches from registered students?
                </p>
                <p style={{ fontSize: "13px", color: "#64748b", lineHeight: "1.5" }}>
                  The system analyzes all registered students, groups them strictly by their assigned course/role,
                  and generates only the necessary batches based on your configured capacity.
                </p>
              </div>

              <div className="management-form-field" style={{ marginBottom: "16px" }}>
                <label htmlFor="auto-create-capacity">Batch Capacity (Students per Batch) *</label>
                <input
                  id="auto-create-capacity"
                  type="number"
                  min={1}
                  max={500}
                  required
                  value={autoCreateCapacity}
                  onChange={(e) => setAutoCreateCapacity(e.target.value)}
                  disabled={autoCreateLoading}
                  placeholder="5"
                />
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  Default is 5 students per batch. Batches are named dynamically in alphabetical order (e.g. Data Analytics - Batch A, Batch B).
                </span>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  marginBottom: "16px",
                  fontSize: "12px",
                  color: "#475569",
                }}
              >
                <div style={{ fontWeight: "600", color: "#334155", marginBottom: "4px" }}>Guarantees:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span>✓ <strong>Role Isolation:</strong> Students from different roles are never mixed.</span>
                  <span>✓ <strong>Duplicate Prevention:</strong> Existing capacity is verified; no duplicate batches are created.</span>
                  <span>✓ <strong>Separate Workflow:</strong> Batches are created now; student shuffling occurs later on the Shuffle page.</span>
                </div>
              </div>

              {autoCreateError && (
                <p className="management-form-error" role="alert">
                  {autoCreateError}
                </p>
              )}

              <div className="management-modal-actions">
                <button
                  className="secondary-action-button"
                  disabled={autoCreateLoading}
                  onClick={() => setAutoCreateOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-action-button"
                  disabled={autoCreateLoading}
                  type="submit"
                >
                  {autoCreateLoading ? (
                    <>
                      <span className="button-spinner" aria-hidden="true" />
                      Creating Batches…
                    </>
                  ) : (
                    "Create Batches"
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ==============================================================================
          AUTO CREATE SUMMARY MODAL
          ============================================================================== */}
      {autoCreateSummary && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAutoCreateSummary(null);
          }}
        >
          <section
            aria-labelledby="auto-summary-title"
            aria-modal="true"
            className="management-modal"
            role="dialog"
            style={{ maxWidth: "560px" }}
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">CREATION SUMMARY</p>
                <h2 id="auto-summary-title">Batches Creation Result</h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setAutoCreateSummary(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <div style={{ padding: "4px 0 16px" }}>
              <p style={{ fontSize: "14px", fontWeight: "600", color: "#0f766e", marginBottom: "12px" }}>
                {autoCreateSummary.message}
              </p>

              {autoCreateSummary.created_batches?.length > 0 ? (
                <div>
                  <p style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b", marginBottom: "8px" }}>
                    Newly Created Batches ({autoCreateSummary.created_batches.length}):
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "240px", overflowY: "auto" }}>
                    {autoCreateSummary.details
                      ?.filter((d) => d.created_batches?.length > 0)
                      .map((d) => (
                        <div
                          key={d.role_id}
                          style={{
                            background: "#f1f5f9",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div style={{ fontWeight: "700", fontSize: "13px", color: "#334155", marginBottom: "4px" }}>
                            {d.role_name} ({d.unassigned_students} students awaiting batch)
                          </div>
                          <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "13px", color: "#0f766e" }}>
                            {d.created_batches.map((bName) => (
                              <li key={bName} style={{ fontWeight: "600" }}>
                                {bName}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div style={{ background: "#f8fafc", borderRadius: "6px", padding: "12px", color: "#475569", fontSize: "13px" }}>
                  No new batches needed. Existing batches have sufficient seats for all registered students.
                </div>
              )}
            </div>

            <div className="management-modal-actions">
              <button
                className="secondary-action-button"
                onClick={() => setAutoCreateSummary(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="primary-action-button"
                onClick={() => {
                  setAutoCreateSummary(null);
                  navigate("/shuffle");
                }}
                type="button"
              >
                Proceed to Shuffle →
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default Batches;
