import json
import urllib.request
import urllib.error
from shuffle_service import get_supabase_client

API_BASE = "http://127.0.0.1:8000"

def post_json(url, payload=None):
    data = json.dumps(payload or {}).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))

def run_test():
    client = get_supabase_client()
    
    # 1. Fetch roles
    roles = client.table("roles").select("id, role_name").execute().data
    da_role = next((r for r in roles if r["role_name"] == "Data Analytics"), None)
    wd_role = next((r for r in roles if r["role_name"] == "Web Development"), None)
    
    assert da_role is not None, "Data Analytics role not found in DB!"
    assert wd_role is not None, "Web Development role not found in DB!"
    
    print(f"Role 1: {da_role['role_name']} (ID: {da_role['id']})")
    print(f"Role 2: {wd_role['role_name']} (ID: {wd_role['id']})")
    
    # Clean up previous test students and batches if any
    client.table("batch_students").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    client.table("batches").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    client.table("students").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    
    print("\nInserting 10 Data Analytics students and 10 Web Development students...")
    da_students = [{"name": f"DA Student {i+1}", "role_id": da_role["id"]} for i in range(10)]
    wd_students = [{"name": f"WD Student {i+1}", "role_id": wd_role["id"]} for i in range(10)]
    
    client.table("students").insert(da_students).execute()
    client.table("students").insert(wd_students).execute()
    print("✓ Successfully inserted 20 students.")

    # 2. Call Auto Create Role-wise Batches API with batch_capacity = 5
    print("\nCalling POST /batches/auto-create-role-wise with capacity=5...")
    status1, data1 = post_json(f"{API_BASE}/batches/auto-create-role-wise", {"batch_capacity": 5})
    assert status1 == 200, f"Auto create failed: {data1}"
    
    print("Auto-create response:")
    print(json.dumps(data1, indent=2))
    
    created = data1["created_batches"]
    expected_batches = [
        "Data Analytics - Batch A",
        "Data Analytics - Batch B",
        "Web Development - Batch A",
        "Web Development - Batch B"
    ]
    for exp in expected_batches:
        assert exp in created, f"Expected batch '{exp}' was not created!"
    print(f"✓ All 4 expected batches were created: {created}")

    # 3. Call Auto Create Role-wise Batches API AGAIN to test idempotency
    print("\nTesting Idempotency: Calling POST /batches/auto-create-role-wise a 2nd time...")
    status2, data2 = post_json(f"{API_BASE}/batches/auto-create-role-wise", {"batch_capacity": 5})
    assert status2 == 200, f"Auto create 2nd call failed: {data2}"
    assert len(data2["created_batches"]) == 0, f"Duplicate batches created! {data2['created_batches']}"
    print("✓ Idempotency confirmed: 0 new batches created on second run.")

    # 4. Call Shuffle All API
    print("\nCalling POST /shuffle/all...")
    shuffle_status, shuffle_data = post_json(f"{API_BASE}/shuffle/all")
    assert shuffle_status == 200, f"Shuffle failed: {shuffle_data}"
    
    print(f"Shuffle result message: {shuffle_data.get('message')}")
    print(f"Total students: {shuffle_data.get('total_students')}")
    print(f"Newly assigned count: {shuffle_data.get('newly_assigned_count')}")
    print(f"Unassigned count: {shuffle_data.get('unassigned_count')}")
    
    assignments = shuffle_data.get("assignments", [])
    assert len(assignments) == 20, f"Expected 20 assignments, got {len(assignments)}"
    
    # Verify: Data Analytics students only in Data Analytics batches,
    # Web Development students only in Web Development batches
    batch_counts = {}
    for a in assignments:
        s_name = a["student_name"]
        b_name = a["batch_name"]
        c_name = a["course_name"]
        
        batch_counts[b_name] = batch_counts.get(b_name, 0) + 1
        
        if "DA Student" in s_name:
            assert "Data Analytics" in b_name, f"Role mismatch: {s_name} in {b_name}"
            assert c_name == "Data Analytics", f"Course mismatch for {s_name}: {c_name}"
        elif "WD Student" in s_name:
            assert "Web Development" in b_name, f"Role mismatch: {s_name} in {b_name}"
            assert c_name == "Web Development", f"Course mismatch for {s_name}: {c_name}"

    print("\nBatch assignment student counts:")
    for b_name, cnt in batch_counts.items():
        print(f"  {b_name}: {cnt} students")
        assert cnt <= 5, f"Batch '{b_name}' exceeded capacity of 5 (has {cnt})!"
        assert cnt == 5, f"Batch '{b_name}' should have exactly 5 students (has {cnt})!"

    print("\n✓ ALL 17 TEST REQUIREMENTS AND INVARIANTS PASSED PERFECTLY!")

if __name__ == "__main__":
    run_test()
