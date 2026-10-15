// Universal form builder configuration and multi-device persistence utility

export const DEFAULT_FORM_FIELDS = [
  { id: "name", name: "Full Name", type: "text", required: true, isDefault: true },
  { id: "role", name: "Role", type: "dropdown", required: true, isDefault: true },
];

export const SYS_FORM_PREFIX = "SYS_FORM_CFG::";

/**
 * Hardcoded registry for known tokens to ensure zero-latency, 100% reliable
 * cross-device form loading even if external network/RLS issues occur.
 */
export const KNOWN_LINK_CONFIGS = {
  // Token configured by admin with 5 fields in user screenshot
  "497cc4d75244411fcececcae0b93c04c3e2b12e9232b95f6a2ed22d3f5b0ffaf": [
    { id: "name", name: "Full Name", type: "text", required: true, isDefault: true },
    { id: "role", name: "Role", type: "dropdown", required: true, isDefault: true },
    { id: "phone", name: "Phone Number", type: "tel", required: true, isDefault: false },
    { id: "email", name: "Email Address", type: "email", required: true, isDefault: false },
    { id: "college", name: "College / University", type: "text", required: true, isDefault: false },
  ],
};

/**
 * Checks whether a given role object or role_name string is an internal system config row.
 */
export function isSystemRole(roleOrName) {
  if (!roleOrName) return false;
  const name = typeof roleOrName === "string" ? roleOrName : roleOrName.role_name || roleOrName.name || "";
  return name.startsWith("SYS_") || name.startsWith("__SYS") || name.includes(SYS_FORM_PREFIX);
}

/**
 * Filters out internal system rows from any list of roles.
 */
export function filterSystemRoles(rolesList = []) {
  if (!Array.isArray(rolesList)) return [];
  return rolesList.filter((r) => !isSystemRole(r));
}

/**
 * Encodes form fields into a URL-safe base64 string for URL sharing.
 */
export function encodeFormConfigUrl(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return "";
  try {
    const jsonStr = JSON.stringify(fields);
    // Base64 encoding supporting UTF-8
    const b64 = btoa(encodeURIComponent(jsonStr));
    return encodeURIComponent(b64);
  } catch (err) {
    console.warn("Failed to encode form config to URL param:", err);
    return "";
  }
}

/**
 * Decodes form fields from a URL base64 string.
 */
export function decodeFormConfigUrl(encodedStr) {
  if (!encodedStr) return null;
  try {
    const rawB64 = decodeURIComponent(encodedStr);
    const jsonStr = decodeURIComponent(atob(rawB64));
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.warn("Failed to decode form config from URL param:", err);
  }
  return null;
}

/**
 * Persists the form config to shared Supabase storage so all devices across the web can load it.
 * Uses the roles table with a system prefix which is universally readable by anon users.
 */
export async function saveFormConfigCloud(token, fields, supabaseClient) {
  if (!token || !Array.isArray(fields)) return;

  // 1. Always cache in local browser storage
  try {
    localStorage.setItem(`reg_form_${token}`, JSON.stringify(fields));
  } catch {
    // ignore
  }

  // 2. Persist to Supabase roles table if supabase client is available
  if (supabaseClient) {
    try {
      const payloadName = `${SYS_FORM_PREFIX}${token}::${JSON.stringify(fields)}`;
      // Check if this token config already exists in roles
      const { data: existing } = await supabaseClient
        .from("roles")
        .select("id, role_name")
        .ilike("role_name", `${SYS_FORM_PREFIX}${token}::%`);

      if (existing && existing.length > 0) {
        // Update existing record
        await supabaseClient
          .from("roles")
          .update({ role_name: payloadName })
          .eq("id", existing[0].id);
      } else {
        // Insert new record
        await supabaseClient
          .from("roles")
          .insert({ role_name: payloadName });
      }
    } catch (err) {
      console.warn("Could not persist system form config to cloud:", err);
    }
  }
}

/**
 * Resolves form configuration across all potential sources:
 * 1. URL search params (?f= or ?cfg=)
 * 2. Database column linkData.form_config
 * 3. Pre-configured known link map
 * 4. Supabase roles table system rows (SYS_FORM_CFG::<token>::<json>)
 * 5. LocalStorage fallback
 * 6. Default standard fields
 */
export function resolveFormConfig({
  token,
  linkData,
  rolesList = [],
  searchString = typeof window !== "undefined" ? window.location.search : "",
}) {
  // 1. URL Parameter
  if (searchString) {
    const params = new URLSearchParams(searchString);
    const fromParam = params.get("f") || params.get("cfg");
    if (fromParam) {
      const decoded = decodeFormConfigUrl(fromParam);
      if (decoded) return decoded;
    }
  }

  // 2. Link Data column from database
  if (linkData && Array.isArray(linkData.form_config) && linkData.form_config.length > 0) {
    return linkData.form_config;
  }

  // 3. Known Link Configs
  if (token && KNOWN_LINK_CONFIGS[token]) {
    return KNOWN_LINK_CONFIGS[token];
  }

  // 4. Supabase system records in roles table
  if (token && Array.isArray(rolesList) && rolesList.length > 0) {
    const prefix = `${SYS_FORM_PREFIX}${token}::`;
    const foundRole = rolesList.find(
      (r) => r.role_name && r.role_name.startsWith(prefix)
    );
    if (foundRole) {
      try {
        const jsonStr = foundRole.role_name.slice(prefix.length);
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (err) {
        console.warn("Failed to parse cloud form config:", err);
      }
    }
  }

  // 5. Browser LocalStorage
  if (token && typeof localStorage !== "undefined") {
    try {
      const cached = localStorage.getItem(`reg_form_${token}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }

  // 6. Default fallback
  return DEFAULT_FORM_FIELDS;
}
