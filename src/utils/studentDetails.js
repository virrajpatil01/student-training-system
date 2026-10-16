/**
 * Universal Student Details & Contact Information Extractor
 *
 * Reliably extracts and normalizes student data across all historical & modern storage mechanisms:
 * 1. Direct database columns (`student.email`, `student.phone`, etc.)
 * 2. Dynamic JSON `student.extra_fields` (handles preset keys, dynamic field_* UUIDs, and human-readable names)
 * 3. Composite name fallback strings: "Name (Phone Number: 123 | Email Address: a@b.com | College: ABC | Age: 22)"
 * 4. Resolves dynamic field IDs (field_...) using registration link form configurations and system roles
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,20}$/;

/**
 * Builds a lookup map from field ID -> { id, name, type, options }
 * using roles table (SYS_FORM_CFG::) and registration_links.form_config.
 */
export function buildGlobalFormConfigMap(roles = [], registrationLinks = []) {
  const map = new Map();

  // 1. Scan registration_links.form_config
  if (Array.isArray(registrationLinks)) {
    for (const link of registrationLinks) {
      if (link && Array.isArray(link.form_config)) {
        for (const f of link.form_config) {
          if (f && f.id) {
            map.set(String(f.id), {
              id: f.id,
              name: f.name || f.label || "Custom Field",
              type: f.type || "text",
              options: f.options || "",
            });
          }
        }
      }
    }
  }

  // 2. Scan roles with SYS_FORM_CFG prefix
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const roleName = r?.role_name || r?.name || "";
      if (typeof roleName === "string" && roleName.includes("SYS_FORM_CFG::")) {
        try {
          const jsonStart = roleName.indexOf("[");
          if (jsonStart !== -1) {
            const jsonStr = roleName.slice(jsonStart);
            const fields = JSON.parse(jsonStr);
            if (Array.isArray(fields)) {
              for (const f of fields) {
                if (f && f.id) {
                  map.set(String(f.id), {
                    id: f.id,
                    name: f.name || f.label || "Custom Field",
                    type: f.type || "text",
                    options: f.options || "",
                  });
                }
              }
            }
          }
        } catch {
          // ignore malformed system config
        }
      }
    }
  }

  return map;
}

/**
 * Parses composite name strings formatted as:
 * "Suraj Ghadage (Phone Number: 9456160255 | Email Address: suraj@gmail.com | College / University: Willengdon)"
 */
export function parseCompositeName(rawName) {
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { cleanName: "Unnamed Student", parsedPairs: {} };
  }

  const trimmed = rawName.trim();
  const match = trimmed.match(/^(.*?)\s*\((.*?)\)$/);
  if (!match) {
    return { cleanName: trimmed, parsedPairs: {} };
  }

  const cleanName = match[1].trim() || trimmed;
  const details = match[2];
  const parts = details.split("|").map((p) => p.trim()).filter(Boolean);
  const parsedPairs = {};

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx !== -1) {
      const key = part.slice(0, colonIdx).trim();
      const val = part.slice(colonIdx + 1).trim();
      if (key && val) {
        parsedPairs[key] = val;
      }
    } else {
      // Unlabeled value fallback
      parsedPairs[part] = part;
    }
  }

  return { cleanName, parsedPairs };
}

/**
 * Universal extractor for a student object.
 * Returns cleanName, email, phone, and all additional customDetails with human-readable labels.
 */
