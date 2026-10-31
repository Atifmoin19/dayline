import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  useToast,
  Box,
  Text,
  Flex,
  IconButton,
} from "@chakra-ui/react";
import { FaTimes } from "Utils/icons";
import { useCreateSprintMutation } from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { LABEL_PROPS, softFieldProps } from "Components/Timeline/taskModalStyles";

interface SprintCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new sprint's id right after a successful create, so the caller can e.g.
   * navigate straight to its detail page. */
  onCreated?: (sprintId: string) => void;
}

/**
 * Create-a-new-sprint modal — mirrors `EpicCreationModal`'s single-column layout. Any
 * authenticated user may create a sprint (open, like Epic creation); `created_by` is set
 * server-side from the requester.
 */
const SprintCreationModal: React.FC<SprintCreationModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [createSprint, { isLoading: isSubmitting }] = useCreateSprintMutation();
  const toast = useToast();

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setStartDate("");
    setEndDate("");
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Name is required", status: "error" });
      return;
    }
    if (!startDate || !endDate) {
      toast({ title: "Start and end dates are required", status: "error" });
      return;
    }
    if (endDate <= startDate) {
      toast({ title: "End date must be after the start date", status: "error" });
      return;
    }

    const resp = await createSprint({
      name: name.trim(),
      start_date: new Date(`${startDate}T00:00:00`).toISOString(),
      end_date: new Date(`${endDate}T23:59:59`).toISOString(),
    });
    if (resp?.data) {
      toast({ title: "Sprint created successfully.", status: "success" });
      onCreated?.(resp.data.id);
      onClose();
    } else {
      toast({
        title: "Failed to create sprint",
        description: getApiErrorMessage(resp?.error) || "Please try again.",
        status: "error",
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay bg="rgba(15,23,42,0.3)" backdropFilter="blur(12px)" />
      <ModalContent
        borderRadius="1rem"
        boxShadow="0 32px 64px -12px rgba(0,0,0,0.14)"
        overflow="hidden"
      >
        <Flex justify="space-between" align="start" px={6} py={6} flexShrink={0}>
          <Box>
            <Text fontSize="2xl" fontWeight={700} letterSpacing="-0.01em" color="neutral.900">
              Create Sprint
            </Text>
            <Text fontSize="sm" color="neutral.500" mt={1}>
              A time-boxed cycle tasks can optionally be scoped to.
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
                placeholder="e.g. Sprint 24"
                fontWeight={600}
                {...softFieldProps}
              />
            </FormControl>

            <Flex gap={4}>
              <FormControl flex={1} isRequired>
                <FormLabel {...LABEL_PROPS}>Start Date</FormLabel>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  {...softFieldProps}
                />
              </FormControl>
              <FormControl flex={1} isRequired>
                <FormLabel {...LABEL_PROPS}>End Date</FormLabel>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  {...softFieldProps}
                />
              </FormControl>
            </Flex>
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
            Create Sprint
          </Button>
        </Flex>
      </ModalContent>
    </Modal>
  );
};

export default SprintCreationModal;
