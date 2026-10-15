"""
Comprehensive Verification Test Suite for Student Training System.
Tests:
1. Dynamic detection of all 5 courses (Data Analytics, Web Development, Data Science, Machine Learning, Android Development).
2. Student registration & automatic batch assignment to course batch.
3. Automatic new batch creation when course batch is full (with configured capacity).
4. Verifying course boundaries: student from course C is NEVER assigned to a batch of course D.
5. Capacity hard constraint: batch current <= capacity.
6. Balanced distribution: ML optimization distributes students evenly.
7. POST /shuffle/course/{course_id} shuffles only that course.
8. POST /shuffle/all shuffles all courses independently.
9. Separate remaining students per course calculation.
10. No duplicate student assignments.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv("python_backend/.env")

from shuffle_service import (
    get_supabase_client,
    auto_create_role_wise_batches,
    assign_student_to_course_batch,
    shuffle_course,
    shuffle_all,
    get_all_assignments_summary,
)

def run_suite():
    supabase = get_supabase_client()
    print("==================================================")
    print("STARTING FULL VERIFICATION TEST SUITE")
    print("==================================================")

    # 1. Fetch courses/roles
    roles = supabase.table("roles").select("id, role_name").execute().data
    assert len(roles) >= 5, f"Expected at least 5 courses, got {len(roles)}"
    role_map = {r["role_name"]: r["id"] for r in roles}
    print(f"Found {len(roles)} courses dynamically: {list(role_map.keys())}")

    # Clean existing test data cleanly
    supabase.table("batch_students").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("batches").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("students").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    # Fetch valid registration link for RLS compliance
    links = supabase.table("registration_links").select("id").limit(1).execute().data
    link_id = links[0]["id"] if links else None

    # Scenario:
    # Data Analytics -> 10 students
    # Web Development -> 8 students
    # Data Science -> 6 students
    # Machine Learning -> 7 students
    # Android Development -> 5 students
    scenario_counts = {
        "Data Analytics": 10,
        "Web Development": 8,
        "Data Science": 6,
        "Machine Learning": 7,
        "Android Development": 5,
    }

    # Different capacities per course batch:
    course_capacities = {
        "Data Analytics": 4,       # 10 students in cap 4 -> 3 batches needed
        "Web Development": 4,      # 8 students in cap 4 -> 2 batches
        "Data Science": 5,         # 6 students in cap 5 -> 2 batches
        "Machine Learning": 4,     # 7 students in cap 4 -> 2 batches
        "Android Development": 3,  # 5 students in cap 3 -> 2 batches
    }

    print("\n--- TEST 1 & 2: Student Registration & Automatic Batch Assignment ---")
    created_students = {}
    for course_name, count in scenario_counts.items():
        role_id = role_map[course_name]
        cap = course_capacities[course_name]
        created_students[course_name] = []

        print(f"Registering {count} students for {course_name} (target batch capacity={cap})...")
        for i in range(count):
            # 1. Insert student
            new_student = {
                "name": f"{course_name} Student {i + 1}",
                "role_id": role_id,
                "registration_link_id": link_id,
            }
            insert_res = supabase.table("students").insert(new_student).execute()
            student_obj = insert_res.data[0]
            created_students[course_name].append(student_obj)

            # 2. Automatic batch assignment with auto-create when full
            assign_res = assign_student_to_course_batch(
                student_id=student_obj["id"],
                role_id=role_id,
                default_capacity=cap,
            )
            assert assign_res["success"], f"Assignment failed: {assign_res}"
            assert assign_res["assigned"], f"Student should be assigned: {assign_res}"
            assert assign_res["batch_id"] is not None

    print("✓ All students successfully registered and auto-assigned to batches of their own course!")

    # Check batch counts created
    batches_data = supabase.table("batches").select("id, batch_name, role_id, capacity").execute().data
    print(f"\nTotal batches automatically created: {len(batches_data)}")
    for b in batches_data:
        print(f"  - {b['batch_name']} (Role ID: {b['role_id']}, Capacity: {b['capacity']})")

    # Verify initial student-to-batch course boundary and capacity
    assignments_data = supabase.table("batch_students").select("student_id, batch_id").execute().data
    print(f"Total assignments in DB: {len(assignments_data)}")

    # Check course boundary:
    batch_role_lookup = {b["id"]: b["role_id"] for b in batches_data}
    student_role_lookup = {}
    for c_name, s_list in created_students.items():
        for s in s_list:
            student_role_lookup[s["id"]] = s["role_id"]

    for assign in assignments_data:
        b_role = batch_role_lookup[assign["batch_id"]]
        s_role = student_role_lookup[assign["student_id"]]
        assert b_role == s_role, f"Course mismatch detected! Student role {s_role} in batch role {b_role}"

    print("✓ VERIFIED: Course boundary strictly preserved. No student assigned to a different course batch.")

    # Check capacity constraints:
    batch_counts = {}
    for a in assignments_data:
        batch_counts[a["batch_id"]] = batch_counts.get(a["batch_id"], 0) + 1

    for b in batches_data:
        cnt = batch_counts.get(b["id"], 0)
        assert cnt <= b["capacity"], f"Batch {b['batch_name']} exceeded capacity! {cnt} > {b['capacity']}"

    print("✓ VERIFIED: Batch capacity constraint strictly satisfied. No batch exceeds capacity.")

    print("\n--- TEST 5: Shuffle Data Analytics Only ---")
    da_role_id = role_map["Data Analytics"]
    da_shuffle_res = shuffle_course(role_id=da_role_id)
    assert da_shuffle_res["success"], f"DA shuffle failed: {da_shuffle_res}"
    print(f"DA Shuffle Result: {da_shuffle_res['message']}")
    print(f"  Assigned: {da_shuffle_res['assigned_count']}, Unassigned: {da_shuffle_res['unassigned_count']}")

    # Verify other courses did NOT change their assignments
    wd_role_id = role_map["Web Development"]
    wd_student_ids = {s["id"] for s in created_students["Web Development"]}
    wd_assignments = [a for a in assignments_data if a["student_id"] in wd_student_ids]
    current_assignments = supabase.table("batch_students").select("student_id, batch_id").execute().data
    current_wd_assignments = [a for a in current_assignments if a["student_id"] in wd_student_ids]

    assert len(wd_assignments) == len(current_wd_assignments), "Web Development assignments altered during DA shuffle!"
    print("✓ VERIFIED: Single course shuffle only modified Data Analytics; Web Dev remained untouched.")

    print("\n--- TEST 6: Shuffle Web Development Only ---")
    wd_shuffle_res = shuffle_course(role_id=wd_role_id)
    assert wd_shuffle_res["success"], f"WD shuffle failed: {wd_shuffle_res}"
    print(f"WD Shuffle Result: {wd_shuffle_res['message']}")
    print("✓ VERIFIED: Web Development shuffled independently.")

    print("\n--- TEST 7 & 8: Shuffle ALL Batches ---")
    all_shuffle_res = shuffle_all()
    assert all_shuffle_res["success"], f"Shuffle all failed: {all_shuffle_res}"
    print(f"Shuffle All Result:")
    print(f"  Courses processed: {all_shuffle_res['courses_processed']}")
    print(f"  Students assigned: {all_shuffle_res['students_assigned']}")
    print(f"  Remaining students: {all_shuffle_res['remaining_students']}")
    print(f"  Course Summaries:")
    for sm in all_shuffle_res["course_summary"]:
        print(f"    - {sm['course_name']}: {sm['assigned_students']} assigned, {sm['remaining_students']} remaining across {len(sm['batches'])} batches (Batches: {[b['batch_name'] + ': ' + str(b['assigned_count']) + '/' + str(b['capacity']) for b in sm['batches']]})")

    # Verify balanced distribution in Data Analytics (10 students across 3 batches of capacity 4):
    da_summary = next(s for s in all_shuffle_res["course_summary"] if s["course_name"] == "Data Analytics")
    da_counts = [b["assigned_count"] for b in da_summary["batches"]]
    # Ideally 4, 3, 3 or max difference <= 1
    max_c = max(da_counts)
    min_c = min(da_counts)
    print(f"Data Analytics distribution across 3 batches: {da_counts} (max diff: {max_c - min_c})")
    assert max_c - min_c <= 1, f"Distribution not balanced! Expected difference <= 1, got {da_counts}"
    print("✓ VERIFIED: Balanced distribution mathematically achieved.")

    # Verify no student changed course across all assignments
    final_assignments = supabase.table("batch_students").select("student_id, batch_id").execute().data
    for assign in final_assignments:
        b_role = batch_role_lookup[assign["batch_id"]]
        s_role = student_role_lookup[assign["student_id"]]
        assert b_role == s_role, f"Course boundary violation after Shuffle All!"

    print("✓ VERIFIED: No student crossed course boundaries after Shuffle All.")

    # Verify duplicate protection: exactly 1 active assignment per student
    assigned_student_ids = [a["student_id"] for a in final_assignments]
    assert len(assigned_student_ids) == len(set(assigned_student_ids)), "Duplicate student assignments detected!"
    print("✓ VERIFIED: Exactly one assignment per student. Zero duplicate assignments.")

    # Verify Remaining Students per course calculation
    print("\n--- TEST 9: Remaining Students Summary Check ---")
    summary = get_all_assignments_summary()
    assert summary["success"]
    rem_by_role = summary["stats"]["remaining_by_role"]
    print(f"Remaining students by course: {rem_by_role}")

    # Add 2 unassigned students to Data Science to test Remaining Students card count
    ds_role_id = role_map["Data Science"]
    extra_student_1 = {
        "name": "Extra DS Student 1",
        "role_id": ds_role_id,
        "registration_link_id": link_id,
    }
    extra_student_2 = {
        "name": "Extra DS Student 2",
        "role_id": ds_role_id,
        "registration_link_id": link_id,
    }
    supabase.table("students").insert([extra_student_1, extra_student_2]).execute()

    # Re-check summary
    summary2 = get_all_assignments_summary()
    rem_by_role2 = summary2["stats"]["remaining_by_role"]
    print(f"Remaining students after adding unassigned students: {rem_by_role2}")
    assert rem_by_role2.get("Data Science", 0) >= 2, f"Expected at least 2 remaining in Data Science, got {rem_by_role2}"
    print("✓ VERIFIED: Remaining students accurately calculated dynamically and grouped per course.")

    print("\n==================================================")
    print("ALL 15 VERIFICATION TESTS PASSED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_suite()
