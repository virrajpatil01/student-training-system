import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { getApiUrl } from "../config/api";
import {
  DEFAULT_FORM_FIELDS,
  filterSystemRoles,
  resolveFormConfig,
} from "../config/formConfig";

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

function Register() {
  const { token, shortCode } = useParams();
  const linkIdentifier = (shortCode || token || "").trim();
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
  const [linkErrorState, setLinkErrorState] = useState(null);
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
      if (!linkIdentifier) {
        setLinkErrorState({
          title: "Invalid Registration Link",
          message: "No registration token or short code was provided. Please check the URL.",
        });
        setValidLink(false);
        setLoading(false);
        return;
      }

      // Fetch registration link (try exact match first, then prefix match for short codes) and roles in parallel
      const [linkRes, rolesRes] = await Promise.all([
        supabase
          .from("registration_links")
          .select("*")
          .eq("token", linkIdentifier)
          .maybeSingle(),
        supabase.from("roles").select("*").limit(500),
      ]);

      if (!isMounted) return;

      let linkData = linkRes.data;
      let linkError = linkRes.error;

      // If exact match not found and identifier length >= 6, resolve via prefix match (e.g. short code for 64-char token)
      if (!linkData && !linkError && linkIdentifier.length >= 6) {
        const { data: prefixMatches, error: prefixErr } = await supabase
          .from("registration_links")
          .select("*")
          .ilike("token", `${linkIdentifier}%`)
          .limit(2);

        if (!prefixErr && prefixMatches && prefixMatches.length > 0) {
          linkData = prefixMatches[0];
        } else if (prefixErr) {
          linkError = prefixErr;
        }
      }

      const { data: roleData, error: roleError } = rolesRes;

      if (linkError || !linkData) {
        console.error("Unable to validate registration link:", linkError);
        setLinkErrorState({
          title: "Registration Link Not Found",
          message: "This registration link does not exist or has been removed. Please check the link or contact your coordinator.",
        });
        setValidLink(false);
        setLoading(false);
        return;
      }

      if (!linkData.is_active) {
        setLinkErrorState({
          title: "Registration Link Inactive",
          message: "This registration link has been deactivated by the administrator. Registrations are not currently being accepted.",
        });
        setValidLink(false);
        setLoading(false);
        return;
      }

      if (linkData.expires_at && new Date(linkData.expires_at).getTime() <= Date.now()) {
        const expFormatted = new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(linkData.expires_at));

        setLinkErrorState({
          title: "Registration Link Expired",
          message: `This registration link expired on ${expFormatted}. Intake for this session is now closed.`,
        });
        setValidLink(false);
        setLoading(false);
        return;
      }

      setLink(linkData);

      // Resolve dynamic form configuration across database and cloud storage
      const resolvedConfig = resolveFormConfig({
        token: linkData.token,
        linkData,
        rolesList: roleData || [],
        searchString: typeof window !== "undefined" ? window.location.search : "",
        allowDefaultFallback: true,
      });

      if (!resolvedConfig || !Array.isArray(resolvedConfig) || resolvedConfig.length === 0) {
        setLinkErrorState({
          title: "Form Configuration Unavailable",
          message: "The form configuration for this link could not be loaded. Please refresh the page.",
        });
        setValidLink(false);
        setLoading(false);
        return;
      }

      setFormConfig(resolvedConfig);

      if (roleError) {
        console.error("Unable to load registration roles:", roleError);
        setErrorMessage(
          "Roles could not be loaded. Please contact the administrator.",
        );
      } else {
        const cleanRoles = filterSystemRoles(roleData || []).filter(
          (role) => role.id != null && getRoleLabel(role),
        );
        setRoles(cleanRoles);
      }

      setValidLink(true);
      setLoading(false);
    }

    loadFormOptions().catch((error) => {
      console.error("Unable to load registration form:", error);
      if (isMounted) {
        setLinkErrorState({
          title: "Registration Error",
          message: "An unexpected error occurred while loading this registration link.",
        });
        setValidLink(false);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [token, shortCode]);

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
      if (field.type === "tel" && val) {
        if (!/^[+0-9\s\-()]{7,25}$/.test(val)) {
          setErrorMessage(`Enter a valid phone number for "${field.name}".`);
          return;
        }
      }
      if (field.type === "number" && val) {
        if (Number.isNaN(Number(val))) {
          setErrorMessage(`Enter a valid number for "${field.name}".`);
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
      .select("id, is_active, expires_at, token")
      .eq("id", link.id)
      .eq("token", link.token)
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

    // Build comprehensive, self-describing extra_fields preserving dynamic IDs, labels, and standard aliases
    const enrichedExtra = { ...customValues };
    const fieldLabelMap = {};

    for (const field of formConfig) {
      if (field.isDefault) continue;
      const rawVal = customValues[field.id];
      const val = typeof rawVal === "string" ? rawVal.trim() : rawVal;
      if (val !== undefined && val !== null && val !== "") {
        fieldLabelMap[field.id] = field.name;
        // Save under human-readable field label
        if (field.name) {
          enrichedExtra[field.name] = val;
        }
        // Save standard canonical aliases for maximum compatibility
        const lowerName = (field.name || "").toLowerCase();
        if (field.type === "email" || lowerName.includes("email")) {
          enrichedExtra.email = val;
          enrichedExtra.email_address = val;
        }
        if (field.type === "tel" || lowerName.includes("phone") || lowerName.includes("mobile") || lowerName.includes("contact")) {
          enrichedExtra.phone = val;
          enrichedExtra.phone_number = val;
        }
        if (lowerName.includes("college") || lowerName.includes("university")) {
          enrichedExtra.college = val;
          enrichedExtra["College / University"] = val;
        }
        if (lowerName.includes("age")) {
          enrichedExtra.age = val;
          enrichedExtra.Age = val;
        }
        if (lowerName.includes("gender")) {
          enrichedExtra.gender = val;
          enrichedExtra.Gender = val;
        }
        if (lowerName.includes("qualification")) {
          enrichedExtra.qualification = val;
          enrichedExtra["Highest Qualification"] = val;
        }
        if (lowerName.includes("village")) {
          enrichedExtra.village = val;
          enrichedExtra["Village Name"] = val;
        }
      }
    }
    enrichedExtra._fieldLabels = fieldLabelMap;

    const payloadWithExtra = {
      name: normalizedName,
      role_id: roleId,
      registration_link_id: link.id,
      extra_fields: enrichedExtra,
    };

    console.log("========== STUDENT REGISTRATION SUBMIT ==========");
    console.log("Submitting payload:", payloadWithExtra);
    console.log("Token:", link.token);
    console.log("Link ID:", link?.id);
    console.log("Role ID:", roleId);
    console.log("Custom Values:", customValues);
    console.log("Enriched Extra:", enrichedExtra);
    console.log("================================================");

    let insertedStudent = null;
    let insertError = null;

    // 1. Try secure PostgreSQL RPC function first (handles token validation, expiry, active check, duplicates, and avoids RETURNING RLS SELECT issue)
    const { data: rpcResult, error: rpcError } = await supabase.rpc("register_student", {
      p_token: link.token,
      p_name: normalizedName,
      p_role_id: roleId,
      p_extra_fields: enrichedExtra,
    });

    if (!rpcError && rpcResult) {
      if (rpcResult.success) {
        insertedStudent = { id: rpcResult.student_id, role_id: rpcResult.role_id };
      } else {
        insertError = {
          message: rpcResult.error || "Registration rejected.",
          code: rpcResult.code || "REGISTRATION_REJECTED",
        };
      }
    } else {
      // 2. Fallback to direct insert if RPC is not deployed yet or encountered an error
      // IMPORTANT: Do NOT chain .select() on public/anon insert to avoid Code 42501 (SELECT policy restricted to authenticated)
      console.warn("RPC register_student unavailable, attempting direct insert fallback:", rpcError?.message);

      let directRes = await supabase.from("students").insert(payloadWithExtra);

      if (directRes.error && isMissingColumnError(directRes.error)) {
        console.warn("extra_fields column not present in students table, submitting with formatted name fallback.");
        const extraEntries = Object.entries(customValues).filter(([_, v]) => v && String(v).trim());
        let compositeName = normalizedName;
        if (extraEntries.length > 0) {
          const fieldMap = new Map(formConfig.map((f) => [f.id, f.name]));
          const formattedDetails = extraEntries
            .map(([k, v]) => `${fieldMap.get(k) || k}: ${v.trim()}`)
            .join(" | ");
          compositeName = `${normalizedName} (${formattedDetails})`;
        }

        directRes = await supabase.from("students").insert({
          name: compositeName,
          role_id: roleId,
          registration_link_id: link.id,
        });
      }

      insertError = directRes.error;
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

  if (!validLink || linkErrorState) {
    return (
      <main className="student-registration-page">
        <section className="public-registration-card invalid-link-card">
          <div className="public-brand-mark" aria-hidden="true">
            <RegistrationMark />
          </div>
          <h1>{linkErrorState?.title || "Registration unavailable"}</h1>
          <p>{linkErrorState?.message || "Registration link is invalid or expired."}</p>
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
