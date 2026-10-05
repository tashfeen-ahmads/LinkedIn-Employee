/**
 * A page's `searchParams`, as the query string they arrived in.
 *
 * For routes that only redirect somewhere else: the query is how a server
 * action says what happened (`?error=`, `?notice=`), and a forwarding route
 * that drops it says that to nobody.
 */
export function forwardQuery(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    for (const one of values) query.append(key, one);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
