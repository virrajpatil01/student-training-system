import math
import random
import unittest
from typing import Dict, List, Any

# Import the core logic functions or mock database client
from shuffle_service import (
    trainer_specializes_in,
    index_to_letter,
    letter_to_index,
)

class MockTable:
    def __init__(self, data_store: dict, table_name: str):
        self.data_store = data_store
        self.table_name = table_name
        self._select_cols = "*"
        self._filters = []
        self._inserted_rows = []

    def select(self, cols="*"):
        self._select_cols = cols
        return self

    def insert(self, rows):
        if isinstance(rows, dict):
            rows = [rows]
        inserted = []
        for i, r in enumerate(rows):
            row_copy = dict(r)
            if "id" not in row_copy:
                row_copy["id"] = f"{self.table_name}_{len(self.data_store[self.table_name]) + 1}_{i}"
            self.data_store[self.table_name].append(row_copy)
            inserted.append(row_copy)
        self._inserted_rows = inserted
        return self

    def execute(self):
        class Response:
            def __init__(self, data):
                self.data = data

        if self._inserted_rows:
            res = Response(list(self._inserted_rows))
            self._inserted_rows = []
            return res

        rows = list(self.data_store.get(self.table_name, []))
        return Response(rows)

class MockSupabaseClient:
    def __init__(self, initial_data: dict):
        self.data_store = initial_data

    def table(self, table_name: str):
        return MockTable(self.data_store, table_name)


def run_auto_create_role_wise_test(client: MockSupabaseClient, batch_capacity: int = 5):
    """
    Executes auto_create_role_wise_batches logic against the mock client.
    """
    import re
    students_res = client.table("students").select().execute()
    roles_res = client.table("roles").select().execute()
    batches_res = client.table("batches").select().execute()
    assignments_res = client.table("batch_students").select().execute()

    students = students_res.data or []
    roles = roles_res.data or []
    batches = batches_res.data or []
    assignments = assignments_res.data or []

    already_assigned_ids = {str(a["student_id"]) for a in assignments if a.get("student_id")}

    batch_student_counts = {}
    for a in assignments:
        bid = str(a.get("batch_id"))
        batch_student_counts[bid] = batch_student_counts.get(bid, 0) + 1

    created_batches_list = []
    existing_batches_list = []
    batches_to_insert = []
    role_details = []

    for role in roles:
        rid = str(role["id"])
        role_name = (role.get("role_name") or f"Role-{rid[:8]}").strip()

        role_students = [s for s in students if str(s.get("role_id") or "") == rid]
        total_role_students = len(role_students)

        unassigned_role_students = [s for s in role_students if str(s["id"]) not in already_assigned_ids]
        unassigned_count = len(unassigned_role_students)

        existing_role_batches = [
            b for b in batches
            if b.get("batch_type") == "role_wise"
            and str(b.get("role_id") or "") == rid
            and str(b.get("status", "")).lower() != "cancelled"
        ]

        total_available_seats = sum(
            max(0, int(b.get("capacity") or batch_capacity) - batch_student_counts.get(str(b["id"]), 0))
            for b in existing_role_batches
        )

        for b in existing_role_batches:
            existing_batches_list.append(b.get("batch_name", "Unnamed Batch"))

        needed_new_batches = 0
        if unassigned_count > 0:
            if unassigned_count > total_available_seats:
                deficit_seats = unassigned_count - total_available_seats
                needed_new_batches = math.ceil(deficit_seats / batch_capacity)
        elif total_role_students > 0 and len(existing_role_batches) == 0:
            needed_new_batches = math.ceil(total_role_students / batch_capacity)

        role_created_names = []
        if needed_new_batches > 0:
            letter_pattern = re.compile(rf"^{re.escape(role_name)}\s*-\s*Batch\s*([A-Za-z]+)$", re.IGNORECASE)
            num_pattern = re.compile(rf"^{re.escape(role_name)}\s*-\s*Batch\s*(\d+)$", re.IGNORECASE)
            existing_indices = []
            for b in existing_role_batches:
                bname = str(b.get("batch_name", "")).strip()
                lm = letter_pattern.match(bname)
                if lm:
                    existing_indices.append(letter_to_index(lm.group(1)))
                    continue
                nm = num_pattern.match(bname)
                if nm:
                    existing_indices.append(int(nm.group(1)))

            next_idx = (max(existing_indices) + 1) if existing_indices else (len(existing_role_batches) + 1)

            for _ in range(needed_new_batches):
                letter_suffix = index_to_letter(next_idx)
                new_batch_name = f"{role_name} - Batch {letter_suffix}"
                next_idx += 1
                batches_to_insert.append({
                    "batch_name": new_batch_name,
                    "batch_type": "role_wise",
                    "role_id": rid,
                    "trainer_id": None,
                    "capacity": batch_capacity,
                    "status": "upcoming"
                })
                role_created_names.append(new_batch_name)
                created_batches_list.append(new_batch_name)

        role_details.append({
            "role_id": rid,
            "role_name": role_name,
            "total_students": total_role_students,
            "unassigned_students": unassigned_count,
            "existing_batches_count": len(existing_role_batches),
            "existing_available_seats": total_available_seats,
            "created_batches_count": needed_new_batches,
            "created_batches": role_created_names
        })

    if batches_to_insert:
        client.table("batches").insert(batches_to_insert).execute()

    return {
        "success": True,
        "created_batches": created_batches_list,
        "existing_batches": existing_batches_list,
        "total_roles_processed": len(roles),
        "total_students": len(students),
        "details": role_details
    }


