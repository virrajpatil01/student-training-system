import re
import datetime
from typing import Dict, List, Any, Optional
import numpy as np


def extract_contact_info(student: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Safely extracts email and phone from student record or extra_fields JSONB."""
    extra = student.get("extra_fields") or {}
    if not isinstance(extra, dict):
        extra = {}

    email = (
        student.get("email")
        or extra.get("email")
        or extra.get("Email")
        or extra.get("email_address")
        or ""
    )
    phone = (
        student.get("phone")
        or extra.get("phone")
        or extra.get("Phone")
        or extra.get("contact")
        or extra.get("phone_number")
        or extra.get("mobile")
        or ""
    )
    return {"email": str(email).strip(), "phone": str(phone).strip()}


def calculate_recency_score(created_at_str: Optional[str]) -> float:
    """Computes a normalized recency score between 0.0 and 1.0."""
    if not created_at_str:
        return 0.5
    try:
        dt = datetime.datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        diff_days = max(0.0, (now - dt).total_seconds() / 86400.0)
        # Exponential decay: recent registrations have higher score
        return float(np.exp(-diff_days / 30.0))
    except Exception:
        return 0.5


def trainer_course_affinity(trainer: Optional[Dict[str, Any]], course_name: str) -> float:
    """
    Computes trainer specialization compatibility score with course_name.
    1.0 = Exact match in specialization list
    0.8 = Partial substring match
    0.5 = General trainer (no specialization specified)
    0.1 = Trainer specialized in different courses
    """
    if not trainer or not course_name:
        return 0.5

    spec = (trainer.get("specialization") or "").strip()
    if not spec:
        return 0.5

    specs = [s.strip().lower() for s in spec.split(",") if s.strip()]
    if not specs:
        return 0.5

    c_lower = course_name.strip().lower()
    if any(c_lower == s for s in specs):
        return 1.0
    if any(c_lower in s or s in c_lower for s in specs):
        return 0.8

    return 0.1


def extract_student_features(student: Dict[str, Any], course_id: str) -> np.ndarray:
    """
    Transforms a student dictionary into a dense numeric feature vector:
    [has_email, has_phone, recency_score, student_hash_val]
    """
    contacts = extract_contact_info(student)
    has_email = 1.0 if contacts["email"] else 0.0
    has_phone = 1.0 if contacts["phone"] else 0.0
    recency = calculate_recency_score(student.get("created_at"))
    
    # Deterministic pseudo-random seed based on UUID for consistent scoring
    sid = str(student.get("id") or "")
    sid_hash = (sum(ord(c) for c in sid) % 100) / 100.0

    return np.array([has_email, has_phone, recency, sid_hash], dtype=np.float32)


def extract_batch_features(
    batch: Dict[str, Any],
    course_name: str,
    trainer: Optional[Dict[str, Any]]
) -> np.ndarray:
    """
    Transforms a batch state into a numeric feature vector:
    [capacity, trainer_affinity, trainer_cap_ratio, batch_index_norm]
    """
    cap = float(batch.get("capacity") or 20)
    affinity = trainer_course_affinity(trainer, course_name)
    
    t_cap = float(trainer.get("capacity") or 30) if trainer else 30.0
    trainer_ratio = min(1.0, cap / max(1.0, t_cap))

    # Extract letter / numeric suffix index
    b_name = str(batch.get("batch_name") or "")
    num_match = re.search(r"Batch\s*(\d+)$", b_name, re.IGNORECASE)
    let_match = re.search(r"Batch\s*([A-Za-z]+)$", b_name, re.IGNORECASE)
    idx_val = 1.0
    if num_match:
        idx_val = float(num_match.group(1))
    elif let_match:
        ch = let_match.group(1).upper()
        idx_val = float(ord(ch[0]) - ord('A') + 1) if ch else 1.0

    return np.array([cap / 50.0, affinity, trainer_ratio, idx_val / 20.0], dtype=np.float32)


def build_compatibility_matrix(
    students: List[Dict[str, Any]],
    batches: List[Dict[str, Any]],
    trainers_map: Dict[str, Dict[str, Any]],
    course_name: str
) -> np.ndarray:
    """
    Constructs an (N, M) compatibility score matrix between N students and M batches.
    Higher score indicates higher affinity / priority for balanced assignment.
    """
    n = len(students)
    m = len(batches)
    if n == 0 or m == 0:
        return np.zeros((n, m), dtype=np.float32)

    student_matrix = np.array([extract_student_features(s, "") for s in students])  # shape (N, 4)
    batch_features = []
    for b in batches:
        tid = str(b.get("trainer_id") or "")
        trainer = trainers_map.get(tid)
        batch_features.append(extract_batch_features(b, course_name, trainer))
    batch_matrix = np.array(batch_features)  # shape (M, 4)

    # Dot product similarity weighted by affinity
    # Weight vector emphasizing balanced distribution & trainer affinity
    weights = np.array([0.2, 0.2, 0.3, 0.3], dtype=np.float32)
    weighted_students = student_matrix * weights
    weighted_batches = batch_matrix * weights

    similarity = np.dot(weighted_students, weighted_batches.T)  # shape (N, M)

    # Normalize similarity to [0.1, 1.0] range
    min_val = np.min(similarity)
    max_val = np.max(similarity)
    if max_val > min_val:
        scores = 0.1 + 0.9 * ((similarity - min_val) / (max_val - min_val))
    else:
        scores = np.ones((n, m), dtype=np.float32) * 0.5

    return scores
