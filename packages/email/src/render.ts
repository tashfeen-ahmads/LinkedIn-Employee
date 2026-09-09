import { escapeHtml } from "@le/shared";

export { escapeHtml };
/**
 * A deliberately small HTML layer. Every template renders a text part too,
 * because a plain-text alternative is what keeps a transactional email out of
 * the spam folder — and this product's whole premise is that its customers
 * cannot afford deliverability problems.
 */

export interface LayoutOptions {
  title: string;
  /** Blocks of already-escaped HTML. */
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}

export function layout(options: LayoutOptions): string {
  const cta = options.cta
    ? `<tr><td style="padding:8px 0 24px">
         <a href="${escapeHtml(options.cta.url)}"
            style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;
                   padding:11px 20px;border-radius:8px;font-weight:600;font-size:15px">
           ${escapeHtml(options.cta.label)}
         </a>
       </td></tr>`
    : "";

  const footer = options.footer
    ? `<tr><td style="padding-top:20px;border-top:1px solid #e3e6ea;color:#5b6472;font-size:13px;line-height:1.5">
         ${options.footer}
       </td></tr>`
    : "";

  // Table layout and inline styles: email clients are twenty years behind.
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f8fa">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border:1px solid #e3e6ea;border-radius:12px;padding:28px;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    color:#14181f;font-size:15px;line-height:1.55">
        <tr><td style="font-size:20px;font-weight:650;padding-bottom:12px">${escapeHtml(options.title)}</td></tr>
        <tr><td style="padding-bottom:16px">${options.body}</td></tr>
        ${cta}
        ${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;
}

export function list(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul style="margin:0 0 12px;padding-left:20px">${items
    .map((item) => `<li style="margin-bottom:6px">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}
