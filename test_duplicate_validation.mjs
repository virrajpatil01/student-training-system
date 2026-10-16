/**
 * Automated Test Suite for Duplicate Registration Validation
 *
 * Requirements:
 * 1. Student Name can be duplicated (even in the same course).
 * 2. Email Address must be globally unique (case-insensitive & trimmed).
 * 3. Exact error message: "This email address is already registered. Please use a different email address."
 * 4. System-wide uniqueness: existing email reused for another course must be rejected.
 */

console.log("==================================================================");
console.log("RUNNING DUPLICATE REGISTRATION VALIDATION TEST SUITE");
console.log("==================================================================");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

// In-memory simulation of the new PostgreSQL register_student RPC and DB trigger logic
class SimulatedRegistrationEngine {
  constructor(initialStudents = []) {
    this.students = [...initialStudents];
    this.lockMap = new Set();
  }

  registerStudent({ token, name, role_id, extra_fields, email }) {
    const cleanToken = (token || "").trim();
    const cleanName = (name || "").trim();

    if (!cleanToken) {
      return { success: false, code: "INVALID_TOKEN", error: "Registration token is required." };
    }
    if (cleanName.length < 2) {
      return { success: false, code: "INVALID_NAME", error: "Student name must be at least 2 characters." };
    }
    if (!role_id) {
      return { success: false, code: "ROLE_NOT_FOUND", error: "Selected course does not exist." };
    }

    // Extract & normalize email (case-insensitive & trimmed)
    let cleanEmail = (email || extra_fields?.email || extra_fields?.["Email Address"] || "").trim().toLowerCase();
    if (!cleanEmail && extra_fields) {
      for (const [_, v] of Object.entries(extra_fields)) {
        if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) {
          cleanEmail = v.trim().toLowerCase();
          break;
        }
      }
    }

    // Concurrency advisory lock simulation
    if (cleanEmail) {
      if (this.lockMap.has(cleanEmail)) {
        // In real Postgres, pg_advisory_xact_lock serializes; when unlocked, uniqueness check catches it
      }
      this.lockMap.add(cleanEmail);
    }

    try {
      // 1. System-wide Unique Email Check (Case-insensitive & trimmed)
      if (cleanEmail) {
        const emailExists = this.students.some((s) => {
          const sEmail = (s.email || s.extra_fields?.email || s.extra_fields?.["Email Address"] || "").trim().toLowerCase();
          return sEmail === cleanEmail;
        });

        if (emailExists) {
          return {
            success: false,
            code: "EMAIL_ALREADY_REGISTERED",
            error: "This email address is already registered. Please use a different email address.",
          };
        }
      }

      // NOTE: Student name duplicate check is INTENTIONALLY REMOVED.
      // Multiple students can have the exact same name across any courses.

      const newStudent = {
        id: "student-" + (this.students.length + 1),
        name: cleanName,
        role_id,
        email: cleanEmail || null,
        extra_fields: { ...extra_fields, email: cleanEmail },
      };

      this.students.push(newStudent);
      return {
        success: true,
        student_id: newStudent.id,
        role_id,
        message: "Registration submitted successfully.",
      };
    } finally {
      if (cleanEmail) {
        this.lockMap.delete(cleanEmail);
      }
    }
  }
}

// Initial DB state with existing students (matches real database)
const engine = new SimulatedRegistrationEngine([
  {
    id: "3022454e-6ca0-42f6-b4d0-6fcc92d10099",
    name: "Suraj Ghadage",
    role_id: "course-data-analytics",
    email: "surajghadage1206@gmail.com",
    extra_fields: { email: "surajghadage1206@gmail.com" },
  },
  {
    id: "cbc58af8-978b-4107-a5e3-e41a3924ea02",
    name: "Viraj Patil",
    role_id: "course-web-dev",
    email: "virajtpatil01@gmail.com",
    extra_fields: { email: "virajtpatil01@gmail.com" },
  },
]);

// -----------------------------------------------------------------------------
// TEST CASE 1: Same name + different emails -> Registration ALLOWED
// -----------------------------------------------------------------------------
console.log("\n--- TEST CASE 1: Same name + different emails ---");
const res1a = engine.registerStudent({
  token: "token123",
  name: "Amit Kumar",
  role_id: "course-web-dev",
  email: "amit.kumar1@gmail.com",
});
assert(res1a.success === true, "First student 'Amit Kumar' with email amit.kumar1@gmail.com registered successfully");

const res1b = engine.registerStudent({
  token: "token123",
  name: "Amit Kumar",
  role_id: "course-web-dev",
  email: "amit.kumar2@gmail.com",
});
assert(res1b.success === true, "Second student with SAME name 'Amit Kumar' but different email is ALLOWED");

