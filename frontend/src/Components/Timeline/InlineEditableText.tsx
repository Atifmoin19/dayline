import React, { useEffect, useRef, useState } from "react";
import { Input, Textarea, Text, InputProps, TextareaProps } from "@chakra-ui/react";

interface InlineEditableTextProps {
  value: string;
  onCommit: (value: string) => void;
  as?: "input" | "textarea";
  placeholder?: string;
  displayProps?: Record<string, unknown>;
  inputProps?: InputProps;
  textareaProps?: TextareaProps;
  emptyLabel?: string;
}

/**
 * Jira-style "click to view, double-click to edit" field. Renders as plain text/paragraph
 * until double-clicked, then swaps to an Input/Textarea; blur or Enter (Cmd/Ctrl+Enter for
 * the textarea variant) commits and reverts to view mode, Escape cancels without saving.
 */
const InlineEditableText: React.FC<InlineEditableTextProps> = ({
  value,
  onCommit,
  as = "input",
  placeholder,
  displayProps,
  inputProps,
  textareaProps,
  emptyLabel = "Add a description...",
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = as === "input" ? draft.trim() : draft;
    if (trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    if (as === "textarea") {
      return (
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") commit();
          }}
          placeholder={placeholder}
          {...textareaProps}
        />
      );
    }
    return (
      <Input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          if (e.key === "Enter") commit();
        }}
        placeholder={placeholder}
        {...inputProps}
      />
    );
  }

  return (
    <Text
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        // Keyboard-only equivalent of double-click: Enter/Space opens edit mode
        // (double-click has no keyboard analog, so this is the only way a keyboard
        // or screen-reader user can reach the input at all).
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${value || emptyLabel}. Press Enter to edit.`}
      cursor="text"
      whiteSpace="pre-wrap"
      color={value ? undefined : "neutral.500"}
      title="Double-click to edit"
      _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "2px" }}
      {...displayProps}
    >
      {value || emptyLabel}
    </Text>
  );
};

export default InlineEditableText;
