import os
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
import joblib
import numpy as np
from sklearn.linear_model import Ridge
from .feature_engineering import extract_student_features, extract_batch_features

logger = logging.getLogger("ml_training")

MODELS_DIR = Path(__file__).parent.parent / "models"
MODEL_FILE = MODELS_DIR / "batch_assignment_model.pkl"


def train_assignment_model(
    assignments: List[Dict[str, Any]],
    students_map: Dict[str, Dict[str, Any]],
    batches_map: Dict[str, Dict[str, Any]],
    trainers_map: Dict[str, Dict[str, Any]],
    roles_map: Dict[str, str],
    model_output_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Trains an affinity scoring model using historical student batch assignments.
    If historical data is sparse, initializes and calibrates a robust baseline model.
    """
    output_path = model_output_path or MODEL_FILE
    output_path.parent.mkdir(parents=True, exist_ok=True)

    X_train = []
    y_train = []

    # Construct training samples from historical assignments
    for a in assignments:
        sid = str(a.get("student_id") or "")
        bid = str(a.get("batch_id") or "")
        if sid in students_map and bid in batches_map:
            student = students_map[sid]
            batch = batches_map[bid]
            tid = str(batch.get("trainer_id") or "")
            trainer = trainers_map.get(tid)
            course_name = roles_map.get(str(student.get("role_id") or ""), "")

            s_feat = extract_student_features(student, str(student.get("role_id") or ""))
            b_feat = extract_batch_features(batch, course_name, trainer)
            combined_feat = np.concatenate([s_feat, b_feat])

            X_train.append(combined_feat)
            y_train.append(1.0)  # Positive assignment pairing

    # Generate synthetic negative samples (mismatched batches) for contrastive learning
    if len(X_train) >= 5:
        # Create negative examples by pairing students with mismatched batches
        for sid, student in list(students_map.items())[:len(X_train)]:
            for bid, batch in list(batches_map.items())[:3]:
                if str(student.get("role_id")) != str(batch.get("role_id")):
                    tid = str(batch.get("trainer_id") or "")
                    trainer = trainers_map.get(tid)
                    course_name = roles_map.get(str(student.get("role_id") or ""), "")
                    s_feat = extract_student_features(student, str(student.get("role_id") or ""))
                    b_feat = extract_batch_features(batch, course_name, trainer)
                    X_train.append(np.concatenate([s_feat, b_feat]))
                    y_train.append(0.0)  # Negative pairing (different course)

    X = np.array(X_train) if X_train else np.zeros((0, 8))
    y = np.array(y_train) if y_train else np.zeros((0,))

    # Train model if sufficient samples exist, otherwise use calibrated Ridge model
    model = Ridge(alpha=1.0)
    if len(X) >= 10:
        model.fit(X, y)
        train_status = f"Trained supervised model with {len(X)} historical samples."
    else:
        # Fit on structured calibration priors
        # [s_email, s_phone, s_recency, s_hash, b_cap, b_affinity, b_tr_ratio, b_idx]
        dummy_X = np.array([
            [1.0, 1.0, 0.9, 0.5, 0.4, 1.0, 0.6, 0.1],
            [1.0, 0.0, 0.5, 0.2, 0.4, 0.8, 0.5, 0.2],
            [0.0, 1.0, 0.3, 0.8, 0.4, 0.5, 0.4, 0.3],
            [0.0, 0.0, 0.1, 0.1, 0.4, 0.1, 0.2, 0.4],
        ], dtype=np.float32)
        dummy_y = np.array([1.0, 0.8, 0.5, 0.1], dtype=np.float32)
        model.fit(dummy_X, dummy_y)
        train_status = f"Calibrated baseline ML scoring model (sparse historical data: {len(X)} records)."

    # Serialize to disk
    joblib.dump(model, output_path)
    logger.info(f"Model successfully saved to {output_path}")

    return {
        "success": True,
        "model_path": str(output_path),
        "status": train_status,
        "sample_count": len(X),
    }


def load_trained_model(model_path: Optional[Path] = None) -> Optional[Any]:
    """Loads pre-trained model from disk if present."""
    path = model_path or MODEL_FILE
    if path.exists():
        try:
            return joblib.load(path)
        except Exception as e:
            logger.warning(f"Failed to load model from {path}: {e}")
            return None
    return None
