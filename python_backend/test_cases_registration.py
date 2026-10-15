import os
import sys
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
from typing import Any, Dict, List, Optional

# Add python_backend to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shuffle_service import (
    determine_next_batch_name,
    assign_student_to_batch,
    letter_to_index,
    index_to_letter,
)

class MockSupabaseDB:
    """In-memory thread-safe database simulating PostgREST for exact unit testing."""
    def __init__(self):
        self.lock = threading.Lock()
        self.students = []
        self.roles = []
        self.trainers = []
        self.batches = []
        self.batch_students = []

    def table(self, table_name: str):
        return MockTableQuery(self, table_name)


class MockTableQuery:
    def __init__(self, db: MockSupabaseDB, table_name: str):
        self.db = db
        self.table_name = table_name
        self.filters = []
        self._action = "select"
        self._insert_data = None

    def select(self, fields: str = "*"):
        self._action = "select"
        return self

    def insert(self, data):
        self._action = "insert"
        self._insert_data = data if isinstance(data, list) else [data]
        return self

    def eq(self, field: str, value: Any):
        self.filters.append(("eq", field, str(value)))
        return self

    def neq(self, field: str, value: Any):
        self.filters.append(("neq", field, str(value)))
        return self

    def in_(self, field: str, values: list):
        str_values = {str(v) for v in values}
        self.filters.append(("in", field, str_values))
        return self

    def execute(self):
        with self.db.lock:
            target_list = getattr(self.db, self.table_name)
            if self._action == "insert":
                inserted_rows = []
                for item in self._insert_data:
                    row = dict(item)
                    if "id" not in row:
                        row["id"] = f"{self.table_name}-{len(target_list) + 1}"
                    target_list.append(row)
                    inserted_rows.append(row)
                res = MagicMock()
                res.data = inserted_rows
                return res

            elif self._action == "select":
                results = []
                for row in target_list:
                    match = True
                    for op, field, val in self.filters:
                        row_val = str(row.get(field, ""))
                        if op == "eq" and row_val != val:
                            match = False
                            break
                        elif op == "neq" and row_val == val:
                            match = False
                            break
                        elif op == "in" and row_val not in val:
                            match = False
                            break
                    if match:
                        results.append(dict(row))
                res = MagicMock()
                res.data = results
                return res


