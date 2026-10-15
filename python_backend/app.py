import os
import logging
from typing import Optional, List
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from shuffle_service import (
    shuffle_all,
    shuffle_course,
    shuffle_batch,
    assign_student_to_batch,
    assign_student_to_course_batch,
    assign_unassigned_students_to_course,
    auto_create_role_wise_batches,
    get_all_assignments_summary,
    get_supabase_client,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("shuffle_app")

app = FastAPI(
    title="Student Training System - ML Shuffle API",
    description="Generic, balanced ML optimization service for automated student batch allocations across all courses.",
    version="2.0.0",
)

# Configure CORS for Vite React frontend (supports localhost, custom domain, and Vercel domains)
frontend_env = os.getenv("FRONTEND_URL")
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]
if frontend_env:
    origins.append(frontend_env.strip().rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.vercel\.app.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AutoCreateBatchesRequest(BaseModel):
    batch_capacity: Optional[int] = Field(default=20, ge=1, le=500)


class ShuffleAllRequest(BaseModel):
    auto_create_if_deficit: Optional[bool] = Field(default=True)
    default_capacity: Optional[int] = Field(default=20, ge=1, le=500)


class ShuffleCourseRequest(BaseModel):
    default_capacity: Optional[int] = Field(default=20, ge=1, le=500)


class AssignStudentRequest(BaseModel):
    student_id: str
    role_id: Optional[str] = None
    default_capacity: Optional[int] = Field(default=20, ge=1, le=500)


class AssignUnassignedRequest(BaseModel):
    role_id: str
    batch_id: Optional[str] = None
    default_capacity: Optional[int] = Field(default=25, ge=1, le=500)


class BulkDeleteStudentsRequest(BaseModel):
    student_ids: List[str] = Field(..., min_length=1)


@app.get("/")
@app.get("/health")
def health_check():
    """Health check endpoint to verify backend availability."""
    return {
        "status": "healthy",
        "service": "student-ml-shuffle-backend",
        "version": "2.0.0"
    }


@app.post("/shuffle/all", status_code=status.HTTP_200_OK)
def handle_shuffle_all(
    payload: Optional[ShuffleAllRequest] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Executes balanced ML shuffle across ALL courses detected from the database:
    - Never hardcodes course names.
    - Operates course-wise: students NEVER cross course boundaries.
    - Capacity is a hard constraint (current <= capacity).
    - Balances batch distribution evenly (e.g. 47 students in 3 batches -> 16, 16, 15).
    - Auto-creates batches for courses if needed when auto_create_if_deficit is enabled.
    """
    try:
        auto_create = payload.auto_create_if_deficit if payload else True
        capacity = payload.default_capacity if payload else 20
        logger.info(f"Executing /shuffle/all (auto_create={auto_create}, capacity={capacity})")
        result = shuffle_all(
            auto_create_if_deficit=auto_create,
            default_capacity=capacity,
            auth_token=authorization
        )
        return result
    except ValueError as val_err:
        logger.warning(f"Shuffle validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        logger.error(f"Internal error during shuffle_all: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Shuffle operation failed: {str(exc)}"
        )


@app.post("/shuffle/course/{course_id}", status_code=status.HTTP_200_OK)
def handle_shuffle_course(
    course_id: str,
    payload: Optional[ShuffleCourseRequest] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Executes ML shuffle for a SINGLE selected course:
    - Redistributes students of that course across its eligible batches.
    - All other courses remain completely untouched.
    """
    if not course_id or not course_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Course ID must be provided."
        )

    try:
        capacity = payload.default_capacity if payload else 20
        logger.info(f"Executing /shuffle/course/{course_id} (capacity={capacity})")
        result = shuffle_course(
            course_id=course_id.strip(),
            default_capacity=capacity,
            auth_token=authorization
        )
        return result
    except ValueError as val_err:
        logger.warning(f"Shuffle course validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        logger.error(f"Internal error during shuffle_course: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Course shuffle operation failed: {str(exc)}"
        )


@app.post("/shuffle/batch/{batch_id}", status_code=status.HTTP_200_OK)
def handle_shuffle_batch(batch_id: str, authorization: Optional[str] = Header(None)):
    """
    Executes random shuffle for a single specified batch.
    """
    if not batch_id or not batch_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch ID must be provided."
        )

    try:
        logger.info(f"Executing /shuffle/batch/{batch_id}")
        result = shuffle_batch(batch_id=batch_id.strip(), auth_token=authorization)
        return result
    except ValueError as val_err:
        logger.warning(f"Shuffle batch validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        logger.error(f"Internal error during shuffle_batch: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Shuffle batch operation failed: {str(exc)}"
        )


