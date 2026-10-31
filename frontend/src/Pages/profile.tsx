import React, { useState } from "react";
import {
  Box,
  Container,
  Flex,
  Heading,
  Text,
  Badge,
  SimpleGrid,
  HStack,
  VStack,
  Divider,
  Icon,
  Button,
  Input,
  FormControl,
  FormLabel,
  useToast,
  Link as CLink,
  Wrap,
  WrapItem,
} from "@chakra-ui/react";
import {
  FaEnvelope,
  FaPhone,
  FaBuilding,
  FaUserTie,
  FaMapMarkerAlt,
  FaCalendarAlt,
  FaTint,
  FaGraduationCap,
  FaLinkedin,
  FaEdit,
  FaCheck,
  FaTimes,
  FaIdBadge,
} from "Utils/icons";
import SimpleLayout from "Layouts/simpleLayout";
import { useAppSelector, useAppDispatch } from "app/hooks";
import { useTaskListQuery, useUpdateProfileMutation } from "Services/user.api";
import { setCurrentUser } from "app/slices/scheduler.slice";
import { formatDuration } from "Utils/common";
import UserAvatar from "Components/UserAvatar";
import { Employee } from "types";
import type { IconType } from "react-icons";

const StatCard: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label,
  value,
  color = "neutral.900",
}) => (
  <Box bg="surface.card" border="1px solid" borderColor="surface.border" borderRadius="card" boxShadow="card" p={5}>
    <Text fontSize="2xl" fontWeight={700} color={color} lineHeight="1.1">
      {value}
    </Text>
    <Text fontSize="xs" color="neutral.500" mt={1} textTransform="uppercase" letterSpacing="0.04em">
      {label}
    </Text>
  </Box>
);

const InfoRow: React.FC<{ icon: IconType; label: string; value?: React.ReactNode }> = ({ icon, label, value }) => (
  <Flex align="center" gap={3} py={2}>
    <Icon as={icon} color="neutral.500" boxSize={4} />
    <Box minW={0}>
      <Text fontSize="xs" color="neutral.500">
        {label}
      </Text>
      <Box fontSize="sm" fontWeight={500} color="neutral.800">
        {value || "—"}
      </Box>
    </Box>
  </Flex>
);

