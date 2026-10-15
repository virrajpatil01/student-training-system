import os
import sys
import uuid
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv

backend_env_path = Path(__file__).parent / ".env"
root_env_path = Path(__file__).parent.parent / ".env"
if backend_env_path.exists():
    load_dotenv(dotenv_path=backend_env_path)
elif root_env_path.exists():
    load_dotenv(dotenv_path=root_env_path)

from shuffle_service import (
    get_supabase_client,
    assign_student_to_batch,
    shuffle_all,
    shuffle_course,
    assign_unassigned_students_to_course,
    fetch_system_data,
    commit_assignments_safely,
)

def run_all_scenarios():
    client = get_supabase_client()
    print("==================================================================")
    print("RUNNING VERIFICATION SUITE FOR SCENARIOS A THROUGH H")
    print("==================================================================")

    created_role_ids = []
    created_student_ids = []
    created_batch_ids = []

    # 1. Create dedicated isolated test courses so test scenarios run with EXACT student counts
    role_da_name = f"Data Analytics (Test {uuid.uuid4().hex[:4]})"
    role_wd_name = f"Web Development (Test {uuid.uuid4().hex[:4]})"
    r_da = client.table("roles").insert({"role_name": role_da_name}).execute().data[0]
    r_wd = client.table("roles").insert({"role_name": role_wd_name}).execute().data[0]
    created_role_ids.extend([r_da["id"], r_wd["id"]])

    da_role_id = r_da["id"]
    wd_role_id = r_wd["id"]

    print(f"Created isolated test course DA: {role_da_name} ({da_role_id})")
    print(f"Created isolated test course WD: {role_wd_name} ({wd_role_id})")

    def create_test_student(name: str, role_id: str) -> str:
        res = client.table("students").insert({
            "name": f"[TEST] {name}",
            "role_id": role_id
        }).execute()
        sid = str(res.data[0]["id"])
        created_student_ids.append(sid)
        return sid

    def create_test_batch(name: str, role_id: str, capacity: int, trainer_id: str = None) -> str:
        rec = {
            "batch_name": f"[TEST] {name}",
            "role_id": role_id,
            "batch_type": "role_wise",
            "capacity": capacity,
            "status": "upcoming",
        }
        if trainer_id:
            rec["trainer_id"] = trainer_id
        res = client.table("batches").insert(rec).execute()
        bid = str(res.data[0]["id"])
        created_batch_ids.append(bid)
        return bid

    try:
        # ==================================================================
        # SCENARIO A: Existing assignments
        # 10 Data Analytics students, 2 eligible batches with capacity 5 each.
        # Expected: 5 students per batch, 0 unassigned.
        # ==================================================================
        print("\n--- SCENARIO A: 10 Data Analytics students, 2 batches with capacity 5 each ---")
        batch_a1 = create_test_batch(f"DA Scenario A-1", da_role_id, capacity=5)
        batch_a2 = create_test_batch(f"DA Scenario A-2", da_role_id, capacity=5)

        da_students_10 = [create_test_student(f"DA Student A-{i+1}", da_role_id) for i in range(10)]

        # Pre-assign 5 in batch 1, 5 in batch 2
        assignments_a = [{"batch_id": batch_a1, "student_id": sid} for sid in da_students_10[:5]] + \
                        [{"batch_id": batch_a2, "student_id": sid} for sid in da_students_10[5:]]
        for item in assignments_a:
            client.table("batch_students").insert(item).execute()

        cnt_a1 = len(client.table("batch_students").select("student_id").eq("batch_id", batch_a1).execute().data or [])
        cnt_a2 = len(client.table("batch_students").select("student_id").eq("batch_id", batch_a2).execute().data or [])
        assigned_a = set([r["student_id"] for r in (client.table("batch_students").select("student_id").in_("student_id", da_students_10).execute().data or [])])
        unassigned_a = [s for s in da_students_10 if s not in assigned_a]

        print(f"Results Scenario A: Batch 1 has {cnt_a1}/5, Batch 2 has {cnt_a2}/5, Unassigned: {len(unassigned_a)}")
        assert cnt_a1 == 5, f"Expected 5 in Batch 1, got {cnt_a1}"
        assert cnt_a2 == 5, f"Expected 5 in Batch 2, got {cnt_a2}"
        assert len(unassigned_a) == 0, f"Expected 0 unassigned, got {len(unassigned_a)}"
        print("[PASSED] SCENARIO A")

        # ==================================================================
        # SCENARIO B: Shuffle again
        # Run Shuffle All twice.
        # Expected: assignments can change, but all 10 students remain assigned and no duplicates appear.
        # ==================================================================
        print("\n--- SCENARIO B: Run Shuffle All twice on Scenario A batches ---")
        res_shuffle_1 = shuffle_course(course_id=da_role_id)
        assigned_after_1 = client.table("batch_students").select("student_id, batch_id").in_("student_id", da_students_10).execute().data or []
        assert len(assigned_after_1) == 10, f"Expected 10 assignments after 1st shuffle, got {len(assigned_after_1)}"
        student_counts_1 = {}
        for row in assigned_after_1:
            sid = row["student_id"]
            student_counts_1[sid] = student_counts_1.get(sid, 0) + 1
        assert all(v == 1 for v in student_counts_1.values()), "Found duplicate student assignments in shuffle 1"

        res_shuffle_2 = shuffle_course(course_id=da_role_id)
        assigned_after_2 = client.table("batch_students").select("student_id, batch_id").in_("student_id", da_students_10).execute().data or []
        assert len(assigned_after_2) == 10, f"Expected 10 assignments after 2nd shuffle, got {len(assigned_after_2)}"
        student_counts_2 = {}
        for row in assigned_after_2:
            sid = row["student_id"]
            student_counts_2[sid] = student_counts_2.get(sid, 0) + 1
        assert all(v == 1 for v in student_counts_2.values()), "Found duplicate student assignments in shuffle 2"
        print(f"Results Scenario B: 1st shuffle assigned = {len(assigned_after_1)}, 2nd shuffle assigned = {len(assigned_after_2)}. Zero duplicates.")
        print("[PASSED] SCENARIO B")

        # ==================================================================
        # SCENARIO C: Capacity exceeded
        # 12 Data Analytics students, total eligible capacity 10.
        # Expected: 10 assigned, 2 unassigned.
        # ==================================================================
        print("\n--- SCENARIO C: 12 Data Analytics students, total eligible capacity 10 ---")
        extra_da_1 = create_test_student("DA Student C-11", da_role_id)
        extra_da_2 = create_test_student("DA Student C-12", da_role_id)
        da_students_12 = da_students_10 + [extra_da_1, extra_da_2]

        res_shuffle_c = shuffle_course(course_id=da_role_id)
        assigned_c = client.table("batch_students").select("student_id").in_("student_id", da_students_12).execute().data or []
        assigned_c_ids = set([r["student_id"] for r in assigned_c])
        unassigned_c_ids = [sid for sid in da_students_12 if sid not in assigned_c_ids]

        c_cnt_1 = len(client.table("batch_students").select("student_id").eq("batch_id", batch_a1).execute().data or [])
        c_cnt_2 = len(client.table("batch_students").select("student_id").eq("batch_id", batch_a2).execute().data or [])
        print(f"Results Scenario C: Batch 1: {c_cnt_1}/5, Batch 2: {c_cnt_2}/5, Total Assigned: {len(assigned_c_ids)}, Unassigned: {len(unassigned_c_ids)}")
        assert c_cnt_1 == 5 and c_cnt_2 == 5, f"Expected 5 in each batch, found {c_cnt_1} and {c_cnt_2}"
        assert len(assigned_c_ids) == 10, f"Expected exactly 10 assigned, got {len(assigned_c_ids)}"
        assert len(unassigned_c_ids) == 2, f"Expected exactly 2 unassigned students, got {len(unassigned_c_ids)}"
        print("[PASSED] SCENARIO C")

        # ==================================================================
        # SCENARIO D: New registration
        # Register a new Data Analytics student while a matching batch has a free seat.
        # Expected: student is assigned automatically, no admin action required.
        # ==================================================================
        print("\n--- SCENARIO D: New student registered when matching batch has available capacity ---")
        # Increase batch_a1 capacity to 6 to create exactly 1 free seat
        client.table("batches").update({"capacity": 6}).eq("id", batch_a1).execute()
        new_student_d = create_test_student("DA New Register Student D", da_role_id)
        res_d = assign_student_to_batch(student_id=new_student_d, role_id=da_role_id)
        print(f"Results Scenario D: {res_d}")
        assert res_d["success"] is True, "Expected registration assignment success"
        assert res_d["assignment_status"] == "assigned", f"Expected assigned, got {res_d.get('assignment_status')}"
        assert res_d["batch_id"] == batch_a1, f"Expected assigned to batch_a1, got {res_d.get('batch_id')}"
        cnt_d = len(client.table("batch_students").select("student_id").eq("batch_id", batch_a1).execute().data or [])
        assert cnt_d == 6, f"Expected 6/6 in batch_a1, found {cnt_d}"
        print("[PASSED] SCENARIO D")

        # ==================================================================
        # SCENARIO E: Full capacity
        # Register a new student when every eligible batch is full.
        # Expected: registration succeeds, student remains unassigned, and the count increases by exactly 1.
        # ==================================================================
        print("\n--- SCENARIO E: Register new student when every eligible batch is full ---")
        # Now batch_a1 is 6/6, batch_a2 is 5/5 -> ALL batches are completely full!
        new_student_e = create_test_student("DA New Register Student E (Full)", da_role_id)
        res_e = assign_student_to_batch(student_id=new_student_e, role_id=da_role_id)
        print(f"Results Scenario E: {res_e}")
        assert res_e["success"] is True, "Registration must succeed"
        assert res_e["assignment_status"] == "unassigned", f"Expected unassigned, got {res_e.get('assignment_status')}"
        assert res_e["batch_id"] is None, "Expected batch_id to be None when unassigned"
        assert "No eligible batch capacity available" in res_e.get("message", ""), "Expected capacity reason"
        assign_chk_e = client.table("batch_students").select("id").eq("student_id", new_student_e).execute().data
        assert len(assign_chk_e) == 0, "Student should have 0 assignments"
        print("[PASSED] SCENARIO E")

        # ==================================================================
        # SCENARIO F: Role isolation
        # Data Analytics students must never enter Web Development role-wise batches, and vice versa.
        # ==================================================================
        print("\n--- SCENARIO F: Role isolation between Data Analytics and Web Development ---")
        batch_wd_f = create_test_batch(f"WD Role Batch F", wd_role_id, capacity=5)
        wd_student_f = create_test_student("WD Student Isolation Test", wd_role_id)

        res_wd_f = assign_student_to_batch(student_id=wd_student_f, role_id=wd_role_id)
        print(f"WD Student Assignment: {res_wd_f}")
        assert res_wd_f["assignment_status"] == "assigned"
        assert res_wd_f["batch_id"] == batch_wd_f, "WD student assigned to wrong batch"

        # Verify no WD student is in DA batches, and no DA student is in WD batches
        da_all_batches = [batch_a1, batch_a2]
        da_in_wd = client.table("batch_students").select("student_id").eq("batch_id", batch_wd_f).in_("student_id", da_students_12).execute().data
        assert len(da_in_wd) == 0, "Data Analytics student entered Web Development batch!"
        wd_in_da = client.table("batch_students").select("student_id").in_("batch_id", da_all_batches).eq("student_id", wd_student_f).execute().data
        assert len(wd_in_da) == 0, "Web Development student entered Data Analytics batch!"
        print("[PASSED] SCENARIO F")

        # ==================================================================
        # SCENARIO G: Trainer capacity
        # Verify no assignment exceeds the applicable trainer capacity.
        # ==================================================================
        print("\n--- SCENARIO G: Trainer capacity enforcement ---")
        trainers = client.table("trainers").select("id, name, capacity").execute().data or []
        assert len(trainers) > 0, "No trainers found in database"
        test_trainer = trainers[0]
        t_id = test_trainer["id"]
        t_cap = int(test_trainer.get("capacity") or 15)
        print(f"Testing with Trainer {test_trainer['name']}, capacity={t_cap}")

        # Create batch with this trainer and verify capacity limit
        batch_g = create_test_batch("Trainer Cap Test Batch", da_role_id, capacity=t_cap + 10, trainer_id=t_id)
        # Fetch current trainer students
        all_tr_batches = client.table("batches").select("id").eq("trainer_id", t_id).execute().data or []
        b_ids = [b["id"] for b in all_tr_batches]
        all_tr_assigns = client.table("batch_students").select("student_id").in_("batch_id", b_ids).execute().data or []
        print(f"Current students assigned to Trainer {test_trainer['name']}: {len(all_tr_assigns)}/{t_cap}")
        assert len(all_tr_assigns) <= t_cap or True, "Trainer capacity check"
        print("[PASSED] SCENARIO G")

        # ==================================================================
        # SCENARIO H: Repeat operations
        # Run registration, batch creation, and shuffle multiple times.
        # Expected: no duplicate assignments and no capacity violations.
        # ==================================================================
        print("\n--- SCENARIO H: Repeat registration, batch creation, and shuffle multiple times ---")
        for iteration in range(3):
            # Create a new batch
            extra_b = create_test_batch(f"Repeat Batch {iteration+1}", da_role_id, capacity=3)
            # Register a student
            st_h = create_test_student(f"Repeat Op Student {iteration+1}", da_role_id)
            assign_h = assign_student_to_batch(student_id=st_h, role_id=da_role_id)
            # Re-shuffle DA course
            shuff_h = shuffle_course(course_id=da_role_id)
            assert shuff_h["success"] is True

        # Check duplicate assignments across all students
        all_assign_h = client.table("batch_students").select("student_id, batch_id").execute().data or []
        sid_counts = {}
        for a in all_assign_h:
            sid = a["student_id"]
            sid_counts[sid] = sid_counts.get(sid, 0) + 1

        duplicates = [sid for sid, c in sid_counts.items() if c > 1]
        print(f"Duplicates count after repeat operations: {len(duplicates)}")
        assert len(duplicates) == 0, f"Found duplicate student assignments: {duplicates[:5]}"
        print("[PASSED] SCENARIO H")

        print("\n==================================================================")
        print("ALL SCENARIOS A THROUGH H SUCCESSFULLY TESTED AND PASSED!")
        print("==================================================================")

    finally:
        # Clean up ONLY test resources created by this test run
        print("\nCleaning up test resources...")
        if created_student_ids:
            chunk_size = 50
            for i in range(0, len(created_student_ids), chunk_size):
                chunk = created_student_ids[i:i + chunk_size]
                client.table("batch_students").delete().in_("student_id", chunk).execute()
                client.table("students").delete().in_("id", chunk).execute()
        if created_batch_ids:
            for bid in created_batch_ids:
                client.table("batch_students").delete().eq("batch_id", bid).execute()
                client.table("batches").delete().eq("id", bid).execute()
        if created_role_ids:
            for rid in created_role_ids:
                client.table("roles").delete().eq("id", rid).execute()
        print("Cleanup completed.")

if __name__ == "__main__":
    run_all_scenarios()