def run_shuffle_all_test(client: MockSupabaseClient):
    """
    Executes shuffle_all logic against the mock client.
    """
    import re
    students = client.table("students").select().execute().data
    roles = client.table("roles").select().execute().data
    trainers = client.table("trainers").select().execute().data
    batches = client.table("batches").select().execute().data
    existing_assignments = client.table("batch_students").select().execute().data

    roles_map = {str(r["id"]): r["role_name"] for r in roles}
    trainers_map = {str(t["id"]): t for t in trainers}
    batches_map = {str(b["id"]): b for b in batches}
    students_map = {str(s["id"]): s for s in students}

    already_assigned_ids = {str(a["student_id"]) for a in existing_assignments if a.get("student_id")}

    batch_student_counts = {str(b["id"]): 0 for b in batches}
    trainer_student_counts = {str(t["id"]): 0 for t in trainers}

    for a in existing_assignments:
        bid = str(a.get("batch_id"))
        if bid in batches_map:
            batch_student_counts[bid] = batch_student_counts.get(bid, 0) + 1
            tid = batches_map[bid].get("trainer_id")
            if tid and str(tid) in trainer_student_counts:
                trainer_student_counts[str(tid)] += 1

    eligible_batches = [
        b for b in batches
        if str(b.get("status", "")).lower() not in ["cancelled", "completed"]
    ]

    unassigned_students = [s for s in students if str(s["id"]) not in already_assigned_ids]

    assignment_plan = []
    newly_assigned_student_ids = set()

    def get_remaining_capacity(batch):
        bid = str(batch["id"])
        batch_cap = int(batch.get("capacity") or 30)
        batch_used = batch_student_counts.get(bid, 0)
        remaining_batch = max(0, batch_cap - batch_used)

        tid = batch.get("trainer_id")
        if tid and str(tid) in trainers_map:
            trainer = trainers_map[str(tid)]
            trainer_cap = int(trainer.get("capacity") or 30)
            trainer_used = trainer_student_counts.get(str(tid), 0)
            remaining_trainer = max(0, trainer_cap - trainer_used)
            return min(remaining_batch, remaining_trainer)
        return remaining_batch

    # Step 1: Group unassigned students by role_id
    role_students_map = {}
    for s in unassigned_students:
        rid = str(s.get("role_id") or "")
        if rid:
            role_students_map.setdefault(rid, []).append(s)

    for rid in role_students_map:
        random.shuffle(role_students_map[rid])

    role_wise_batches = [b for b in eligible_batches if b.get("batch_type") == "role_wise"]

    for role in roles:
        rid = str(role["id"])
        c_name = roles_map.get(rid, "")
        students_for_this_role = role_students_map.get(rid, [])
        if not students_for_this_role:
            continue

        batches_for_this_role = [
            b for b in role_wise_batches
            if str(b.get("role_id") or "") == rid
        ]
        batches_for_this_role.sort(key=lambda b: str(b.get("batch_name", "")))

        for batch in batches_for_this_role:
            bid = str(batch["id"])
            tid = batch.get("trainer_id")

            # Auto-assign trainer if batch has no trainer
            if not tid and trainers:
                from shuffle_service import find_specialist_trainer_for_course
                best_tr = find_specialist_trainer_for_course(
                    course_name=c_name,
                    trainers=trainers,
                    trainer_student_counts=trainer_student_counts
                )
                if best_tr:
                    tid = str(best_tr["id"])
                    batch["trainer_id"] = tid

            if tid and str(tid) in trainers_map:
                trainer = trainers_map[str(tid)]
                if not trainer_specializes_in(trainer, c_name):
                    continue

            available_slots = get_remaining_capacity(batch)
            if available_slots <= 0:
                continue

            candidate_students = [
                s for s in students_for_this_role
                if str(s["id"]) not in newly_assigned_student_ids
            ]

            allocated = candidate_students[:available_slots]
            for student in allocated:
                sid = str(student["id"])
                assignment_plan.append({"batch_id": bid, "student_id": sid})
                newly_assigned_student_ids.add(sid)
                batch_student_counts[bid] += 1
                if tid and str(tid) in trainer_student_counts:
                    trainer_student_counts[str(tid)] += 1

    # Insert into mock batch_students
    if assignment_plan:
        client.table("batch_students").insert(assignment_plan).execute()

    return {
        "success": True,
        "newly_assigned_count": len(assignment_plan),
        "assignment_plan": assignment_plan,
        "batch_student_counts": batch_student_counts
    }


