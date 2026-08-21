/**
 * JSON-Schema validation for the portable account configuration format.
 *
 * The schema is loaded from `schema/portable-account-config.schema.json` and
 * compiled with Ajv. In v1 we only accept exactly `format` and `version`
 * matching PORTABLE_FORMAT / PORTABLE_VERSION — future versions must be
 * routed to a migration function before validation.
 */

import {
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  type PortableAccountConfig,
} from "../model/portable.js";

/**
 * Runtime validator for the portable account configuration format.
 *
 * The full JSON-Schema (`schema/portable-account-config.schema.json`) is
 * authoritative and exercised by the Jest test suite via Ajv in Node. At
 * runtime inside Thunderbird we cannot pull in Ajv as a bare module
 * specifier ("ajv" would need a bundler), so this file performs a
 * hand-written structural check that covers the same surface as the
 * schema's `required` / top-level `type` rules — enough to reject junk,
 * wrong format strings and unknown versions before hitting the importer.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  message?: string;
}

function fail(message: string, errors: ValidationError[] = []): ValidationResult {
  return { ok: false, errors, message };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function validatePortable(input: unknown): ValidationResult {
  if (!isObject(input)) {
    return fail("schema_invalid", [{ path: "/", message: "not_an_object" }]);
  }
  const cfg = input as Partial<PortableAccountConfig> & Record<string, unknown>;

  if (typeof cfg.format !== "string") {
    return fail("schema_invalid", [{ path: "/format", message: "missing_or_not_string" }]);
  }
  if (cfg.format !== PORTABLE_FORMAT) {
    return fail("wrong_format");
  }
  if (typeof cfg.version !== "number") {
    return fail("schema_invalid", [{ path: "/version", message: "missing_or_not_number" }]);
  }
  if (cfg.version !== PORTABLE_VERSION) {
    return fail("unsupported_version");
  }
  if (typeof cfg.exportedAt !== "string") {
    return fail("schema_invalid", [{ path: "/exportedAt", message: "missing_or_not_string" }]);
  }
  if (!Array.isArray(cfg.accounts)) {
    return fail("schema_invalid", [{ path: "/accounts", message: "missing_or_not_array" }]);
  }
  if (!Array.isArray(cfg.smtpServers)) {
    return fail("schema_invalid", [{ path: "/smtpServers", message: "missing_or_not_array" }]);
  }

  for (let i = 0; i < cfg.accounts.length; i++) {
    const a = cfg.accounts[i];
    if (!isObject(a)) {
      return fail("schema_invalid", [{ path: `/accounts/${i}`, message: "not_an_object" }]);
    }
    if (typeof a.name !== "string" || typeof a.type !== "string") {
      return fail("schema_invalid", [{ path: `/accounts/${i}`, message: "missing_name_or_type" }]);
    }
    if (!isObject(a.incoming)) {
      return fail("schema_invalid", [{ path: `/accounts/${i}/incoming`, message: "missing" }]);
    }
    if (!Array.isArray(a.identities)) {
      return fail("schema_invalid", [{ path: `/accounts/${i}/identities`, message: "missing" }]);
    }
  }

  for (let i = 0; i < cfg.smtpServers.length; i++) {
    const s = cfg.smtpServers[i];
    if (!isObject(s) || typeof s.id !== "string") {
      return fail("schema_invalid", [{ path: `/smtpServers/${i}`, message: "missing_id" }]);
    }
  }

  return { ok: true, errors: [] };
}
