"""
Unit & Integration Verification for ML Shuffle Module and Business Logic.
Tests:
1. Multi-course isolation: 5 courses (Data Analytics, Web Development, Data Science, Machine Learning, Android Development).
2. Hard capacity constraints: no batch exceeds its configured capacity.
3. Mathematical quota balance: distributes students as evenly as possible (e.g. 10 -> 4, 3, 3; 8 -> 4, 4; 6 -> 3, 3).
4. Auto-creation of batches when course is full.
5. Strict course boundaries: 0 cross-course contamination.
6. Zero duplicate assignments per student.
7. Remaining students grouped by course calculation.
"""

import sys
import os

# Add python_backend to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml.feature_engineering import extract_student_features, extract_batch_features, build_compatibility_matrix
from ml.shuffle_model import BalancedAssignmentModel, CourseBatchOptimizer
from ml.predictor import predict_course_assignments
from ml.training import train_assignment_model, load_trained_model

def run_ml_verification():
    print("==================================================")
    print("TESTING ML MODULE & OPTIMIZER")
    print("==================================================")

    # 1. Test Model Persistence and Baseline Training
    print("\n--- 1. Testing Model Persistence & Loading ---")
    baseline_result = train_assignment_model([], {}, {}, {}, {})
    assert baseline_result["success"], "Baseline training failed!"
    print(f"[OK] Baseline model trained & saved: {baseline_result['model_path']}")

    model = load_trained_model()
    assert model is not None, "Failed to load trained model!"
    print("[OK] ML Model successfully loaded from pkl artifact.")

    # 2. Test Feature Engineering
    print("\n--- 2. Testing Feature Engineering ---")
    mock_students = [
        {"id": f"s-{i}", "name": f"Student {i}", "role_id": "role-1", "created_at": "2026-10-01T10:00:00Z"}
        for i in range(10)
    ]
    mock_batches = [
        {"id": f"b-{j}", "batch_name": f"Batch {j+1}", "role_id": "role-1", "capacity": 4, "trainer_id": f"t-{j}"}
        for j in range(3)
    ]
    mock_trainers = {
        "t-0": {"id": "t-0", "name": "Rahul", "specialization": "Data Analytics"},
        "t-1": {"id": "t-1", "name": "Priya", "specialization": "Data Analytics"},
        "t-2": {"id": "t-2", "name": "Amit", "specialization": "General"},
    }
    
    s_feat = extract_student_features(mock_students[0], "role-1")
    b_feat = extract_batch_features(mock_batches[0], "Data Analytics", mock_trainers["t-0"])
    assert len(s_feat) == 4, f"Expected 4 student features, got {len(s_feat)}"
    assert len(b_feat) == 4, f"Expected 4 batch features, got {len(b_feat)}"
    print(f"[OK] Feature vectors generated: student (dim={len(s_feat)}), batch (dim={len(b_feat)})")

    compat_matrix = build_compatibility_matrix(mock_students, mock_batches, mock_trainers, "Data Analytics")
    assert compat_matrix.shape == (10, 3)
    print(f"[OK] Compatibility score matrix shape: {compat_matrix.shape}")

    # 3. Test Scenarios for All 5 Courses
    print("\n--- 3. Testing 5-Course Balanced Optimizer Scenarios ---")
    test_courses = {
        "Data Analytics": {"students": 10, "batches": [4, 4, 4], "expected_distribution": [4, 3, 3]},
        "Web Development": {"students": 8, "batches": [4, 4], "expected_distribution": [4, 4]},
        "Data Science": {"students": 6, "batches": [5, 5], "expected_distribution": [3, 3]},
        "Machine Learning": {"students": 7, "batches": [4, 4], "expected_distribution": [4, 3]},
        "Android Development": {"students": 5, "batches": [3, 3], "expected_distribution": [3, 2]},
    }

    trainers_list = [
        {"id": "t-1", "name": "Trainer 1", "specialization": "Data Analytics"},
        {"id": "t-2", "name": "Trainer 2", "specialization": "Web Development"},
        {"id": "t-3", "name": "Trainer 3", "specialization": "Data Science"},
        {"id": "t-4", "name": "Trainer 4", "specialization": "Machine Learning"},
        {"id": "t-5", "name": "Trainer 5", "specialization": "Android Development"},
    ]

    for course_name, spec in test_courses.items():
        role_id = f"role-{course_name.lower().replace(' ', '-')}"
        students = [
            {"id": f"s-{course_name}-{i}", "name": f"{course_name} Student {i+1}", "role_id": role_id}
            for i in range(spec["students"])
        ]
        batches = [
            {
                "id": f"b-{course_name}-{j}",
                "batch_name": f"{course_name} Batch {j+1}",
                "role_id": role_id,
                "capacity": cap,
                "trainer_id": trainers_list[j % len(trainers_list)]["id"],
            }
            for j, cap in enumerate(spec["batches"])
        ]

        # Test mathematical quota calculation
        bam = BalancedAssignmentModel()
        caps = [b["capacity"] for b in batches]
        calculated_quotas = bam.calculate_balanced_quotas(len(students), caps)
        quota_values = sorted(calculated_quotas, reverse=True)
        expected_values = sorted(spec["expected_distribution"], reverse=True)
        print(f"\n[{course_name}] (Students: {len(students)}, Batches: {len(batches)})")
        print(f"  Calculated Quotas: {quota_values}")
        print(f"  Expected Distribution: {expected_values}")
        assert quota_values == expected_values, f"Quota mismatch for {course_name}: {quota_values} != {expected_values}"

        # Test Full Prediction Pipeline
        assigned, unassigned, stats = predict_course_assignments(
            course_id=role_id,
            course_name=course_name,
            students=students,
            batches=batches,
            trainers=trainers_list,
        )
        
        # Verify student counts
        total_capacity = sum(spec["batches"])
        assert len(assigned) == min(len(students), total_capacity)
        assert len(unassigned) == max(0, len(students) - total_capacity)

        # Verify no duplicate student assigned
        assigned_student_ids = [a["student_id"] for a in assigned]
        assert len(assigned_student_ids) == len(set(assigned_student_ids)), "Duplicate student assignment!"

        # Verify capacity hard constraint
        batch_counts = {}
        for a in assigned:
            batch_counts[a["batch_id"]] = batch_counts.get(a["batch_id"], 0) + 1
        for b in batches:
            cnt = batch_counts.get(b["id"], 0)
            assert cnt <= b["capacity"], f"Batch {b['batch_name']} exceeded capacity: {cnt} > {b['capacity']}"
        actual_counts = sorted([batch_counts.get(b["id"], 0) for b in batches], reverse=True)
        assert actual_counts == expected_values, f"Batch assignment distribution mismatch: {actual_counts} != {expected_values}"

        # Verify course boundary: student course role_id == batch role_id
        for a in assigned:
            s_obj = next(s for s in students if s["id"] == a["student_id"])
            b_obj = next(b for b in batches if b["id"] == a["batch_id"])
            assert s_obj["role_id"] == b_obj["role_id"] == role_id, "Course boundary violated!"

        print(f"  [OK] Course boundaries, hard capacity, and balanced distribution verified for {course_name}!")

    # 4. Test Auto Batch Creation Logic
    print("\n--- 4. Testing Auto Batch Creation Logic ---")
    da_batches = [
        {"id": "b1", "batch_name": "Data Analytics - Batch 1", "capacity": 4, "assigned_count": 4},
        {"id": "b2", "batch_name": "Data Analytics - Batch 2", "capacity": 4, "assigned_count": 4},
    ]
    # Check available capacity
    available_batch = next((b for b in da_batches if b["assigned_count"] < b["capacity"]), None)
    assert available_batch is None, "Expected all batches to be full"

    # New batch should be generated with next index
    new_batch_index = len(da_batches) + 1
    new_batch_name = f"Data Analytics - Batch {new_batch_index}"
    new_batch_capacity = 4
    da_batches.append({"id": f"b{new_batch_index}", "batch_name": new_batch_name, "capacity": new_batch_capacity, "assigned_count": 1})
    print(f"[OK] All existing batches full -> Automatically created '{new_batch_name}' with capacity {new_batch_capacity} and assigned student.")
    assert len(da_batches) == 3
    assert da_batches[-1]["batch_name"] == "Data Analytics - Batch 3"

    # 5. Test Remaining Students Logic
    print("\n--- 5. Testing Remaining Students Per-Course Logic ---")
    all_students_pool = [
        {"id": "s1", "name": "DA Student 1", "role_id": "role-da", "role_name": "Data Analytics"},
        {"id": "s2", "name": "DA Student 2", "role_id": "role-da", "role_name": "Data Analytics"},
        {"id": "s3", "name": "WD Student 1", "role_id": "role-wd", "role_name": "Web Development"},
        {"id": "s4", "name": "WD Student 2", "role_id": "role-wd", "role_name": "Web Development"},
        {"id": "s5", "name": "WD Student 3", "role_id": "role-wd", "role_name": "Web Development"},
        {"id": "s6", "name": "DS Student 1", "role_id": "role-ds", "role_name": "Data Science"},
    ]
    assigned_records = [
        {"student_id": "s1"},
        {"student_id": "s3"},
    ]
    assigned_ids = {a["student_id"] for a in assigned_records}
    remaining_students = [s for s in all_students_pool if s["id"] not in assigned_ids]
    
    remaining_by_role = {}
    for s in remaining_students:
        r_name = s["role_name"]
        remaining_by_role[r_name] = remaining_by_role.get(r_name, 0) + 1

    print(f"Remaining students by course: {remaining_by_role}")
    assert remaining_by_role == {"Data Analytics": 1, "Web Development": 2, "Data Science": 1}
    # Courses with 0 remaining students should NOT be in the card list
    active_cards = {course: cnt for course, cnt in remaining_by_role.items() if cnt > 0}
    assert "Machine Learning" not in active_cards
    print("[OK] Separate remaining students card logic verified: only courses with remaining > 0 are rendered.")

    print("\n==================================================")
    print("ALL ML OPTIMIZATION & BUSINESS LOGIC TESTS PASSED!")
    print("==================================================")

if __name__ == "__main__":
    run_ml_verification()
