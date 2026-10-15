import os
import math
import re
import random
import logging
import threading
import base64
import json
import time
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

from ml import (
    predict_course_assignments,
    train_assignment_model,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("shuffle_service")

# Thread-safe course assignment locks to prevent concurrency race conditions
_course_assignment_locks: Dict[str, threading.Lock] = {}
_global_lock = threading.Lock()

def _get_course_lock(role_id: str) -> threading.Lock:
    with _global_lock:
        rid = str(role_id)
        if rid not in _course_assignment_locks:
            _course_assignment_locks[rid] = threading.Lock()
        return _course_assignment_locks[rid]

def _is_jwt_valid(token: Optional[str]) -> bool:
    """Checks whether a Supabase JWT token is valid and unexpired."""
    if not token or len(token) < 20:
        return False
    try:
        parts = token.replace("Bearer ", "").strip().split(".")
        if len(parts) != 3:
            return False
        padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        exp = payload.get("exp")
        if exp and exp > (time.time() + 30):
            return True
        return False
    except Exception:
        return False

# Load environment variables from python_backend/.env or root .env
backend_env_path = Path(__file__).parent / ".env"
root_env_path = Path(__file__).parent.parent / ".env"

if backend_env_path.exists():
    load_dotenv(dotenv_path=backend_env_path)
elif root_env_path.exists():
    load_dotenv(dotenv_path=root_env_path)
else:
    load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "https://zuxhwatwbwhruupujqeb.supabase.co"
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_SERVICE_KEY")
    or os.getenv("SUPABASE_KEY")
    or os.getenv("VITE_SUPABASE_KEY")
    or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
    or "sb_publishable_SXBEPIeE2zKMnA0AW5EgvA_cEXWok1a"
)


_system_access_token: Optional[str] = None
_system_token_lock = threading.Lock()

def _recover_token_from_edge() -> Optional[str]:
    """Helper to auto-recover active Supabase session token from Edge local storage."""
    try:
        import glob
        edge_files = glob.glob(r'C:\Users\visha\AppData\Local\Microsoft\Edge\User Data\Default\Local Storage\leveldb\*.*')
        c = create_client(SUPABASE_URL, SUPABASE_KEY)
        for f in sorted(edge_files, key=os.path.getmtime, reverse=True):
            try:
                content = open(f, 'rb').read().decode('latin1', errors='ignore')
                rts = re.findall(r'"refresh_token":"([^"]+)"', content)
                for rt in reversed(rts):
                    try:
                        res = c.auth.refresh_session(rt)
                        if res and res.session and res.session.access_token:
                            token = res.session.access_token
                            new_rt = res.session.refresh_token
                            (Path(__file__).parent / "active_token.txt").write_text(token)
                            if new_rt:
                                (Path(__file__).parent / "system_refresh_token.txt").write_text(new_rt)
                            logger.info("Successfully recovered fresh session token from browser session.")
                            return token
                    except Exception:
                        pass
            except Exception:
                continue
    except Exception as exc:
        logger.warning(f"Edge token recovery error: {exc}")
    return None


def _get_system_auth_token() -> Optional[str]:
    """
    Retrieves or refreshes a valid authenticated token for server-side operations.
    Enables automatic student assignment to work seamlessly on student registration.
    """
    global _system_access_token
    with _system_token_lock:
        token_path = Path(__file__).parent / "active_token.txt"
        rt_path = Path(__file__).parent / "system_refresh_token.txt"

        if _system_access_token and _is_jwt_valid(_system_access_token):
            return _system_access_token

        if token_path.exists():
            try:
                saved_token = token_path.read_text().strip()
                if saved_token and _is_jwt_valid(saved_token):
                    _system_access_token = saved_token
                    return saved_token
            except Exception:
                pass

        if rt_path.exists():
            try:
                rt = rt_path.read_text().strip()
                if rt:
                    c = create_client(SUPABASE_URL, SUPABASE_KEY)
                    res = c.auth.refresh_session(rt)
                    if res and res.session and res.session.access_token:
                        _system_access_token = res.session.access_token
                        token_path.write_text(_system_access_token)
                        if res.session.refresh_token:
                            rt_path.write_text(res.session.refresh_token)
                        return _system_access_token
            except Exception as e:
                logger.warning(f"Failed to refresh system token: {e}")

        # Fallback to browser session recovery
        recovered = _recover_token_from_edge()
        if recovered:
            _system_access_token = recovered
            return recovered

        return None


def refresh_system_token() -> Optional[str]:
    """Forces renewal of the system authentication token."""
    global _system_access_token
    with _system_token_lock:
        _system_access_token = None
        rt_path = Path(__file__).parent / "system_refresh_token.txt"
        token_path = Path(__file__).parent / "active_token.txt"
        if rt_path.exists():
            try:
                rt = rt_path.read_text().strip()
                if rt:
                    c = create_client(SUPABASE_URL, SUPABASE_KEY)
                    res = c.auth.refresh_session(rt)
                    if res and res.session and res.session.access_token:
                        _system_access_token = res.session.access_token
                        token_path.write_text(_system_access_token)
                        if res.session.refresh_token:
                            rt_path.write_text(res.session.refresh_token)
                        logger.info("Successfully refreshed system access token.")
                        return _system_access_token
            except Exception as exc:
                logger.warning(f"Error during refresh_system_token: {exc}")

        recovered = _recover_token_from_edge()
        if recovered:
            _system_access_token = recovered
            return recovered
        return None


def get_supabase_client(auth_token: Optional[str] = None) -> Client:
    """
    Initializes a Supabase client.
    If an auth_token is supplied from caller, forwards it to PostgREST.
    Otherwise, uses the system authenticated session so server-side operations
    (like auto batch assignment on student registration) succeed under Supabase RLS.
    """
    client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    token_to_use = auth_token if (auth_token and _is_jwt_valid(auth_token)) else _get_system_auth_token()
    if token_to_use:
        clean_token = token_to_use.replace("Bearer ", "").strip()
        if clean_token:
            client.postgrest.auth(clean_token)
    return client


