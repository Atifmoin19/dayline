import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Flex,
  Text,
  Button,
  SimpleGrid,
  IconButton,
  Image,
  Spinner,
  useToast,
  useDisclosure,
  Portal,
} from "@chakra-ui/react";
import { FaCloudUploadAlt, FaTrash, FaTimes } from "Utils/icons";
import {
  useTaskAttachmentsQuery,
  useAddTaskAttachmentMutation,
  useDeleteTaskAttachmentMutation,
} from "Services/user.api";
import { StagedAttachment } from "types";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, toDataUri } from "Utils/attachments";
import { getApiErrorMessage } from "Services/baseQuery";

/** A row shape both live (server) and staged (local, pre-create) attachments share for render. */
type Row = { key: string; filename?: string; data: string };

interface TaskAttachmentsProps {
  /** Live mode: an existing task — fetches/uploads/deletes via the API. */
  taskId?: string;
  /** Staged mode: no task yet (create flow) — held locally until the task is created. */
  staged?: StagedAttachment[];
  onStagedChange?: (files: StagedAttachment[]) => void;
  /** "compact" (default) = small inline header + "Add image" button, used in TaskDetailModal.
   * "dropzone" = a big drag-and-drop target with no internal header, used in the create-task
   * modal ("Reference Materials" per the Stitch mockup) — the caller supplies its own label. */
  variant?: "compact" | "dropzone";
}

/** Task image attachments — stored inline as base64 (no object storage). Upload, thumbnail
 * grid with a lightbox preview, and delete. In "staged" mode (no taskId yet, i.e. the
 * create-task form) files are held client-side and handed back via onStagedChange; the
 * caller uploads them to the real task right after creation succeeds. */
