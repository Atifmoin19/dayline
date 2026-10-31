import React, { useMemo } from "react";
import { Box, Flex, Spinner, Text, HStack } from "@chakra-ui/react";
import { useSprintBurndownQuery } from "Services/user.api";
import { getLocalDateKey } from "Utils/scheduler";

const WIDTH = 640;
const HEIGHT = 260;
const PADDING = { top: 16, right: 16, bottom: 28, left: 48 };
const INNER_W = WIDTH - PADDING.left - PADDING.right;
const INNER_H = HEIGHT - PADDING.top - PADDING.bottom;

const IDEAL_COLOR = "#9ca3af";
const ACTUAL_COLOR = "#2563eb";

const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Ideal-vs-actual burndown for one sprint (scale-gaps-plan.md §B.5). Plain inline SVG with
 * computed layout coordinates — same "no charting library" convention as `TaskGraphView.tsx`.
 * The ideal line is the server-computed straight reference (`ideal_remaining_hours`); the
 * actual line only draws through days with a non-null `actual_remaining_hours` — future days
 * (still null) leave a gap rather than being plotted as zero.
 */
const SprintBurndownChart: React.FC<{ sprintId: string }> = ({ sprintId }) => {
  const { data, isFetching, isError } = useSprintBurndownQuery(sprintId, { skip: !sprintId });

  const layout = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const points = data.points;
    const maxY = Math.max(
      data.total_hours,
      ...points.map((p) => p.ideal_remaining_hours),
      ...points.map((p) => p.actual_remaining_hours ?? 0),
      1,
    );
    const xFor = (i: number) =>
      PADDING.left + (points.length <= 1 ? 0 : (i / (points.length - 1)) * INNER_W);
    const yFor = (v: number) => PADDING.top + INNER_H - (v / maxY) * INNER_H;

    const idealPath = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.ideal_remaining_hours).toFixed(1)}`)
      .join(" ");

    // Actual line: break into separate path segments wherever actual_remaining_hours is null
    // (a future day, not yet knowable) so the line visibly stops rather than dipping to 0.
    const actualSegments: string[] = [];
    const actualPoints: { x: number; y: number }[] = [];
    let current: string[] = [];
    points.forEach((p, i) => {
      if (p.actual_remaining_hours == null) {
        if (current.length) {
          actualSegments.push(current.join(" "));
          current = [];
        }
        return;
      }
      const x = xFor(i);
      const y = yFor(p.actual_remaining_hours);
      current.push(`${current.length === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
      actualPoints.push({ x, y });
    });
    if (current.length) actualSegments.push(current.join(" "));

    const todayKey = getLocalDateKey(new Date());
    const todayIdx = points.findIndex((p) => p.date === todayKey);

    return {
      points,
      maxY,
      xFor,
      yFor,
      idealPath,
      actualSegments,
      actualPoints,
      todayX: todayIdx >= 0 ? xFor(todayIdx) : null,
    };
  }, [data]);

  if (isFetching && !data) {
    return (
      <Flex align="center" justify="center" py={10}>
        <Spinner size="sm" />
      </Flex>
    );
  }
  if (isError || !layout) {
    return (
      <Text fontSize="sm" color="neutral.500">
        {isError ? "Couldn't load the burndown chart." : "No burndown data yet."}
      </Text>
    );
  }

  const { points, maxY, yFor, idealPath, actualSegments, actualPoints, todayX } = layout;
  // Dedupe: at a small maxY (e.g. an empty/just-created sprint, which floors to 1 — see the
  // `Math.max(..., 1)` guard above), 0/0.5/1 can round to the same integer (e.g. [0, 1, 1]),
  // which would draw two identical overlapping gridlines/labels, not just violate React's
  // unique-key rule.
  const yTicks = Array.from(new Set([0, 0.5, 1].map((f) => Math.round(maxY * f))));
  // Sparse x labels: first, last, and up to 3 evenly spaced in between so dense sprints
  // (30+ days) don't overlap their date labels.
  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  const xLabelIndices = points
    .map((_, i) => i)
    .filter((i) => i === 0 || i === points.length - 1 || i % labelStep === 0);

  return (
    <Box>
      <HStack spacing={4} mb={2}>
        <HStack spacing={1.5}>
          <Box w="14px" h="0" borderTop="2px dashed" borderColor={IDEAL_COLOR} />
          <Text fontSize="xs" color="neutral.500">
            Ideal
          </Text>
        </HStack>
        <HStack spacing={1.5}>
          <Box w="14px" h="2px" bg={ACTUAL_COLOR} />
          <Text fontSize="xs" color="neutral.500">
            Actual
          </Text>
        </HStack>
      </HStack>
      <Box overflowX="auto">
        <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          {/* Y gridlines + labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={yFor(v)}
                y2={yFor(v)}
                stroke="#f3f4f6"
                strokeWidth={1}
              />
              <text x={PADDING.left - 8} y={yFor(v) + 3} fontSize={10} fill="#6b7280" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {/* Today marker */}
          {todayX != null && (
            <line
              x1={todayX}
              x2={todayX}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}
          {/* Ideal reference line */}
          <path d={idealPath} fill="none" stroke={IDEAL_COLOR} strokeWidth={2} strokeDasharray="6 4" />
          {/* Actual line, drawn as separate segments to gap over future/unknown days */}
          {actualSegments.map((seg, i) => (
            <path key={i} d={seg} fill="none" stroke={ACTUAL_COLOR} strokeWidth={2.5} />
          ))}
          {actualPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={ACTUAL_COLOR} />
          ))}
          {/* X labels */}
          {xLabelIndices.map((i) => (
            <text
              key={i}
              x={layout.xFor(i)}
              y={HEIGHT - PADDING.bottom + 16}
              fontSize={10}
              fill="#6b7280"
              textAnchor="middle"
            >
              {shortDate(points[i].date)}
            </text>
          ))}
        </svg>
      </Box>
    </Box>
  );
};

export default SprintBurndownChart;