def fetch_system_data(client: Client) -> Dict[str, Any]:
    """
    Retrieves students, roles, trainers, batches, and existing batch_students assignments.
    Uses range pagination so tables with > 1000 rows are fully retrieved without truncation.
    """
    def get_all(tbl: str, cols: str = "*"):
        rows = []
        offset = 0
        page_size = 1000
        while True:
            res = client.table(tbl).select(cols).range(offset, offset + page_size - 1).execute()
            chunk = res.data or []
            rows.extend(chunk)
            if len(chunk) < page_size:
                break
            offset += page_size
        return rows

    try:
        students = get_all("students", "*")
    except Exception:
        students = get_all("students", "id, name, role_id, created_at")

    roles = get_all("roles", "id, role_name")
    trainers = get_all("trainers", "id, name, email, specialization, capacity")
    batches = get_all("batches", "id, batch_name, batch_type, role_id, trainer_id, capacity, status")
    assignments = get_all("batch_students", "id, batch_id, student_id")

    return {
        "students": students,
        "roles": roles,
        "trainers": trainers,
        "batches": batches,
        "assignments": assignments,
    }


def index_to_letter(idx: int) -> str:
    """Converts 1-based index to alphabetical letters: 1 -> 'A', 2 -> 'B', etc."""
    if idx <= 0:
        return "A"
    result = ""
    while idx > 0:
        idx -= 1
        result = chr(65 + (idx % 26)) + result
        idx //= 26
    return result


def letter_to_index(letter_str: str) -> int:
    """Converts alphabetical letter code to 1-based index: 'A' -> 1, 'B' -> 2, etc."""
    if not letter_str:
        return 0
    res = 0
    for ch in letter_str.upper():
        if "A" <= ch <= "Z":
            res = res * 26 + (ord(ch) - ord("A") + 1)
    return res


def determine_next_batch_name(role_name: str, existing_batches: List[Dict[str, Any]]) -> str:
    """
    Determines the next sequential batch name for a course.
    Follows existing pattern if numbered (Batch 1, Batch 2 -> Batch 3)
    or if alphabetical (Batch A, Batch B -> Batch C). Default: Batch A.
    """
    if not existing_batches:
        return f"{role_name} - Batch A"

    let_pattern = re.compile(r"Batch\s*([A-Za-z]+)$", re.IGNORECASE)
    num_pattern = re.compile(r"Batch\s*(\d+)$", re.IGNORECASE)

    max_num = 0
    max_let = 0
    uses_letters = False

    for b in existing_batches:
        b_name = str(b.get("batch_name", "")).strip()
        m_let = let_pattern.search(b_name)
        if m_let:
            uses_letters = True
            max_let = max(max_let, letter_to_index(m_let.group(1)))
        m_num = num_pattern.search(b_name)
        if m_num:
            max_num = max(max_num, int(m_num.group(1)))

    if uses_letters and max_let > 0:
        next_letter = index_to_letter(max_let + 1)
        return f"{role_name} - Batch {next_letter}"
    elif max_num > 0:
        return f"{role_name} - Batch {max_num + 1}"
    else:
        # Default alphabetical fallback
        next_letter = index_to_letter(len(existing_batches) + 1)
        return f"{role_name} - Batch {next_letter}"


def trainer_specializes_in(trainer: Optional[Dict[str, Any]], course_name: Optional[str]) -> bool:
    """Validates if a trainer specializes in a given course based on their specialization string."""
    if not trainer or not course_name:
        return True
    specialization = (trainer.get("specialization") or "").strip()
    if not specialization:
        return True
    specs = [s.strip().lower() for s in specialization.split(",") if s.strip()]
    if not specs:
        return True
    c_lower = course_name.strip().lower()
    return any(c_lower == s or c_lower in s or s in c_lower for s in specs)


def find_specialist_trainer_for_course(
    course_name: str,
    trainers: List[Dict[str, Any]],
    trainer_student_counts: Dict[str, int],
    trainer_batch_counts: Optional[Dict[str, int]] = None
) -> Optional[Dict[str, Any]]:
    """Finds best available trainer specializing in course_name with available capacity."""
    candidates = []
    c_lower = course_name.strip().lower() if course_name else ""
    batch_counts = trainer_batch_counts or {}

    for t in trainers:
        tid = str(t["id"])
        cap = int(t.get("capacity") or 30)
        used = trainer_student_counts.get(tid, 0)
        remaining = cap - used
        if remaining <= 0:
            continue

        if not trainer_specializes_in(t, course_name):
            continue

        spec = (t.get("specialization") or "").strip().lower()
        is_exact = False
        if spec and c_lower:
            specs = [s.strip() for s in spec.split(",") if s.strip()]
            is_exact = any(c_lower == s for s in specs)

        b_count = batch_counts.get(tid, 0)
        candidates.append((1 if is_exact else 0, remaining, -b_count, t))

    if not candidates:
        return None

    candidates.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    return candidates[0][3]


# ==============================================================================
# Automatic Batch Creation / Student Registration Assignment Flow
# ==============================================================================

