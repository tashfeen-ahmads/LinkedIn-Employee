/**
 * The whole product, in one picture.
 *
 * The hero showed a single inbox panel — one reply, held for a person. That is
 * the best *moment* in the product and it is not the product: somebody landing
 * cold cannot tell from it that anything happens before the reply, or that a
 * list was built, or that the sending is paced. The headline claims a pipeline
 * and the picture underneath it showed one message.
 *
 * So this draws the mechanism: what each stage does, what it hands to the next,
 * and the two places the product stops on purpose. Those two are the argument —
 * every competitor sends faster, and what a buyer is actually frightened of is
 * a restricted account and a stranger receiving something they would not have
 * signed.
 *
 * Inline SVG on one scale, no library: four shapes is less code than a
 * dependency's configuration, and a diagram built on its own scale cannot draw
 * a bar whose length disagrees with the number beside it (rule 35). Every
 * colour is a token, so it reads in both themes rather than being flipped.
 */
export function PlatformDiagram() {
  // One coordinate space, scaled by CSS. Sized so the five stages sit on whole
  // numbers — a stage at x=170.5 renders a half-pixel edge on every border.
  const W = 940;
  // Content runs from the top gate at y=14 to the lower bands ending at 220.
  // Sized to that rather than a round number, or the figure reserves eighty
  // pixels of nothing and the hero grows a gap under the picture.
  const H = 232;
  const stages = [
    { x: 40, title: "Strategy", line: "Reads your site", sub: "Writes who to target" },
    { x: 220, title: "Targeting", line: "Builds the list", sub: "Scored, deduplicated" },
    { x: 400, title: "Outreach", line: "Invites, paced", sub: "Warm-up, then follow-ups" },
    { x: 580, title: "Reply", line: "Answers in your voice", sub: "From your own words" },
    { x: 760, title: "Meeting", line: "Booked in your diary", sub: "Times you are free" },
  ];
  const boxW = 140;
  const boxH = 86;
  const y = 74;

  return (
    /*
     * Focusable because it scrolls. Below 720px the drawing keeps a minimum
     * width and the figure scrolls sideways, and a scrolling box nobody can
     * focus is one a keyboard user can see the start of and never the end.
     */
    <figure className="platform" tabIndex={0} role="region" aria-label="How the product works, end to end">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        className="chart-svg platform-svg"
        aria-labelledby="platform-title platform-desc"
      >
        <title id="platform-title">How the product works, end to end</title>
        <desc id="platform-desc">
          Five stages in order: Strategy reads your website and writes who to target. Targeting
          builds a scored, deduplicated list. Outreach sends invitations paced across your working
          hours, inside LinkedIn&rsquo;s limits. Reply answers in your voice from your own words.
          Meeting books into your diary. Two stops are marked: you approve the list before anything
          sends, and any reply the agent is unsure about is held for you.
        </desc>

        {/* The spine first, so every stage sits on it rather than near it. */}
        <line
          className="platform-spine"
          x1={stages[0]!.x + boxW / 2}
          y1={y + boxH / 2}
          x2={stages[4]!.x + boxW / 2}
          y2={y + boxH / 2}
        />

        {stages.map((stage, i) => (
          <g key={stage.title}>
            {i > 0 ? (
              <polygon
                className="platform-arrow"
                points={`${stage.x - 16},${y + boxH / 2 - 5} ${stage.x - 6},${y + boxH / 2} ${stage.x - 16},${y + boxH / 2 + 5}`}
              />
            ) : null}
            <rect
              className={`platform-box${i === 4 ? " is-end" : ""}`}
              x={stage.x}
              y={y}
              width={boxW}
              height={boxH}
              rx={10}
            />
            {/* No "01" to "05" above the titles: the arrows already say the
                order, and a number on every box was a label for its position
                rather than for anything in it. */}
            <text className="platform-title" x={stage.x + 12} y={y + 30}>
              {stage.title}
            </text>
            <text className="platform-line" x={stage.x + 12} y={y + 52}>
              {stage.line}
            </text>
            <text className="platform-sub" x={stage.x + 12} y={y + 70}>
              {stage.sub}
            </text>
          </g>
        ))}

        {/*
          The two stops, drawn above and below rather than as a sixth stage.
          They are not steps in the pipeline — they are the pipeline refusing to
          continue, which is a different kind of thing and reads wrongly in a
          row of boxes.
        */}
        <g className="platform-gate">
          <line x1={stages[1]!.x + boxW / 2} y1={y} x2={stages[1]!.x + boxW / 2} y2={40} />
          <rect x={stages[1]!.x - 6} y={14} width={boxW + 12} height={26} rx={13} />
          <text x={stages[1]!.x + boxW / 2} y={31}>You approve the list</text>
        </g>

        <g className="platform-gate">
          <line
            x1={stages[3]!.x + boxW / 2}
            y1={y + boxH}
            x2={stages[3]!.x + boxW / 2}
            y2={y + boxH + 34}
          />
          <rect x={stages[3]!.x - 20} y={y + boxH + 34} width={boxW + 40} height={26} rx={13} />
          <text x={stages[3]!.x + boxW / 2} y={y + boxH + 51}>
            Unsure? Held for you
          </text>
        </g>

        {/*
          The limiter, drawn as a band under the sending stage.
          It is the one number a buyer in this category is actually weighing, so
          it is on the picture rather than in a paragraph three sections down.
        */}
        <g className="platform-cap">
          <line
            x1={stages[2]!.x + boxW / 2}
            y1={y + boxH}
            x2={stages[2]!.x + boxW / 2}
            y2={y + boxH + 34}
          />
          <rect x={stages[2]!.x - 14} y={y + boxH + 34} width={boxW + 28} height={26} rx={13} />
          <text x={stages[2]!.x + boxW / 2} y={y + boxH + 51}>
            Never above your cap
          </text>
        </g>
      </svg>
    </figure>
  );
}
