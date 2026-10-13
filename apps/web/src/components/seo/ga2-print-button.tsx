"use client";

/**
 * Prints one list on its own page, without the article around it.
 *
 * A checklist somebody wants on paper (or saved as a PDF from the print
 * dialog) is the list and its title, not ten screens of guide. When a pop-up
 * blocker refuses the new window, the whole page prints instead of nothing.
 */

export function PrintListButton({
  title,
  items,
  footer,
  label = "Print or save as PDF",
}: {
  title: string;
  items: readonly string[];
  footer?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="btn secondary small"
      onClick={() => {
        const win = window.open("", "_blank", "width=720,height=900");
        if (!win) {
          window.print();
          return;
        }
        // Built with the DOM rather than a markup string, so nothing typed into
        // the list can become markup in the new window.
        const doc = win.document;
        doc.title = title;
        const style = doc.createElement("style");
        style.textContent =
          "body{font:16px/1.6 system-ui,sans-serif;margin:2.5rem;max-width:42rem}h1{font-size:1.4rem}" +
          "li{margin:0 0 .75rem;padding-left:.25rem}li::marker{font-weight:600}p{font-size:.85rem}";
        doc.head.appendChild(style);
        const heading = doc.createElement("h1");
        heading.textContent = title;
        const list = doc.createElement("ol");
        for (const item of items) {
          const li = doc.createElement("li");
          li.textContent = item;
          list.appendChild(li);
        }
        doc.body.append(heading, list);
        if (footer) {
          const note = doc.createElement("p");
          note.textContent = footer;
          doc.body.appendChild(note);
        }
        win.document.close();
        win.focus();
        win.print();
      }}
    >
      {label}
    </button>
  );
}
