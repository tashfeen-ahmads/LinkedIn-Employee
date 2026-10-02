"use client";

import { useEffect } from "react";

/**
 * Keeps a long form's answers through a reload.
 *
 * The onboarding form asks for a company, a description, a bio, an address,
 * hours and settings. When its submit fails in the browser — most often because
 * a deploy landed while it was being filled in — the cure is a reload, and a
 * reload used to cost every answer — and a customer lost a full form twice in
 * one evening. Kept in this browser until the workspace exists (`clearKept`
 * runs on the dashboard), never sent anywhere, and never required: if storage
 * is refused the form simply starts empty, as it always did.
 */
export function FormKeeper({ formId, storageKey }: { formId: string; storageKey: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, string | boolean>;
      for (const [name, value] of Object.entries(saved)) {
        const field = form.elements.namedItem(name);
        if (field instanceof RadioNodeList) {
          for (const radio of Array.from(field)) {
            if (radio instanceof HTMLInputElement) radio.checked = radio.value === value;
          }
        } else if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = value === true;
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
        if (field instanceof HTMLInputElement && field.type === "radio") {
          if (field.checked) values[field.name] = field.value;
        } else if (field instanceof HTMLInputElement && field.name && field.type !== "hidden") {
          values[field.name] = field.type === "checkbox" ? field.checked : field.value;
        } else if ((field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && field.name) {
          values[field.name] = field.value;
        }
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(values));
      } catch {
        // Storage refused: the form still works, it just will not survive a reload.
      }
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    // Autofill does not always fire input events; leaving the page, or
    // submitting, saves whatever is in the fields at that moment.
    form.addEventListener("submit", save);
    window.addEventListener("pagehide", save);
    return () => {
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
      form.removeEventListener("submit", save);
      window.removeEventListener("pagehide", save);
    };
  }, [formId, storageKey]);

  return null;
}

/** Forgets a kept form once it has done its job. */
export function ClearKept({ storageKey }: { storageKey: string }) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to clear, or storage refused.
    }
  }, [storageKey]);
  return null;
}