/** Tenure in years from a "DD-MM-YYYY" joining date (best-effort). */
const tenureYears = (doj?: string): string | null => {
  if (!doj) return null;
  const m = doj.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const start = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (isNaN(start.getTime())) return null;
  const yrs = (Date.now() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
  return yrs >= 0 ? `${yrs.toFixed(1)} yrs` : null;
};

const EDITABLE_FIELDS = [
  ["emp_phone", "Phone"],
  ["work_location", "Work Location"],
  ["linkedin", "LinkedIn URL"],
  ["blood_group", "Blood Group"],
  ["gender", "Gender"],
  ["date_of_birth", "Date of Birth (DD-MM-YYYY)"],
  ["profile_pic", "Photo URL"],
] as const;

const ProfilePage: React.FC = () => {
  const { currentUser, developers } = useAppSelector((state) => state.scheduler);
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [updateProfile, { isLoading: saving }] = useUpdateProfileMutation();

  const { data: taskData } = useTaskListQuery(
    currentUser ? { user_id: currentUser.emp_id } : {},
    { refetchOnMountOrArgChange: true, skip: !currentUser },
  );
  const myTasks = React.useMemo(
    () => (!taskData ? [] : Array.isArray(taskData) ? taskData : taskData.items ?? []),
    [taskData],
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  if (!currentUser) return null;

  const manager = developers.find((d) => d.emp_id === currentUser.manager_id);

  const countBy = (statuses: string[]) =>
    myTasks.filter((t) => statuses.includes((t.task_status || "").toLowerCase())).length;
  const inProgress = countBy(["in-progress", "in progress"]);
  const done = countBy(["done", "completed"]);
  const onHold = countBy(["on-hold", "on hold"]);
  const pending = countBy(["todo", "backlog"]);
  const totalSpent = myTasks.reduce((s, t) => s + (Number(t.time_spent) || 0), 0);

  const startEdit = () => {
    setForm(
      EDITABLE_FIELDS.reduce((acc, [k]) => {
        acc[k] = currentUser[k] || "";
        return acc;
      }, {} as Record<string, string>),
    );
    setEditing(true);
  };

  const save = async () => {
    try {
      const resp = await updateProfile(form as Partial<Employee>).unwrap();
      dispatch(setCurrentUser({ ...(currentUser as Employee), ...(resp || form) }));
      toast({ title: "Profile updated", status: "success", duration: 2000 });
      setEditing(false);
    } catch {
      toast({ title: "Couldn't update profile", status: "error", duration: 3000 });
    }
  };

  const tenure = tenureYears(currentUser.date_of_joining);

  return (
    <SimpleLayout hideSidebar>
      <Container maxW="container.lg" py={2}>
        {/* Identity header */}
        <Flex
          bg="surface.card"
          border="1px solid"
          borderColor="surface.border"
          borderRadius="card"
          boxShadow="card"
          p={6}
          align="center"
          gap={5}
          mb={6}
          wrap="wrap"
        >
          <UserAvatar size="xl" name={currentUser.emp_name} photo={currentUser.profile_pic} />
          <Box flex={1} minW="200px">
            <Heading size="lg" color="neutral.900">
              {currentUser.emp_name}
            </Heading>
            <Wrap mt={2} spacing={2} align="center">
              <WrapItem>
                <Badge colorScheme="blue" borderRadius="full" px={2}>
                  {currentUser.emp_designation}
                </Badge>
              </WrapItem>
              {currentUser.emp_department && (
                <WrapItem>
                  <Text fontSize="sm" color="neutral.500">
                    {currentUser.emp_department}
                  </Text>
                </WrapItem>
              )}
              <WrapItem>
                <Text fontSize="sm" color="neutral.500">
                  {currentUser.emp_id}
                </Text>
              </WrapItem>
            </Wrap>
          </Box>
          {!editing ? (
            <Button leftIcon={<FaEdit />} variant="outline" size="sm" onClick={startEdit}>
              Edit profile
            </Button>
          ) : (
            <HStack>
              <Button leftIcon={<FaCheck />} colorScheme="brand" size="sm" isLoading={saving} onClick={save}>
                Save
              </Button>
              <Button leftIcon={<FaTimes />} variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </HStack>
          )}
        </Flex>

        {/* Task stats */}
        <SimpleGrid columns={{ base: 2, md: 5 }} spacing={4} mb={6}>
          <StatCard label="In Progress" value={inProgress} color="blue.500" />
          <StatCard label="Pending" value={pending} color="orange.500" />
          <StatCard label="On Hold" value={onHold} color="yellow.500" />
          <StatCard label="Completed" value={done} color="green.500" />
          <StatCard label="Time Logged" value={formatDuration(totalSpent)} />
        </SimpleGrid>

        {editing ? (
          /* Edit form */
          <Box bg="surface.card" border="1px solid" borderColor="surface.border" borderRadius="card" boxShadow="card" p={6}>
            <Text fontSize="sm" fontWeight={700} color="neutral.500" textTransform="uppercase" letterSpacing="0.04em" mb={4}>
              Edit your details
            </Text>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              {EDITABLE_FIELDS.map(([key, label]) => (
                <FormControl key={key}>
                  <FormLabel fontSize="sm" color="neutral.600">
                    {label}
                  </FormLabel>
                  <Input
                    size="sm"
                    value={form[key] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </FormControl>
              ))}
            </SimpleGrid>
            <Text fontSize="xs" color="neutral.500" mt={4}>
              Name, ID, designation, department and manager are managed by HR and can't be edited here.
            </Text>
          </Box>
        ) : (
          /* Read-only details */
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
            <Box bg="surface.card" border="1px solid" borderColor="surface.border" borderRadius="card" boxShadow="card" p={6}>
              <Text fontSize="sm" fontWeight={700} color="neutral.500" textTransform="uppercase" letterSpacing="0.04em" mb={2}>
                Contact & Role
              </Text>
              <VStack align="stretch" spacing={0} divider={<Divider borderColor="surface.border" />}>
                <InfoRow icon={FaEnvelope} label="Email" value={currentUser.emp_email} />
                <InfoRow icon={FaPhone} label="Phone" value={currentUser.emp_phone} />
                <InfoRow icon={FaBuilding} label="Department" value={currentUser.emp_department} />
                <InfoRow icon={FaIdBadge} label="Company" value={currentUser.company || currentUser.legal_entity} />
                <InfoRow icon={FaMapMarkerAlt} label="Work Location" value={currentUser.work_location} />
                <InfoRow
                  icon={FaUserTie}
                  label="Reports to"
                  value={manager ? `${manager.emp_name} (${manager.emp_designation})` : currentUser.manager_id || "—"}
                />
              </VStack>
            </Box>

            <Box bg="surface.card" border="1px solid" borderColor="surface.border" borderRadius="card" boxShadow="card" p={6}>
              <Text fontSize="sm" fontWeight={700} color="neutral.500" textTransform="uppercase" letterSpacing="0.04em" mb={2}>
                Personal
              </Text>
              <VStack align="stretch" spacing={0} divider={<Divider borderColor="surface.border" />}>
                <InfoRow
                  icon={FaCalendarAlt}
                  label="Joined"
                  value={currentUser.date_of_joining ? `${currentUser.date_of_joining}${tenure ? ` · ${tenure}` : ""}` : undefined}
                />
                <InfoRow icon={FaCalendarAlt} label="Date of Birth" value={currentUser.date_of_birth} />
                <InfoRow icon={FaTint} label="Blood Group" value={currentUser.blood_group} />
                <InfoRow icon={FaGraduationCap} label="Education" value={(currentUser.education || []).join(", ") || undefined} />
                <InfoRow
                  icon={FaLinkedin}
                  label="LinkedIn"
                  value={
                    currentUser.linkedin ? (
                      <CLink href={currentUser.linkedin} color="brand.600" isExternal noOfLines={1}>
                        {currentUser.linkedin}
                      </CLink>
                    ) : undefined
                  }
                />
              </VStack>
            </Box>
          </SimpleGrid>
        )}
      </Container>
    </SimpleLayout>
  );
};

export default ProfilePage;
