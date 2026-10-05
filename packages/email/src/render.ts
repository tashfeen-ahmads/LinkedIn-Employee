import { BRAND, escapeHtml } from "@le/shared";

export { escapeHtml };
/**
 * The HTML every email this product sends is built in.
 *
 * Every template renders a text part too, because a plain-text alternative is
 * what keeps a transactional email out of the spam folder — and this product's
 * whole premise is that its customers cannot afford deliverability problems.
 *
 * Built the way email has to be built, which is not the way a page is:
 *
 * - **Tables and inline styles.** Outlook on Windows renders with Word's
 *   engine, Gmail strips anything it does not recognise, and the only layout
 *   every client agrees on is a table with its styles on the element.
 * - **Fluid to 600px**, with a ghost table for Outlook (which ignores
 *   `max-width`) and a `<style>` media query that tightens the padding at
 *   phone width. Clients that drop the `<style>` block still get a single
 *   column that fits, because nothing here has a fixed width but the shell.
 * - **Dark mode on purpose.** `color-scheme` tells Apple Mail and Outlook the
 *   email has a dark rendering, the media query supplies it, and the colours
 *   that remain for Gmail's forced inversion are ones it inverts cleanly. The
 *   logo is a PNG — every client blocks SVG — with a light-text twin swapped in
 *   wherever the media query runs.
 * - **A bulletproof button.** A VML roundrect for Outlook, a padded anchor for
 *   everyone else, so the call to action is a button even with images off.
 *
 * Colours are the product's own tokens (`--accent`, `--text`, `--bg` in the
 * stylesheet, `BRAND.color` in shared) written as literals, because no email
 * client has heard of a custom property.
 */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Light palette. Matches the app's tokens so an email reads as the product. */
const C = {
  page: "#F4F5F9",
  card: "#FFFFFF",
  border: "#E1E4EC",
  text: "#0F1117",
  muted: "#454D5E",
  subtle: "#61697A",
  accent: BRAND.color.accent,
  limit: BRAND.color.limit,
  tint: "#F0F0FE",
} as const;

export interface LayoutOptions {
  /** The heading inside the card. Also the document title. */
  title: string;
  /** Blocks of already-escaped HTML, built with the helpers below. */
  body: string;
  /**
   * The line an inbox shows after the subject. Without one, clients fill it
   * with whatever text comes first — usually "View in browser" or the logo's
   * alt text, which is a wasted second line on every phone.
   */
  preheader?: string;
  cta?: { label: string; url: string };
  /** Escaped HTML under the button: a sign-off, a note, a secondary link. */
  after?: string;
  /**
   * Why this person is receiving this, in one sentence. Already-escaped HTML.
   * Defaults to the account line, which is true of everything we send.
   */
  footer?: string;
  /**
   * Marketing mail only. Present, the footer carries a one-click unsubscribe
   * link; absent, it carries none — transactional email must not pretend it
   * can be turned off.
   */
  unsubscribeUrl?: string;
  /** A postal address, which commercial email law asks for. Optional. */
  postalAddress?: string | null;
  /**
   * The app's own origin, which is where the logo is served from. Falls back
   * to the marketing site, which serves the same file.
   */
  appUrl?: string;
}

/**
 * Where the logo lives. A PNG, because every major client blocks SVG.
 *
 * `apps/web/public/email/logo.png` is the mark and wordmark from `logo.tsx`
 * rendered at twice its 134×32 display size, so it is sharp on a retina
 * screen while the `<img>` keeps its 1x dimensions; `logo-dark.png` is the
 * same lockup with light text for the dark-mode swap, and the `@2x` files are
 * four-times renders for anybody who needs them larger.
 */
export function logoUrl(appUrl: string | undefined, variant: "light" | "dark" = "light"): string {
  const origin = (appUrl ?? BRAND.site).replace(/\/$/, "");
  return `${origin}/email/${variant === "dark" ? "logo-dark" : "logo"}.png`;
}

