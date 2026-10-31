import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  Button,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Select,
  VStack,
  useToast,
  Box,
  Text,
  Flex,
  IconButton,
} from "@chakra-ui/react";
import { FaTimes } from "Utils/icons";
import { useAppSelector } from "app/hooks";
import { useCreateEpicMutation } from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import AssigneePicker from "Components/Timeline/AssigneePicker";
import { EPIC_STATUS_OPTIONS } from "Utils/epicStatus";
import {
  LABEL_PROPS,
  softFieldProps,
  cardFieldProps,
} from "Components/Timeline/taskModalStyles";

interface EpicCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new epic's id right after a successful create, so the caller can e.g.
   * navigate straight to its detail page. */
  onCreated?: (epicId: string) => void;
}

/**
 * Create-a-new-epic modal — mirrors `TaskCreationModal`'s single-column layout (an epic has far
 * fewer fields than a task, so no left/right split is needed). Any authenticated user may
 * create an epic (open, like task assignment elsewhere); `owner_id` defaults server-side to the
 * creator if left unset here.
 */
const EpicCreationModal: React.FC<EpicCreationModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [createEpic, { isLoading: isSubmitting }] = useCreateEpicMutation();
  const developers = useAppSelector((state) => state.scheduler.developers);
  const currentUser = useAppSelector((state) => state.scheduler.currentUser);
  const toast = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("todo");
  const [department, setDepartment] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    developers.forEach((d) => {
      if (d.emp_department?.trim()) set.add(d.emp_department.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [developers]);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setDescription("");
    setStatus("todo");
    setDepartment("");
    setOwnerId(currentUser?.emp_id || "");
    setStartDate("");
    setTargetDate("");
  }, [isOpen, currentUser]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Name is required", status: "error" });
      return;
    }
    if (startDate && targetDate && targetDate < startDate) {
      toast({ title: "Target date can't be before the start date", status: "error" });
      return;
    }

    const resp = await createEpic({
      name: name.trim(),
      description: description || undefined,
      status,
      department: department || undefined,
      owner_id: ownerId || undefined,
      start_date: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined,
      target_date: targetDate ? new Date(`${targetDate}T23:59:59`).toISOString() : undefined,
    });
    if (resp?.data) {
      toast({ title: "Epic created successfully.", status: "success" });
      onCreated?.(resp.data.id);
      onClose();
    } else {
      toast({
        title: "Failed to create epic",
        description: getApiErrorMessage(resp?.error) || "Please try again.",
        status: "error",
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
      <ModalOverlay bg="rgba(15,23,42,0.3)" backdropFilter="blur(12px)" />
      <ModalContent
        borderRadius="1rem"
        boxShadow="0 32px 64px -12px rgba(0,0,0,0.14)"
        overflow="hidden"
      >
        <Flex justify="space-between" align="start" px={6} py={6} flexShrink={0}>
          <Box>
            <Text fontSize="2xl" fontWeight={700} letterSpacing="-0.01em" color="neutral.900">
              Create Epic
            </Text>
            <Text fontSize="sm" color="neutral.500" mt={1}>
              A cross-team initiative that a set of stories roll up into.
            </Text>
          </Box>
          <IconButton
            aria-label="Close"
            icon={<FaTimes />}
            variant="ghost"
            borderRadius="full"
            onClick={onClose}
            _active={{ transform: "scale(0.95)" }}
          />
        </Flex>

        <Box px={6} pb={6}>
          <VStack spacing={5} align="stretch">
            <FormControl isRequired>
              <FormLabel {...LABEL_PROPS}>Name</FormLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q3 Payments Migration"
                fontWeight={600}
                {...softFieldProps}
              />
            </FormControl>

            <FormControl>
              <FormLabel {...LABEL_PROPS}>Description</FormLabel>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this initiative about?"
                rows={4}
                resize="none"
                {...softFieldProps}
              />
            </FormControl>

            <Flex gap={4}>
              <FormControl flex={1}>
                <FormLabel {...LABEL_PROPS}>Status</FormLabel>
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  {...cardFieldProps}
                >
                  {EPIC_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormControl>
              <FormControl flex={1}>
                <FormLabel {...LABEL_PROPS}>Department</FormLabel>
                <Select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="None"
                  {...cardFieldProps}
                >
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </FormControl>
            </Flex>

            <Flex gap={4}>
              <FormControl flex={1}>
                <FormLabel {...LABEL_PROPS}>Start Date</FormLabel>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  {...cardFieldProps}
                />
              </FormControl>
              <FormControl flex={1}>
                <FormLabel {...LABEL_PROPS}>Target Date</FormLabel>
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  {...cardFieldProps}
                />
              </FormControl>
            </Flex>

            <FormControl>
              <FormLabel {...LABEL_PROPS}>Owner</FormLabel>
              <AssigneePicker
                value={ownerId}
                onChange={setOwnerId}
                developers={developers}
                placeholder="Defaults to you"
              />
            </FormControl>
          </VStack>
        </Box>

        <Flex
          justify="flex-end"
          align="center"
          gap={4}
          px={6}
          py={5}
          borderTop="1px solid"
          borderColor="#f3f4f6"
          bg="rgba(249,250,251,0.5)"
          flexShrink={0}
        >
          <Button
            variant="ghost"
            px={8}
            py={3}
            h="auto"
            borderRadius="0.75rem"
            color="neutral.600"
            fontWeight={600}
            onClick={onClose}
            _hover={{ bg: "neutral.100" }}
            _active={{ transform: "scale(0.95)" }}
          >
            Discard
          </Button>
          <Button
            bg="brand.600"
            color="white"
            px={10}
            py={3}
            h="auto"
            borderRadius="0.75rem"
            fontWeight={600}
            boxShadow="0 8px 20px -4px rgba(37,99,235,0.3)"
            _hover={{ filter: "brightness(1.1)" }}
            _active={{ transform: "scale(0.95)" }}
            onClick={handleSubmit}
            isLoading={isSubmitting}
            loadingText="Creating..."
          >
            Create Epic
          </Button>
        </Flex>
      </ModalContent>
    </Modal>
  );
};

export default EpicCreationModal;