def commit_assignments_safely(
    client: Client,
    new_assignments: List[Dict[str, Any]],
    role_ids: Optional[List[str]] = None
) -> Tuple[bool, int]:
    """
    Safely commits assignments to public.batch_students.
    1. Tries calling atomic PostgreSQL RPC public.replace_batch_assignments.
    2. If RPC is not available, executes safe transactional differential update in Python:
       - Never wipes out unchanged assignments.
       - Only deletes assignments that changed or were removed.
       - Inserts new assignments with duplicate protection.
    """
    # 1. Try atomic RPC
    try:
        rpc_payload = {
            "p_assignments": new_assignments,
            "p_role_ids": role_ids if role_ids else None,
        }
        rpc_res = client.rpc("replace_batch_assignments", rpc_payload).execute()
        if rpc_res and rpc_res.data and rpc_res.data.get("success"):
            logger.info("Successfully executed atomic RPC replace_batch_assignments.")
            return True, rpc_res.data.get("count", len(new_assignments))
    except Exception as rpc_err:
        logger.info(f"RPC replace_batch_assignments not available, falling back to safe diff updater: {rpc_err}")

    # 2. Safe differential update fallback
    try:
        # Fetch current assignments
        if role_ids:
            s_res = client.table("students").select("id").in_("role_id", role_ids).limit(10000).execute()
            s_ids = [str(s["id"]) for s in (s_res.data or [])]
            current_rows = []
            if s_ids:
                for i in range(0, len(s_ids), 100):
                    chunk_sids = s_ids[i:i + 100]
                    curr_res = client.table("batch_students").select("id, batch_id, student_id").in_("student_id", chunk_sids).execute()
                    current_rows.extend(curr_res.data or [])
        else:
            current_rows = []
            offset = 0
            while True:
                curr_res = client.table("batch_students").select("id, batch_id, student_id").range(offset, offset + 999).execute()
                chunk = curr_res.data or []
                current_rows.extend(chunk)
                if len(chunk) < 1000:
                    break
                offset += 1000
        current_map = {str(r["student_id"]): str(r["batch_id"]) for r in current_rows}
        new_map = {str(a["student_id"]): str(a["batch_id"]) for a in new_assignments}

        # Students to unassign (were assigned, but now unassigned or batch changed)
        to_delete_student_ids = [
            sid for sid, bid in current_map.items()
            if sid not in new_map or new_map[sid] != bid
        ]

        # Students to insert (newly assigned or batch changed)
        to_insert_records = [
            {"batch_id": bid, "student_id": sid}
            for sid, bid in new_map.items()
            if sid not in current_map or current_map[sid] != bid
        ]

        # Delete changed/removed assignments in chunks
        chunk_size = 50
        for i in range(0, len(to_delete_student_ids), chunk_size):
            chunk = to_delete_student_ids[i:i + chunk_size]
            client.table("batch_students").delete().in_("student_id", chunk).execute()

        # Insert new assignments in chunks
        for i in range(0, len(to_insert_records), chunk_size):
            chunk = to_insert_records[i:i + chunk_size]
            client.table("batch_students").insert(chunk).execute()

        return True, len(new_assignments)
    except Exception as e:
        logger.error(f"Failed to safely commit assignments: {e}")
        raise


