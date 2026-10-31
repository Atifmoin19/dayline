import React from "react";
import { Box, HStack, SkeletonCircle, Text, Tooltip } from "@chakra-ui/react";
import UserAvatar from "Components/UserAvatar";
import { Employee } from "types";
import { useAssigneeSuggestionsQuery } from "Services/user.api";
import { useDebouncedValue } from "hooks/useDebouncedValue";

interface AssigneeSuggestionsProps {
  tags: string;
  priority: string;
  /** Already "committed" by the caller (see TaskCreationModal: only updates on the Title field's
   * own onBlur, not on every keystroke) — combined with `description` below, a non-trivial value
   * makes the backend run a real Gemini call server-side, so this must never be wired to a
   * live/debounced value — only a per-field blur commit. */
  title: string;
  /** Already "committed" by the caller (only updates on the Description field's own onBlur) —
   * same reasoning as `title` above. Title and description are committed independently: typing
   * in one never re-triggers a request while the other is still mid-edit, and blurring either
   * fires a request using whatever the other was last committed to (possibly still empty). */
  description: string;
  developers: Employee[];
  selectedId?: string;
  onSelect: (empId: string) => void;
}

const MAX_SHOWN = 5;

/**
 * "Suggested" shortcut sitting above `AssigneePicker` in the create-task modal — surfaces the
 * top few candidates from `GET /tasks/assignee-suggestions` so picking an assignee can be one
 * click instead of a full directory search. Rendered deliberately differently from
 * `AssigneePicker` (small circular avatar-only chips, name/reasons only on hover via `Tooltip`)
 * after user feedback that the previous full-width card rows looked confusable with the picker's
 * own selected-state row. Purely additive: clicking a chip just calls the same
 * `onChange`/select handler the picker itself uses, and any failure here is silent (never
 * blocks or errors the create-task form).
 */
const AssigneeSuggestions: React.FC<AssigneeSuggestionsProps> = ({
  tags,
  priority,
  title,
  description,
  developers,
  selectedId,
  onSelect,
}) => {
  // Debounce the tags string only — re-querying on every keystroke while someone is actively
  // typing a tag would be wasteful. Priority changes (a <Select>) are already discrete clicks,
  // and title/description are already commit-on-blur upstream (see TaskCreationModal) — none of
  // those three need a debounce here.
  const debouncedTags = useDebouncedValue(tags.trim(), 400);

  const { data, isFetching, isError } = useAssigneeSuggestionsQuery({
    tags: debouncedTags || undefined,
    priority: priority || undefined,
    title: title.trim() || undefined,
    description: description.trim() || undefined,
  });

  // Nice-to-have suggestions only — never surface an error in the create-task flow.
  if (isError) return null;

  const suggestions = (data ?? []).slice(0, MAX_SHOWN);
  if (!isFetching && suggestions.length === 0) return null;

  const heading = description.trim()
    ? "Suggested (skill match)"
    : debouncedTags
      ? "Suggested (tags)"
      : "Suggested";

  return (
    <Box>
      <Text
        fontSize="xs"
        fontWeight={700}
        color="neutral.500"
        textTransform="uppercase"
        letterSpacing="0.08em"
        mb={2}
      >
        {heading}
      </Text>
      {isFetching ? (
        <HStack spacing={3}>
          {[0, 1, 2].map((i) => (
            <SkeletonCircle key={i} size="9" />
          ))}
        </HStack>
      ) : (
        <HStack spacing={3} flexWrap="wrap">
          {suggestions.map((s) => {
            const dev = developers?.find((d) => d.emp_id === s.emp_id);
            const isSelected = s.emp_id === selectedId;
            const topReason = s.reasons[0];
            const tooltipLabel = topReason ? `${s.emp_name} — ${topReason}` : s.emp_name;
            return (
              <Tooltip key={s.emp_id} label={tooltipLabel} hasArrow placement="top" openDelay={200}>
                <Box
                  as="button"
                  type="button"
                  onClick={() => onSelect(s.emp_id)}
                  aria-label={tooltipLabel}
                  borderRadius="full"
                  p="2px"
                  lineHeight={0}
                  border="2px solid"
                  borderColor={isSelected ? "brand.400" : "transparent"}
                  transition="transform 0.12s ease"
                  _hover={{ transform: "scale(1.08)" }}
                  _focusVisible={{ outline: "2px solid", outlineColor: "brand.400" }}
                >
                  <UserAvatar size="sm" name={s.emp_name} photo={dev?.profile_pic} />
                </Box>
              </Tooltip>
            );
          })}
        </HStack>
      )}
    </Box>
  );
};

export default AssigneeSuggestions;