@app.post("/students/assign-or-create", status_code=status.HTTP_200_OK)
@app.post("/students/assign-to-batch", status_code=status.HTTP_200_OK)
def handle_assign_student(
    payload: AssignStudentRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Assigns a registered student to an available batch of their selected course.
    If existing batches are full, automatically creates a new batch for that course.
    """
    try:
        logger.info(f"Assigning student {payload.student_id} to role {payload.role_id}")
        result = assign_student_to_batch(
            student_id=payload.student_id,
            role_id=payload.role_id,
            default_capacity=payload.default_capacity or 20,
            auth_token=authorization
        )
        return result
    except ValueError as val_err:
        logger.warning(f"Assign student validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        logger.error(f"Internal error during assign_student: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Student assignment failed: {str(exc)}"
        )


@app.post("/batches/auto-create-role-wise", status_code=status.HTTP_200_OK)
def handle_auto_create_role_wise(
    payload: Optional[AutoCreateBatchesRequest] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Analyzes registered students by role and creates required role-wise batches.
    """
    try:
        capacity = payload.batch_capacity if (payload and payload.batch_capacity) else 20
        logger.info(f"Executing /batches/auto-create-role-wise with capacity={capacity}")
        result = auto_create_role_wise_batches(batch_capacity=capacity, auth_token=authorization)
        return result
    except ValueError as val_err:
        logger.warning(f"Auto-create batches validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        logger.error(f"Internal error during auto-create batches: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Auto batch creation failed: {str(exc)}"
        )


@app.post("/batches/assign-unassigned", status_code=status.HTTP_200_OK)
def handle_assign_unassigned(
    payload: AssignUnassignedRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Automatically fetches all unassigned students belonging to the same course
    and assigns them to available batches (including the newly created batch).
    If capacity is insufficient, automatically creates additional same-course batches.
    """
    try:
        logger.info(f"Assigning unassigned students for role={payload.role_id}, batch={payload.batch_id}")
        result = assign_unassigned_students_to_course(
            role_id=payload.role_id,
            batch_id=payload.batch_id,
            default_capacity=payload.default_capacity or 25,
            auth_token=authorization
        )
        return result
    except ValueError as val_err:
        logger.warning(f"Assign unassigned validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err)
        )
    except Exception as exc:
        logger.error(f"Internal error during assign_unassigned: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch student assignment failed: {str(exc)}"
        )


@app.get("/shuffle/assignments", status_code=status.HTTP_200_OK)
def handle_get_assignments(authorization: Optional[str] = Header(None)):
    """
    Returns full summary of all current student assignments, batches, trainers,
    and dynamically calculated remaining students grouped by course.
    """
    try:
        result = get_all_assignments_summary(auth_token=authorization)
        return result
    except Exception as exc:
        logger.error(f"Internal error fetching assignments: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch assignments: {str(exc)}"
        )


@app.get("/trainers/capacity-summary", status_code=status.HTTP_200_OK)
def handle_get_trainers_capacity_summary(authorization: Optional[str] = Header(None)):
    """
    Returns live target capacity and assigned student counts for all trainers.
    """
    try:
        summary = get_all_assignments_summary(auth_token=authorization)
        return {
            "success": True,
            "trainers": summary.get("trainers_summary", []),
            "stats": summary.get("stats", {})
        }
    except Exception as exc:
        logger.error(f"Internal error fetching trainer capacity summary: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch trainer capacity summary: {str(exc)}"
        )


@app.delete("/students/bulk", status_code=status.HTTP_200_OK)
def handle_bulk_delete_students(
    payload: BulkDeleteStudentsRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Safely deletes students in bulk:
    1. Validates selected student IDs.
    2. Deletes batch_students records first (foreign key constraint order).
    3. Deletes student records from students table.
    4. Handles RLS and foreign key constraints explicitly.
    """
    clean_ids = [str(sid).strip() for sid in payload.student_ids if str(sid).strip()]
    if not clean_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student IDs list is empty or invalid."
        )

    try:
        logger.info(f"Executing bulk delete for {len(clean_ids)} students")
        client = get_supabase_client(auth_token=authorization)

        CHUNK_SIZE = 100

        def run_deletion(curr_client):
            deleted_bs = 0
            for i in range(0, len(clean_ids), CHUNK_SIZE):
                chunk = clean_ids[i:i + CHUNK_SIZE]
                bs_res = curr_client.table("batch_students").delete().in_("student_id", chunk).execute()
                if bs_res.data:
                    deleted_bs += len(bs_res.data)
            logger.info(f"Deleted {deleted_bs} batch_students assignment records")

            del_students = []
            for i in range(0, len(clean_ids), CHUNK_SIZE):
                chunk = clean_ids[i:i + CHUNK_SIZE]
                st_res = curr_client.table("students").delete().in_("id", chunk).execute()
                if st_res.data:
                    del_students.extend(st_res.data)

            return del_students

        try:
            deleted_students = run_deletion(client)
        except Exception as query_exc:
            if "jwt expired" in str(query_exc).lower():
                logger.warning("Token expired during bulk delete. Refreshing system token...")
                from shuffle_service import refresh_system_token
                refresh_system_token()
                client = get_supabase_client(auth_token=None)
                deleted_students = run_deletion(client)
            else:
                raise

        deleted_count = len(deleted_students)
        logger.info(f"Deleted {deleted_count} student records from database")

        if deleted_count == 0:
            logger.error("0 students deleted from database. RLS policy violation on public.students.")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Delete failed: Row Level Security policy violation on students table. Please ensure authenticated DELETE policy is enabled in Supabase SQL Editor."
            )

        return {
            "success": True,
            "deleted_count": deleted_count,
            "deleted_ids": [s["id"] for s in deleted_students if isinstance(s, dict) and "id" in s],
            "message": f"{deleted_count} student{'s' if deleted_count != 1 else ''} deleted successfully."
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error during bulk student delete: {exc}", exc_info=True)
        err_str = str(exc)
        if "foreign key" in err_str.lower():
            detail_msg = "Delete failed: foreign key constraint violation"
        elif "policy" in err_str.lower() or "rls" in err_str.lower() or "permission" in err_str.lower():
            detail_msg = "Delete failed: Row Level Security policy violation"
        else:
            detail_msg = f"Delete failed: {err_str}"
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=detail_msg
        )


