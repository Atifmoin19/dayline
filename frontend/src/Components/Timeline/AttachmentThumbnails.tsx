import React, { useState } from "react";
import {
  Box,
  Divider,
  SimpleGrid,
  Image,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalCloseButton,
  ModalBody,
  Text,
} from "@chakra-ui/react";
import { useTaskAttachmentsQuery } from "Services/user.api";

interface AttachmentThumbnailsProps {
  taskId: string;
  thumbSize?: string;
  /** Render a leading Divider — only when there's actually something to show below it. */
  withDivider?: boolean;
  /** When provided, clicking a thumbnail reports the preview up to the caller instead of opening
   * a local Modal — required inside a hover-triggered Popover (e.g. TimelineView), where the
   * Popover's own mouseleave-driven auto-close would unmount this component (and any Modal owned
   * by it) as soon as the lightbox's overlay steals the pointer's hit-test out from under the
   * popover. The caller should render the actual lightbox outside the popover's subtree. */
  onPreview?: (preview: { data: string; filename?: string } | null) => void;
}

/** Read-only attachment thumbnail grid + click-to-preview lightbox — for anywhere a task is
 * summarized (timeline popover, pending-tasks modal) but doesn't have the full edit UI. Renders
 * nothing (not even a loading state) until attachments are confirmed present, so it never adds
 * visual noise to tasks with none. */
const AttachmentThumbnails: React.FC<AttachmentThumbnailsProps> = ({
  taskId,
  thumbSize = "44px",
  withDivider,
  onPreview,
}) => {
  const { data: attachments = [] } = useTaskAttachmentsQuery(taskId);
  const [localPreview, setLocalPreview] = useState<{ data: string; filename?: string } | null>(null);
  const setPreview = onPreview || setLocalPreview;

  if (attachments.length === 0) return null;

  return (
    <>
      {withDivider && <Divider />}
      <Box>
        <Text
          fontSize="xs"
          fontWeight={700}
          color="gray.600"
          mb={1}
          textTransform="uppercase"
          letterSpacing="0.04em"
        >
          Attachments ({attachments.length})
        </Text>
        <SimpleGrid columns={6} spacing={1.5}>
          {attachments.map((a) => (
            <Box
              key={a.id}
              role="button"
              tabIndex={0}
              aria-label={`View ${a.filename || "attachment"}`}
              w={thumbSize}
              h={thumbSize}
              borderRadius="md"
              overflow="hidden"
              border="1px solid"
              borderColor="gray.200"
              cursor="pointer"
              _hover={{ borderColor: "blue.300" }}
              _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "1px" }}
              onClick={(e) => {
                e.stopPropagation();
                setPreview({ data: a.data, filename: a.filename });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setPreview({ data: a.data, filename: a.filename });
                }
              }}
            >
              <Image src={a.data} alt={a.filename || "attachment"} w="100%" h="100%" objectFit="cover" />
            </Box>
          ))}
        </SimpleGrid>
      </Box>

      {!onPreview && (
        <Modal isOpen={!!localPreview} onClose={() => setLocalPreview(null)} size="xl" isCentered>
          <ModalOverlay />
          <ModalContent bg="transparent" boxShadow="none" onClick={(e) => e.stopPropagation()}>
            <ModalCloseButton color="white" bg="blackAlpha.600" borderRadius="full" />
            <ModalBody p={0}>
              {localPreview && (
                <Image src={localPreview.data} alt={localPreview.filename || "attachment"} maxH="80vh" mx="auto" borderRadius="md" />
              )}
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default AttachmentThumbnails;
