import React, { useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Icon,
  Select,
  Input,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Spinner,
  Code,
} from "@chakra-ui/react";
import SimpleLayout from "Layouts/simpleLayout";
import { useAuditLogQuery } from "Services/user.api";
import { FaHistory } from "Utils/icons";

const ACTIONS = [
  { value: "", label: "All actions" },
  { value: "user.create", label: "User created" },
  { value: "user.update", label: "User updated" },
  { value: "user.delete", label: "User deleted" },
  { value: "user.bulk_delete", label: "Users bulk-deleted" },
  { value: "user.csv_import", label: "User CSV import" },
  { value: "task.csv_import", label: "Task CSV import" },
];

const PAGE_SIZE = 25;

/** Org-wide log of admin actions (scale-gaps-plan.md Phase 3, item 2) — a compliance gap this
 * app previously had no cross-cutting answer for (only per-task activity existed, via
 * `task_comments.is_system`). Read-only: nothing here is ever edited or deleted, matching the
 * backend's append-only `audit_log` table. */
const AuditLogPage: React.FC = () => {
  const [action, setAction] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, isFetching, isError, refetch } = useAuditLogQuery({
    action: action || undefined,
    actor_emp_id: actorFilter.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  const resetToFirstPage = () => setOffset(0);

  return (
    <SimpleLayout>
      <Box>
        <Flex align="center" justify="space-between" mb={1} wrap="wrap" gap={3}>
          <Flex align="center" gap={3}>
            <Icon as={FaHistory} color="brand.600" boxSize={5} />
            <Heading size="lg" color="neutral.900">
              Audit Log
            </Heading>
          </Flex>
          <Button variant="outline" onClick={() => refetch()} isLoading={isFetching}>
            Refresh
          </Button>
        </Flex>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Org-wide record of admin actions — user create/update/delete, bulk operations, and CSV
          imports. Append-only.
        </Text>

        <Flex gap={3} mb={4} wrap="wrap">
          <Select
            maxW="240px"
            bg="neutral.50"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              resetToFirstPage();
            }}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          <Input
            maxW="200px"
            bg="neutral.50"
            placeholder="Actor emp_id"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            onBlur={resetToFirstPage}
            onKeyDown={(e) => e.key === "Enter" && resetToFirstPage()}
          />
        </Flex>

        <Box
          bg="surface.card"
          border="1px solid"
          borderColor="surface.border"
          borderRadius="card"
          boxShadow="card"
          overflow="hidden"
        >
          {isFetching && entries.length === 0 ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={3}>
              <Spinner />
              <Text color="neutral.500" fontSize="sm">
                Loading audit log…
              </Text>
            </Flex>
          ) : isError ? (
            <Flex align="center" justify="center" py={16} direction="column" gap={2}>
              <Text color="neutral.700" fontWeight={600}>
                Audit log unavailable
              </Text>
              <Text color="neutral.500" fontSize="sm">
                Couldn't load the audit log right now. Try refreshing the page.
              </Text>
            </Flex>
          ) : entries.length === 0 ? (
            <Flex align="center" justify="center" py={16}>
              <Text color="neutral.500" fontSize="sm">
                No matching entries.
              </Text>
            </Flex>
          ) : (
            <Box overflowX="auto" w="100%">
              <Table variant="unstyled" sx={{ width: "max-content", minWidth: "100%" }}>
                <Thead bg="neutral.50">
                  <Tr>
                    {["Time", "Actor", "Action", "Target", "Details"].map((h) => (
                      <Th key={h} py={3.5} fontSize="xs" color="neutral.500" letterSpacing="0.04em">
                        {h}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {entries.map((e) => (
                    <Tr key={e.id} borderTop="1px solid" borderColor="surface.border">
                      <Td py={3} whiteSpace="nowrap" fontSize="sm" color="neutral.700">
                        {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                      </Td>
                      <Td whiteSpace="nowrap">
                        <Text fontSize="sm" fontWeight={600} color="neutral.900">
                          {e.actor_name || e.actor_emp_id || "—"}
                        </Text>
                        {e.actor_designation && (
                          <Text fontSize="xs" color="neutral.500">
                            {e.actor_designation}
                          </Text>
                        )}
                      </Td>
                      <Td whiteSpace="nowrap" fontSize="sm" color="neutral.700">
                        {ACTIONS.find((a) => a.value === e.action)?.label || e.action}
                      </Td>
                      <Td whiteSpace="nowrap" fontSize="sm" color="neutral.700">
                        {e.target_id ? `${e.target_type || ""} ${e.target_id}`.trim() : "—"}
                      </Td>
                      <Td maxW="420px">
                        {e.details ? (
                          <Code fontSize="xs" whiteSpace="pre-wrap" wordBreak="break-word" bg="neutral.50">
                            {JSON.stringify(e.details)}
                          </Code>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          )}
        </Box>

        {total > 0 && (
          <Flex align="center" justify="space-between" mt={4}>
            <Text fontSize="sm" color="neutral.500">
              {rangeStart}–{rangeEnd} of {total}
            </Text>
            <Flex gap={2}>
              <Button
                size="sm"
                variant="outline"
                isDisabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                isDisabled={rangeEnd >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </Flex>
          </Flex>
        )}
      </Box>
    </SimpleLayout>
  );
};

export default AuditLogPage;