export function layout(options: LayoutOptions): string {
  const title = escapeHtml(options.title);
  const preheader = options.preheader ? escapeHtml(options.preheader) : "";
  const site = BRAND.site.replace(/^https?:\/\//, "");

  const why =
    options.footer ??
    `You are receiving this because you have a ${escapeHtml(BRAND.name)} account.`;

  const unsubscribe = options.unsubscribeUrl
    ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.subtle}" class="nora-muted">
         Not useful? <a href="${escapeHtml(options.unsubscribeUrl)}" class="nora-link" style="color:${C.subtle};text-decoration:underline">Unsubscribe from product emails</a> in one click. Emails about your own account still arrive.
       </p>`
    : "";

  const address = options.postalAddress
    ? `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.subtle}" class="nora-muted">${escapeHtml(options.postalAddress)}</p>`
    : "";

  // Table layout and inline styles: email clients are twenty years behind.
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media screen and (max-width: 620px) {
    .nora-shell { padding:16px 0 24px !important; }
    .nora-card { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .nora-pad { padding-left:22px !important; padding-right:22px !important; }
    .nora-top { padding-top:28px !important; }
    .nora-h1 { font-size:23px !important; line-height:30px !important; }
    .nora-btn { width:100% !important; }
    .nora-btn a { display:block !important; padding:0 16px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .nora-bg { background-color:#0E0F15 !important; }
    .nora-card { background-color:#181A23 !important; border-color:#2A2D3A !important; }
    .nora-text, .nora-text p, .nora-text li, .nora-text td, .nora-h1 { color:#ECEDF3 !important; }
    .nora-muted { color:#A9AEBD !important; }
    .nora-tint { background-color:#22243A !important; border-color:#33365A !important; }
    .nora-rule { border-color:#2A2D3A !important; }
    .nora-link { color:#9C98FF !important; }
    .nora-logo-light { display:none !important; max-height:0 !important; overflow:hidden !important; }
    .nora-logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
  }
  [data-ogsc] .nora-bg { background-color:#0E0F15 !important; }
  [data-ogsc] .nora-card { background-color:#181A23 !important; border-color:#2A2D3A !important; }
  [data-ogsc] .nora-text, [data-ogsc] .nora-text p, [data-ogsc] .nora-text li, [data-ogsc] .nora-h1 { color:#ECEDF3 !important; }
  [data-ogsc] .nora-muted { color:#A9AEBD !important; }
  [data-ogsc] .nora-tint { background-color:#22243A !important; }
</style>
</head>
<body class="nora-bg" style="margin:0;padding:0;background-color:${C.page};">
${
  preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}${"&#8199;&#65279;&#847; ".repeat(40)}</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nora-bg" bgcolor="${C.page}" style="background-color:${C.page};">
  <tr>
    <td align="center" class="nora-shell" style="padding:32px 12px 40px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
        <tr>
          <td class="nora-pad" style="padding:0 4px 18px;">
            <a href="${escapeHtml(BRAND.site)}" style="text-decoration:none;display:inline-block;">
              <img class="nora-logo-light" src="${escapeHtml(logoUrl(options.appUrl))}" width="134" height="32" alt="${escapeHtml(BRAND.full)}" style="display:block;width:134px;height:32px;border:0;font-family:${FONT};font-size:18px;font-weight:700;color:${C.accent};">
              <!--[if !mso]><!-->
              <div class="nora-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
                <img src="${escapeHtml(logoUrl(options.appUrl, "dark"))}" width="134" height="32" alt="${escapeHtml(BRAND.full)}" style="display:block;width:134px;height:32px;border:0;">
              </div>
              <!--<![endif]-->
            </a>
          </td>
        </tr>
        <tr>
          <td class="nora-card" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="nora-pad nora-top nora-text" style="padding:40px 44px 4px;font-family:${FONT};font-size:16px;line-height:26px;color:${C.text};">
                  <h1 class="nora-h1" style="margin:0 0 18px;font-family:${FONT};font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.4px;color:${C.text};">${title}</h1>
                  ${options.body}
                </td>
              </tr>
              ${options.cta ? `<tr><td class="nora-pad" style="padding:12px 44px 8px;">${button(options.cta)}</td></tr>` : ""}
              ${
                options.after
                  ? `<tr><td class="nora-pad nora-text" style="padding:16px 44px 0;font-family:${FONT};font-size:16px;line-height:26px;color:${C.text};">${options.after}</td></tr>`
                  : ""
              }
              <tr><td style="padding:0 0 36px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="nora-pad" style="padding:24px 8px 0;">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;font-weight:600;color:${C.muted};" class="nora-muted">
              ${escapeHtml(BRAND.full)} &middot; <span style="font-weight:400;">${escapeHtml(BRAND.tagline)}</span>
            </p>
            <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.subtle};" class="nora-muted">${why}</p>
            ${unsubscribe}
            ${address}
            <p style="margin:6px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.subtle};" class="nora-muted">
              <a href="${escapeHtml(BRAND.site)}" class="nora-link" style="color:${C.subtle};text-decoration:underline;">${escapeHtml(site)}</a>
            </p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * The call to action, as a button that survives Outlook and images-off.
 *
 * The VML width is estimated from the label because Outlook will not size a
 * roundrect to its text; too narrow and the label wraps inside the button.
 */
export function button(cta: { label: string; url: string }): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  const vmlWidth = Math.max(200, Math.round(cta.label.length * 9.5 + 64));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="nora-btn">
  <tr>
    <td align="center" bgcolor="${C.accent}" style="border-radius:10px;background-color:${C.accent};">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="21%" stroke="f" fillcolor="${C.accent}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${url}" style="display:inline-block;background-color:${C.accent};color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:600;line-height:48px;text-align:center;text-decoration:none;padding:0 28px;border-radius:10px;-webkit-text-size-adjust:none;">${label}&nbsp;&rarr;</a><!--<![endif]-->
    </td>
  </tr>
</table>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:26px;color:${C.text};">${escapeHtml(text)}</p>`;
}

/** A paragraph in the quieter colour, for an aside that should not compete. */
export function note(text: string): string {
  return `<p class="nora-muted" style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">${escapeHtml(text)}</p>`;
}

export function subheading(text: string): string {
  return `<p style="margin:24px 0 8px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${C.accent};" class="nora-link">${escapeHtml(text)}</p>`;
}

export function list(items: string[]): string {
  if (items.length === 0) return "";
  return `<ul style="margin:0 0 16px;padding:0 0 0 22px;">${items
    .map(
      (item) =>
        `<li style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.text};">${escapeHtml(item)}</li>`,
    )
    .join("")}</ul>`;
}

/**
 * Numbered steps, drawn rather than left to `<ol>`, whose numbering Outlook
 * and Gmail each render differently.
 */
export function steps(items: { title: string; detail: string }[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map(
      (item, index) => `<tr>
        <td valign="top" width="36" style="padding:2px 12px 14px 0;width:36px;">
          <div style="width:26px;height:26px;border-radius:13px;background-color:${C.tint};color:${C.accent};font-family:${FONT};font-size:13px;line-height:26px;font-weight:700;text-align:center;" class="nora-tint nora-link">${index + 1}</div>
        </td>
        <td valign="top" style="padding:0 0 14px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.text};">
          <strong>${escapeHtml(item.title)}</strong><br>
          <span class="nora-muted" style="color:${C.muted};font-size:15px;line-height:23px;">${escapeHtml(item.detail)}</span>
        </td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;">${rows}</table>`;
}

/** A tinted box for the one thing in an email somebody must not miss. */
export function callout(title: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
  <tr>
    <td class="nora-tint" style="background-color:${C.tint};border:1px solid #DCDBFB;border-radius:12px;padding:16px 18px;font-family:${FONT};">
      <p style="margin:0 0 4px;font-size:15px;line-height:22px;font-weight:700;color:${C.text};">${escapeHtml(title)}</p>
      <p style="margin:0;font-size:15px;line-height:23px;color:${C.muted};" class="nora-muted">${escapeHtml(text)}</p>
    </td>
  </tr>
</table>`;
}

/**
 * Numbers in tiles, two to a row. Two rather than four across because four
 * tiles stacked one above another at phone width is a screen of numbers before
 * the first sentence, and two-by-two reads the same on every client without a
 * media query to rearrange it. Each value is printed, never implied by a bar
 * or a colour, so the tile says the same thing with styles stripped.
 */
export function stats(items: { label: string; value: string | number }[]): string {
  if (items.length === 0) return "";
  const rows: { label: string; value: string | number }[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));

  const tile = (item: { label: string; value: string | number } | undefined, side: "left" | "right") => {
    const pad = side === "left" ? "0 5px 10px 0" : "0 0 10px 5px";
    if (!item) return `<td width="50%" style="padding:${pad};">&nbsp;</td>`;
    return `<td width="50%" valign="top" style="padding:${pad};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="nora-tint" style="background-color:${C.tint};border-radius:12px;padding:14px 16px;font-family:${FONT};">
            <p style="margin:0;font-size:26px;line-height:32px;font-weight:700;color:${C.text};font-variant-numeric:tabular-nums;">${escapeHtml(String(item.value))}</p>
            <p style="margin:2px 0 0;font-size:13px;line-height:18px;color:${C.muted};" class="nora-muted">${escapeHtml(item.label)}</p>
          </td>
        </tr></table>
      </td>`;
  };

  const body = rows.map((row) => `<tr>${tile(row[0], "left")}${tile(row[1], "right")}</tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 10px;">${body}</table>`;
}

/**
 * A short facts table — label on the left, value on the right. For the
 * operator's notifications, which are read as data rather than as prose.
 */
export function facts(rows: { label: string; value: string }[]): string {
  const body = rows
    .map(
      (row) => `<tr>
        <td valign="top" width="104" class="nora-muted nora-rule" style="width:104px;padding:9px 12px 9px 0;border-bottom:1px solid ${C.border};font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};white-space:nowrap;">${escapeHtml(row.label)}</td>
        <td valign="top" class="nora-rule" style="padding:9px 0;border-bottom:1px solid ${C.border};font-family:${FONT};font-size:15px;line-height:21px;color:${C.text};word-break:break-word;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${C.border};" class="nora-rule">${body}</table>`;
}

/** How Nora signs off. The voice of the product, in one place. */
export function signoff(line: string = BRAND.name, role = `Your AI executive assistant at ${BRAND.full}`): string {
  return `<p style="margin:8px 0 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.text};">${escapeHtml(line)}<br><span class="nora-muted" style="font-size:14px;color:${C.muted};">${escapeHtml(role)}</span></p>`;
}

/**
 * Plain text split into paragraphs on blank lines. For the one email a person
 * types by hand — an announcement — which must never be read as HTML.
 */
export function prose(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:26px;color:${C.text};">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

/**
 * The team, as rows with a lettered avatar each. Letters rather than images:
 * an avatar that is blocked by default is a grey box with alt text in it.
 */
export function roster(people: { name: string; role: string; detail: string }[]): string {
  const rows = people
    .map(
      (person) => `<tr>
        <td valign="top" width="48" style="padding:0 14px 16px 0;width:48px;">
          <div class="nora-tint nora-link" style="width:40px;height:40px;border-radius:20px;background-color:${C.tint};color:${C.accent};font-family:${FONT};font-size:16px;line-height:40px;font-weight:700;text-align:center;">${escapeHtml(person.name.slice(0, 1))}</div>
        </td>
        <td valign="top" style="padding:0 0 16px;font-family:${FONT};">
          <p style="margin:0;font-size:16px;line-height:22px;color:${C.text};"><strong>${escapeHtml(person.name)}</strong> <span class="nora-muted" style="color:${C.subtle};font-size:14px;">&middot; ${escapeHtml(person.role)}</span></p>
          <p class="nora-muted" style="margin:2px 0 0;font-size:15px;line-height:22px;color:${C.muted};">${escapeHtml(person.detail)}</p>
        </td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;">${rows}</table>`;
}
