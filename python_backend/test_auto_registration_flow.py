import os
import sys
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Load environment
backend_env_path = Path(__file__).parent / ".env"
root_env_path = Path(__file__).parent.parent / ".env"
from dotenv import load_dotenv
if backend_env_path.exists():
    load_dotenv(dotenv_path=backend_env_path)
elif root_env_path.exists():
    load_dotenv(dotenv_path=root_env_path)

from shuffle_service import (
    get_supabase_client,
    assign_student_to_batch,
    determine_next_batch_name,
)



def run_tests():
    client = get_supabase_client()
    print("==================================================")
    print("STARTING TEST SUITE: AUTOMATIC REGISTRATION -> BATCH ASSIGNMENT")
    print("==================================================")

    # 1. Fetch existing roles
    roles_res = client.table("roles").select("id, role_name").execute()
    roles = roles_res.data or []
    da_role = next((r for r in roles if "data analytics" in r["role_name"].lower()), roles[0])
    wd_role = next((r for r in roles if "web development" in r["role_name"].lower()), roles[1] if len(roles) > 1 else roles[0])
    other_role = next((r for r in roles if r["id"] not in (da_role["id"], wd_role["id"])), roles[-1])

    print(f"Role 1: {da_role['role_name']} ({da_role['id']})")
    print(f"Role 2: {wd_role['role_name']} ({wd_role['id']})")
    print(f"Role 3 (Empty course test): {other_role['role_name']} ({other_role['id']})")

    # Tracking created resources for cleanup
    created_student_ids = []
    created_batch_ids = []

    def create_test_student(name: str, role_id: str) -> str:
        res = client.table("students").insert({
            "name": name,
            "role_id": role_id
        }).execute()
        sid = str(res.data[0]["id"])
        created_student_ids.append(sid)
        return sid

    def create_test_batch(name: str, role_id: str, capacity: int = 7) -> str:
        res = client.table("batches").insert({
            "batch_name": name,
            "role_id": role_id,
            "batch_type": "role_wise",
            "capacity": capacity,
            "status": "upcoming"
        }).execute()
        bid = str(res.data[0]["id"])
        created_batch_ids.append(bid)
        return bid

    try:
        # ----------------------------------------------------
        # TEST 1: DA Batch A = 6/7, New DA student -> Expected: DA Batch A = 7/7, No remaining
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 1: Existing Batch with room (6/7 -> 7/7) ---")
        da_batch_a_id = create_test_batch("Data Analytics - Batch A", da_role["id"], capacity=7)
        # Fill 6 students
        for i in range(6):
            sid = create_test_student(f"DA Student {i+1}", da_role["id"])
            client.table("batch_students").insert({"batch_id": da_batch_a_id, "student_id": sid}).execute()

        # New DA student registers
        new_da_student = create_test_student("DA Student 7 (New)", da_role["id"])
        res1 = assign_student_to_batch(new_da_student, role_id=da_role["id"])
        print(f"Test 1 Assignment Result: {res1}")

        # Verify
        b_count_res = client.table("batch_students").select("student_id").eq("batch_id", da_batch_a_id).execute()
        assert len(b_count_res.data) == 7, f"Expected 7 students in Batch A, found {len(b_count_res.data)}"
        assert res1["batch_id"] == da_batch_a_id, "Expected student assigned to Batch A"
        assert res1["batch_created"] is False, "Expected no new batch created"
        print("✓ TEST 1 PASSED: DA Batch A reached 7/7 with new student successfully!")

        # ----------------------------------------------------
        # TEST 2: DA Batch A = 7/7, New DA student -> Expected: Auto-create DA Batch B, student -> Batch B
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 2: Batch full (7/7) -> Auto-create Batch B ---")
        new_da_student_8 = create_test_student("DA Student 8 (New)", da_role["id"])
        res2 = assign_student_to_batch(new_da_student_8, role_id=da_role["id"])
        print(f"Test 2 Assignment Result: {res2}")

        created_batch_ids.append(res2["batch_id"])
        assert res2["batch_created"] is True, "Expected new batch to be created"
        assert "Batch B" in res2["batch_name"], f"Expected batch name to have 'Batch B', got '{res2['batch_name']}'"
        assert res2["course_name"] == da_role["role_name"], "Expected batch course to match DA"
        b2_count_res = client.table("batch_students").select("student_id").eq("batch_id", res2["batch_id"]).execute()
        assert len(b2_count_res.data) == 1, f"Expected 1 student in Batch B, found {len(b2_count_res.data)}"
        print(f"✓ TEST 2 PASSED: Automatically created '{res2['batch_name']}' and assigned student!")

        # ----------------------------------------------------
        # TEST 3: DA Batch A = 7/7, DA Batch B = 7/7, New DA student -> Expected: Create Batch C
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 3: Batches A & B full (7/7) -> Auto-create Batch C ---")
        da_batch_b_id = res2["batch_id"]
        # Fill remaining 6 seats in Batch B (so it becomes 7/7)
        for i in range(6):
            sid = create_test_student(f"DA Student B-{i+2}", da_role["id"])
            client.table("batch_students").insert({"batch_id": da_batch_b_id, "student_id": sid}).execute()

        # New DA student registers
        new_da_student_15 = create_test_student("DA Student 15 (New)", da_role["id"])
        res3 = assign_student_to_batch(new_da_student_15, role_id=da_role["id"])
        print(f"Test 3 Assignment Result: {res3}")

        created_batch_ids.append(res3["batch_id"])
        assert res3["batch_created"] is True, "Expected new batch to be created"
        assert "Batch C" in res3["batch_name"], f"Expected batch name to have 'Batch C', got '{res3['batch_name']}'"
        print(f"✓ TEST 3 PASSED: Automatically created '{res3['batch_name']}' and assigned student!")

        # ----------------------------------------------------
        # TEST 4: DA Batch A = 6/7, New WD student -> WD batch receives student, DA Batch stays 6/7
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 4: Strict Course Boundary Check ---")
        wd_batch_a_id = create_test_batch("Web Development - Batch A", wd_role["id"], capacity=7)
        wd_student = create_test_student("WD Student 1", wd_role["id"])
        res4 = assign_student_to_batch(wd_student, role_id=wd_role["id"])
        print(f"Test 4 Assignment Result: {res4}")

        assert res4["batch_id"] == wd_batch_a_id, "Expected WD student in WD batch"
        assert res4["role_id"] == wd_role["id"], "Expected role_id to be WD"
        
        # Verify DA Batch A is unchanged
        da_count = len(client.table("batch_students").select("student_id").eq("batch_id", da_batch_a_id).execute().data)
        assert da_count == 7, f"DA Batch A changed! Expected 7, got {da_count}"
        print("✓ TEST 4 PASSED: Web Development student went to WD Batch, DA remained untouched!")

        # ----------------------------------------------------
        # TEST 5: No batch exists for course -> Auto-create first batch and assign student
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 5: No batch exists for course -> Auto-create first batch ---")
        other_student = create_test_student("Student in Fresh Course", other_role["id"])
        res5 = assign_student_to_batch(other_student, role_id=other_role["id"])
        print(f"Test 5 Assignment Result: {res5}")

        created_batch_ids.append(res5["batch_id"])
        assert res5["batch_created"] is True, "Expected batch to be auto-created"
        assert "Batch A" in res5["batch_name"], f"Expected first batch to be Batch A, got {res5['batch_name']}"
        assert res5["role_id"] == other_role["id"], "Expected matching course"
        print(f"✓ TEST 5 PASSED: Auto-created first batch '{res5['batch_name']}' for fresh course!")

        # ----------------------------------------------------
        # TEST 6: Student already assigned -> No duplicate assignment
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 6: Duplicate Protection ---")
        res6 = assign_student_to_batch(other_student, role_id=other_role["id"])
        print(f"Test 6 Assignment Result: {res6}")

        assert res6["assignment_status"] in ("already_assigned", "assigned")
        assert res6["batch_created"] is False
        assign_count = len(client.table("batch_students").select("id").eq("student_id", other_student).execute().data)
        assert assign_count == 1, f"Expected exactly 1 assignment record, got {assign_count}"
        print("✓ TEST 6 PASSED: Duplicate assignment prevented! Exactly 1 record preserved.")

        # ----------------------------------------------------
        # TEST 7: Race condition / Simultaneous registration when 1 seat is available
        # ----------------------------------------------------
        print("\n--- RUNNING TEST 7: Concurrent simultaneous registration (Race Condition Guard) ---")
        # Create a test batch with capacity 7 and fill 6 seats
        race_batch_id = create_test_batch("Race Test - Batch A", wd_role["id"], capacity=7)
        for i in range(6):
            sid = create_test_student(f"Race Seed {i+1}", wd_role["id"])
            client.table("batch_students").insert({"batch_id": race_batch_id, "student_id": sid}).execute()

        # Two students register concurrently
        concurrent_student_1 = create_test_student("Concurrent Student 1", wd_role["id"])
        concurrent_student_2 = create_test_student("Concurrent Student 2", wd_role["id"])

        results = []
        barrier = threading.Barrier(2)

        def worker(sid):
            barrier.wait() # Synchronize start to hit API at the exact same millisecond
            res = assign_student_to_batch(sid, role_id=wd_role["id"])
            results.append(res)

        with ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(worker, concurrent_student_1)
            f2 = executor.submit(worker, concurrent_student_2)
            f1.result()
            f2.result()

        print(f"Concurrent Worker 1 result: {results[0]}")
        print(f"Concurrent Worker 2 result: {results[1]}")

        # Check race_batch_id students count
        race_b_count = len(client.table("batch_students").select("student_id").eq("batch_id", race_batch_id).execute().data)
        print(f"Race Batch students count: {race_b_count} / 7")
        assert race_b_count == 7, f"CRITICAL: Race batch exceeded capacity! Count is {race_b_count} instead of 7"

        # One student must have taken the 7th seat, and the other must have gotten a newly created batch
        assigned_to_race_batch = [r for r in results if r["batch_id"] == race_batch_id]
        created_new_batch_res = [r for r in results if r["batch_created"] is True]

        assert len(assigned_to_race_batch) == 1, f"Expected exactly 1 student in the last seat, got {len(assigned_to_race_batch)}"
        assert len(created_new_batch_res) == 1, f"Expected 1 student in new batch, got {len(created_new_batch_res)}"

        created_batch_ids.append(created_new_batch_res[0]["batch_id"])
        print("✓ TEST 7 PASSED: Mutex lock completely prevented race condition! Final counts: 7/7 and 1/7, capacity NEVER exceeded.")

        print("\n==================================================")
        print("ALL 7 TEST CASES PASSED WITH 100% SUCCESS!")
        print("==================================================")

    finally:
        # Cleanup test records
        print("\nCleaning up test records from database...")
        if created_student_ids:
            client.table("batch_students").delete().in_("student_id", created_student_ids).execute()
            client.table("students").delete().in_("id", created_student_ids).execute()
        if created_batch_ids:
            client.table("batch_students").delete().in_("batch_id", created_batch_ids).execute()
            client.table("batches").delete().in_("id", created_batch_ids).execute()
        print("Cleanup completed successfully.")

if __name__ == "__main__":
    run_tests()
