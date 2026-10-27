/**
 * One labelled list of what a strategy says, as the strategy pages show it.
 *
 * `unsaid` is for a field the agent may have left out: a strategy written
 * before `whatTheyBuy` existed says nothing there, and a missing fact shown as
 * no fact reads as agreement (rule 49), so the gap is named instead.
 */
export function StrategyFacts({
  label,
  values,
  unsaid,
}: {
  label: string;
  values: readonly (string | null | undefined)[];
  unsaid?: string;
}) {
  const said = values.filter((value): value is string => Boolean(value?.trim()));
  if (said.length === 0 && !unsaid) return null;
  return (
    <div className="strategy-facts">
      <p className="small muted">{label}</p>
      {said.length ? (
        <ul className="small bullets">
          {said.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="small subtle">{unsaid}</p>
      )}
    </div>
  );
}
