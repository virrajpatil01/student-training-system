// Universal dynamic form builder configuration and cloud persistence utility
// Zero hardcoding - all form configurations are dynamically resolved per registration link

export const DEFAULT_FORM_FIELDS = [
  { id: "name", name: "Full Name", type: "text", required: true, isDefault: true },
  { id: "role", name: "Role", type: "dropdown", required: true, isDefault: true },
];

export const SYS_FORM_PREFIX = "SYS_FORM_CFG::";

/**
 * Generates a clean, unique, URL-safe short token.
 */
export function createShortToken(length = 8) {
  const byteCount = Math.ceil(length / 2);
  const bytes = new Uint8Array(byteCount);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteCount; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/**
 * Extracts the short code for a registration link or token.
 * If the link has an existing 64-character token, uses its 8-character prefix.
 */
export function getShortCode(linkOrToken) {
  if (!linkOrToken) return "";
  const token = typeof linkOrToken === "string" ? linkOrToken : (linkOrToken?.token || "");
  if (!token) return "";
  return token.length > 8 ? token.slice(0, 8) : token;
}

/**
 * Builds the canonical short URL for a registration link.
 * Does NOT append large encoded form configuration (?f=).
 */
export function getShortUrl(linkOrToken) {
  const code = getShortCode(linkOrToken);
  if (!code) return "";
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return origin ? `${origin}/r/${code}` : `/r/${code}`;
}

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
 * Persists the form config to Supabase for the specified registration link.
 * Updates registration_links.form_config column and maintains resilient cloud fallback.
 */
export async function saveFormConfigCloud(token, fields, supabaseClient) {
  if (!token || !Array.isArray(fields)) return;

  // 1. Always cache in local browser storage
  try {
    localStorage.setItem(`reg_form_${token}`, JSON.stringify(fields));
  } catch {
    // ignore
  }

  // 2. Persist to Supabase if client is available
  if (supabaseClient) {
    // 2a. Update registration_links.form_config column
    try {
      const { error: linkUpdateErr } = await supabaseClient
        .from("registration_links")
        .update({ form_config: fields })
        .eq("token", token);

      if (linkUpdateErr) {
        console.warn("form_config column update on registration_links:", linkUpdateErr.message);
      }
    } catch (err) {
      console.warn("Could not update form_config on registration_links:", err);
    }

    // 2b. Cloud-shared fallback in roles table (readable universally by all public/anon users)
    try {
      const payloadName = `${SYS_FORM_PREFIX}${token}::${JSON.stringify(fields)}`;
      const { data: existing } = await supabaseClient
        .from("roles")
        .select("id, role_name")
        .ilike("role_name", `${SYS_FORM_PREFIX}${token}::%`);

      if (existing && existing.length > 0) {
        await supabaseClient
          .from("roles")
          .update({ role_name: payloadName })
          .eq("id", existing[0].id);
      } else {
        await supabaseClient
          .from("roles")
          .insert({ role_name: payloadName });
      }
    } catch (err) {
      console.warn("Could not persist cloud fallback form config:", err);
    }
  }
}

/**
 * Dynamically resolves form configuration for a given token across all real storage sources:
 * 1. Database column linkData.form_config
 * 2. Supabase roles table dynamic record (SYS_FORM_CFG::<token>::<json>)
 * 3. URL search params (?f= or ?cfg=)
 * 4. Local browser storage
 *
 * Returns null if no valid configuration is found so caller can handle errors gracefully.
 */
export function resolveFormConfig({
  token,
  linkData,
  rolesList = [],
  searchString = typeof window !== "undefined" ? window.location.search : "",
  allowDefaultFallback = true,
}) {
  // 1. Direct database column from registration_links
  if (linkData && Array.isArray(linkData.form_config) && linkData.form_config.length > 0) {
    return linkData.form_config;
  }

  // 2. Supabase dynamic cloud record in roles table for this token (or prefix)
  const fullToken = linkData?.token || token || "";
  const shortCode = fullToken.length > 8 ? fullToken.slice(0, 8) : fullToken;
  if (Array.isArray(rolesList) && rolesList.length > 0 && (fullToken || shortCode)) {
    const prefixes = [
      fullToken ? `${SYS_FORM_PREFIX}${fullToken}::` : null,
      shortCode ? `${SYS_FORM_PREFIX}${shortCode}::` : null,
    ].filter(Boolean);

    const foundRole = rolesList.find((r) =>
      r.role_name && prefixes.some((pfx) => r.role_name.startsWith(pfx))
    );

    if (foundRole) {
      try {
        const separatorIdx = foundRole.role_name.indexOf("::", SYS_FORM_PREFIX.length);
        if (separatorIdx !== -1) {
          const jsonStr = foundRole.role_name.slice(separatorIdx + 2);
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (err) {
        console.warn("Failed to parse cloud form config:", err);
      }
    }
  }

  // 3. Self-contained URL parameter (backward compatibility)
  if (searchString) {
    const params = new URLSearchParams(searchString);
    const fromParam = params.get("f") || params.get("cfg");
    if (fromParam) {
      const decoded = decodeFormConfigUrl(fromParam);
      if (decoded && Array.isArray(decoded) && decoded.length > 0) {
        return decoded;
      }
    }
  }

  // 4. Browser LocalStorage cache
  if (typeof localStorage !== "undefined") {
    try {
      const keysToTry = [
        fullToken ? `reg_form_${fullToken}` : null,
        shortCode ? `reg_form_${shortCode}` : null,
      ].filter(Boolean);

      for (const k of keysToTry) {
        const cached = localStorage.getItem(k);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Default fallback only if explicitly permitted (e.g., standard links)
  if (allowDefaultFallback) {
    return DEFAULT_FORM_FIELDS;
  }

  return null;
}
