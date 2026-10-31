import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Flex,
  Text,
  Heading,
  Badge,
  HStack,
  IconButton,
  Icon,
  Input,
  InputGroup,
  InputLeftElement,
} from "@chakra-ui/react";
import { FaChevronDown, FaChevronRight, FaSearch, FaSitemap, FaUsers } from "Utils/icons";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector } from "app/hooks";
import { Employee } from "types";
import { getDescendants } from "Utils/orgTree";
import UserAvatar from "Components/UserAvatar";

/** One node in the tree; renders its children recursively. The signed-in user's own node
 * gets a "You" badge + brand-tinted border so they can spot themselves in the full org.
 * A node matching the active name/designation search gets a highlighted name instead. */
const OrgNode: React.FC<{
  emp: Employee;
  childrenOf: Map<string, Employee[]>;
  depth: number;
  reportCount: number;
  selfId?: string;
  expandPath: Set<string>;
  matchIds: Set<string>;
}> = ({ emp, childrenOf, depth, reportCount, selfId, expandPath, matchIds }) => {
  const kids = childrenOf.get(emp.emp_id) || [];
  const isSelf = emp.emp_id === selfId;
  const isMatch = matchIds.has(emp.emp_id);
  const [open, setOpen] = useState(depth < 2 || expandPath.has(emp.emp_id));

  // expandPath grows as the viewer types a search (new ancestors added on every keystroke) —
  // re-open this branch whenever it becomes part of that path, without fighting a manual
  // collapse of branches that aren't on it.
  useEffect(() => {
    if (expandPath.has(emp.emp_id)) setOpen(true);
  }, [expandPath, emp.emp_id]);

  return (
    <Box>
      <Flex
        align="center"
        gap={3}
        bg={isSelf ? "brand.50" : "surface.card"}
        border="1px solid"
        borderColor={isSelf ? "brand.300" : "surface.border"}
        borderRadius="10px"
        px={3}
        py={2}
        _hover={{ borderColor: "brand.300" }}
        transition="border-color 0.12s"
      >
        <IconButton
          aria-label={open ? "Collapse" : "Expand"}
          icon={kids.length ? (open ? <FaChevronDown /> : <FaChevronRight />) : <span />}
          size="xs"
          variant="ghost"
          visibility={kids.length ? "visible" : "hidden"}
          onClick={() => setOpen((o) => !o)}
        />
        <UserAvatar size="sm" name={emp.emp_name} photo={emp.profile_pic} />
        <Box minW={0} flex={1}>
          <HStack spacing={2}>
            <Text
              fontSize="sm"
              fontWeight={700}
              color="neutral.900"
              noOfLines={1}
              bg={isMatch ? "yellow.200" : undefined}
              px={isMatch ? 1 : undefined}
              borderRadius={isMatch ? "4px" : undefined}
            >
              {emp.emp_name}
            </Text>
            {isSelf && (
              <Badge colorScheme="brand" borderRadius="full" fontSize="0.65em" px={2}>
                You
              </Badge>
            )}
          </HStack>
          <Text fontSize="xs" color="neutral.500" noOfLines={1}>
            {emp.emp_designation}
            {emp.emp_department ? ` · ${emp.emp_department}` : ""}
          </Text>
        </Box>
        {reportCount > 0 && (
          <Badge colorScheme="gray" variant="subtle" borderRadius="full" fontSize="0.7em">
            <HStack spacing={1}>
              <Icon as={FaUsers} boxSize="10px" />
              <Text>{reportCount}</Text>
            </HStack>
          </Badge>
        )}
      </Flex>

      {open && kids.length > 0 && (
        <Box pl={5} mt={2} ml={3} borderLeft="2px solid" borderColor="surface.border">
          <Box pl={3} display="flex" flexDirection="column" gap={2}>
            {kids.map((k) => (
              <OrgNode
                key={k.emp_id}
                emp={k}
                childrenOf={childrenOf}
                depth={depth + 1}
                reportCount={(childrenOf.get(k.emp_id) || []).length}
                selfId={selfId}
                expandPath={expandPath}
                matchIds={matchIds}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

const OrganizationPage: React.FC = () => {
  const { currentUser, developers } = useAppSelector((state) => state.scheduler);
  const [search, setSearch] = useState("");

  // Full company hierarchy — visible to everyone (org structure is shared information, not
  // access-gated). Task/timeline data visibility is what stays scoped, not this chart.
  const { root, childrenOf, managerChain, expandPath, byId } = useMemo(() => {
    const byId = new Map(developers.map((d) => [d.emp_id, d]));

    const kids = new Map<string, Employee[]>();
    for (const d of developers) {
      if (d.manager_id && byId.has(d.manager_id)) {
        const arr = kids.get(d.manager_id);
        if (arr) arr.push(d);
        else kids.set(d.manager_id, [d]);
      }
    }
    for (const arr of kids.values()) arr.sort((a, b) => a.emp_name.localeCompare(b.emp_name));

    // The top of the tree: whoever has no manager (or one outside the loaded directory).
    const topLevel = developers.filter((d) => !d.manager_id || !byId.has(d.manager_id));
    const rootEmp = topLevel[0] || (currentUser as Employee | undefined) || null;

    // Manager chain above the current user — the highlighted "reports to" flow bar.
    const chain: Employee[] = [];
    if (currentUser) {
      let m = currentUser.manager_id;
      const seen = new Set<string>();
      while (m && byId.has(m) && !seen.has(m)) {
        seen.add(m);
        const mgr = byId.get(m)!;
        chain.push(mgr);
        m = mgr.manager_id;
      }
    }

    // Auto-expand every ancestor of the current user, so their own node is revealed without
    // manual clicking through a now much bigger, company-wide tree.
    const expand = new Set<string>(chain.map((m) => m.emp_id));

    return { root: rootEmp, childrenOf: kids, managerChain: chain, expandPath: expand, byId };
  }, [currentUser, developers]);

  // Name/designation search — matches highlight in place (hierarchy context around a hit is
  // exactly what finding someone in a large org needs), and every ancestor of a match
  // auto-expands the same way the viewer's own ancestor chain does above, generalized to any
  // matched employee instead of just the signed-in user.
  const { matchIds, searchExpandPath, query } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { matchIds: new Set<string>(), searchExpandPath: new Set<string>(), query: q };

    const matches = developers.filter(
      (d) =>
        d.emp_name.toLowerCase().includes(q) ||
        (d.emp_designation || "").toLowerCase().includes(q),
    );
    const ids = new Set(matches.map((d) => d.emp_id));

    const expand = new Set<string>();
    for (const m of matches) {
      let mgrId = m.manager_id;
      const seen = new Set<string>();
      while (mgrId && byId.has(mgrId) && !seen.has(mgrId)) {
        seen.add(mgrId);
        expand.add(mgrId);
        mgrId = byId.get(mgrId)!.manager_id;
      }
    }

    return { matchIds: ids, searchExpandPath: expand, query: q };
  }, [search, developers, byId]);

  const combinedExpandPath = useMemo(
    () => new Set<string>([...expandPath, ...searchExpandPath]),
    [expandPath, searchExpandPath],
  );

  if (!root) return null;

  const directReports = currentUser ? getDescendants(developers, currentUser.emp_id).size : 0;

  return (
    <SimpleLayout>
      <Box>
        <Flex align="center" gap={3} mb={1}>
          <Icon as={FaSitemap} color="brand.600" boxSize={5} />
          <Heading size="lg" color="neutral.900">
            Organization
          </Heading>
        </Flex>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Full company hierarchy — {developers.length} people.
          {directReports > 0 ? ` You have ${directReports} direct + indirect reports.` : ""}
        </Text>

        <InputGroup maxW="320px" size="sm" mb={query ? 2 : 4}>
          <InputLeftElement pointerEvents="none">
            <Box as={FaSearch} color="neutral.500" boxSize="12px" />
          </InputLeftElement>
          <Input
            placeholder="Search by name or designation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        {query && (
          <Text fontSize="sm" color="neutral.500" mb={4}>
            {matchIds.size > 0
              ? `${matchIds.size} match${matchIds.size === 1 ? "" : "es"} highlighted below.`
              : `No matches for "${search.trim()}".`}
          </Text>
        )}

        {/* Reports-to chain (context) */}
        {managerChain.length > 0 && (
          <Flex align="center" gap={2} mb={5} wrap="wrap" fontSize="sm" color="neutral.500">
            <Text fontWeight={600}>Reports to:</Text>
            {managerChain.map((m, i) => (
              <HStack key={m.emp_id} spacing={1}>
                {i > 0 && <Text color="neutral.300">→</Text>}
                <Badge colorScheme="blue" variant="subtle" borderRadius="full" px={2}>
                  {m.emp_name} ({m.emp_designation})
                </Badge>
              </HStack>
            ))}
          </Flex>
        )}

        <OrgNode
          emp={root}
          childrenOf={childrenOf}
          depth={0}
          reportCount={(childrenOf.get(root.emp_id) || []).length}
          selfId={currentUser?.emp_id}
          expandPath={combinedExpandPath}
          matchIds={matchIds}
        />
      </Box>
    </SimpleLayout>
  );
};

export default OrganizationPage;
