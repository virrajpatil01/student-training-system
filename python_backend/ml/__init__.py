"""
Machine Learning and Balanced Optimization Module for Student Batch Allocation.

Provides:
- Feature extraction for students, batches, and trainer compatibility.
- Balanced assignment optimization enforcing course isolation and hard capacity limits.
- Pre-trained / incremental scoring model.
- High-level prediction API for all courses.
"""

from .feature_engineering import (
    extract_student_features,
    extract_batch_features,
    build_compatibility_matrix,
)
from .shuffle_model import (
    CourseBatchOptimizer,
    BalancedAssignmentModel,
)
from .predictor import (
    predict_course_assignments,
)
from .training import (
    train_assignment_model,
)

__all__ = [
    "extract_student_features",
    "extract_batch_features",
    "build_compatibility_matrix",
    "CourseBatchOptimizer",
    "BalancedAssignmentModel",
    "predict_course_assignments",
    "train_assignment_model",
]
