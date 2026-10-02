"use client";

import { useEffect } from "react";

/**
 * Keeps a long form's answers through a reload.
 *
 * The onboarding form asks for a company, a description, a bio, an address,
 * hours and settings. When its submit fails in the browser — most often because
 * a deploy landed while it was being filled in — the cure is a reload, and a
 * reload used to cost every answer. Stored in this tab's session only, never
 * sent anywhere, and never required: if storage is refused the form simply
 * starts empty, as it always did.
 */
export function FormKeeper({ formId, storageKey }: { formId: string; storageKey: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}") as Record<string, string | boolean>;
      for (const [name, value] of Object.entries(saved)) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = value === true;
        else if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        ) {
          field.value = String(value);
        }
      }
    } catch {
      // Nothing saved, or storage refused.
    }

    const save = () => {
      const values: Record<string, string | boolean> = {};
      for (const field of Array.from(form.elements)) {
        if (field instanceof HTMLInputElement && field.name && field.type !== "hidden") {
          values[field.name] = field.type === "checkbox" ? field.checked : field.value;
        } else if ((field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && field.name) {
          values[field.name] = field.value;
        }
      }
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(values));
      } catch {
        // Storage refused: the form still works, it just will not survive a reload.
      }
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [formId, storageKey]);

  return null;
}