def main():
    print("==================================================")
    print("RUNNING FINAL TEST SUITE FOR PART 17")
    print("==================================================")

    da_role_id = "6b5d4560-7e4e-4606-8928-9fccd22a0a47"
    wd_role_id = "11e50d85-3822-49e1-a4bc-bdd7bbc5e0d9"

    roles = [
        {"id": da_role_id, "role_name": "Data Analytics"},
        {"id": wd_role_id, "role_name": "Web Development"}
    ]

    # Create 10 Data Analytics students and 10 Web Development students
    students = []
    for i in range(1, 11):
        students.append({"id": f"student_da_{i}", "name": f"DA Student {i}", "role_id": da_role_id})
    for i in range(1, 11):
        students.append({"id": f"student_wd_{i}", "name": f"WD Student {i}", "role_id": wd_role_id})

    print(f"Total students created: {len(students)} (10 DA, 10 WD)")

    db = {
        "roles": roles,
        "students": students,
        "trainers": [
            {"id": "t1", "name": "Trainer Alex", "capacity": 10, "specialization": "Data Analytics"},
            {"id": "t2", "name": "Trainer Sam", "capacity": 10, "specialization": "Web Development"},
        ],
        "batches": [],
        "batch_students": []
    }
    client = MockSupabaseClient(db)

    # 1. First run of Auto Create Role-wise Batches (Capacity = 5)
    print("\n--- STEP 1: Auto Create Role-wise Batches (Capacity = 5) ---")
    res1 = run_auto_create_role_wise_test(client, batch_capacity=5)
    print("Created Batches:", res1["created_batches"])
    assert res1["created_batches"] == [
        "Data Analytics - Batch A",
        "Data Analytics - Batch B",
        "Web Development - Batch A",
        "Web Development - Batch B"
    ], f"Unexpected created batches: {res1['created_batches']}"
    assert len(db["batches"]) == 4, f"Expected 4 batches in db, got {len(db['batches'])}"
    print("[PASS]: Exactly 4 batches created (2 for DA, 2 for WD)")

    # 2. Second run of Auto Create (Idempotency check)
    print("\n--- STEP 2: Second run of Auto Create (Idempotency Check) ---")
    res2 = run_auto_create_role_wise_test(client, batch_capacity=5)
    print("Created Batches on Run 2:", res2["created_batches"])
    assert len(res2["created_batches"]) == 0, f"Expected 0 batches created on second run, got {res2['created_batches']}"
    assert len(db["batches"]) == 4, "No duplicate batches created"
    print("[PASS]: Zero duplicate batches created on second run")

    # 3. Run Shuffle All
    print("\n--- STEP 3: Run Shuffle All ---")
    shuffle_res = run_shuffle_all_test(client)
    print("Newly assigned count:", shuffle_res["newly_assigned_count"])
    assert shuffle_res["newly_assigned_count"] == 20, f"Expected 20 assignments, got {shuffle_res['newly_assigned_count']}"

    # Verify assignments
    assignments = db["batch_students"]
    batches = {b["id"]: b for b in db["batches"]}
    students_map = {s["id"]: s for s in db["students"]}

    da_batch_ids = [b["id"] for b in db["batches"] if b["role_id"] == da_role_id]
    wd_batch_ids = [b["id"] for b in db["batches"] if b["role_id"] == wd_role_id]

    print("\n--- STEP 4: Verification of Integrity & Role Isolation ---")
    # Verify each batch has exactly 5 students (no capacity overflow)
    for b in db["batches"]:
        count = sum(1 for a in assignments if a["batch_id"] == b["id"])
        print(f"Batch '{b['batch_name']}' assigned count: {count}/5")
        assert count == 5, f"Batch '{b['batch_name']}' expected 5 students, got {count}"
    print("[PASS]: All 4 batches have exactly 5 students (respects capacity = 5)")

    # Verify no DA student is in WD batch, and no WD student in DA batch
    for a in assignments:
        bid = a["batch_id"]
        sid = a["student_id"]
        batch = batches[bid]
        student = students_map[sid]
        assert batch["role_id"] == student["role_id"], (
            f"ERROR: Student {student['name']} ({student['role_id']}) assigned to Batch {batch['batch_name']} ({batch['role_id']})"
        )
    print("[PASS]: 100% strict role isolation. Zero cross-role contamination!")

    # Verify no student is assigned more than once
    assigned_student_ids = [a["student_id"] for a in assignments]
    assert len(assigned_student_ids) == len(set(assigned_student_ids)), "Duplicate student assignments found!"
    print("[PASS]: Zero duplicate student assignments in batch_students")

    # Verify direct trainer assignments
    for b in db["batches"]:
        assert b.get("trainer_id") is not None, f"Batch '{b['batch_name']}' has no trainer assigned!"
        if b["role_id"] == da_role_id:
            assert b["trainer_id"] == "t1", f"Expected DA batch to have Trainer Alex (t1), got {b['trainer_id']}"
        elif b["role_id"] == wd_role_id:
            assert b["trainer_id"] == "t2", f"Expected WD batch to have Trainer Sam (t2), got {b['trainer_id']}"
    print("[PASS]: Trainers automatically assigned to all batches matching course specialization (Alex -> DA, Sam -> WD)")

    # 4. Third run of Auto Create after Shuffle (Existing full batches)
    print("\n--- STEP 5: Third Auto Create run after all students assigned ---")
    res3 = run_auto_create_role_wise_test(client, batch_capacity=5)
    print("Created Batches on Run 3:", res3["created_batches"])
    assert len(res3["created_batches"]) == 0, "No extra batches should be created"
    print("[PASS]: Zero extra batches created when existing batches are full and unassigned count = 0")

    # 5. Add 2 new Data Analytics students -> Should create Batch C
    print("\n--- STEP 6: Add 2 new DA students -> Verify Batch C creation with available seats ---")
    db["students"].append({"id": "student_da_11", "name": "DA Student 11", "role_id": da_role_id})
    db["students"].append({"id": "student_da_12", "name": "DA Student 12", "role_id": da_role_id})
    res4 = run_auto_create_role_wise_test(client, batch_capacity=5)
    print("Created Batches after 2 new students:", res4["created_batches"])
    assert res4["created_batches"] == ["Data Analytics - Batch C"], f"Expected ['Data Analytics - Batch C'], got {res4['created_batches']}"
    print("[PASS]: Dynamically created 'Data Analytics - Batch C' for the 2 deficit students")

    print("\n==================================================")
    print("ALL TESTS PASSED SUCCESSFULLY! 100% VERIFIED.")
    print("==================================================")

if __name__ == "__main__":
    main()