@app.delete("/students/{student_id}", status_code=status.HTTP_200_OK)
def handle_delete_single_student(
    student_id: str,
    authorization: Optional[str] = Header(None)
):
    """
    Deletes a single student following strict foreign key ordering.
    """
    sid = str(student_id).strip()
    if not sid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Student ID required.")
    return handle_bulk_delete_students(
        payload=BulkDeleteStudentsRequest(student_ids=[sid]),
        authorization=authorization
    )


@app.delete("/registration-links/{link_id}", status_code=status.HTTP_200_OK)
def handle_delete_registration_link(
    link_id: str,
    authorization: Optional[str] = Header(None)
):
    """
    Safely deletes a registration link:
    1. Nullifies registration_link_id on referencing students table.
    2. Deletes from registration_links table.
    """
    lid = str(link_id).strip()
    if not lid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Link ID is required.")

    try:
        client = get_supabase_client(auth_token=authorization)
        # Attempt to set registration_link_id to null on referencing students
        try:
            client.table("students").update({"registration_link_id": None}).eq("registration_link_id", lid).execute()
        except Exception as e:
            logger.warning(f"Could not nullify students registration_link_id: {e}")

        # Delete the registration link
        client.table("registration_links").delete().eq("id", lid).execute()
        return {"success": True, "message": "Registration link deleted successfully."}
    except Exception as exc:
        logger.error(f"Error deleting registration link: {exc}", exc_info=True)
        err_str = str(exc)
        if "foreign key" in err_str.lower() or "23503" in err_str:
            detail_msg = "Cannot delete link because registered students reference it. Please apply the ON DELETE SET NULL foreign key constraint in Supabase SQL Editor (supabase/fix_registration_links_delete.sql)."
        else:
            detail_msg = f"Failed to delete registration link: {err_str}"
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail_msg)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
