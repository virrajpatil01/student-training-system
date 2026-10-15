import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { getApiUrl } from "../config/api";

function isValidLink(link) {
  return Boolean(
    link?.is_active &&
      (!link.expires_at || new Date(link.expires_at).getTime() > Date.now()),
  );
}

function getRoleLabel(role) {
  return role.name || role.role_name || role.role || role.title || "";
}

function isMissingColumnError(error) {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    (typeof error.message === "string" &&
      (error.message.toLowerCase().includes("column") ||
        error.message.toLowerCase().includes("schema cache") ||
        error.message.toLowerCase().includes("does not exist")))
  );
}

const DEFAULT_FORM_FIELDS = [
  { id: "name", name: "Full Name", type: "text", required: true, isDefault: true },
  { id: "role", name: "Role", type: "dropdown", required: true, isDefault: true },
];

function Register() {
  const { token } = useParams();
  const submissionLock = useRef(false);
  const [link, setLink] = useState(null);
  const [formConfig, setFormConfig] = useState(DEFAULT_FORM_FIELDS);
  const [roles, setRoles] = useState([]);
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [customValues, setCustomValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [assignmentResult, setAssignmentResult] = useState(null);
  const [validLink, setValidLink] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showCreateCourseInline, setShowCreateCourseInline] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseCapacity, setNewCourseCapacity] = useState(40);
  const [newCourseDescription, setNewCourseDescription] = useState("");
  const [newCourseError, setNewCourseError] = useState("");
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [courseCreatedNotice, setCourseCreatedNotice] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadFormOptions() {
      if (!token) {
        setValidLink(false);
        setLoading(false);
        return;
      }

      const { data: linkData, error: linkError } = await supabase
        .from("registration_links")
        .select("*")
        .eq("token", token)
        .maybeSingle();

      if (!isMounted) return;

      if (linkError) {
        console.error("Unable to validate registration link:", linkError);
        setValidLink(false);
        setLoading(false);
        return;
      }

      if (!isValidLink(linkData)) {
        setValidLink(false);
        setLoading(false);
        return;
      }

      setLink(linkData);

      let loadedConfig = null;
      if (Array.isArray(linkData.form_config) && linkData.form_config.length > 0) {
        loadedConfig = linkData.form_config;
      } else {
        try {
          const cached = localStorage.getItem(`reg_form_${token}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              loadedConfig = parsed;
            }
          }
        } catch {
          // ignore
        }
      }

      if (loadedConfig) {
        setFormConfig(loadedConfig);
      }

      const { data: roleData, error: roleError } = await supabase
        .from("roles")
        .select("*")
        .limit(500);

      if (!isMounted) return;

      if (roleError) {
        console.error("Unable to load registration roles:", roleError);
        setErrorMessage(
          "Roles could not be loaded. Please contact the administrator.",
        );
      } else {
        setRoles(
          (roleData || []).filter(
            (role) => role.id != null && getRoleLabel(role),
          ),
        );
      }
      setValidLink(true);
      setLoading(false);
    }

    loadFormOptions().catch((error) => {
      console.error("Unable to load registration form:", error);
      if (isMounted) {
        setValidLink(false);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [token]);

  function handleCustomChange(fieldId, value) {
    setCustomValues((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  }

  async function handleCreateCourseInline() {
    const trimmed = (newCourseName || "").trim();
    if (!trimmed || trimmed.length < 2) {
      setNewCourseError("Course name must be at least 2 characters.");
      return;
    }
    const cap = Math.max(1, parseInt(newCourseCapacity, 10) || 40);
    const desc = (newCourseDescription || "").trim();

    setCreatingCourse(true);
    setNewCourseError("");

    try {
      const { data: existing } = await supabase.from("roles").select("id, role_name");
      if ((existing || []).some((r) => (r.role_name || "").trim().toLowerCase() === trimmed.toLowerCase())) {
        setNewCourseError(`A course named "${trimmed}" already exists.`);
        setCreatingCourse(false);
        return;
      }

      let createdRole = null;
      try {
        const { data, error } = await supabase
          .from("roles")
          .insert({ role_name: trimmed, capacity: cap, description: desc })
          .select()
          .single();
        if (error) throw error;
        createdRole = data;
      } catch {
        const { data, error } = await supabase
          .from("roles")
          .insert({ role_name: trimmed })
          .select()
          .single();
        if (error) throw error;
        createdRole = data;
      }

      if (createdRole) {
        try {
          localStorage.setItem(`course_meta_${createdRole.id}`, JSON.stringify({ capacity: cap, description: desc }));
        } catch {
          // ignore
        }

        setRoles((prev) => [...prev, createdRole]);
        setRoleId(String(createdRole.id));
        setShowCreateCourseInline(false);
        setNewCourseName("");
        setNewCourseCapacity(40);
        setNewCourseDescription("");
        setCourseCreatedNotice(`✓ Course "${trimmed}" created & selected.`);
        setTimeout(() => setCourseCreatedNotice(""), 6000);
      }
    } catch (err) {
      console.error("Inline course creation failed:", err);
      setNewCourseError(err.message || "Failed to create course.");
    } finally {
      setCreatingCourse(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submissionLock.current || saving) return;
    setErrorMessage("");

    const normalizedName = name.trim();
    if (normalizedName.length < 2) {
      setErrorMessage("Enter your name using at least 2 characters.");
      return;
    }
    if (!roleId) {
      setErrorMessage("Select a role.");
      return;
    }

    // Validate custom fields
    for (const field of formConfig) {
      if (field.isDefault) continue;
      const val = (customValues[field.id] || "").trim();
      if (field.required && !val) {
        setErrorMessage(`Please provide a value for "${field.name}".`);
        return;
      }
      if (field.type === "email" && val) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          setErrorMessage(`Enter a valid email address for "${field.name}".`);
          return;
        }
      }
    }

    if (!link || !isValidLink(link)) {
      setValidLink(false);
      return;
    }

    submissionLock.current = true;
    setSaving(true);

    const { data: currentLink, error: validationError } = await supabase
      .from("registration_links")
      .select("id, is_active, expires_at")
      .eq("id", link.id)
      .eq("token", token)
      .maybeSingle();

    if (validationError || !isValidLink(currentLink)) {
      if (validationError) {
        console.error("Unable to revalidate registration link:", validationError);
      }
      setSaving(false);
      submissionLock.current = false;
      setValidLink(false);
      return;
    }

    const payloadWithExtra = {
      name: normalizedName,
      role_id: roleId,
      registration_link_id: link.id,
      extra_fields: customValues,
    };

    console.log("========== STUDENT REGISTRATION SUBMIT ==========");
    console.log("Submitting payload:", payloadWithExtra);
    console.log("Token:", token);
    console.log("Link ID:", link?.id);
    console.log("Role ID:", roleId);
    console.log("Custom Values:", customValues);
    console.log("================================================");

    let studentInsertResult = await supabase
      .from("students")
      .insert(payloadWithExtra)
      .select("id, role_id")
      .single();

    let insertError = studentInsertResult.error;
    let insertedStudent = studentInsertResult.data;

    // Fallback if extra_fields column does not exist yet (PGRST204 or 42703)
    if (insertError && isMissingColumnError(insertError)) {
      console.warn("extra_fields column not present in students table, submitting default columns.");
      const defaultPayload = {
        name: normalizedName,
        role_id: roleId,
        registration_link_id: link.id,
      };
      const fallbackResult = await supabase
        .from("students")
        .insert(defaultPayload)
        .select("id, role_id")
        .single();
      insertError = fallbackResult.error;
      insertedStudent = fallbackResult.data;
    }

    // Automatic Course-wise Batch Allocation
    if (!insertError && insertedStudent?.id) {
      try {
        const assignRes = await fetch(getApiUrl("/students/assign-or-create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            student_id: insertedStudent.id,
            role_id: roleId,
            default_capacity: 20,
          }),
        });
        if (assignRes.ok) {
          const assignData = await assignRes.json();
          setAssignmentResult(assignData);
        }
      } catch (assignApiErr) {
        console.warn("FastAPI auto-assign endpoint unreachable:", assignApiErr);
      }
    }

    setSaving(false);
    submissionLock.current = false;

    if (insertError) {
      console.error("========== STUDENT INSERT ERROR ==========");
      console.error("Error Object:", insertError);
      console.error("Error Message:", insertError.message);
      console.error("Error Code:", insertError.code);
      console.error("Error Details:", insertError.details);
      console.error("Error Hint:", insertError.hint);
      console.error("==========================================");

      const errorParts = [
        insertError.message ? `Error: ${insertError.message}` : "Registration failed.",
        insertError.code ? `[Code: ${insertError.code}]` : null,
        insertError.details ? `Details: ${insertError.details}` : null,
        insertError.hint ? `Hint: ${insertError.hint}` : null,
      ].filter(Boolean);

      setErrorMessage(errorParts.join(" | "));
      return;
    }

    setName("");
    setRoleId("");
    setCustomValues({});
    setSubmitted(true);
  }

  if (loading) {
    return (
      <main className="student-registration-page">
        <div className="public-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Checking registration link…</span>
        </div>
      </main>
    );
  }

  if (!validLink) {
    return (
      <main className="student-registration-page">
        <section className="public-registration-card invalid-link-card">
          <div className="public-brand-mark" aria-hidden="true">
            <RegistrationMark />
          </div>
          <h1>Registration unavailable</h1>
          <p>Registration link is invalid or expired.</p>
        </section>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="student-registration-page">
        <section className="public-registration-card registration-success">
          <span className="success-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="m5 12 4 4L19 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <p className="eyebrow">STUDENT REGISTRATION</p>
          <h1>Registration Successful!</h1>
          <p>Your registration has been submitted successfully.</p>
          {assignmentResult?.batch_name ? (
            <div
              style={{
                marginTop: "1.25rem",
                padding: "1rem 1.25rem",
                borderRadius: "0.75rem",
                background: "rgba(34, 197, 94, 0.08)",
                border: "1px solid rgba(34, 197, 94, 0.25)",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#16a34a", fontWeight: 600 }}>
                Automatic Batch Assignment
              </span>
              <strong style={{ fontSize: "1.125rem", color: "#15803d" }}>
                {assignmentResult.batch_name}
              </strong>
              {assignmentResult.course && (
                <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                  Course: {assignmentResult.course}
                </span>
              )}
            </div>
          ) : assignmentResult?.assignment_status === "unassigned" ? (
            <div
              style={{
                marginTop: "1.25rem",
                padding: "1rem 1.25rem",
                borderRadius: "0.75rem",
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.25)",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#d97706", fontWeight: 600 }}>
                Batch Allocation Status
              </span>
              <strong style={{ fontSize: "1rem", color: "#b45309" }}>
                Awaiting Batch Allocation (Batches Full)
              </strong>
              <span style={{ fontSize: "0.875rem", color: "#64748b", textAlign: "center" }}>
                {assignmentResult.message || "All current batches for your course are at capacity. You are placed in the priority remaining queue."}
              </span>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="student-registration-page">
      <section className="public-registration-card">
        <div className="public-brand-mark" aria-hidden="true">
          <RegistrationMark />
        </div>
        <p className="eyebrow">STUDENT REGISTRATION</p>
        <h1>Student Registration</h1>
        <p className="public-registration-intro">
          Complete the form below to submit your registration.
        </p>

        <form className="public-registration-form" onSubmit={handleSubmit}>
          {formConfig.map((field) => {
            if (field.id === "name") {
              return (
                <div key={field.id} className="public-field-group">
                  <label htmlFor="student-name">
                    {field.name || "Name"} {field.required && <span aria-hidden="true">*</span>}
                  </label>
                  <input
                    autoComplete="name"
                    id="student-name"
                    maxLength={150}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Enter your name"
                    required={field.required}
                    value={name}
                  />
                </div>
              );
            }

            if (field.id === "role") {
              return (
                <div key={field.id} className="public-field-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label htmlFor="student-role" style={{ margin: 0 }}>
                      {field.name || "Course / Role"} {field.required && <span aria-hidden="true">*</span>}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCreateCourseInline(!showCreateCourseInline)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#2563eb",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {showCreateCourseInline ? "Close New Course" : "+ Create New Course"}
                    </button>
                  </div>

                  <select
                    id="student-role"
                    onChange={(event) => {
                      if (event.target.value === "__NEW_COURSE__") {
                        setShowCreateCourseInline(true);
                      } else {
                        setRoleId(event.target.value);
                      }
                    }}
                    required={field.required && !showCreateCourseInline}
                    value={roleId}
                  >
                    <option value="">Select Course / Role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {getRoleLabel(role)}
                      </option>
                    ))}
                    <option value="__NEW_COURSE__">➕ + Create New Course...</option>
                  </select>

                  {courseCreatedNotice && (
                    <p style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600, margin: "4px 0 0" }}>
                      {courseCreatedNotice}
                    </p>
                  )}

                  {showCreateCourseInline && (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "14px",
                        background: "#f8fafc",
                        borderRadius: "10px",
                        border: "1.5px dashed #93c5fd",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e3a8a" }}>
                          ✨ Add New Course & Enroll
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowCreateCourseInline(false)}
                          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "14px" }}
                        >
                          ✕
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Course Name *</label>
                          <input
                            type="text"
                            placeholder="e.g. Artificial Intelligence, Cloud Computing"
                            value={newCourseName}
                            onChange={(e) => setNewCourseName(e.target.value)}
                            style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", marginTop: "2px" }}
                          />
                        </div>

                        <div style={{ display: "flex", gap: "8px" }}>
                          <div style={{ width: "140px" }}>
                            <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Target Seats</label>
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              placeholder="e.g. 40"
                              value={newCourseCapacity}
                              onChange={(e) => setNewCourseCapacity(e.target.value)}
                              style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", marginTop: "2px" }}
                            />
                          </div>

                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569" }}>Details / Syllabus (optional)</label>
                            <input
                              type="text"
                              placeholder="Brief description or module outline"
                              value={newCourseDescription}
                              onChange={(e) => setNewCourseDescription(e.target.value)}
                              style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", marginTop: "2px" }}
                            />
                          </div>
                        </div>

                        {newCourseError && (
                          <span style={{ fontSize: "12px", color: "#ef4444" }}>{newCourseError}</span>
                        )}

                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" }}>
                          <button
                            type="button"
                            onClick={() => setShowCreateCourseInline(false)}
                            className="secondary-action-button"
                            style={{ padding: "6px 12px", fontSize: "12px" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleCreateCourseInline}
                            disabled={creatingCourse}
                            className="primary-action-button"
                            style={{ padding: "6px 14px", fontSize: "12px" }}
                          >
                            {creatingCourse ? "Saving…" : "Save Course & Continue"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {roles.length === 0 && !errorMessage && !showCreateCourseInline && (
                    <p className="public-form-hint">
                      No roles are currently configured. Click "+ Create New Course" above to create one now.
                    </p>
                  )}
                </div>
              );
            }

            const inputId = `custom-${field.id}`;
            const isTextarea = field.type === "textarea";
            const isDropdown = field.type === "dropdown";

            return (
              <div key={field.id} className="public-field-group">
                <label htmlFor={inputId}>
                  {field.name} {field.required && <span aria-hidden="true">*</span>}
                </label>
                {isTextarea ? (
                  <textarea
                    id={inputId}
                    placeholder={`Enter ${field.name.toLowerCase()}`}
                    required={field.required}
                    rows={3}
                    value={customValues[field.id] || ""}
                    onChange={(event) =>
                      handleCustomChange(field.id, event.target.value)
                    }
                  />
                ) : isDropdown ? (
                  <select
                    id={inputId}
                    required={field.required}
                    value={customValues[field.id] || ""}
                    onChange={(event) =>
                      handleCustomChange(field.id, event.target.value)
                    }
                  >
                    <option value="">Select {field.name}</option>
                    {(field.options || "")
                      .split(",")
                      .map((opt) => opt.trim())
                      .filter(Boolean)
                      .map((opt, optIdx) => (
                        <option key={optIdx} value={opt}>
                          {opt}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    id={inputId}
                    placeholder={`Enter ${field.name.toLowerCase()}`}
                    required={field.required}
                    type={field.type || "text"}
                    value={customValues[field.id] || ""}
                    onChange={(event) =>
                      handleCustomChange(field.id, event.target.value)
                    }
                  />
                )}
              </div>
            );
          })}

          {errorMessage && (
            <p className="login-error" role="alert">
              {errorMessage}
            </p>
          )}

          <button
            className="login-button public-submit-button"
            disabled={saving || roles.length === 0}
            type="submit"
          >
            {saving && <span className="button-spinner" aria-hidden="true" />}
            {saving ? "Submitting…" : "Submit Registration"}
          </button>
        </form>
        <p className="public-registration-footer">
          Student Registration &amp; Training Management System
        </p>
      </section>
    </main>
  );
}

function RegistrationMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="m3 9 9-5 9 5-9 5-9-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 11v4.5c3.4 2.8 7.6 2.8 11 0V11M21 9v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Register;