def run_tests():
    print("==================================================")
    print("STARTING TEST SUITE: EXACT TESTS 1 TO 7 FOR REGISTRATION ASSIGNMENT")
    print("==================================================")

    db = MockSupabaseDB()
    da_role_id = "role-da"
    wd_role_id = "role-wd"
    ml_role_id = "role-ml"

    db.roles = [
        {"id": da_role_id, "role_name": "Data Analytics"},
        {"id": wd_role_id, "role_name": "Web Development"},
        {"id": ml_role_id, "role_name": "Machine Learning"},
    ]
    db.trainers = [
        {"id": "t-1", "name": "Rahul Patil", "specialization": "Data Analytics", "capacity": 50},
        {"id": "t-2", "name": "Anita Sharma", "specialization": "Web Development", "capacity": 50},
    ]

    with patch("shuffle_service.get_supabase_client", return_value=db):
        # ----------------------------------------------------
        # TEST 1:
        # DA Batch A = 6/7
        # New DA student
        # Expected:
        # DA Batch A = 7/7
        # No remaining DA student
        # ----------------------------------------------------
        print("\n--- TEST 1: DA Batch A = 6/7, New DA student -> 7/7 ---")
        batch_a = {
            "id": "b-da-a",
            "batch_name": "Data Analytics - Batch A",
            "role_id": da_role_id,
            "batch_type": "role_wise",
            "capacity": 7,
            "status": "upcoming"
        }
        db.batches.append(batch_a)

        # Seed 6 students
        for i in range(1, 7):
            sid = f"s-da-{i}"
            db.students.append({"id": sid, "name": f"Student {i}", "role_id": da_role_id})
            db.batch_students.append({"id": f"bs-{i}", "batch_id": "b-da-a", "student_id": sid})

        # New DA student registers
        new_da_student = "s-da-7"
        db.students.append({"id": new_da_student, "name": "Student 7", "role_id": da_role_id})

        res1 = assign_student_to_batch(new_da_student, role_id=da_role_id)
        print(f"Result 1: {res1}")

        b_a_count = sum(1 for a in db.batch_students if a["batch_id"] == "b-da-a")
        assert b_a_count == 7, f"Expected 7 students in Batch A, got {b_a_count}"
        assert res1["batch_id"] == "b-da-a"
        assert res1["batch_created"] is False
        assert res1["assignment_status"] == "assigned"
        print(f"[PASS] TEST 1 PASSED: DA Batch A = {b_a_count}/7. No remaining DA student!")

        # ----------------------------------------------------
        # TEST 2:
        # DA Batch A = 7/7
        # New DA student
        # Expected:
        # Automatically create DA Batch B
        # DA student -> Batch B
        # ----------------------------------------------------
        print("\n--- TEST 2: DA Batch A = 7/7, New DA student -> Auto-create Batch B ---")
        new_da_student_8 = "s-da-8"
        db.students.append({"id": new_da_student_8, "name": "Student 8", "role_id": da_role_id})

        res2 = assign_student_to_batch(new_da_student_8, role_id=da_role_id)
        print(f"Result 2: {res2}")

        assert res2["batch_created"] is True, "Expected new batch to be created"
        assert "Batch B" in res2["batch_name"], f"Expected 'Batch B', got {res2['batch_name']}"
        b_b_id = res2["batch_id"]
        b_b_count = sum(1 for a in db.batch_students if a["batch_id"] == b_b_id)
        assert b_b_count == 1, f"Expected 1 student in Batch B, got {b_b_count}"
        print(f"[PASS] TEST 2 PASSED: Automatically created '{res2['batch_name']}' and assigned DA student 8!")

        # ----------------------------------------------------
        # TEST 3:
        # DA Batch A = 7/7
        # DA Batch B = 7/7
        # New DA student
        # Expected:
        # Create DA Batch C
        # Student -> Batch C
        # ----------------------------------------------------
        print("\n--- TEST 3: DA Batch A = 7/7, DA Batch B = 7/7 -> Auto-create Batch C ---")
        # Fill Batch B up to 7/7
        for i in range(9, 15):
            sid = f"s-da-{i}"
            db.students.append({"id": sid, "name": f"Student {i}", "role_id": da_role_id})
            db.batch_students.append({"id": f"bs-{i}", "batch_id": b_b_id, "student_id": sid})

        b_b_full_count = sum(1 for a in db.batch_students if a["batch_id"] == b_b_id)
        assert b_b_full_count == 7, f"Batch B should be 7/7, got {b_b_full_count}"

        # New DA student registers
        new_da_student_15 = "s-da-15"
        db.students.append({"id": new_da_student_15, "name": "Student 15", "role_id": da_role_id})

        res3 = assign_student_to_batch(new_da_student_15, role_id=da_role_id)
        print(f"Result 3: {res3}")

        assert res3["batch_created"] is True
        assert "Batch C" in res3["batch_name"], f"Expected 'Batch C', got {res3['batch_name']}"
        b_c_id = res3["batch_id"]
        b_c_count = sum(1 for a in db.batch_students if a["batch_id"] == b_c_id)
        assert b_c_count == 1
        print(f"[PASS] TEST 3 PASSED: Created '{res3['batch_name']}' and assigned Student 15!")

        # ----------------------------------------------------
        # TEST 4:
        # DA Batch A = 6/7 (simulate reset to 6)
        # New Web Development student
        # Expected:
        # Web Development batch receives student
        # DA Batch must remain 6/7
        # ----------------------------------------------------
        print("\n--- TEST 4: Strict Course Boundary Check ---")
        wd_batch_a = {
            "id": "b-wd-a",
            "batch_name": "Web Development - Batch A",
            "role_id": wd_role_id,
            "batch_type": "role_wise",
            "capacity": 7,
            "status": "upcoming"
        }
        db.batches.append(wd_batch_a)

        wd_student_1 = "s-wd-1"
        db.students.append({"id": wd_student_1, "name": "WD Student 1", "role_id": wd_role_id})

        res4 = assign_student_to_batch(wd_student_1, role_id=wd_role_id)
        print(f"Result 4: {res4}")

        assert res4["batch_id"] == "b-wd-a"
        assert res4["course"] == "Web Development"

        # Verify DA Batches are completely unchanged
        da_a_after = sum(1 for a in db.batch_students if a["batch_id"] == "b-da-a")
        assert da_a_after == 7, f"DA Batch A changed! Got {da_a_after}"
        print(f"[PASS] TEST 4 PASSED: WD student assigned to WD batch, DA Batches remain untouched!")

        # ----------------------------------------------------
        # TEST 5:
        # No batch exists for a course
        # New student registers
        # Expected:
        # Automatically create first batch for that course
        # Assign student
        # ----------------------------------------------------
        print("\n--- TEST 5: No batch exists for course -> Auto-create first batch ---")
        ml_student_1 = "s-ml-1"
        db.students.append({"id": ml_student_1, "name": "ML Student 1", "role_id": ml_role_id})

        res5 = assign_student_to_batch(ml_student_1, role_id=ml_role_id, default_capacity=7)
        print(f"Result 5: {res5}")

        assert res5["batch_created"] is True
        assert "Batch A" in res5["batch_name"]
        assert res5["course"] == "Machine Learning"
        ml_count = sum(1 for a in db.batch_students if a["batch_id"] == res5["batch_id"])
        assert ml_count == 1
        print(f"[PASS] TEST 5 PASSED: Auto-created first batch '{res5['batch_name']}' for Machine Learning!")

        # ----------------------------------------------------
        # TEST 6:
        # Student already assigned
        # Expected:
        # No duplicate batch_students record
        # ----------------------------------------------------
        print("\n--- TEST 6: Duplicate Protection ---")
        res6 = assign_student_to_batch(ml_student_1, role_id=ml_role_id)
        print(f"Result 6: {res6}")

        assert res6["assignment_status"] in ("already_assigned", "assigned")
        assert res6["batch_created"] is False
        ml_assign_count = sum(1 for a in db.batch_students if a["student_id"] == ml_student_1)
        assert ml_assign_count == 1, f"Expected 1 record, found {ml_assign_count}"
        print(f"[PASS] TEST 6 PASSED: Exactly 1 assignment record preserved, duplicate prevented!")

        # ----------------------------------------------------
        # TEST 7:
        # Two students register simultaneously when one seat is available
        # Expected:
        # Only one student gets the last seat
        # Second student causes a new same-course batch to be created
        # ----------------------------------------------------
        print("\n--- TEST 7: Race Condition / Simultaneous Registration Protection ---")
        # Setup WD Batch A with 6/7 students (1 seat left)
        for i in range(2, 7):
            sid = f"s-wd-{i}"
            db.students.append({"id": sid, "name": f"WD Student {i}", "role_id": wd_role_id})
            db.batch_students.append({"id": f"bs-wd-{i}", "batch_id": "b-wd-a", "student_id": sid})

        wd_a_current = sum(1 for a in db.batch_students if a["batch_id"] == "b-wd-a")
        assert wd_a_current == 6, f"Expected WD Batch A to have 6 students, got {wd_a_current}"

        # Two students register simultaneously
        cand_1 = "s-wd-concurrent-1"
        cand_2 = "s-wd-concurrent-2"
        db.students.append({"id": cand_1, "name": "Concurrent 1", "role_id": wd_role_id})
        db.students.append({"id": cand_2, "name": "Concurrent 2", "role_id": wd_role_id})

        concurrent_results = []
        barrier = threading.Barrier(2)

        def worker(sid):
            barrier.wait()
            res = assign_student_to_batch(sid, role_id=wd_role_id)
            concurrent_results.append(res)

        with ThreadPoolExecutor(max_workers=2) as executor:
            fut1 = executor.submit(worker, cand_1)
            fut2 = executor.submit(worker, cand_2)
            fut1.result()
            fut2.result()

        print(f"Worker 1 Result: {concurrent_results[0]}")
        print(f"Worker 2 Result: {concurrent_results[1]}")

        # Check WD Batch A count
        final_wd_a_count = sum(1 for a in db.batch_students if a["batch_id"] == "b-wd-a")
        print(f"WD Batch A final count: {final_wd_a_count} / 7")
        assert final_wd_a_count == 7, f"Capacity overflow! WD Batch A has {final_wd_a_count} instead of 7"

        # Check results: exactly 1 took seat in WD Batch A, exactly 1 created new batch
        took_last_seat = [r for r in concurrent_results if r["batch_id"] == "b-wd-a"]
        created_new = [r for r in concurrent_results if r["batch_created"] is True]

        assert len(took_last_seat) == 1, f"Expected 1 student in last seat, got {len(took_last_seat)}"
        assert len(created_new) == 1, f"Expected 1 student in new batch, got {len(created_new)}"
        assert "Batch B" in created_new[0]["batch_name"]

        new_batch_id = created_new[0]["batch_id"]
        new_batch_count = sum(1 for a in db.batch_students if a["batch_id"] == new_batch_id)
        assert new_batch_count == 1
        print(f"[PASS] TEST 7 PASSED: Mutex lock completely prevented race condition! WD Batch A = 7/7, WD Batch B = 1/7. Capacity NEVER exceeded!")

        print("\n==================================================")
        print("ALL 7 TEST CASES PASSED WITH 100% SUCCESS!")
        print("==================================================")

if __name__ == "__main__":
    run_tests()