const TaskAttachments: React.FC<TaskAttachmentsProps> = ({
  taskId,
  staged,
  onStagedChange,
  variant = "compact",
}) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [dragOver, setDragOver] = useState(false);
  const isStaged = !taskId;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const { data: liveAttachments = [], isLoading } = useTaskAttachmentsQuery(taskId as string, {
    skip: !taskId,
  });
  const [addAttachment, { isLoading: uploading }] = useAddTaskAttachmentMutation();
  const [deleteAttachment] = useDeleteTaskAttachmentMutation();

  const rows: Row[] = isStaged
    ? (staged || []).map((s) => ({ key: s.localId, filename: s.filename, data: s.data }))
    : liveAttachments.map((a) => ({ key: String(a.id), filename: a.filename, data: a.data }));

  const validate = (file: File): string | null => {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) return `${file.name}: only image files are allowed`;
    if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name}: exceeds 5MB limit`;
    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const err = validate(file);
      if (err) {
        toast({ title: err, status: "error" });
        continue;
      }
      const data = await toDataUri(file);
      if (isStaged) {
        onStagedChange?.([
          ...(staged || []),
          { localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, filename: file.name, content_type: file.type, data },
        ]);
      } else {
        try {
          await addAttachment({ taskId: taskId as string, filename: file.name, content_type: file.type, data }).unwrap();
        } catch (err) {
          toast({
            title: `Failed to upload ${file.name}`,
            description: getApiErrorMessage(err),
            status: "error",
          });
        }
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const remove = async (row: Row) => {
    if (isStaged) {
      onStagedChange?.((staged || []).filter((s) => s.localId !== row.key));
      return;
    }
    try {
      await deleteAttachment({ id: Number(row.key), taskId: taskId as string }).unwrap();
    } catch {
      toast({ title: "Failed to delete attachment", status: "error" });
    }
  };

  const openPreview = (row: Row) => {
    // Remember what had focus so it can be restored when the lightbox closes (it's a
    // custom Portal overlay, not a Chakra <Modal>, so none of this comes for free).
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setPreview(row);
    onOpen();
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // Plain Escape-to-close for the lightbox — it's a custom Portal overlay (not a Chakra
  // <Modal>) specifically so it can be nested inside TaskDetailModal without Chakra's
  // modalManager/aria-hidden treating the click that opens it as an outside-click on the
  // OUTER modal and closing that instead (a known nested-Modal interaction).
  //
  // Because it's not a real Chakra <Modal>, none of the focus handling is free either:
  // the close button is the only focusable element in the overlay, so on open we move
  // focus there, and — since Tab has nowhere else to go — every Tab/Shift+Tab just keeps
  // focus pinned on it (a trivial one-control focus trap). On close, focus returns to
  // whatever triggered the preview (the clicked thumbnail).
  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      hidden
      onChange={(e) => handleFiles(e.target.files)}
    />
  );

  const thumbnailGrid = rows.length > 0 && (
    <SimpleGrid columns={{ base: 3, sm: 4, md: 6 }} spacing={3}>
      {rows.map((row) => (
        <Box
          key={row.key}
          role="button"
          tabIndex={0}
          aria-label={`View ${row.filename || "attachment"}`}
          position="relative"
          borderRadius="md"
          overflow="hidden"
          border="1px solid"
          borderColor="surface.border"
          cursor="pointer"
          _hover={{ borderColor: "brand.300" }}
          _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "1px" }}
          aspectRatio={1}
          onClick={() => openPreview(row)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPreview(row);
            }
          }}
        >
          <Image src={row.data} alt={row.filename || "attachment"} w="100%" h="100%" objectFit="cover" />
          <IconButton
            aria-label="Delete attachment"
            icon={<FaTrash />}
            size="xs"
            colorScheme="red"
            variant="solid"
            position="absolute"
            top={1}
            right={1}
            opacity={0.85}
            onClick={(e) => {
              e.stopPropagation();
              remove(row);
            }}
          />
        </Box>
      ))}
    </SimpleGrid>
  );

  return (
    <Box>
      {variant === "compact" && (
        <Flex justify="space-between" align="center" mb={3}>
          <Text
            fontSize="sm"
            fontWeight={700}
            color="neutral.500"
            textTransform="uppercase"
            letterSpacing="0.04em"
          >
            Attachments {rows.length > 0 ? `(${rows.length})` : ""}
          </Text>
          <Button
            size="xs"
            variant="outline"
            leftIcon={<FaCloudUploadAlt />}
            isLoading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            Add image
          </Button>
          {hiddenInput}
        </Flex>
      )}

      {variant === "compact" ? (
        !isStaged && isLoading ? (
          <Flex justify="center" py={4}>
            <Spinner size="sm" />
          </Flex>
        ) : rows.length === 0 ? (
          <Text fontSize="sm" color="neutral.500">
            {isStaged ? "Add images now, or later once the task exists." : "No attachments yet."}
          </Text>
        ) : (
          thumbnailGrid
        )
      ) : (
        <Box>
          {rows.length === 0 ? (
            <Box
              // `data-group` (not `role="group"`) so `_groupHover` below still works while
              // the actual ARIA role reflects what this element does — open the file picker.
              data-group=""
              role="button"
              tabIndex={0}
              aria-label="Drop files here or browse files, max 5MB per file"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              cursor="pointer"
              border="2px dashed"
              borderColor={dragOver ? "brand.400" : "#e5e7eb"}
              bg={dragOver ? "brand.50" : "#f9fafb"}
              borderRadius="0.75rem"
              p={8}
              textAlign="center"
              transition="all 0.15s"
              _hover={{ bg: "rgba(243,244,246,0.5)", borderColor: "brand.300" }}
              _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "2px" }}
            >
              <Flex
                w={12}
                h={12}
                mx="auto"
                mb={4}
                align="center"
                justify="center"
                borderRadius="full"
                bg="white"
                boxShadow="sm"
                color="brand.600"
                fontSize="xl"
                transition="transform 0.15s"
                _groupHover={{ transform: "scale(1.1)" }}
              >
                <FaCloudUploadAlt />
              </Flex>
              <Text fontSize="sm" color="neutral.600">
                Drop files here or{" "}
                <Text as="span" color="brand.600" fontWeight={600}>
                  browse files
                </Text>
              </Text>
              <Text fontSize="xs" color="neutral.500" mt={1}>
                Max 5MB per file
              </Text>
              {hiddenInput}
            </Box>
          ) : (
            <>
              {thumbnailGrid}
              <Button
                size="xs"
                variant="outline"
                leftIcon={<FaCloudUploadAlt />}
                isLoading={uploading}
                onClick={() => fileInputRef.current?.click()}
                mt={3}
              >
                Add more
              </Button>
              {hiddenInput}
            </>
          )}
        </Box>
      )}

      {isOpen && preview && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            zIndex="modal"
            bg="blackAlpha.700"
            display="flex"
            alignItems="center"
            justifyContent="center"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={`Preview: ${preview.filename || "attachment"}`}
          >
            <IconButton
              ref={closeButtonRef}
              aria-label="Close preview"
              icon={<FaTimes />}
              onClick={onClose}
              position="fixed"
              top={4}
              right={4}
              color="white"
              bg="blackAlpha.600"
              borderRadius="full"
              _hover={{ bg: "blackAlpha.800" }}
            />
            <Image
              src={preview.data}
              alt={preview.filename || "attachment"}
              maxH="80vh"
              maxW="90vw"
              borderRadius="md"
              onClick={(e) => e.stopPropagation()}
            />
          </Box>
        </Portal>
      )}
    </Box>
  );
};

export default TaskAttachments;