export function extractStudentDetails(student, formConfigMap = new Map()) {
  if (!student) {
    return {
      cleanName: "Unnamed Student",
      email: "—",
      phone: "—",
      customDetails: [],
      extraFields: {},
      raw: null,
    };
  }

  // 1. Parse name string
  const { cleanName, parsedPairs: namePairs } = parseCompositeName(student.name);

  // 2. Identify extra fields
  let extra = {};
  if (student.extra_fields && typeof student.extra_fields === "object") {
    extra = { ...student.extra_fields };
  }

  // Also merge any metadata label tags if present
  const embeddedLabels = extra._fieldLabels && typeof extra._fieldLabels === "object" ? extra._fieldLabels : {};

  // 3. Extract Email
  let email = student.email || "";

  // Check direct keys in extra
  if (!email) {
    const directEmailKeys = [
      "email",
      "Email",
      "email_address",
      "Email Address",
      "emailAddress",
      "e-mail",
      "E-mail",
    ];
    for (const k of directEmailKeys) {
      if (extra[k] && typeof extra[k] === "string" && extra[k].trim()) {
        email = extra[k].trim();
        break;
      }
    }
  }

  // Check dynamic keys via formConfigMap
  if (!email && formConfigMap.size > 0) {
    for (const [key, val] of Object.entries(extra)) {
      if (key === "_fieldLabels" || !val || typeof val !== "string") continue;
      const meta = formConfigMap.get(key);
      if (meta && (meta.type === "email" || meta.name?.toLowerCase().includes("email"))) {
        email = val.trim();
        break;
      }
    }
  }

  // Check any field whose value matches email regex
  if (!email) {
    for (const [key, val] of Object.entries(extra)) {
      if (key === "_fieldLabels" || !val || typeof val !== "string") continue;
      if (EMAIL_REGEX.test(val.trim())) {
        email = val.trim();
        break;
      }
    }
  }

  // Check parsed composite name pairs
  if (!email) {
    for (const [k, v] of Object.entries(namePairs)) {
      if (k.toLowerCase().includes("email") || EMAIL_REGEX.test(v)) {
        email = v;
        break;
      }
    }
  }

  // 4. Extract Phone
  let phone = student.phone || "";

  // Check direct keys in extra
  if (!phone) {
    const directPhoneKeys = [
      "phone",
      "Phone",
      "phone_number",
      "Phone Number",
      "phoneNumber",
      "contact",
      "Contact",
      "contact_number",
      "Contact Number",
      "mobile",
      "Mobile",
      "mobile_number",
      "Mobile Number",
      "tel",
      "Tel",
    ];
    for (const k of directPhoneKeys) {
      if (extra[k] && typeof extra[k] === "string" && extra[k].trim()) {
        phone = extra[k].trim();
        break;
      }
    }
  }

  // Check dynamic keys via formConfigMap
  if (!phone && formConfigMap.size > 0) {
    for (const [key, val] of Object.entries(extra)) {
      if (key === "_fieldLabels" || !val || typeof val !== "string") continue;
      const meta = formConfigMap.get(key);
      if (
        meta &&
        (meta.type === "tel" ||
          meta.name?.toLowerCase().includes("phone") ||
          meta.name?.toLowerCase().includes("mobile") ||
          meta.name?.toLowerCase().includes("contact"))
      ) {
        phone = val.trim();
        break;
      }
    }
  }

  // Check any field whose key indicates phone or value is a valid phone
  if (!phone) {
    for (const [key, val] of Object.entries(extra)) {
      if (key === "_fieldLabels" || !val || typeof val !== "string") continue;
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("phone") || lowerKey.includes("mobile") || lowerKey.includes("contact")) {
        phone = val.trim();
        break;
      }
    }
  }

  if (!phone) {
    for (const [key, val] of Object.entries(extra)) {
      if (key === "_fieldLabels" || !val || typeof val !== "string") continue;
      const cleanVal = val.trim();
      const lowerKey = key.toLowerCase();
      // Ignore keys that are obviously not phone (e.g. age, zip, date)
      if (
        !lowerKey.includes("age") &&
        !lowerKey.includes("year") &&
        !lowerKey.includes("pin") &&
        !lowerKey.includes("zip") &&
        PHONE_REGEX.test(cleanVal) &&
        !cleanVal.includes("@")
      ) {
        phone = cleanVal;
        break;
      }
    }
  }

  // Check parsed composite name pairs
  if (!phone) {
    for (const [k, v] of Object.entries(namePairs)) {
      const lowerK = k.toLowerCase();
      if (
        lowerK.includes("phone") ||
        lowerK.includes("mobile") ||
        lowerK.includes("contact") ||
        PHONE_REGEX.test(v)
      ) {
        phone = v;
        break;
      }
    }
  }

  // 5. Gather Additional / Custom Details
  // We want to list all details entered by the student, avoiding duplicating the primary email & phone
  const customDetails = [];
  const seenLabels = new Set();
  const seenValues = new Set();

  // Helper to add detail cleanly
  function addDetail(rawKey, label, value) {
    if (value === undefined || value === null) return;
    const strVal = String(value).trim();
    if (!strVal || strVal === "—") return;

    // Skip if this matches the primary email or phone exactly
    if (email && strVal.toLowerCase() === email.toLowerCase()) return;
    if (phone && strVal === phone) return;

    const normLabel = label.trim();
    const lowerLabel = normLabel.toLowerCase();

    // Skip email/phone labels that slipped through
    if (lowerLabel === "email" || lowerLabel === "email address" || lowerLabel === "phone" || lowerLabel === "phone number") {
      return;
    }

    if (seenLabels.has(lowerLabel)) return;
    seenLabels.add(lowerLabel);

    customDetails.push({
      id: rawKey,
      label: normLabel,
      value: strVal,
    });
  }

  // 5a. Process extra_fields
  for (const [key, val] of Object.entries(extra)) {
    if (key === "_fieldLabels" || !val) continue;

    // Resolve label
    let label = "";

    // 1. From formConfigMap
    if (formConfigMap.has(key)) {
      label = formConfigMap.get(key).name;
    }
    // 2. From embedded labels
    else if (embeddedLabels[key]) {
      label = embeddedLabels[key];
    }
    // 3. Known key mappings
    else {
      const lower = key.toLowerCase();
      if (lower === "college" || lower === "university" || lower === "college_university") {
        label = "College / University";
      } else if (lower === "qualification" || lower === "highest_qualification") {
        label = "Highest Qualification";
      } else if (lower === "village" || lower === "village_name") {
        label = "Village Name";
      } else if (lower === "dist" || lower === "district") {
        label = "District";
      } else if (lower === "tal" || lower === "taluka") {
        label = "Taluka";
      } else if (lower === "gender") {
        label = "Gender";
      } else if (lower === "age") {
        label = "Age";
      } else if (!key.startsWith("field_")) {
        // If it's a readable key like "College Name" or "Passing Year"
        label = key
          .replace(/_/g, " ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    if (label) {
      addDetail(key, label, val);
    }
  }

  // 5b. Process composite name pairs (for historical records where extra_fields was empty)
  for (const [k, v] of Object.entries(namePairs)) {
    let cleanLabel = k.trim();
    const lower = cleanLabel.toLowerCase();
    if (lower.includes("village") || lower.includes("city") || lower.includes("town")) {
      cleanLabel = "Village Name";
    } else if (lower.includes("college") || lower.includes("university") || lower.includes("institute") || lower.includes("school")) {
      cleanLabel = "College / University";
    } else if (lower.includes("qualification") || lower.includes("degree")) {
      cleanLabel = "Highest Qualification";
    } else if (lower.includes("gender") || lower.includes("sex")) {
      cleanLabel = "Gender";
    } else if (lower.includes("dist") || lower.includes("district")) {
      cleanLabel = "District";
    } else if (lower.includes("tal") || lower.includes("taluka")) {
      cleanLabel = "Taluka";
    } else if (/\bage\b/i.test(lower)) {
      cleanLabel = "Age";
    }
    addDetail(k, cleanLabel, v);
  }

  return {
    cleanName: cleanName || student.name || "Unnamed Student",
    email: email.trim() || "—",
    phone: phone.trim() || "—",
    customDetails,
    extraFields: extra,
    raw: student,
  };
}

/**
 * Contact extraction helper backwards-compatible with previous extractContact signatures.
 */
export function extractContact(student, formConfigMap = new Map()) {
  const details = extractStudentDetails(student, formConfigMap);
  return {
    email: details.email,
    phone: details.phone,
    cleanName: details.cleanName,
    customDetails: details.customDetails,
  };
}