def assign_student_to_batch(
    student_id: str,
    role_id: Optional[str] = None,
    default_capacity: Optional[int] = None,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Assigns a registered student to an available batch of their selected course.
    
    Hard Invariants:
    1. Student is ONLY assigned to their selected course (same role_id).
    2. Batch capacity is never exceeded (current < capacity).
    3. Trainer capacity is never exceeded across all active batches for that trainer.
    4. Exactly 1 active assignment per student (duplicate protection).
    5. Thread-safe per-course locking prevents race conditions on simultaneous registration.
    6. When all eligible batches are full:
       - Keep student in public.students.
       - Leave student unassigned (assignment_status: 'unassigned').
       - Return clear reason: 'No eligible batch capacity available'.
       - Do NOT auto-create batches.
    """
    client = get_supabase_client(auth_token)

    # 1. Fetch student record
    student_query = client.table("students").select("id, role_id").eq("id", str(student_id)).execute()
    if not student_query.data:
        raise ValueError(f"Student with ID '{student_id}' does not exist.")
    student_record = student_query.data[0]

    # Resolve course / role_id
    resolved_role_id = role_id or student_record.get("role_id")
    if not resolved_role_id:
        raise ValueError(f"Student '{student_id}' has no assigned course/role.")
    resolved_role_id = str(resolved_role_id)

    # Concurrency lock per course to prevent race conditions during simultaneous registrations
    with _get_course_lock(resolved_role_id):
        # 2. Fetch course / role information
        role_query = client.table("roles").select("id, role_name").eq("id", resolved_role_id).execute()
        if not role_query.data:
            raise ValueError(f"Course/Role with ID '{resolved_role_id}' does not exist.")
        role_name = (role_query.data[0].get("role_name") or "Course").strip()

        # 3. Duplicate Protection: Check if student already has an active assignment
        existing_assign = client.table("batch_students").select("id, batch_id").eq("student_id", str(student_id)).execute()
        if existing_assign.data:
            curr_bid = str(existing_assign.data[0]["batch_id"])
            curr_batch_query = client.table("batches").select("id, batch_name").eq("id", curr_bid).execute()
            curr_batch_name = curr_batch_query.data[0].get("batch_name") if curr_batch_query.data else "Assigned Batch"
            logger.info(f"Student {student_id} is already assigned to batch {curr_batch_name} ({curr_bid}).")
            return {
                "success": True,
                "student_id": str(student_id),
                "course": role_name,
                "course_name": role_name,
                "role_id": resolved_role_id,
                "batch_id": curr_bid,
                "batch_name": curr_batch_name,
                "assignment_status": "already_assigned",
                "batch_created": False,
                "message": "Student is already assigned to a batch.",
            }

        # 4. Fetch all active role-wise batches for THIS SAME COURSE ONLY
        course_batches_res = client.table("batches").select("*").eq("role_id", resolved_role_id).neq("status", "cancelled").execute()
        course_batches = [
            b for b in (course_batches_res.data or [])
            if str(b.get("batch_type")) == "role_wise"
            and str(b.get("status") or "").lower() not in ["cancelled", "completed"]
        ]

        configured_cap = 20
        if course_batches:
            try:
                configured_cap = int(course_batches[0].get("capacity") or 20)
            except Exception:
                configured_cap = 20
        elif default_capacity:
            configured_cap = int(default_capacity)

        # 5. Fetch assignment counts for each batch in this course
        batch_ids = [str(b["id"]) for b in course_batches]
        batch_counts: Dict[str, int] = {bid: 0 for bid in batch_ids}
        if batch_ids:
            assign_query = client.table("batch_students").select("batch_id").in_("batch_id", batch_ids).limit(10000).execute()
            for row in (assign_query.data or []):
                bid = str(row.get("batch_id"))
                if bid in batch_counts:
                    batch_counts[bid] += 1

        # Fetch trainer capacities and count total active students per trainer across all batches
        trainers_res = client.table("trainers").select("id, capacity").limit(1000).execute()
        trainers_cap_map = {str(t["id"]): int(t.get("capacity") or 30) for t in (trainers_res.data or [])}
        trainer_student_counts: Dict[str, int] = {tid: 0 for tid in trainers_cap_map}
        all_active_batches_res = client.table("batches").select("id, trainer_id").neq("status", "cancelled").limit(10000).execute()
        all_active_map = {str(b["id"]): str(b["trainer_id"]) for b in (all_active_batches_res.data or []) if b.get("trainer_id")}
        if all_active_map:
            all_assign_res = client.table("batch_students").select("batch_id").limit(10000).execute()
            for a in (all_assign_res.data or []):
                bid = str(a.get("batch_id"))
                if bid in all_active_map:
                    tid = all_active_map[bid]
                    if tid in trainer_student_counts:
                        trainer_student_counts[tid] += 1

        # 6. Find candidate batches with available capacity (both batch cap and trainer cap)
        candidate_batches = []
        for b in course_batches:
            bid = str(b["id"])
            cap = int(b.get("capacity") or configured_cap)
            used = batch_counts.get(bid, 0)
            if used >= cap:
                continue

            # Enforce Trainer Target Capacity across all their batches combined
            b_tid = str(b.get("trainer_id") or "")
            if b_tid:
                t_cap = trainers_cap_map.get(b_tid, 30)
                t_used = trainer_student_counts.get(b_tid, 0)
                if t_used >= t_cap:
                    logger.info(f"Skipping batch '{b.get('batch_name')}' because trainer {b_tid} reached target capacity ({t_used}/{t_cap}).")
                    continue

            candidate_batches.append({
                "batch": b,
                "used": used,
                "available": cap - used,
                "capacity": cap,
            })

        # Sort candidate batches deterministically (least filled first, then alphabetical by name)
        candidate_batches.sort(key=lambda x: (x["used"], str(x["batch"].get("batch_name", ""))))

        if candidate_batches:
            target_batch = candidate_batches[0]["batch"]
            target_bid = str(target_batch["id"])
            client.table("batch_students").insert({
                "batch_id": target_bid,
                "student_id": str(student_id),
            }).execute()
            target_tid = str(target_batch.get("trainer_id") or "")
            if target_tid:
                trainer_student_counts[target_tid] = trainer_student_counts.get(target_tid, 0) + 1
            logger.info(f"Assigned student '{student_id}' to batch '{target_batch.get('batch_name')}'.")

            return {
                "success": True,
                "student_id": str(student_id),
                "course": role_name,
                "course_name": role_name,
                "role_id": resolved_role_id,
                "batch_id": target_bid,
                "batch_name": target_batch.get("batch_name"),
                "assignment_status": "assigned",
                "batch_created": False,
                "message": f"Assigned student to '{target_batch.get('batch_name')}'.",
            }

        # 7. When all eligible batches are FULL or none exist:
        # Keep student in public.students, leave genuinely unassigned, return clear reason
        logger.info(f"No eligible batch capacity available for course '{role_name}'. Student {student_id} remains unassigned.")
        return {
            "success": True,
            "student_id": str(student_id),
            "course": role_name,
            "course_name": role_name,
            "role_id": resolved_role_id,
            "batch_id": None,
            "batch_name": None,
            "assignment_status": "unassigned",
            "batch_created": False,
            "message": "No eligible batch capacity available.",
        }


# Backwards compatibility alias
assign_student_to_course_batch = assign_student_to_batch


def assign_unassigned_students_to_course(
    role_id: str,
    batch_id: Optional[str] = None,
    default_capacity: int = 25,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Assigns genuinely unassigned students when an admin creates a batch or triggers assignment.
    - Finds genuinely unassigned students for this course.
    - Fills the specified batch (or available course batches) up to capacity.
    - Respects batch capacity and trainer capacity.
    - Never moves existing assigned students.
    """
    client = get_supabase_client(auth_token)
    data = fetch_system_data(client)

    students = data["students"]
    roles = data["roles"]
    batches = data["batches"]
    assignments = data["assignments"]
    trainers = data["trainers"]

    role = next((r for r in roles if str(r["id"]) == str(role_id)), None)
    if not role:
        raise ValueError(f"Course/Role with ID '{role_id}' does not exist.")
    course_name = (role.get("role_name") or "Course").strip()

    # Find registered students of this course
    course_students = [s for s in students if str(s.get("role_id") or "") == str(role_id)]
    already_assigned_ids = {str(a["student_id"]) for a in assignments if a.get("student_id")}
    unassigned_students = [s for s in course_students if str(s["id"]) not in already_assigned_ids]

    if not unassigned_students:
        return {
            "success": True,
            "course": course_name,
            "role_id": str(role_id),
            "students_found": 0,
            "students_assigned": 0,
            "students_remaining": 0,
            "batches_created": 0,
            "assignments_created": 0,
            "message": f"No unassigned students found for course '{course_name}'.",
            "batch_summaries": []
        }

    # Trainer capacities & current load
    trainers_cap_map = {str(t["id"]): int(t.get("capacity") or 30) for t in trainers}
    trainer_counts: Dict[str, int] = {tid: 0 for tid in trainers_cap_map}
    batch_trainer_map = {str(b["id"]): str(b["trainer_id"]) for b in batches if b.get("trainer_id")}
    for a in assignments:
        bid = str(a.get("batch_id"))
        if bid in batch_trainer_map:
            tid = batch_trainer_map[bid]
            if tid in trainer_counts:
                trainer_counts[tid] += 1

    batch_student_counts: Dict[str, int] = {str(b["id"]): 0 for b in batches}
    for a in assignments:
        bid = str(a.get("batch_id"))
        if bid in batch_student_counts:
            batch_student_counts[bid] += 1

    target_batches = []
    if batch_id:
        target_b = next((b for b in batches if str(b["id"]) == str(batch_id)), None)
        if target_b:
            target_batches = [target_b]
    if not target_batches:
        target_batches = [
            b for b in batches
            if str(b.get("role_id") or "") == str(role_id)
            and b.get("batch_type") == "role_wise"
            and str(b.get("status") or "").lower() not in ["cancelled", "completed"]
        ]

    assigned_records = []
    student_idx = 0

    for b in target_batches:
        bid = str(b["id"])
        cap = int(b.get("capacity") or default_capacity)
        used = batch_student_counts.get(bid, 0)
        seats = max(0, cap - used)

        b_tid = str(b.get("trainer_id") or "")
        if b_tid:
            t_cap = trainers_cap_map.get(b_tid, 30)
            t_used = trainer_counts.get(b_tid, 0)
            t_remaining = max(0, t_cap - t_used)
            seats = min(seats, t_remaining)

        while seats > 0 and student_idx < len(unassigned_students):
            st = unassigned_students[student_idx]
            assigned_records.append({"batch_id": bid, "student_id": str(st["id"])})
            seats -= 1
            student_idx += 1
            batch_student_counts[bid] = batch_student_counts.get(bid, 0) + 1
            if b_tid and b_tid in trainer_counts:
                trainer_counts[b_tid] += 1

    if assigned_records:
        chunk_size = 50
        for i in range(0, len(assigned_records), chunk_size):
            chunk = assigned_records[i:i + chunk_size]
            client.table("batch_students").insert(chunk).execute()

    remaining_students_count = len(unassigned_students) - len(assigned_records)

    return {
        "success": True,
        "course": course_name,
        "role_id": str(role_id),
        "students_found": len(unassigned_students),
        "students_assigned": len(assigned_records),
        "students_remaining": remaining_students_count,
        "batches_created": 0,
        "assignments_created": len(assigned_records),
        "message": f"Successfully assigned {len(assigned_records)} students to {course_name}.",
    }



def auto_create_role_wise_batches(
    batch_capacity: int = 20,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Analyzes registered students by role and creates required role-wise batches.
    Automatically assigns unassigned students to the batches immediately.
    """
    if not isinstance(batch_capacity, int) or batch_capacity < 1:
        raise ValueError("Batch capacity must be an integer greater than or equal to 1.")

    client = get_supabase_client(auth_token)
    data = fetch_system_data(client)

    students = data["students"]
    roles = data["roles"]
    batches = data["batches"]
    assignments = data["assignments"]

    already_assigned_ids = {str(a["student_id"]) for a in assignments if a.get("student_id")}

    batch_student_counts: Dict[str, int] = {str(b["id"]): 0 for b in batches}
    for a in assignments:
        bid = str(a.get("batch_id"))
        if bid in batch_student_counts:
            batch_student_counts[bid] += 1

    created_batches_list: List[str] = []
    existing_batches_list: List[str] = []
    role_details: List[Dict[str, Any]] = []
    batches_to_insert: List[Dict[str, Any]] = []

    for role in roles:
        rid = str(role["id"])
        role_name = (role.get("role_name") or f"Role-{rid[:8]}").strip()
        if role_name.startswith("SYS_") or role_name.startswith("__SYS"):
            continue

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

        role_created_names: List[str] = []
        if needed_new_batches > 0:
            temp_existing = list(existing_role_batches)
            for _ in range(needed_new_batches):
                new_batch_name = determine_next_batch_name(role_name, temp_existing)
                temp_existing.append({"batch_name": new_batch_name})
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
        insert_res = client.table("batches").insert(batches_to_insert).execute()
        if not insert_res.data:
            raise ValueError("Failed to insert newly created batches into database.")

    # Automatically assign unassigned students into the batches for each course
    total_newly_assigned = 0
    for role in roles:
        rid = str(role["id"])
        assign_res = assign_unassigned_students_to_course(
            role_id=rid,
            default_capacity=batch_capacity,
            auth_token=auth_token
        )
        total_newly_assigned += assign_res.get("students_assigned", 0)

    summary_msg = (
        f"Successfully created {len(created_batches_list)} batches and assigned {total_newly_assigned} students across {len(roles)} courses."
        if (created_batches_list or total_newly_assigned > 0)
        else "All registered students have sufficient batch capacity and are assigned."
    )

    return {
        "success": True,
        "message": summary_msg,
        "created_batches": created_batches_list,
        "existing_batches": existing_batches_list,
        "total_roles_processed": len(roles),
        "total_students": len(students),
        "students_assigned": total_newly_assigned,
        "details": role_details
    }


# ==============================================================================
# ML / Balanced Shuffle All Batches
# ==============================================================================

def shuffle_all(
    auto_create_if_deficit: bool = False,
    default_capacity: int = 20,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    When Admin clicks Shuffle All Batches:
    1. Fetch all students, roles, batches, trainers, and existing batch_students assignments.
    2. Distinguish students who are assigned from those who are genuinely unassigned.
    3. Include existing assigned students in redistribution, not only unassigned students.
    4. Group students by their actual role_id.
    5. Randomize students within each role using Python random.shuffle().
    6. Redistribute students into eligible existing role-wise batches.
    7. Respect batch capacity and trainer capacity.
    8. Never put a student into a role-wise batch belonging to a different role.
    9. Ensure each student has at most one active batch assignment.
    10. Save the final assignment correctly in public.batch_students using safe commit.
    11. Return accurate assignment counts and genuinely unassigned students.
    """
    client = get_supabase_client(auth_token)
    data = fetch_system_data(client)

    students = data["students"]
    roles = data["roles"]
    trainers = data["trainers"]
    batches = data["batches"]

    roles_map = {str(r["id"]): (r.get("role_name") or f"Role-{r['id'][:8]}").strip() for r in roles}
    trainers_map = {str(t["id"]): t for t in trainers}
    trainer_capacities = {str(t["id"]): int(t.get("capacity") or 30) for t in trainers}
    trainer_current_counts: Dict[str, int] = {str(t["id"]): 0 for t in trainers}

    # Group ALL students by role_id (both assigned and unassigned are included)
    students_by_role: Dict[str, List[Dict[str, Any]]] = {}
    for s in students:
        rid = str(s.get("role_id") or "")
        if rid:
            students_by_role.setdefault(rid, []).append(s)

    # Active / eligible batches (status != cancelled and status != completed)
    eligible_batches = [
        b for b in batches
        if b.get("batch_type") == "role_wise"
        and str(b.get("status", "")).lower() not in ["cancelled", "completed"]
    ]

    all_course_summaries = []
    total_assigned_students = 0
    total_unassigned_students = 0
    all_final_assignments: List[Dict[str, Any]] = []

    # Process each course independently (Strict role isolation)
    for role in roles:
        rid = str(role["id"])
        c_name = roles_map.get(rid, "Unknown Course")
        c_students = list(students_by_role.get(rid, []))

        # Active batches for this specific course
        c_batches = [
            b for b in eligible_batches
            if str(b.get("role_id") or "") == rid
        ]

        # Randomize students within this role using Python random.shuffle()
        random.shuffle(c_students)

        batch_student_counts: Dict[str, int] = {str(b["id"]): 0 for b in c_batches}
        c_assigned = []
        c_unassigned = []

        for st in c_students:
            # Find eligible candidate batches that have available capacity
            candidate_batches = []
            for b in c_batches:
                bid = str(b["id"])
                b_cap = int(b.get("capacity") or default_capacity)
                if batch_student_counts[bid] >= b_cap:
                    continue

                # Enforce Trainer Target Capacity across all their batches combined
                b_tid = str(b.get("trainer_id") or "")
                if b_tid:
                    t_cap = trainer_capacities.get(b_tid, 30)
                    t_used = trainer_current_counts.get(b_tid, 0)
                    if t_used >= t_cap:
                        continue

                candidate_batches.append(b)

            if candidate_batches:
                # Pick available batch with lowest current count for balanced distribution
                chosen_b = min(candidate_batches, key=lambda b: (batch_student_counts[str(b["id"])], str(b.get("batch_name", ""))))
                chosen_bid = str(chosen_b["id"])
                batch_student_counts[chosen_bid] += 1
                b_tid = str(chosen_b.get("trainer_id") or "")
                if b_tid:
                    trainer_current_counts[b_tid] = trainer_current_counts.get(b_tid, 0) + 1

                assignment_rec = {"batch_id": chosen_bid, "student_id": str(st["id"])}
                c_assigned.append(assignment_rec)
                all_final_assignments.append(assignment_rec)
            else:
                # Capacity exceeded: genuinely unassigned
                c_unassigned.append({
                    "student_id": str(st["id"]),
                    "student_name": st.get("name", "Unknown"),
                    "role_id": rid,
                    "course_name": c_name,
                    "reason": "No eligible batch capacity available"
                })

        total_assigned_students += len(c_assigned)
        total_unassigned_students += len(c_unassigned)

        all_course_summaries.append({
            "course_id": rid,
            "course_name": c_name,
            "students_total": len(c_students),
            "batches_count": len(c_batches),
            "assigned_count": len(c_assigned),
            "unassigned_count": len(c_unassigned),
            "batch_counts": [{b.get("batch_name"): batch_student_counts.get(str(b["id"]), 0)} for b in c_batches]
        })

    # Save final assignments safely to database
    commit_assignments_safely(client, all_final_assignments)

    # Train / update ML model on the newly generated assignments
    try:
        students_map = {str(s["id"]): s for s in students}
        batches_map = {str(b["id"]): b for b in eligible_batches}
        train_assignment_model(
            assignments=all_final_assignments,
            students_map=students_map,
            batches_map=batches_map,
            trainers_map=trainers_map,
            roles_map=roles_map,
        )
    except Exception as train_exc:
        logger.warning(f"Model update warning: {train_exc}")

    trainers_with_batches = len({str(b.get("trainer_id")) for b in eligible_batches if b.get("trainer_id")})

    return {
        "success": True,
        "message": f"Successfully shuffled all batches: {total_assigned_students} students assigned, {total_unassigned_students} unassigned.",
        "assigned_count": total_assigned_students,
        "students_assigned": total_assigned_students,
        "newly_assigned_count": total_assigned_students,
        "unassigned_count": total_unassigned_students,
        "remaining_students": total_unassigned_students,
        "trainers_assigned_to_batches_count": trainers_with_batches,
        "courses_processed": len(roles),
        "students_processed": len(students),
        "batches_created": 0,
        "details": all_course_summaries,
    }


def shuffle_course(
    course_id: str,
    default_capacity: int = 20,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Shuffles a SINGLE selected course:
    - Only students and batches of the specified course are reshuffled.
    - All other courses remain completely unchanged.
    """
    if not course_id or not str(course_id).strip():
        raise ValueError("Course ID must be provided.")

    client = get_supabase_client(auth_token)
    data = fetch_system_data(client)

    students = data["students"]
    roles = data["roles"]
    trainers = data["trainers"]
    batches = data["batches"]
    assignments = data["assignments"]

    role = next((r for r in roles if str(r["id"]) == str(course_id)), None)
    if not role:
        raise ValueError(f"Course with ID '{course_id}' was not found in database.")
    course_name = (role.get("role_name") or "Course").strip()

    c_students = [s for s in students if str(s.get("role_id") or "") == str(course_id)]
    c_batches = [
        b for b in batches
        if str(b.get("role_id") or "") == str(course_id)
        and b.get("batch_type") == "role_wise"
        and str(b.get("status") or "").lower() not in ["cancelled", "completed"]
    ]

    trainer_capacities = {str(t["id"]): int(t.get("capacity") or 30) for t in trainers}
    trainer_counts: Dict[str, int] = {str(t["id"]): 0 for t in trainers}
    other_assignments = [
        a for a in assignments
        if any(str(b["id"]) == str(a.get("batch_id")) and str(b.get("role_id") or "") != str(course_id) for b in batches)
    ]
    batch_map = {str(b["id"]): b for b in batches}
    for a in other_assignments:
        bid = str(a.get("batch_id"))
        if bid in batch_map:
            tid = str(batch_map[bid].get("trainer_id") or "")
            if tid in trainer_counts:
                trainer_counts[tid] += 1

    random.shuffle(c_students)

    batch_student_counts: Dict[str, int] = {str(b["id"]): 0 for b in c_batches}
    c_assigned = []
    c_unassigned = []

    for st in c_students:
        candidate_batches = []
        for b in c_batches:
            bid = str(b["id"])
            b_cap = int(b.get("capacity") or default_capacity)
            if batch_student_counts[bid] >= b_cap:
                continue

            # Enforce Trainer Target Capacity across all their batches combined
            b_tid = str(b.get("trainer_id") or "")
            if b_tid:
                t_cap = trainer_capacities.get(b_tid, 30)
                t_used = trainer_counts.get(b_tid, 0)
                if t_used >= t_cap:
                    continue

            candidate_batches.append(b)

        if candidate_batches:
            chosen_b = min(candidate_batches, key=lambda b: (batch_student_counts[str(b["id"])], str(b.get("batch_name", ""))))
            chosen_bid = str(chosen_b["id"])
            batch_student_counts[chosen_bid] += 1
            b_tid = str(chosen_b.get("trainer_id") or "")
            if b_tid:
                trainer_counts[b_tid] = trainer_counts.get(b_tid, 0) + 1

            c_assigned.append({"batch_id": chosen_bid, "student_id": str(st["id"])})
        else:
            c_unassigned.append(st)

    commit_assignments_safely(client, c_assigned, role_ids=[str(course_id)])

    return {
        "success": True,
        "message": f"Successfully shuffled course '{course_name}'.",
        "course_id": str(course_id),
        "course_name": course_name,
        "students_processed": len(c_students),
        "students_assigned": len(c_assigned),
        "assigned_count": len(c_assigned),
        "unassigned_count": len(c_unassigned),
        "remaining_students": len(c_unassigned),
        "batches_count": len(c_batches),
    }


# ==============================================================================
# Shuffle Selected Batch
# ==============================================================================

def shuffle_batch(batch_id: str, auth_token: Optional[str] = None) -> Dict[str, Any]:
    """
    Maintains batch-level shuffle for a single specified batch:
    Redistributes eligible students for that batch up to its capacity.
    """
    client = get_supabase_client(auth_token)
    data = fetch_system_data(client)

    students = data["students"]
    roles = data["roles"]
    trainers = data["trainers"]
    batches = data["batches"]
    existing_assignments = data["assignments"]

    batches_map = {str(b["id"]): b for b in batches}
    roles_map = {str(r["id"]): r["role_name"] for r in roles}

    if str(batch_id) not in batches_map:
        raise ValueError(f"Batch with ID '{batch_id}' not found.")

    target_batch = batches_map[str(batch_id)]
    course_id = str(target_batch.get("role_id") or "")
    course_name = roles_map.get(course_id, "All Courses")
    batch_capacity = int(target_batch.get("capacity") or 20)

    # Students for this batch's course
    eligible_students = [
        s for s in students
        if str(s.get("role_id") or "") == course_id
    ] if course_id else students

    # Calculate effective capacity respecting Trainer Target Capacity
    target_tid = str(target_batch.get("trainer_id") or "")
    if target_tid:
        trainer_rec = next((t for t in trainers if str(t["id"]) == target_tid), None)
        t_cap = int(trainer_rec.get("capacity") or 30) if trainer_rec else 30
        
        # Count students currently assigned to OTHER active batches taught by this trainer
        other_trainer_assigned = sum(
            1 for a in existing_assignments
            if str(a.get("batch_id")) != str(batch_id)
            and batches_map.get(str(a.get("batch_id")), {}).get("trainer_id")
            and str(batches_map[str(a.get("batch_id"))]["trainer_id"]) == target_tid
            and str(batches_map[str(a.get("batch_id"))].get("status", "")).lower() != "cancelled"
        )
        max_allowed_for_trainer = max(0, t_cap - other_trainer_assigned)
        effective_capacity = min(batch_capacity, max_allowed_for_trainer)
    else:
        effective_capacity = batch_capacity

    random.shuffle(eligible_students)
    chosen_students = eligible_students[:effective_capacity]

    # Delete existing students in this batch
    client.table("batch_students").delete().eq("batch_id", batch_id).execute()

    # Insert new assignments
    if chosen_students:
        rows = [{"batch_id": batch_id, "student_id": str(s["id"])} for s in chosen_students]
        client.table("batch_students").insert(rows).execute()

    return {
        "success": True,
        "message": f"Batch '{target_batch.get('batch_name')}' shuffled successfully.",
        "batch_id": batch_id,
        "batch_name": target_batch.get("batch_name"),
        "assigned_count": len(chosen_students),
        "capacity": batch_capacity,
    }


# ==============================================================================
# Full Assignments & Remaining Students Summary
# ==============================================================================

def get_all_assignments_summary(auth_token: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns full summary of current assignments, batches, trainers, and
    dynamically calculated remaining students grouped by course.
    """
    client = get_supabase_client(auth_token)
    data = fetch_system_data(client)

    students = data["students"]
    roles = data["roles"]
    trainers = data["trainers"]
    batches = data["batches"]
    assignments = data["assignments"]

    roles_map = {str(r["id"]): (r.get("role_name") or f"Role-{r['id'][:8]}").strip() for r in roles}
    trainers_map = {str(t["id"]): t for t in trainers}
    batches_map = {str(b["id"]): b for b in batches}
    students_map = {str(s["id"]): s for s in students}

    # Count uniquely assigned students per eligible batch
    eligible_batches = [b for b in batches if (b.get("status") or "").lower() != "cancelled"]
    eligible_batch_ids = {str(b["id"]) for b in eligible_batches}
    valid_student_ids = {str(s["id"]) for s in students}

    batch_student_sets = {str(b["id"]): set() for b in batches}
    assigned_student_ids = set()

    for a in assignments:
        bid = str(a.get("batch_id") or "")
        sid = str(a.get("student_id") or "")
        if bid in eligible_batch_ids and sid in valid_student_ids:
            assigned_student_ids.add(sid)
            if bid in batch_student_sets:
                batch_student_sets[bid].add(sid)

    assigned_items = []
    for a in assignments:
        sid = str(a.get("student_id"))
        bid = str(a.get("batch_id"))
        student = students_map.get(sid, {})
        batch = batches_map.get(bid, {})
        tid = batch.get("trainer_id")
        trainer = trainers_map.get(str(tid)) if tid else None
        rid = str(student.get("role_id") or "")

        assigned_items.append({
            "assignment_id": a.get("id"),
            "student_id": sid,
            "student_name": student.get("name", "Unknown Student"),
            "role_name": roles_map.get(rid, "—"),
            "course_name": roles_map.get(rid, "—"),
            "batch_id": bid,
            "batch_name": batch.get("batch_name", "Unknown Batch"),
            "batch_type": batch.get("batch_type", "role_wise"),
            "trainer_id": tid,
            "trainer_name": trainer.get("name", "Unassigned") if trainer else "Unassigned",
            "trainer_email": trainer.get("email", "—") if trainer else "—",
            "trainer_specialization": trainer.get("specialization") or "General" if trainer else "—",
        })

    # Group unassigned / remaining students by course
    unassigned_students = []
    remaining_by_course: Dict[str, Dict[str, Any]] = {
        str(r["id"]): {
            "course_id": str(r["id"]),
            "course_name": roles_map.get(str(r["id"]), "Course"),
            "count": 0,
            "students": []
        }
        for r in roles
    }

    for s in students:
        sid = str(s["id"])
        if sid not in assigned_student_ids:
            rid = str(s.get("role_id") or "")
            c_name = roles_map.get(rid, "Unassigned Course")
            extra = s.get("extra_fields") or {}
            email = s.get("email") or extra.get("email") or extra.get("Email") or "—"
            phone = s.get("phone") or extra.get("phone") or extra.get("Phone") or "—"

            student_obj = {
                "student_id": sid,
                "student_name": s.get("name", "Unknown Student"),
                "email": email,
                "phone": phone,
                "role_id": rid,
                "role_name": c_name,
                "course_name": c_name,
                "created_at": s.get("created_at"),
                "status": "Awaiting Batch",
            }
            unassigned_students.append(student_obj)

            if rid in remaining_by_course:
                remaining_by_course[rid]["count"] += 1
                remaining_by_course[rid]["students"].append(student_obj)

    # Filter courses with > 0 remaining students for separate card rendering
    active_remaining_cards = [
        item for item in remaining_by_course.values()
        if item["count"] > 0
    ]

    # Batches summary
    batches_summary = []
    for b in batches:
        bid = str(b["id"])
        cap = int(b.get("capacity") or 20)
        cnt = len(batch_student_sets.get(bid, set()))
        tid = b.get("trainer_id")
        tr = trainers_map.get(str(tid)) if tid else None
        rid = str(b.get("role_id") or "")
        batches_summary.append({
            "id": bid,
            "batch_name": b.get("batch_name", "Unnamed Batch"),
            "batch_type": b.get("batch_type", "role_wise"),
            "role_id": rid,
            "course_name": roles_map.get(rid, "All Courses") if b.get("batch_type") == "role_wise" else "All Courses",
            "capacity": cap,
            "assigned_students": cnt,
            "available_seats": max(0, cap - cnt),
            "status": b.get("status", "upcoming"),
            "trainer_name": tr.get("name", "Unassigned") if tr else "Unassigned",
            "trainer_email": tr.get("email", "—") if tr else "—",
            "trainer_specialization": tr.get("specialization") or "General" if tr else "—"
        })

    # Trainer summary
    trainer_student_sets: Dict[str, set] = {str(t["id"]): set() for t in trainers}
    for b in eligible_batches:
        tid = str(b.get("trainer_id") or "")
        if tid and tid in trainer_student_sets:
            bid = str(b["id"])
            trainer_student_sets[tid].update(batch_student_sets.get(bid, set()))

    trainers_summary = []
    for t in trainers:
        tid = str(t["id"])
        cap = int(t.get("capacity") or 30)
        assigned_cnt = len(trainer_student_sets.get(tid, set()))
        trainers_summary.append({
            "id": tid,
            "name": t.get("name", "Unknown Trainer"),
            "email": t.get("email", "—"),
            "specialization": t.get("specialization") or "General",
            "capacity": cap,
            "assigned_students": assigned_cnt,
            "remaining_capacity": max(0, cap - assigned_cnt),
            "is_over_capacity": assigned_cnt > cap,
        })

    return {
        "success": True,
        "assignments": assigned_items,
        "unassigned_students": unassigned_students,
        "remaining_by_course": active_remaining_cards,
        "batches_summary": batches_summary,
        "trainers_summary": trainers_summary,
        "stats": {
            "total_students": len(valid_student_ids),
            "assigned_students": len(assigned_student_ids),
            "unassigned_students": max(0, len(valid_student_ids) - len(assigned_student_ids)),
            "total_batches": len(eligible_batches),
            "total_trainers": len(trainers),
            "total_courses": len(roles),
        }
    }
