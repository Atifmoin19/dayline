import React, { useMemo, useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Icon,
  Input,
  Select,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
} from "@chakra-ui/react";
import SimpleLayout from "Layouts/simpleLayout";
import { useEmployeeOverviewQuery } from "Services/user.api";
import { FaSearch, FaUsers } from "Utils/icons";
import { capacityStatusColor, capacityStatusLabel } from "Utils/capacity";

const ONBOARDED_FILTERS = [
  { value: "", label: "All" },
  { value: "onboarded", label: "Onboarded" },
  { value: "pending", label: "Pending" },
];

/** Admin-only page (Administration section, same as Create Users/Manage Users/Audit Log) —
 * company-wide employee overview: onboarding status, availability and task-count breakdown
 * per employee. Deliberately not org-tree scoped, unlike every other list view in the app. */
const EmployeeOverviewPage: React.FC = () => {
  const { data, isFetching, isError } = useEmployeeOverviewQuery();
  const [search, setSearch] = useState("");
  const [onboardedFilter, setOnboardedFilter] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.employees ?? []).filter((r) => {
      if (onboardedFilter === "onboarded" && !r.is_onboarded) return false;
      if (onboardedFilter === "pending" && r.is_onboarded) return false;
      if (!q) return true;
      return (
        r.emp_name.toLowerCase().includes(q) ||
        r.emp_id.toLowerCase().includes(q) ||
        (r.emp_designation || "").toLowerCase().includes(q) ||
        (r.emp_department || "").toLowerCase().includes(q)
      );
    });
  }, [data, search, onboardedFilter]);

  return (
    <SimpleLayout>
      <Box p={{ base: 4, md: 8 }}>
        <Flex align="center" gap={3} mb={1}>
          <Icon as={FaUsers} boxSize={5} color="brand.500" />
          <Heading size="lg" color="neutral.900">Employee Overview</Heading>
        </Flex>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Company-wide onboarding status, availability and task load — every employee,
          regardless of reporting line.
        </Text>

        <Flex gap={3} mb={4} wrap="wrap">
          <Flex align="center" bg="white" borderRadius="0.6rem" border="1px solid" borderColor="neutral.200" px={3} flex="1" minW="240px">
            <Icon as={FaSearch} boxSize={3.5} color="neutral.400" mr={2} />
            <Input
              variant="unstyled"
              placeholder="Search name, ID, designation, department"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="sm"
              py={2}
            />
          </Flex>
          <Select
            w="200px"
            bg="white"
            size="sm"
            value={onboardedFilter}
            onChange={(e) => setOnboardedFilter(e.target.value)}
          >
            {ONBOARDED_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </Select>
        </Flex>

        {isFetching ? (
          <Flex justify="center" py={16}><Spinner /></Flex>
        ) : isError ? (
          <Text color="red.500" fontSize="sm">Could not load the employee overview.</Text>
        ) : (
          <Box bg="white" borderRadius="0.75rem" border="1px solid" borderColor="neutral.200" overflowX="auto">
            <Table size="sm">
              <Thead>
                <Tr>
                  <Th>Employee</Th>
                  <Th>Designation</Th>
                  <Th>Department</Th>
                  <Th>Onboarding</Th>
                  <Th isNumeric>Open</Th>
                  <Th isNumeric>In progress</Th>
                  <Th isNumeric>On hold</Th>
                  <Th isNumeric>Done</Th>
                  <Th isNumeric>Overdue</Th>
                  <Th isNumeric>Total</Th>
                  <Th>Availability</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((r) => (
                  <Tr key={r.emp_id}>
                    <Td>
                      <Text fontWeight={600}>{r.emp_name}</Text>
                      <Text fontSize="xs" color="neutral.500">{r.emp_id}</Text>
                    </Td>
                    <Td>{r.emp_designation || "—"}</Td>
                    <Td>{r.emp_department || "—"}</Td>
                    <Td>
                      <Badge colorScheme={r.is_onboarded ? "green" : "orange"}>
                        {r.is_onboarded ? "Onboarded" : "Pending"}
                      </Badge>
                    </Td>
                    <Td isNumeric>{r.tasks.open}</Td>
                    <Td isNumeric>{r.tasks.in_progress}</Td>
                    <Td isNumeric>{r.tasks.on_hold}</Td>
                    <Td isNumeric>{r.tasks.done}</Td>
                    <Td isNumeric>
                      <Text color={r.tasks.overdue > 0 ? "red.500" : "neutral.700"} fontWeight={r.tasks.overdue > 0 ? 700 : 400}>
                        {r.tasks.overdue}
                      </Text>
                    </Td>
                    <Td isNumeric>{r.tasks.total}</Td>
                    <Td>
                      <Badge bg={capacityStatusColor(r.availability_status)} color="white">
                        {capacityStatusLabel(r.availability_status)} · {r.utilization_pct}%
                      </Badge>
                    </Td>
                  </Tr>
                ))}
                {filtered.length === 0 && (
                  <Tr>
                    <Td colSpan={11}>
                      <Text textAlign="center" color="neutral.500" py={6} fontSize="sm">
                        No employees match this filter.
                      </Text>
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>
    </SimpleLayout>
  );
};

export default EmployeeOverviewPage;
