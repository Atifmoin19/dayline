import React from "react";
import { Modal, ModalOverlay, ModalContent } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { Task } from "types";
import TaskDetailForm from "Components/Timeline/TaskDetailForm";

interface TaskDetailModalProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal chrome around the shared `TaskDetailForm` — the single place a task is opened from
 * anywhere in the app (pending tasks, timeline, week/calendar, task list). "Maximize" swaps
 * to the identical form rendered full-page at `/tasks/:id` (see `TaskDetailPage`), so there's
 * no separate "page version" of the fields to keep in sync.
 */
const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();

  const handleMaximize = () => {
    if (!task) return;
    onClose();
    navigate(`/tasks/${task.id}`);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" scrollBehavior="inside">
      <ModalOverlay bg="rgba(15,23,42,0.3)" backdropFilter="blur(12px)" />
      {task && (
        <ModalContent
          borderRadius="1rem"
          boxShadow="0 32px 64px -12px rgba(0,0,0,0.14)"
          overflow="hidden"
          h={{ base: "100vh", md: "85vh" }}
          maxH="85vh"
          display="flex"
          flexDirection="column"
        >
          <TaskDetailForm
            task={task}
            onClose={onClose}
            onMaximize={handleMaximize}
          />
        </ModalContent>
      )}
    </Modal>
  );
};

export default TaskDetailModal;
