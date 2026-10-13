/**
 * The 8-checks scorecard on /guides/safest-linkedin-automation-tool: checks
 * down the side, tools across, one short mark per cell.
 *
 * Its own table rather than CompareTable because seven columns of marks need
 * tighter cells than a prose comparison, and on a phone each check becomes a
 * card of tool-and-mark pairs instead of a table scrolled sideways. The mark is
 * always a word; the tint beside it only repeats it.
 */
export type ScoreMark = "Pass" | "Partly" | "Not published";

const MARK_CLASS: Record<ScoreMark, string> = {
  Pass: "is-pass",
  Partly: "is-partly",
  "Not published": "is-none",
};

export function Scorecard({
  caption,
  tools,
  rows,
}: {
  caption: string;
  tools: readonly string[];
  rows: ReadonlyArray<{ check: string; marks: readonly ScoreMark[] }>;
}) {
  return (
    <div className="gb2-score table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Check</th>
            {tools.map((tool) => (
              <th key={tool} scope="col">
                {tool}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.check}>
              <th scope="row">{row.check}</th>
              {row.marks.map((mark, i) => (
                <td key={tools[i]} data-label={tools[i]}>
                  <span className={`gb2-mark ${MARK_CLASS[mark]}`}>{mark}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
