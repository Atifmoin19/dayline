import React from "react";
import { Select } from "@chakra-ui/react";
import { useEpicListQuery } from "Services/user.api";
import { cardFieldProps } from "Components/Timeline/taskModalStyles";

interface EpicPickerProps {
  value?: string; // epic id, "" = none
  onChange: (epicId: string | undefined) => void;
  isDisabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Plain `<Select>` over the company-wide epic list (dozens, not thousands, per Epic's own
 * scope — unlike `AssigneePicker`'s org directory, a searchable combobox isn't warranted here).
 * Used from both the create-task modal and the task-detail sidebar to optionally link a
 * top-level story to an Epic. Never rendered for a subtask (only a story can carry `epic_id`).
 * Carries the same `cardFieldProps` treatment as the sidebar's other structured fields
 * (Priority/Status) so it doesn't need re-styling at every call site.
 */
const EpicPicker: React.FC<EpicPickerProps> = ({
  value,
  onChange,
  isDisabled,
  size,
}) => {
  const { data: epics = [], isFetching } = useEpicListQuery();

  return (
    <Select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      isDisabled={isDisabled || isFetching}
      size={size}
      {...cardFieldProps}
    >
      <option value="">None</option>
      {epics.map((epic) => (
        <option key={epic.id} value={epic.id}>
          {epic.ticket_id ? `${epic.ticket_id} — ${epic.name}` : epic.name}
        </option>
      ))}
    </Select>
  );
};

export default EpicPicker;
