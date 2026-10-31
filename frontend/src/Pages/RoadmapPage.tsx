import React, { useMemo } from "react";
import { Box, Flex, Heading, Icon, Text, Spinner, VStack } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import SimpleLayout from "Layouts/simpleLayout";
import { useEpicListQuery } from "Services/user.api";
import { Epic } from "types";
import { FaMap } from "Utils/icons";

const NAME_COL_W = "260px";
const ROW_H = 56;
const BAR_H = 26;
const HEADER_H = 28;
const DAY_MS = 86400000;

interface Gridline {
  pct: number;
  label: string;
  isToday?: boolean;
}

interface RoadmapRow {
  epic: Epic;
  leftPct: number;
  widthPct: number;
  openStart: boolean;
  openEnd: boolean;
}

/** Builds week-grain gridlines for a <=70 day span, or month-grain gridlines for anything
 * longer — "week/month-grain", never hour-grain (scale-gaps-plan.md §B.4's ask). */
const buildGridlines = (rangeStart: Date, rangeEnd: Date): Gridline[] => {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const spanDays = totalMs / DAY_MS;
  const ticks: Date[] = [];

  if (spanDays <= 70) {
    let d = new Date(rangeStart);
    while (d.getTime() <= rangeEnd.getTime()) {
      ticks.push(new Date(d));
      d = new Date(d.getTime() + 7 * DAY_MS);
    }
  } else {
    let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    if (d.getTime() < rangeStart.getTime()) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    while (d.getTime() <= rangeEnd.getTime()) {
      ticks.push(new Date(d));
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }

  const spansMultipleYears = rangeStart.getFullYear() !== rangeEnd.getFullYear();
  const gridlines: Gridline[] = ticks.map((t) => ({
    pct: ((t.getTime() - rangeStart.getTime()) / totalMs) * 100,
    label:
      spanDays <= 70
        ? t.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : t.toLocaleDateString(undefined, {
            month: "short",
            year: spansMultipleYears ? "numeric" : undefined,
          }),
  }));

  const today = new Date();
  if (today.getTime() >= rangeStart.getTime() && today.getTime() <= rangeEnd.getTime()) {
    gridlines.push({
      pct: ((today.getTime() - rangeStart.getTime()) / totalMs) * 100,
      label: "Today",
      isToday: true,
    });
  }

  return gridlines;
};

const GridlineOverlay: React.FC<{ gridlines: Gridline[] }> = ({ gridlines }) => (
  <>
    {gridlines.map((g, i) => (
      <Box
        key={i}
        position="absolute"
        top={0}
        bottom={0}
        left={`${g.pct}%`}
        borderLeft={g.isToday ? "1.5px dashed" : "1px solid"}
        borderColor={g.isToday ? "orange.400" : "neutral.100"}
        zIndex={g.isToday ? 1 : 0}
      />
    ))}
  </>
);

/**
 * `/roadmap` — a week/month-grain horizontal timeline for Epics, one row per epic with a
 * `start_date` and/or `target_date` set (scale-gaps-plan.md §B.4: "no way to see 'these 12
 * stories run Jul-Sep across 4 teams' at a glance"). Plain Chakra Box/inline styling — no
 * charting dependency, same convention as `TaskGraphView.tsx`'s inline-SVG graph and
 * `Utils/capacity.ts`'s heatmap. Fetches via `useEpicListQuery()` (already company-wide, not
 * org-tree scoped). Clicking a bar/row navigates to the epic's existing detail page.
 */
const RoadmapPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: epics = [], isFetching, isError } = useEpicListQuery();

  const { rows, gridlines, undated } = useMemo(() => {
    const dated = epics.filter((e) => e.start_date || e.target_date);
    const undatedCount = epics.length - dated.length;

    if (dated.length === 0) {
      return { rows: [] as RoadmapRow[], gridlines: [] as Gridline[], undated: undatedCount };
    }

    let minTime = Infinity;
    let maxTime = -Infinity;
    dated.forEach((e) => {
      const s = e.start_date ? new Date(e.start_date).getTime() : undefined;
      const t = e.target_date ? new Date(e.target_date).getTime() : undefined;
      const rowStart = s ?? t!;
      const rowEnd = t ?? s!;
      if (rowStart < minTime) minTime = rowStart;
      if (rowEnd > maxTime) maxTime = rowEnd;
    });

    // Pad the visible range a little on each side (min 3 days) so bars at the very edge of the
    // known range aren't flush against the chart border.
    const span = Math.max(maxTime - minTime, DAY_MS);
    const pad = Math.max(span * 0.06, 3 * DAY_MS);
    const rangeStart = new Date(minTime - pad);
    const rangeEnd = new Date(maxTime + pad);
    const totalMs = rangeEnd.getTime() - rangeStart.getTime();

    const pctFor = (t: number) =>
      Math.max(0, Math.min(100, ((t - rangeStart.getTime()) / totalMs) * 100));

    const roadmapRows: RoadmapRow[] = dated.map((epic) => {
      const openStart = !epic.start_date;
      const openEnd = !epic.target_date;
      const startTime = epic.start_date ? new Date(epic.start_date).getTime() : rangeStart.getTime();
      const endTime = epic.target_date ? new Date(epic.target_date).getTime() : rangeEnd.getTime();
      const leftPct = pctFor(startTime);
      let rightPct = pctFor(endTime);
      if (rightPct - leftPct < 1.5) rightPct = Math.min(leftPct + 1.5, 100);
      return { epic, leftPct, widthPct: rightPct - leftPct, openStart, openEnd };
    });
    // Earliest-starting (or earliest-target, if open-start) epic first.
    roadmapRows.sort((a, b) => a.leftPct - b.leftPct);

    return {
      rows: roadmapRows,
      gridlines: buildGridlines(rangeStart, rangeEnd),
      undated: undatedCount,
    };
  }, [epics]);

  return (
    <SimpleLayout>
      <Box>
        <Flex align="center" gap={3} mb={1}>
          <Icon as={FaMap} color="brand.600" boxSize={5} />
          <Heading size="lg" color="neutral.900">
            Roadmap
          </Heading>
        </Flex>
        <Text color="neutral.500" fontSize="sm" mb={2}>
          Epic date ranges across weeks/months — click a bar to open the epic.
        </Text>
        {undated > 0 && (
          <Text color="neutral.500" fontSize="xs" mb={4}>
            {undated} epic{undated === 1 ? "" : "s"} {undated === 1 ? "has" : "have"} no dates set and
            aren't shown here — set a start or target date on the epic to add it to the roadmap.
          </Text>
        )}

        <Box
          bg="surface.card"
          border="1px solid"
          borderColor="surface.border"
          borderRadius="card"
          boxShadow="card"
          overflow="hidden"
          p={{ base: 4, md: 6 }}
        >
          {isFetching && epics.length === 0 ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={3}>
              <Spinner />
              <Text color="neutral.500" fontSize="sm">
                Loading roadmap…
              </Text>
            </Flex>
          ) : isError ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={2}>
              <Text color="neutral.700" fontWeight={600}>
                Roadmap unavailable
              </Text>
              <Text color="neutral.500" fontSize="sm">
                Couldn't load epics right now. Try refreshing the page.
              </Text>
            </Flex>
          ) : rows.length === 0 ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={2}>
              <Text color="neutral.700" fontWeight={600}>
                No planned epics yet
              </Text>
              <Text color="neutral.500" fontSize="sm">
                {epics.length === 0
                  ? "Create an epic and give it a start or target date to see it here."
                  : "Set a start or target date on an epic to see it here."}
              </Text>
            </Flex>
          ) : (
            <Box overflowX="auto">
              <Box minW="720px">
                {/* Header: gridline labels aligned over the timeline area. */}
                <Flex>
                  <Box w={NAME_COL_W} flexShrink={0} />
                  <Box flex={1} position="relative" h={`${HEADER_H}px`}>
                    {gridlines.map((g, i) => (
                      <Text
                        key={i}
                        position="absolute"
                        left={`${g.pct}%`}
                        transform="translateX(-50%)"
                        fontSize="xs"
                        fontWeight={g.isToday ? 700 : 500}
                        color={g.isToday ? "orange.500" : "neutral.500"}
                        whiteSpace="nowrap"
                      >
                        {g.label}
                      </Text>
                    ))}
                  </Box>
                </Flex>

                <VStack align="stretch" spacing={0} mt={1}>
                  {rows.map(({ epic, leftPct, widthPct, openStart, openEnd }) => {
                    const dateLabel = `${
                      epic.start_date ? new Date(epic.start_date).toLocaleDateString() : "—"
                    } → ${epic.target_date ? new Date(epic.target_date).toLocaleDateString() : "Ongoing"}`;
                    const maskImage = openStart
                      ? "linear-gradient(to right, transparent, black 20px)"
                      : openEnd
                      ? "linear-gradient(to right, black calc(100% - 20px), transparent)"
                      : undefined;
                    return (
                      <Flex
                        key={epic.id}
                        align="center"
                        h={`${ROW_H}px`}
                        borderTop="1px solid"
                        borderColor="surface.border"
                        cursor="pointer"
                        role="button"
                        tabIndex={0}
                        _hover={{ bg: "neutral.50" }}
                        onClick={() => navigate(`/epics/${epic.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/epics/${epic.id}`);
                          }
                        }}
                      >
                        <Box w={NAME_COL_W} flexShrink={0} pr={4} minW={0}>
                          <Text fontSize="sm" fontWeight={600} color="neutral.900" isTruncated>
                            {epic.name}
                          </Text>
                          <Text fontSize="xs" color="neutral.500" isTruncated>
                            {dateLabel}
                          </Text>
                        </Box>
                        <Box flex={1} position="relative" h={`${ROW_H}px`}>
                          <GridlineOverlay gridlines={gridlines} />
                          <Box
                            position="absolute"
                            top={`${(ROW_H - BAR_H) / 2}px`}
                            left={`${leftPct}%`}
                            width={`${widthPct}%`}
                            h={`${BAR_H}px`}
                            borderRadius="full"
                            bg="neutral.200"
                            overflow="hidden"
                            style={{ maskImage, WebkitMaskImage: maskImage }}
                            boxShadow="sm"
                          >
                            <Box
                              position="absolute"
                              top={0}
                              bottom={0}
                              left={0}
                              w={`${epic.story_total ? epic.progress_pct : 0}%`}
                              bg="brand.500"
                            />
                            {widthPct > 12 && (
                              <Flex
                                position="absolute"
                                inset={0}
                                align="center"
                                justify="center"
                                px={2}
                              >
                                <Text
                                  fontSize="xs"
                                  fontWeight={700}
                                  color="white"
                                  isTruncated
                                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
                                >
                                  {epic.story_done}/{epic.story_total}
                                </Text>
                              </Flex>
                            )}
                          </Box>
                        </Box>
                      </Flex>
                    );
                  })}
                </VStack>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </SimpleLayout>
  );
};

export default RoadmapPage;
