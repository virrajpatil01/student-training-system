import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import { supabase } from "../supabase";
import { getApiUrl } from "../config/api";
import {
  DEFAULT_FORM_FIELDS,
  SYS_FORM_PREFIX,
  encodeFormConfigUrl,
  resolveFormConfig,
  saveFormConfigCloud,
} from "../config/formConfig";

function createSecureToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function formatDate(value, emptyLabel = "—") {
  if (!value) return emptyLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function getStatus(link) {
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    return "Expired";
  }
  return link.is_active ? "Active" : "Inactive";
}

const earliestExpiry = new Date(
  Date.now() - new Date().getTimezoneOffset() * 60000,
)
  .toISOString()
  .slice(0, 16);

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

function RegistrationLinks() {
  const { session } = useAuth();
  const [links, setLinks] = useState([]);
  const [expiryInput, setExpiryInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  // Search & Filter & View state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState("cards"); // 'cards' | 'table'
  const [copiedToken, setCopiedToken] = useState(null);

  // Form Builder state
  const [formFields, setFormFields] = useState(DEFAULT_FORM_FIELDS);
  const [showFormModal, setShowFormModal] = useState(false);
  const [builderFields, setBuilderFields] = useState(DEFAULT_FORM_FIELDS);
  const [builderError, setBuilderError] = useState("");
  const [editingLink, setEditingLink] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchLinks() {
      const [linksRes, rolesRes] = await Promise.all([
        supabase
          .from("registration_links")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("roles")
          .select("id, role_name")
          .ilike("role_name", `${SYS_FORM_PREFIX}%`),
      ]);

      if (!isMounted) return;
      if (linksRes.error) {
        console.error("Unable to load registration links:", linksRes.error);
        setErrorMessage(
          "Registration links could not be loaded. Check table access and Supabase policies.",
        );
      } else {
        const rolesList = rolesRes.data || [];
        const hydrated = (linksRes.data || []).map((lnk) => {
          lnk.form_config = resolveFormConfig({
            token: lnk.token,
            linkData: lnk,
            rolesList,
          });
          return lnk;
        });
        setLinks(hydrated);
      }
      setLoading(false);
    }

    fetchLinks().catch((error) => {
      console.error("Unable to load registration links:", error);
      if (isMounted) {
        setErrorMessage("Registration links could not be loaded.");
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function openFormBuilder(targetLink = null) {
    if (targetLink && targetLink.id) {
      setEditingLink(targetLink);
      const initialFields =
        Array.isArray(targetLink.form_config) && targetLink.form_config.length > 0
          ? targetLink.form_config
          : DEFAULT_FORM_FIELDS;
      setBuilderFields(JSON.parse(JSON.stringify(initialFields)));
    } else {
      setEditingLink(null);
      setBuilderFields(JSON.parse(JSON.stringify(formFields)));
    }
    setBuilderError("");
    setShowFormModal(true);
  }

  function addField(preset = null) {
    const newId = `field_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let newField = {
      id: newId,
      name: "Custom Field",
      type: "text",
      required: false,
      isDefault: false,
      options: "",
    };

    if (preset === "email") {
      newField = {
        id: newId,
        name: "Email Address",
        type: "email",
        required: true,
        isDefault: false,
        options: "",
      };
    } else if (preset === "phone") {
      newField = {
        id: newId,
        name: "Phone Number",
        type: "tel",
        required: true,
        isDefault: false,
        options: "",
      };
    } else if (preset === "college") {
      newField = {
        id: newId,
        name: "College / University",
        type: "text",
        required: false,
        isDefault: false,
        options: "",
      };
    } else if (preset === "qualification") {
      newField = {
        id: newId,
        name: "Highest Qualification",
        type: "dropdown",
        required: false,
        isDefault: false,
        options: "B.Tech, B.E., BCA, MCA, B.Sc, Diploma, Other",
      };
    } else if (preset === "gender") {
      newField = {
        id: newId,
        name: "Gender",
        type: "dropdown",
        required: false,
        isDefault: false,
        options: "Male, Female, Other, Prefer not to say",
      };
    }

    setBuilderFields((prev) => [...prev, newField]);
  }

  function updateField(id, key, value) {
    setBuilderFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, [key]: value } : field)),
    );
  }

  function removeField(id) {
    setBuilderFields((prev) => prev.filter((field) => field.id !== id));
  }

  async function saveFormBuilder() {
    for (const field of builderFields) {
      if (!field.name.trim()) {
        setBuilderError("All fields must have a valid label name.");
        return;
      }
      if (field.type === "dropdown" && !field.isDefault && !field.options?.trim()) {
        setBuilderError(
          `Please provide options for dropdown field "${field.name}" (comma-separated).`,
        );
        return;
      }
    }

    if (editingLink) {
      const targetToken = editingLink.token;
      try {
        await saveFormConfigCloud(targetToken, builderFields, supabase);
      } catch (err) {
        console.warn("Failed to persist updated form config to cloud:", err);
      }

      setLinks((prev) =>
        prev.map((lnk) =>
          lnk.id === editingLink.id
            ? { ...lnk, form_config: builderFields }
            : lnk,
        ),
      );

      setShowFormModal(false);
      setNotice(
        `✓ Updated form configuration (${builderFields.length} fields) for link ${targetToken.slice(0, 10)}…`,
      );
      setEditingLink(null);
    } else {
      setFormFields(builderFields);
      setShowFormModal(false);
      setNotice(
        `Registration form configured with ${builderFields.length} fields. The next link you generate will use this form!`,
      );
    }
  }

  function resetToDefaultForm() {
    setBuilderFields(JSON.parse(JSON.stringify(DEFAULT_FORM_FIELDS)));
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setNotice("");
    setErrorMessage("");

    if (!session?.user?.id) {
      setErrorMessage("Your admin session is unavailable. Sign in again.");
      return;
    }

    let expiresAt = null;
    if (expiryInput) {
      const parsedExpiry = new Date(expiryInput);
      if (Number.isNaN(parsedExpiry.getTime()) || parsedExpiry <= new Date()) {
        setErrorMessage("Choose an expiry date and time in the future.");
        return;
      }
      expiresAt = parsedExpiry.toISOString();
    }

    setCreating(true);
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = createSecureToken();
      const payloadWithConfig = {
        token,
        created_by: session.user.id,
        is_active: true,
        expires_at: expiresAt,
        form_config: formFields,
      };

      result = await supabase
        .from("registration_links")
        .insert(payloadWithConfig)
        .select("*")
        .single();

      if (result.error && isMissingColumnError(result.error)) {
        console.warn(
          "form_config column not found in database, saving standard link with local storage fallback:",
          result.error.message,
        );
        const fallbackPayload = {
          token,
          created_by: session.user.id,
          is_active: true,
          expires_at: expiresAt,
        };
        result = await supabase
          .from("registration_links")
          .insert(fallbackPayload)
          .select("*")
          .single();

        if (!result.error && result.data) {
          result.data.form_config = formFields;
        }
      }

      if (!result.error || result.error.code !== "23505") break;
    }
    setCreating(false);

    if (result.error) {
      console.error("Unable to create registration link:", result.error);
      const msg = result.error.message || result.error.details || "Could not create the registration link.";
      setErrorMessage(`Could not create link: ${msg}`);
      return;
    }

    try {
      await saveFormConfigCloud(result.data.token, formFields, supabase);
    } catch {
      // ignore
    }

    const createdRecord = { ...result.data, form_config: formFields };
    setLinks((currentLinks) => [createdRecord, ...currentLinks]);
    setExpiryInput("");
    const newUrl = getPublicUrl(createdRecord);
    setNotice(
      `Registration link generated with ${formFields.length} form fields: ${newUrl}`,
    );
  }

  function getPublicUrl(linkOrToken, customFields) {
    const token = typeof linkOrToken === "string" ? linkOrToken : linkOrToken?.token;
    const fields =
      customFields ||
      (typeof linkOrToken === "object" ? linkOrToken?.form_config : null) ||
      formFields;
    let url = `${window.location.origin}/register/${token}`;
    if (Array.isArray(fields) && fields.length > 2) {
      const encoded = encodeFormConfigUrl(fields);
      if (encoded) url += `?f=${encoded}`;
    }
    return url;
  }

  async function handleCopy(linkOrToken, customFields) {
    setErrorMessage("");
    setNotice("");
    const token = typeof linkOrToken === "string" ? linkOrToken : linkOrToken?.token;
    const url = getPublicUrl(linkOrToken, customFields);

    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
      setNotice("Registration link copied to clipboard!");
    } catch (error) {
      console.error("Unable to copy registration link:", error);
      setErrorMessage(
        "Could not copy the link. Clipboard access requires a secure browser context.",
      );
    }
  }

  function handleWhatsAppShare(linkOrToken, customFields) {
    const url = getPublicUrl(linkOrToken, customFields);
    const message = `Student Registration Form\n${url}`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  async function handleToggle(link) {
    setBusyId(link.id);
    setErrorMessage("");
    setNotice("");

    const { data, error } = await supabase
      .from("registration_links")
      .update({ is_active: !link.is_active })
      .eq("id", link.id)
      .select("*")
      .single();

    setBusyId(null);
    if (error) {
      console.error("Unable to update registration link:", error);
      setErrorMessage("Could not update the link status. Please try again.");
      return;
    }

    setLinks((currentLinks) =>
      currentLinks.map((currentLink) =>
        currentLink.id === data.id ? { ...currentLink, is_active: data.is_active } : currentLink,
      ),
    );
  }

  async function handleDelete(link) {
    if (!window.confirm("Delete this registration link permanently?")) return;

    setBusyId(link.id);
    setErrorMessage("");
    setNotice("");

    try {
      // 1. Try backend endpoint first
      let backendSucceeded = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(getApiUrl(`/registration-links/${link.id}`), {
          method: "DELETE",
          headers,
        });

        if (res.ok) {
          backendSucceeded = true;
        } else {
          const errData = await res.json().catch(() => ({}));
          if (errData.detail && errData.detail.includes("foreign key")) {
            throw new Error(errData.detail);
          }
        }
      } catch (backendErr) {
        if (backendErr.message?.includes("foreign key") || backendErr.message?.includes("Cannot delete link")) {
          throw backendErr;
        }
      }

      // 2. Direct Supabase Client fallback
      if (!backendSucceeded) {
        // Disassociate any students registered through this link
        try {
          await supabase
            .from("students")
            .update({ registration_link_id: null })
            .eq("registration_link_id", link.id);
        } catch (e) {
          console.warn("Could not nullify registration_link_id on students:", e);
        }

        const { error } = await supabase
          .from("registration_links")
          .delete()
          .eq("id", link.id);

        if (error) {
          console.error("Unable to delete registration link:", error);
          if (error.code === "23503" || error.message?.includes("foreign key")) {
            throw new Error(
              "Cannot delete link because registered students reference it. Run the SQL fix in Supabase SQL Editor (supabase/fix_registration_links_delete.sql) or click 'Deactivate' instead."
            );
          } else {
            throw new Error(error.message || "Could not delete the link. Please try again.");
          }
        }
      }

      setLinks((currentLinks) =>
        currentLinks.filter((currentLink) => currentLink.id !== link.id),
      );
      setNotice("Registration link deleted successfully.");
    } catch (err) {
      console.error("Delete registration link error:", err);
      setErrorMessage(err.message || "Could not delete the link. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  // KPIs
  const stats = useMemo(() => {
    let active = 0;
    let expired = 0;
    let customCount = 0;

    links.forEach((link) => {
      const st = getStatus(link);
      if (st === "Active") active++;
      else if (st === "Expired") expired++;

      if (Array.isArray(link.form_config) && link.form_config.length > 2) {
        customCount++;
      }
    });

    return {
      total: links.length,
      active,
      expired,
      customForms: customCount,
    };
  }, [links]);

  // Filtered & Sorted
  const filteredLinks = useMemo(() => {
    let list = [...links];

    // Status filter
    if (statusFilter !== "ALL") {
      list = list.filter((l) => getStatus(l).toLowerCase() === statusFilter.toLowerCase());
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((l) => {
        const publicUrl = `${window.location.origin}/register/${l.token}`.toLowerCase();
        const created = formatDate(l.created_at).toLowerCase();
        const fieldNames = Array.isArray(l.form_config)
          ? l.form_config.map((f) => f.name.toLowerCase()).join(" ")
          : "";
        return publicUrl.includes(q) || created.includes(q) || fieldNames.includes(q);
      });
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === "oldest") {
        return (a.created_at || "").localeCompare(b.created_at || "");
      }
      if (sortBy === "expiry") {
        return (a.expires_at || "9999").localeCompare(b.expires_at || "9999");
      }
      return (b.created_at || "").localeCompare(a.created_at || "");
    });

    return list;
  }, [links, statusFilter, search, sortBy]);

  return (
    <section className="dashboard-content registration-links-page">
      {/* Page Heading Row */}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">STUDENT INTAKE</p>
          <h1>Registration Links</h1>
          <p className="dashboard-welcome">
            Generate, customize, and distribute shareable links for student intake and self-registration.
          </p>
        </div>
      </div>

      {/* Top Metric Summary Cards */}
      <div className="batches-kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Total Links</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.total}</p>
            <span className="kpi-detail">Generated</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Active Links</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.active}</p>
            <span className="kpi-detail">Open Intake</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-amber" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Expired Links</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.expired}</p>
            <span className="kpi-detail">Closed</span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon kpi-icon-blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="kpi-label">Custom Forms</p>
          <div className="kpi-value-row">
            <p className="kpi-value">{loading ? "…" : stats.customForms}</p>
            <span className="kpi-detail">Tailored fields</span>
          </div>
        </article>
      </div>

      {/* Generator Card */}
      <section className="link-generator-card" aria-labelledby="generate-title">
        <div className="link-generator-copy">
          <span className="link-generator-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.72-1.72"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h2 id="generate-title">Generate a New Registration Link</h2>
            <p>Publish an intake portal with optional custom input fields and expiration.</p>
          </div>
        </div>

        <form className="link-generator-form" onSubmit={handleGenerate}>
          <label htmlFor="link-expiry">Expiry date and time (optional)</label>
          <div className="link-generator-controls">
            <input
              id="link-expiry"
              min={earliestExpiry}
              onChange={(event) => setExpiryInput(event.target.value)}
              type="datetime-local"
              value={expiryInput}
            />
            <button
              className="edit-form-trigger-btn"
              onClick={openFormBuilder}
              type="button"
              title="Customize registration form fields for this link"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Customize Form ({formFields.length} fields)
            </button>
            <button className="generate-link-button" disabled={creating} type="submit">
              {creating ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  Generating…
                </>
              ) : (
                <>
                  <span aria-hidden="true">+</span>
                  Generate Registration Link
                </>
              )}
            </button>
          </div>
          <p className="field-hint">
            Leave expiry empty for indefinite intake until manually deactivated.
          </p>

          <div className="form-fields-summary">
            <strong>Active Form Fields:</strong>
            {formFields.map((field) => (
              <span
                key={field.id}
                className={`field-tag ${field.isDefault ? "" : "is-custom"}`}
              >
                {field.name} {field.required ? "*" : "(opt)"}
              </span>
            ))}
            <button
              className="edit-form-link-btn"
              onClick={openFormBuilder}
              type="button"
            >
              ✏️ Edit Fields
            </button>
          </div>
        </form>
      </section>

      {errorMessage && (
        <p className="admin-alert registration-alert" role="alert">
          {errorMessage}
        </p>
      )}
      {notice && (
        <p className="registration-notice" role="status">
          {notice}
        </p>
      )}

      {/* Interactive Controls Toolbar */}
      <section className="batches-controls-card">
        <div className="batches-controls-row">
          {/* Search Box */}
          <div className="batches-search-box">
            <svg
              className="batches-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by link token, fields, or date…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="batches-search-clear"
                onClick={() => setSearch("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="batches-filter-group">
            <label htmlFor="link-status-filter">Status:</label>
            <select
              id="link-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Expired">Expired</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          {/* Sort Filter */}
          <div className="batches-filter-group">
            <label htmlFor="link-sort">Sort:</label>
            <select
              id="link-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="newest">Created (Newest first)</option>
              <option value="oldest">Created (Oldest first)</option>
              <option value="expiry">Expiry Date</option>
            </select>
          </div>

          {/* View Mode Switcher */}
          <div className="batches-filter-group" style={{ marginLeft: "auto" }}>
            <div className="view-mode-toggle" style={{ display: "inline-flex", gap: "4px", background: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: viewMode === "cards" ? "#ffffff" : "transparent",
                  color: viewMode === "cards" ? "#0f172a" : "#64748b",
                  boxShadow: viewMode === "cards" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: viewMode === "table" ? "#ffffff" : "transparent",
                  color: viewMode === "table" ? "#0f172a" : "#64748b",
                  boxShadow: viewMode === "table" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                Table
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      {viewMode === "cards" ? (
        <>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
              Loading registration links…
            </div>
          ) : filteredLinks.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "48px 24px",
                background: "#ffffff",
                borderRadius: "12px",
                border: "1px dashed #cbd5e1",
                color: "#64748b",
                marginBottom: "28px",
              }}
            >
              <p style={{ fontSize: "16px", fontWeight: "600", color: "#334155", margin: "0 0 8px 0" }}>
                No registration links found
              </p>
              <p style={{ margin: "0", fontSize: "14px" }}>
                {search || statusFilter !== "ALL"
                  ? "Try resetting your search or status filter."
                  : "Generate your first link above to share with students."}
              </p>
            </div>
          ) : (
            <div className="registration-links-grid">
              {filteredLinks.map((link) => {
                const status = getStatus(link);
                const publicUrl = getPublicUrl(link);
                const rowBusy = busyId === link.id;
                const isCopied = copiedToken === link.token;
                const fieldList = Array.isArray(link.form_config) ? link.form_config : DEFAULT_FORM_FIELDS;

                return (
                  <article key={link.id} className="reg-link-card">
                    <div>
                      {/* Card Header */}
                      <div className="reg-link-card-header">
                        <span className={`link-status status-${status.toLowerCase()}`}>
                          <span aria-hidden="true" />
                          {status}
                        </span>

                        <span className="field-tag" style={{ fontSize: "12px" }}>
                          {fieldList.length} fields configured
                        </span>
                      </div>

                      {/* URL Box */}
                      <div className="reg-link-url-box">
                        <span className="reg-link-url-text" title={publicUrl}>
                          {publicUrl}
                        </span>
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                          <button
                            type="button"
                            className="primary-action-button"
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              borderRadius: "6px",
                              background: isCopied ? "#16a34a" : undefined,
                            }}
                            onClick={() => handleCopy(link)}
                          >
                            {isCopied ? "✓ Copied!" : "Copy"}
                          </button>
                          <button
                            type="button"
                            className="secondary-action-button"
                            style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "6px" }}
                            onClick={() => window.open(publicUrl, "_blank")}
                            title="Preview student registration form"
                          >
                            Open
                          </button>
                        </div>
                      </div>

                      {/* Fields Preview */}
                      <div className="reg-link-fields-preview">
                        {fieldList.map((f) => (
                          <span
                            key={f.id}
                            className={`field-tag ${f.isDefault ? "" : "is-custom"}`}
                            style={{ fontSize: "11px" }}
                          >
                            {f.name} {f.required ? "*" : ""}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Meta & Actions */}
                    <div>
                      <div className="reg-link-meta-footer">
                        <div>
                          <span>Created: {formatDate(link.created_at)}</span>
                        </div>
                        <div>
                          <span>Expiry: {formatDate(link.expires_at, "No expiry")}</span>
                        </div>
                      </div>

                      <div className="reg-link-actions-row" style={{ marginTop: "12px" }}>
                        <button
                          className="table-action"
                          onClick={() => handleWhatsAppShare(link)}
                          type="button"
                        >
                          📱 WhatsApp
                        </button>
                        <button
                          className="table-action"
                          onClick={() => openFormBuilder(link)}
                          type="button"
                          title="Customize form fields for this link"
                        >
                          ✏️ Edit Form
                        </button>
                        <button
                          className="table-action"
                          disabled={rowBusy || status === "Expired"}
                          onClick={() => handleToggle(link)}
                          type="button"
                        >
                          {link.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          className="table-action table-action-danger"
                          disabled={rowBusy}
                          onClick={() => handleDelete(link)}
                          type="button"
                          style={{ marginLeft: "auto" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Table View */
        <section className="recent-students-card links-table-card">
          <div className="section-heading">
            <div>
              <h2>Generated Links</h2>
              <p>Tabular overview of active and historical student intake links</p>
            </div>
            <span className="section-count">
              {filteredLinks.length} of {links.length} {links.length === 1 ? "link" : "links"}
            </span>
          </div>
          <div className="students-table-wrap">
            <table className="students-table links-table">
              <thead>
                <tr>
                  <th scope="col">Registration Link</th>
                  <th scope="col">Form Fields</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created Date</th>
                  <th scope="col">Expiry Date</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="table-empty" colSpan="6">
                      Loading registration links…
                    </td>
                  </tr>
                ) : filteredLinks.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan="6">
                      No matching registration links found.
                    </td>
                  </tr>
                ) : (
                  filteredLinks.map((link) => {
                    const status = getStatus(link);
                    const publicUrl = getPublicUrl(link);
                    const rowBusy = busyId === link.id;
                    const isCopied = copiedToken === link.token;
                    const fieldCount = Array.isArray(link.form_config)
                      ? link.form_config.length
                      : 2;

                    return (
                      <tr key={link.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", maxWidth: "260px" }}>
                            <a
                              className="registration-link-url"
                              href={publicUrl}
                              rel="noreferrer"
                              target="_blank"
                              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              {publicUrl}
                            </a>
                            <button
                              type="button"
                              className="schedule-copy-btn"
                              onClick={() => handleCopy(link)}
                              title={isCopied ? "Copied!" : "Copy URL"}
                            >
                              {isCopied ? "✓" : "📋"}
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className="field-tag" style={{ fontSize: "11px" }}>
                            {fieldCount} fields
                          </span>
                        </td>
                        <td>
                          <span className={`link-status status-${status.toLowerCase()}`}>
                            <span aria-hidden="true" />
                            {status}
                          </span>
                        </td>
                        <td>{formatDate(link.created_at)}</td>
                        <td>{formatDate(link.expires_at, "No expiry")}</td>
                        <td>
                          <div className="link-actions">
                            <button
                              className="table-action"
                              onClick={() => window.open(publicUrl, "_blank")}
                              type="button"
                              title="Preview registration form"
                            >
                              Open Form
                            </button>
                            <button
                              className="table-action"
                              onClick={() => handleCopy(link)}
                              type="button"
                            >
                              {isCopied ? "Copied!" : "Copy"}
                            </button>
                            <button
                              className="table-action"
                              onClick={() => handleWhatsAppShare(link)}
                              type="button"
                            >
                              WhatsApp
                            </button>
                            <button
                              className="table-action"
                              onClick={() => openFormBuilder(link)}
                              type="button"
                              title="Customize form fields for this link"
                            >
                              Edit Form
                            </button>
                            <button
                              className="table-action"
                              disabled={rowBusy || status === "Expired"}
                              onClick={() => handleToggle(link)}
                              type="button"
                            >
                              {link.is_active ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              className="table-action table-action-danger"
                              disabled={rowBusy}
                              onClick={() => handleDelete(link)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Form Builder Modal */}
      {showFormModal && (
        <div
          className="management-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowFormModal(false);
          }}
        >
          <section
            aria-labelledby="form-builder-title"
            aria-modal="true"
            className="management-modal form-builder-modal"
            role="dialog"
          >
            <div className="management-modal-heading">
              <div>
                <p className="eyebrow">FORM CUSTOMIZATION</p>
                <h2 id="form-builder-title">
                  {editingLink
                    ? `Customize Form for Link (${editingLink.token.slice(0, 10)}…)`
                    : "Customize Registration Form"}
                </h2>
              </div>
              <button
                aria-label="Close dialog"
                className="modal-close-button"
                onClick={() => setShowFormModal(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <p style={{ margin: "4px 0 14px", color: "#64748b", fontSize: "13px" }}>
              Configure the input fields students will see when registering. Standard fields (Name, Role) are mandatory.
            </p>

            <div className="form-builder-presets">
              <span className="form-builder-presets-label">Quick Add Fields:</span>
              <button
                type="button"
                className="form-builder-preset-btn"
                onClick={() => addField("email")}
              >
                + Email Address
              </button>
              <button
                type="button"
                className="form-builder-preset-btn"
                onClick={() => addField("phone")}
              >
                + Phone Number
              </button>
              <button
                type="button"
                className="form-builder-preset-btn"
                onClick={() => addField("college")}
              >
                + College / Univ
              </button>
              <button
                type="button"
                className="form-builder-preset-btn"
                onClick={() => addField("qualification")}
              >
                + Qualification
              </button>
              <button
                type="button"
                className="form-builder-preset-btn"
                onClick={() => addField("gender")}
              >
                + Gender
              </button>
              <button
                type="button"
                className="form-builder-preset-btn"
                onClick={() => addField(null)}
              >
                + Custom Field
              </button>
            </div>

            <div className="form-builder-fields-list">
              {builderFields.map((field, index) => {
                const isDefault = field.isDefault;

                return (
                  <div
                    key={field.id}
                    className={`form-builder-field-item ${isDefault ? "is-default" : ""}`}
                  >
                    <div className="form-builder-field-header">
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                        Field #{index + 1}: {field.name}
                      </span>
                      <span className="form-builder-field-badge">
                        {isDefault ? "System Default" : "Custom Field"}
                      </span>
                    </div>

                    <div className="form-builder-field-inputs">
                      <div>
                        <input
                          disabled={isDefault}
                          placeholder="Field Label (e.g. Email, Mobile)"
                          value={field.name}
                          onChange={(e) => updateField(field.id, "name", e.target.value)}
                        />
                      </div>
                      <div>
                        <select
                          disabled={isDefault}
                          value={field.type}
                          onChange={(e) => updateField(field.id, "type", e.target.value)}
                        >
                          <option value="text">Single-line Text</option>
                          <option value="email">Email</option>
                          <option value="tel">Phone / Tel</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                          <option value="dropdown">Dropdown Select</option>
                          <option value="textarea">Multi-line Text</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-builder-checkbox-label">
                          <input
                            type="checkbox"
                            disabled={isDefault}
                            checked={field.required}
                            onChange={(e) =>
                              updateField(field.id, "required", e.target.checked)
                            }
                          />
                          Required
                        </label>
                      </div>
                      {!isDefault && (
                        <div>
                          <button
                            type="button"
                            className="form-field-remove-btn"
                            onClick={() => removeField(field.id)}
                            title="Remove field"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>

                    {field.type === "dropdown" && !isDefault && (
                      <div className="form-builder-options-input">
                        <input
                          placeholder="Options separated by comma (e.g. Option 1, Option 2, Option 3)"
                          value={field.options || ""}
                          onChange={(e) =>
                            updateField(field.id, "options", e.target.value)
                          }
                        />
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          Separate options with commas.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {builderError && (
              <p className="management-form-error" role="alert" style={{ margin: "10px 0" }}>
                {builderError}
              </p>
            )}

            <div className="management-modal-actions" style={{ marginTop: "20px" }}>
              <button
                type="button"
                className="secondary-action-button"
                onClick={resetToDefaultForm}
              >
                Reset to Default
              </button>
              <button
                type="button"
                className="secondary-action-button"
                onClick={() => setShowFormModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action-button"
                onClick={saveFormBuilder}
              >
                Save &amp; Apply Form
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default RegistrationLinks;
