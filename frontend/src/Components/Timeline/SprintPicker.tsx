import React from "react";
import { Select } from "@chakra-ui/react";
import { useSprintListQuery } from "Services/user.api";
import { cardFieldProps } from "Components/Timeline/taskModalStyles";

interface SprintPickerProps {
  value?: string; // sprint id, "" = none
  onChange: (sprintId: string | undefined) => void;
  isDisabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Plain `<Select>` over the company-wide sprint list — mirrors `EpicPicker` exactly (same
 * "dozens, not thousands" scope reasoning). Used from both the create-task modal and the
 * task-detail sidebar to optionally scope a task to a Sprint/Cycle. Independent of Epic: a
 * sprint is a slice of TIME, an epic is a slice of SCOPE — either, both, or neither may be set.
 */
const SprintPicker: React.FC<SprintPickerProps> = ({
  value,
  onChange,
  isDisabled,
  size,
}) => {
  const { data: sprints = [], isFetching } = useSprintListQuery();

  return (
    <Select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      isDisabled={isDisabled || isFetching}
      size={size}
      {...cardFieldProps}
    >
      <option value="">None</option>
      {sprints.map((sprint) => (
        <option key={sprint.id} value={sprint.id}>
          {sprint.name}
        </option>
      ))}
    </Select>
  );
};

export default SprintPicker;