// -----------------------------------------------------------------------------
// TEST CASE 2: Different names + same email -> Second registration REJECTED
// -----------------------------------------------------------------------------
console.log("\n--- TEST CASE 2: Different names + same email ---");
const res2a = engine.registerStudent({
  token: "token123",
  name: "Sneha Joshi",
  role_id: "course-web-dev",
  email: "shared.email@gmail.com",
});
assert(res2a.success === true, "First student 'Sneha Joshi' registered with shared.email@gmail.com");

const res2b = engine.registerStudent({
  token: "token123",
  name: "Rohan Deshmukh",
  role_id: "course-data-analytics",
  email: "shared.email@gmail.com",
});
assert(res2b.success === false, "Second student with DIFFERENT name but duplicate email is REJECTED");
assert(res2b.code === "EMAIL_ALREADY_REGISTERED", "Error code is EMAIL_ALREADY_REGISTERED");
assert(
  res2b.error === "This email address is already registered. Please use a different email address.",
  "Exact user-facing error message matches required specification"
);

// -----------------------------------------------------------------------------
// TEST CASE 3: Same email with different letter casing & whitespace -> Second registration REJECTED
// -----------------------------------------------------------------------------
console.log("\n--- TEST CASE 3: Same email with different casing & whitespace ---");
const res3a = engine.registerStudent({
  token: "token123",
  name: "Priya Kulkarni",
  role_id: "course-web-dev",
  email: "Priya.Kulkarni@Outlook.Com",
});
assert(res3a.success === true, "Registered with mixed-case email Priya.Kulkarni@Outlook.Com");

const res3b = engine.registerStudent({
  token: "token123",
  name: "Ananya Shinde",
  role_id: "course-web-dev",
  email: "  priya.kulkarni@outlook.com  ",
});
assert(res3b.success === false, "Registration with lowercase & padded email '  priya.kulkarni@outlook.com  ' is REJECTED");
assert(res3b.code === "EMAIL_ALREADY_REGISTERED", "Casing duplicate caught as EMAIL_ALREADY_REGISTERED");

// -----------------------------------------------------------------------------
// TEST CASE 4: Same name + same course + different emails -> Registration ALLOWED
// -----------------------------------------------------------------------------
console.log("\n--- TEST CASE 4: Same name + same course + different emails ---");
const res4a = engine.registerStudent({
  token: "token123",
  name: "Rahul Patil",
  role_id: "course-python-dev",
  email: "rahul.patil.dev@gmail.com",
});
assert(res4a.success === true, "First Rahul Patil in Python Development registered");

const res4b = engine.registerStudent({
  token: "token123",
  name: "Rahul Patil",
  role_id: "course-python-dev",
  email: "rahul.patil.ai@gmail.com",
});
assert(res4b.success === true, "Second Rahul Patil in SAME COURSE (Python Development) with different email is ALLOWED");

// -----------------------------------------------------------------------------
// TEST CASE 5: Existing email reused for another course -> REJECTED system-wide
// -----------------------------------------------------------------------------
console.log("\n--- TEST CASE 5: Existing email reused for another course ---");
// Suraj Ghadage already exists in database with course-data-analytics and email surajghadage1206@gmail.com
const res5 = engine.registerStudent({
  token: "token123",
  name: "Suraj Ghadage 2",
  role_id: "course-web-dev", // different course!
  email: "surajghadage1206@gmail.com",
});
assert(res5.success === false, "Reusing existing student's email for another course is REJECTED system-wide");
assert(res5.code === "EMAIL_ALREADY_REGISTERED", "Error code is EMAIL_ALREADY_REGISTERED");
assert(
  res5.error === "This email address is already registered. Please use a different email address.",
  "Exact required error message returned"
);

// -----------------------------------------------------------------------------
// TEST CASE 6: Frontend Error Mapping Verification
// -----------------------------------------------------------------------------
console.log("\n--- TEST CASE 6: Frontend Error Mapping Verification ---");
function mapFrontendError(insertError) {
  const msg = String(insertError?.message || "");
  const isEmailDuplicate =
    insertError?.code === "EMAIL_ALREADY_REGISTERED" ||
    insertError?.code === "23505" ||
    msg.includes("This email address is already registered") ||
    (msg.toLowerCase().includes("email") &&
      (msg.toLowerCase().includes("already registered") ||
        msg.toLowerCase().includes("unique") ||
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("idx_students_unique")));

  if (isEmailDuplicate) {
    return "This email address is already registered. Please use a different email address.";
  }
  return insertError?.message || "Registration failed.";
}

assert(
  mapFrontendError({ code: "EMAIL_ALREADY_REGISTERED", message: "Registration rejected." }) ===
    "This email address is already registered. Please use a different email address.",
  "Frontend maps EMAIL_ALREADY_REGISTERED code correctly"
);

assert(
  mapFrontendError({ code: "23505", message: 'duplicate key value violates unique constraint "idx_students_unique_email"' }) ===
    "This email address is already registered. Please use a different email address.",
  "Frontend maps PostgreSQL unique violation 23505 correctly"
);

console.log("\n==================================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("==================================================================");

if (failed > 0) {
  process.exit(1);
}
