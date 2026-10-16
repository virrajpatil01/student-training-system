import { supabase } from "../supabase.js";
import { filterSystemRoles } from "../config/formConfig.js";

/**
 * Universal pagination helper to fetch all rows beyond PostgREST's 1000-row limit.
 * Uses .range(from, from + pageSize - 1) repeatedly until all records are retrieved.
 */
export async function fetchAllRows(queryFactory, pageSize = 1000) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Filter rule for eligible batches:
 * A batch is eligible if it exists and its status is not 'cancelled'.
 */
export function isBatchEligible(batch) {
  if (!batch) return false;
  const status = String(batch.status || "").toLowerCase().trim();
  return status !== "cancelled";
}

import {
  extractContact,
  extractStudentDetails,
  buildGlobalFormConfigMap,
} from "./studentDetails.js";
export { extractContact, extractStudentDetails, buildGlobalFormConfigMap };

/**
 * Computes canonical metrics according to system definitions:
 * 1. Total Students: Unique students in public.students.
 * 2. Enrolled Students: Unique students with a valid assignment in public.batch_students linked to an eligible existing batch.
 * 3. Remaining Students: Unique registered students without any valid eligible batch assignment (Total - Enrolled).
 * 4. Total Batches: Eligible existing batches (status != 'cancelled').
 * 5. Available Seats: Sum of Math.max(0, capacity - uniqueAssignedStudents) for each eligible batch.
 */
export function computeMetrics({
  students = [],
  batches = [],
  assignments = [],
  trainers = [],
  roles = [],
}) {
  // 1. Deduplicate students by unique student ID
  const studentMap = new Map();
  students.forEach((s) => {
    if (s && s.id != null) {
      studentMap.set(String(s.id), s);
    }
  });
  const totalStudents = studentMap.size;

  // 2. Filter eligible batches (not cancelled)
  const eligibleBatches = batches.filter(isBatchEligible);
  const eligibleBatchMap = new Map(eligibleBatches.map((b) => [String(b.id), b]));
  const totalBatches = eligibleBatches.length;

  // 3. Map assignments to eligible batches and valid students (prevent double counting)
  const batchStudentSetMap = new Map(); // batchId -> Set of unique studentIds
  const enrolledStudentIdSet = new Set(); // unique studentIds with valid eligible assignment
  const studentBatchMap = new Map(); // studentId -> batchId

  eligibleBatches.forEach((b) => {
    batchStudentSetMap.set(String(b.id), new Set());
  });

  assignments.forEach((a) => {
    if (!a) return;
    const sId = a.student_id != null ? String(a.student_id) : null;
    const bId = a.batch_id != null ? String(a.batch_id) : null;

    // Check validity: student must exist in public.students and batch must be an eligible active batch
    if (sId && bId && studentMap.has(sId) && eligibleBatchMap.has(bId)) {
      enrolledStudentIdSet.add(sId);
      if (!batchStudentSetMap.has(bId)) {
        batchStudentSetMap.set(bId, new Set());
      }
      batchStudentSetMap.get(bId).add(sId);
      if (!studentBatchMap.has(sId)) {
        studentBatchMap.set(sId, bId);
      }
    }
  });

  const enrolledStudents = enrolledStudentIdSet.size;
  const remainingStudents = Math.max(0, totalStudents - enrolledStudents);

  // 4. Batch capacities & available seats (strictly non-negative)
  let totalCapacity = 0;
  let totalAvailableSeats = 0;

  eligibleBatches.forEach((b) => {
    const cap = Math.max(0, Number(b.capacity) || 0);
    const assignedCount = batchStudentSetMap.get(String(b.id))?.size || 0;
    const available = Math.max(0, cap - assignedCount);
    totalCapacity += cap;
    totalAvailableSeats += available;
  });

  // 5. Trainer capacities & assigned student counts across all eligible batches
  const trainerBatchMap = new Map(); // trainerId -> array of eligible batches
  const trainerStudentSetMap = new Map(); // trainerId -> Set of unique studentIds

  trainers.forEach((t) => {
    const tid = String(t.id);
    trainerBatchMap.set(tid, []);
    trainerStudentSetMap.set(tid, new Set());
  });

  eligibleBatches.forEach((b) => {
    if (b.trainer_id) {
      const tid = String(b.trainer_id);
      if (!trainerBatchMap.has(tid)) {
        trainerBatchMap.set(tid, []);
        trainerStudentSetMap.set(tid, new Set());
      }
      const batchWithCount = {
        ...b,
        assignedCount: batchStudentSetMap.get(String(b.id))?.size || 0,
      };
      trainerBatchMap.get(tid).push(batchWithCount);

      const assignedStudentsInBatch = batchStudentSetMap.get(String(b.id)) || new Set();
      assignedStudentsInBatch.forEach((sid) => {
        trainerStudentSetMap.get(tid).add(sid);
      });
    }
  });

  const enrichedTrainers = trainers.map((t) => {
    const tid = String(t.id);
    const assignedBatches = trainerBatchMap.get(tid) || [];
    const assignedStudents = trainerStudentSetMap.get(tid)?.size || 0;
    const targetCapacity = Math.max(0, Number(t.capacity) || 30);
    const remainingCapacity = Math.max(0, targetCapacity - assignedStudents);
    const isOverCapacity = assignedStudents > targetCapacity;
    const fillPercent =
      targetCapacity > 0
        ? Math.min(100, Math.round((assignedStudents / targetCapacity) * 100))
        : 0;

    return {
      ...t,
      batches: assignedBatches,
      batchCount: assignedBatches.length,
      assignedStudents,
      targetCapacity,
      remainingCapacity,
      isOverCapacity,
      fillPercent,
    };
  });

  // 6. Unassigned students list
  const unassignedStudents = [];
  studentMap.forEach((student, sId) => {
    if (!enrolledStudentIdSet.has(sId)) {
      unassignedStudents.push(student);
    }
  });

  return {
    totalStudents,
    enrolledStudents,
    remainingStudents,
    totalBatches,
    totalCapacity,
    totalAvailableSeats,
    totalTrainers: trainers.length,
    totalRoles: roles.length,
    eligibleBatches,
    batchStudentSetMap,
    enrolledStudentIdSet,
    studentBatchMap,
    unassignedStudents,
    trainerBatchMap,
    trainerStudentSetMap,
    enrichedTrainers,
  };
}

/**
 * Shared fetcher that retrieves all raw data using full pagination
 * and computes consistent system metrics.
 */
export async function fetchSystemMetrics() {
  const [students, roles, trainers, batches, assignments, linksRes] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("students")
        .select("*, role:roles(role_name)")
        .order("created_at", { ascending: false })
    ),
    fetchAllRows(() =>
      supabase.from("roles").select("id, role_name").order("role_name", { ascending: true })
    ),
    fetchAllRows(() =>
      supabase
        .from("trainers")
        .select("id, name, email, specialization, capacity, created_at")
        .order("name", { ascending: true })
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
    supabase.from("registration_links").select("id, token, form_config"),
  ]);

  const cleanRoles = filterSystemRoles(roles);
  const formConfigMap = buildGlobalFormConfigMap(roles, linksRes?.data || []);
  const metrics = computeMetrics({ students, batches, assignments, trainers, roles: cleanRoles });

  return {
    students,
    roles: cleanRoles,
    rawRoles: roles,
    registrationLinks: linksRes?.data || [],
    formConfigMap,
    trainers,
    batches,
    assignments,
    metrics,
  };
}
