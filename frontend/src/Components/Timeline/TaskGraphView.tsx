import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Flex, IconButton, Spinner, Text, Portal } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { FaSitemap, FaTimes } from "Utils/icons";
import { useTaskGraphQuery } from "Services/user.api";
import { getPriorityColor } from "Utils/priority";
import { TaskGraphNode } from "types";

const NODE_W = 168;
const NODE_H = 56;
const COL_GAP = 96;
const ROW_GAP = 24;
const PADDING = 32;

interface LaidOutNode extends TaskGraphNode {
  x: number;
  y: number;
}

/** Simple BFS-layered layout: nodes are placed in columns by hop-distance from `rootId`,
 * stacked vertically within their column. Good enough for "a simple node/edge render"
 * (scale-gaps-plan.md §A.6) — this isn't trying to be a general graph-drawing engine, just
 * legible for the story/epic-sized link sets this endpoint actually returns. */
function layoutGraph(
  nodes: TaskGraphNode[],
  edges: { from_task_id: string; to_task_id: string }[],
  rootId: string,
): { laidOut: LaidOutNode[]; width: number; height: number } {
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    adjacency.get(e.from_task_id)?.push(e.to_task_id);
    adjacency.get(e.to_task_id)?.push(e.from_task_id);
  }

  const level = new Map<string, number>();
  level.set(rootId, 0);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift() as string;
    const curLevel = level.get(cur) ?? 0;
    for (const next of adjacency.get(cur) || []) {
      if (!level.has(next)) {
        level.set(next, curLevel + 1);
        queue.push(next);
      }
    }
  }
  // Anything unreached (shouldn't happen — the backend only returns the connected
  // component reachable from rootId) still gets placed rather than silently dropped.
  let maxLevel = 0;
  for (const v of level.values()) maxLevel = Math.max(maxLevel, v);
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, maxLevel + 1);
  }

  const byLevel = new Map<number, TaskGraphNode[]>();
  for (const n of nodes) {
    const l = level.get(n.id) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)?.push(n);
  }

  const laidOut: LaidOutNode[] = [];
  let maxRows = 1;
  for (const [l, rowNodes] of byLevel.entries()) {
    maxRows = Math.max(maxRows, rowNodes.length);
    rowNodes.forEach((n, i) => {
      laidOut.push({
        ...n,
        x: PADDING + l * (NODE_W + COL_GAP),
        y: PADDING + i * (NODE_H + ROW_GAP),
      });
    });
  }

  const width = PADDING * 2 + (byLevel.size || 1) * NODE_W + (byLevel.size - 1) * COL_GAP;
  const height = PADDING * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  return { laidOut, width: Math.max(width, 400), height: Math.max(height, 200) };
}

const STATUS_FILL: Record<string, string> = {
  done: "#dcfce7",
  completed: "#dcfce7",
  "in-progress": "#dbeafe",
  "on-hold": "#fef9c3",
  backlog: "#fed7aa",
};

const EDGE_COLOR: Record<string, string> = {
  subtask: "#93c5fd",
  depends_on: "#9ca3af",
};

/** Entry point + the graph overlay itself. A custom Portal overlay (not a Chakra <Modal>) —
 * same reasoning as TaskAttachments' lightbox: this can be opened from inside
 * TaskDetailModal, and nesting a real Chakra <Modal> inside another one already caused a
 * documented modalManager/focus-trap conflict elsewhere in this app. */
const TaskGraphView: React.FC<{ taskId: string }> = ({ taskId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const { data, isLoading } = useTaskGraphQuery(taskId, { skip: !isOpen || !taskId });

  const layout = useMemo(() => {
    if (!data) return null;
    return layoutGraph(data.nodes, data.edges, taskId);
  }, [data, taskId]);

  const open = () => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [isOpen]);

  const goToTask = (id: string) => {
    close();
    navigate(`/tasks/${id}`);
  };

  const nodeById = new Map((layout?.laidOut || []).map((n) => [n.id, n]));

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        leftIcon={<FaSitemap />}
        color="brand.600"
        onClick={open}
      >
        View graph
      </Button>

      {isOpen && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            zIndex="modal"
            bg="blackAlpha.700"
            display="flex"
            alignItems="center"
            justifyContent="center"
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-label={`Dependency graph for ${taskId}`}
          >
            <IconButton
              ref={closeButtonRef}
              aria-label="Close graph"
              icon={<FaTimes />}
              onClick={close}
              position="fixed"
              top={4}
              right={4}
              color="white"
              bg="blackAlpha.600"
              borderRadius="full"
              _hover={{ bg: "blackAlpha.800" }}
            />
            <Box
              bg="white"
              borderRadius="lg"
              p={6}
              maxW="90vw"
              maxH="85vh"
              overflow="auto"
              onClick={(e) => e.stopPropagation()}
            >
              <Text fontWeight={700} color="neutral.800" mb={3}>
                Dependency graph
              </Text>
              {isLoading || !layout ? (
                <Flex justify="center" py={10} minW="300px">
                  <Spinner />
                </Flex>
              ) : (
                <>
                  <svg width={layout.width} height={layout.height}>
                    <defs>
                      <marker
                        id="graph-arrow"
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                      >
                        <path d="M0,0 L8,4 L0,8 Z" fill="#9ca3af" />
                      </marker>
                    </defs>
                    {data?.edges.map((e) => {
                      const from = nodeById.get(e.from_task_id);
                      const to = nodeById.get(e.to_task_id);
                      if (!from || !to) return null;
                      const x1 = from.x + NODE_W;
                      const y1 = from.y + NODE_H / 2;
                      const x2 = to.x;
                      const y2 = to.y + NODE_H / 2;
                      return (
                        <line
                          key={e.id}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke={EDGE_COLOR[e.link_type] || "#9ca3af"}
                          strokeWidth={2}
                          markerEnd="url(#graph-arrow)"
                        />
                      );
                    })}
                    {layout.laidOut.map((n) => (
                      <g
                        key={n.id}
                        transform={`translate(${n.x}, ${n.y})`}
                        style={{ cursor: "pointer" }}
                        onClick={() => goToTask(n.id)}
                      >
                        <rect
                          width={NODE_W}
                          height={NODE_H}
                          rx={8}
                          fill={STATUS_FILL[(n.task_status || "").toLowerCase()] || "#f3f4f6"}
                          stroke={n.id === taskId ? "#2563eb" : "#d1d5db"}
                          strokeWidth={n.id === taskId ? 2 : 1}
                        />
                        <text x={8} y={20} fontSize={11} fontWeight={700} fill="#374151">
                          {n.ticket_id || n.id.slice(0, 8)}
                        </text>
                        <text x={8} y={38} fontSize={11} fill="#4b5563">
                          {(n.task_name || "").slice(0, 22)}
                          {(n.task_name || "").length > 22 ? "…" : ""}
                        </text>
                        {n.task_priority && (
                          <text
                            x={NODE_W - 8}
                            y={20}
                            fontSize={10}
                            fontWeight={700}
                            textAnchor="end"
                            fill={`var(--chakra-colors-${getPriorityColor(n.task_priority)}-600, #4b5563)`}
                          >
                            {n.task_priority}
                          </text>
                        )}
                      </g>
                    ))}
                  </svg>
                  {data?.truncated && (
                    <Text fontSize="xs" color="orange.600" mt={2}>
                      Graph truncated — this link web is larger than what fits in one view.
                    </Text>
                  )}
                </>
              )}
            </Box>
          </Box>
        </Portal>
      )}
    </>
  );
};

export default TaskGraphView;
