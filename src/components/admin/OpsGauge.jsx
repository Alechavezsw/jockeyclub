const SIZE = 120;
const CX = 60;
const CY = 60;
const RADIUS = 46;
const CIRC = 2 * Math.PI * RADIUS;
const HORSESHOE_GAP = 62;
const HORSESHOE_ARC = 360 - HORSESHOE_GAP;
const HORSESHOE_VISIBLE = CIRC * (HORSESHOE_ARC / 360);
const HORSESHOE_START = 90 + HORSESHOE_GAP / 2;

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function Nail({ angle, fill }) {
  const rad = (angle * Math.PI) / 180;
  const x = CX + RADIUS * Math.cos(rad);
  const y = CY + RADIUS * Math.sin(rad);
  return <circle className="ops-gauge-nail" cx={x} cy={y} r="2.4" fill={fill} />;
}

export function OpsProgressRing({
  value = 0,
  title,
  caption = '%',
  tone = 'ok',
}) {
  const pct = Math.round(clampPct(value));
  const filled = HORSESHOE_VISIBLE * (pct / 100);
  return (
    <div
      className={`ops-gauge ops-gauge--progress ops-gauge--${tone}`}
      title={title}
      role="img"
      aria-label={title || `${pct} por ciento`}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          className="ops-gauge-track"
          cx={CX}
          cy={CY}
          r={RADIUS}
          strokeDasharray={`${HORSESHOE_VISIBLE} ${CIRC}`}
          transform={`rotate(${HORSESHOE_START} ${CX} ${CY})`}
        />
        <circle
          className="ops-gauge-fill"
          cx={CX}
          cy={CY}
          r={RADIUS}
          strokeDasharray={`${filled} ${CIRC}`}
          transform={`rotate(${HORSESHOE_START} ${CX} ${CY})`}
        />
        <Nail angle={HORSESHOE_START} fill="currentColor" />
        <Nail angle={HORSESHOE_START + HORSESHOE_ARC} fill="currentColor" />
      </svg>
      <div className="ops-gauge-core">
        <b className="tabular-nums">{pct}</b>
        {caption ? <small>{caption}</small> : null}
      </div>
    </div>
  );
}

export function OpsSegmentRing({
  segments = [],
  value,
  title,
  caption,
}) {
  const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
  let offset = 0;
  const arcs = total <= 0
    ? []
    : segments.flatMap((s) => {
      const len = CIRC * ((Number(s.value) || 0) / total);
      if (len <= 0) return [];
      const arc = {
        key: s.key,
        color: s.color,
        dash: `${len} ${CIRC}`,
        offset,
      };
      offset += len;
      return [arc];
    });

  return (
    <div
      className="ops-gauge ops-gauge--segments"
      title={title}
      role="img"
      aria-label={title || String(value ?? '')}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle className="ops-gauge-track ops-gauge-track--full" cx={CX} cy={CY} r={RADIUS} />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            className="ops-gauge-seg"
            cx={CX}
            cy={CY}
            r={RADIUS}
            stroke={arc.color}
            strokeDasharray={arc.dash}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
      </svg>
      <div className="ops-gauge-core">
        <b className="tabular-nums">{value}</b>
        {caption ? <small>{caption}</small> : null}
      </div>
    </div>
  );
}
