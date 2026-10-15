import math
import random
from typing import Dict, List, Any, Tuple, Optional
import numpy as np


class BalancedAssignmentModel:
    """
    ML scoring and balanced distribution model for student-batch allocation.
    Balances student load across batches of the same course while respecting
    capacity as a strict constraint.
    """

    def __init__(self, random_seed: Optional[int] = None):
        self.random_seed = random_seed
        if random_seed is not None:
            random.seed(random_seed)
            np.random.seed(random_seed)

    def calculate_balanced_quotas(
        self,
        total_students: int,
        batch_capacities: List[int]
    ) -> List[int]:
        """
        Calculates optimal balanced student quota for each batch.
        
        Example:
        - 47 students, capacities [20, 20, 20] -> [16, 16, 15]
        - 10 students, capacities [5, 5] -> [5, 5]
        - 7 students, capacities [20, 20] -> [4, 3]
        - Respects individual capacity limits as hard ceilings.
        """
        num_batches = len(batch_capacities)
        if num_batches == 0:
            return []

        total_cap = sum(batch_capacities)
        accommodate_count = min(total_students, total_cap)

        quotas = [0] * num_batches
        remaining_to_allocate = accommodate_count

        # Iteratively distribute seats to the least filled batch that has room
        while remaining_to_allocate > 0:
            # Find batches that haven't reached their capacity
            eligible_indices = [
                i for i in range(num_batches)
                if quotas[i] < batch_capacities[i]
            ]
            if not eligible_indices:
                break

            # Choose the batch with the lowest current quota (ties broken fairly)
            min_quota = min(quotas[i] for i in eligible_indices)
            candidates = [i for i in eligible_indices if quotas[i] == min_quota]
            
            # Pick candidate
            chosen_idx = random.choice(candidates)
            quotas[chosen_idx] += 1
            remaining_to_allocate -= 1

        return quotas


class CourseBatchOptimizer:
    """
    Optimization engine that applies machine-learning compatibility scoring
    and balanced quota allocation for a single course.
    """

    def __init__(self, model: Optional[BalancedAssignmentModel] = None):
        self.model = model or BalancedAssignmentModel()

    def optimize_course(
        self,
        course_id: str,
        course_name: str,
        students: List[Dict[str, Any]],
        batches: List[Dict[str, Any]],
        compatibility_scores: np.ndarray,
        trainer_capacities: Optional[Dict[str, int]] = None,
        trainer_current_counts: Optional[Dict[str, int]] = None,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
        """
        Optimizes student assignments for one course.
        
        Returns:
        1. assignments: List of new assignment records [{"student_id": ..., "batch_id": ..., ...}]
        2. unassigned_students: List of students who could not fit due to capacity
        3. metrics: Summary of quotas, load distribution, and variance
        """
        if not students or not batches:
            unassigned = [
                {
                    "student_id": str(s["id"]),
                    "student_name": s.get("name", "Unknown"),
                    "course_id": course_id,
                    "course_name": course_name,
                    "reason": "No active batches available for this course" if not batches else "No students to assign",
                }
                for s in students
            ]
            return [], unassigned, {"status": "empty", "assigned_count": 0}

        # Ensure all students belong to course_id
        valid_students = [
            s for s in students
            if str(s.get("role_id") or "") == str(course_id)
        ]
        if len(valid_students) != len(students):
            # Strict safety: filter out any student with mismatched role
            valid_students = [s for s in students if str(s.get("role_id") or "") == str(course_id)]

        n_students = len(valid_students)
        n_batches = len(batches)

        # 1. Determine effective capacity of each batch (considering trainer capacity)
        trainer_caps = trainer_capacities or {}
        trainer_counts = trainer_current_counts or {}
        effective_capacities = []
        for b in batches:
            b_cap = int(b.get("capacity") or 20)
            tid = str(b.get("trainer_id") or "")
            if tid and tid in trainer_caps:
                t_rem = max(0, trainer_caps[tid] - trainer_counts.get(tid, 0))
                effective_capacities.append(min(b_cap, t_rem))
            else:
                effective_capacities.append(b_cap)

        # 2. Calculate balanced quotas using ML balanced assignment model
        quotas = self.model.calculate_balanced_quotas(n_students, effective_capacities)

        # 3. Randomize students and sort by compatibility scores
        # Shuffling input list ensures fresh assignment on each shuffle invocation
        student_indices = list(range(n_students))
        random.shuffle(student_indices)

        batch_assignments: Dict[str, List[Dict[str, Any]]] = {
            str(b["id"]): [] for b in batches
        }
        assigned_student_ids = set()
        new_assignments = []

        # 4. Fill batches up to balanced quotas
        # For each student, rank candidate batches by ML score + quota availability
        for s_idx in student_indices:
            student = valid_students[s_idx]
            sid = str(student["id"])

            # Find batches with remaining quota
            available_batch_indices = [
                b_idx for b_idx in range(n_batches)
                if len(batch_assignments[str(batches[b_idx]["id"])]) < quotas[b_idx]
            ]

            if not available_batch_indices:
                continue

            # Score each available batch using compatibility score + slight entropy
            scored_candidates = []
            for b_idx in available_batch_indices:
                score = compatibility_scores[s_idx, b_idx] if compatibility_scores.shape == (n_students, n_batches) else 0.5
                # Add small random noise for fair tie-breaking during reshuffles
                noise = random.uniform(-0.05, 0.05)
                scored_candidates.append((score + noise, b_idx))

            scored_candidates.sort(key=lambda x: x[0], reverse=True)
            chosen_b_idx = scored_candidates[0][1]
            chosen_batch = batches[chosen_b_idx]
            chosen_bid = str(chosen_batch["id"])

            batch_assignments[chosen_bid].append(student)
            assigned_student_ids.add(sid)

            new_assignments.append({
                "student_id": sid,
                "student_name": student.get("name", "Unknown Student"),
                "batch_id": chosen_bid,
                "batch_name": chosen_batch.get("batch_name", "Unknown Batch"),
                "course_id": course_id,
                "course_name": course_name,
            })

        # 5. Collect unassigned students
        unassigned_students = []
        for student in valid_students:
            sid = str(student["id"])
            if sid not in assigned_student_ids:
                unassigned_students.append({
                    "student_id": sid,
                    "student_name": student.get("name", "Unknown Student"),
                    "course_id": course_id,
                    "course_name": course_name,
                    "reason": "All available batches for this course reached full capacity",
                })

        # 6. Compute distribution metrics
        final_counts = [len(batch_assignments[str(b["id"])]) for b in batches]
        variance = float(np.var(final_counts)) if final_counts else 0.0

        metrics = {
            "course_id": course_id,
            "course_name": course_name,
            "total_students": n_students,
            "assigned_students": len(new_assignments),
            "unassigned_students": len(unassigned_students),
            "batches_count": n_batches,
            "quotas": quotas,
            "final_batch_counts": final_counts,
            "variance": round(variance, 2),
            "is_balanced": max(final_counts) - min(final_counts) <= 1 if final_counts else True,
        }

        return new_assignments, unassigned_students, metrics
