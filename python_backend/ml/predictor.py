from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path
import numpy as np

from .feature_engineering import build_compatibility_matrix, extract_student_features, extract_batch_features
from .shuffle_model import CourseBatchOptimizer, BalancedAssignmentModel
from .training import load_trained_model


def predict_course_assignments(
    course_id: str,
    course_name: str,
    students: List[Dict[str, Any]],
    batches: List[Dict[str, Any]],
    trainers: List[Dict[str, Any]],
    trainer_capacities: Optional[Dict[str, int]] = None,
    trainer_current_counts: Optional[Dict[str, int]] = None,
    model_path: Optional[Path] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Main prediction pipeline:
    Given students and batches of a single course, computes the ML-optimized,
    balanced, capacity-compliant assignment plan.
    
    Invariants guaranteed:
    1. Every student is strictly assigned to course_id.
    2. No batch exceeds its configured capacity.
    3. Distribution across batches is balanced (e.g. 47 -> 16, 16, 15).
    4. Exactly 1 active assignment per student.
    """
    trainers_map = {str(t["id"]): t for t in trainers}
    n = len(students)
    m = len(batches)

    if n == 0 or m == 0:
        optimizer = CourseBatchOptimizer()
        return optimizer.optimize_course(
            course_id=course_id,
            course_name=course_name,
            students=students,
            batches=batches,
            compatibility_scores=np.zeros((n, m), dtype=np.float32),
            trainer_capacities=trainer_capacities,
            trainer_current_counts=trainer_current_counts,
        )

    # 1. Compute compatibility matrix using trained ML model if available
    trained_model = load_trained_model(model_path)
    if trained_model is not None:
        try:
            scores = np.zeros((n, m), dtype=np.float32)
            for i, student in enumerate(students):
                s_feat = extract_student_features(student, course_id)
                for j, batch in enumerate(batches):
                    tid = str(batch.get("trainer_id") or "")
                    trainer = trainers_map.get(tid)
                    b_feat = extract_batch_features(batch, course_name, trainer)
                    pair_feat = np.concatenate([s_feat, b_feat]).reshape(1, -1)
                    pred = trained_model.predict(pair_feat)
                    scores[i, j] = float(pred[0])
            # Normalize scores to [0.1, 1.0]
            s_min, s_max = np.min(scores), np.max(scores)
            if s_max > s_min:
                scores = 0.1 + 0.9 * ((scores - s_min) / (s_max - s_min))
            else:
                scores = np.ones((n, m), dtype=np.float32) * 0.5
        except Exception:
            scores = build_compatibility_matrix(students, batches, trainers_map, course_name)
    else:
        scores = build_compatibility_matrix(students, batches, trainers_map, course_name)

    # 2. Run balanced optimization with hard constraints
    optimizer = CourseBatchOptimizer()
    return optimizer.optimize_course(
        course_id=course_id,
        course_name=course_name,
        students=students,
        batches=batches,
        compatibility_scores=scores,
        trainer_capacities=trainer_capacities,
        trainer_current_counts=trainer_current_counts,
    )
