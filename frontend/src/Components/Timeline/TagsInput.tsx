import React, { useEffect, useRef, useState } from "react";
import { Wrap, WrapItem, Tag, TagLabel, TagCloseButton, Input, Box } from "@chakra-ui/react";

interface TagsInputProps {
  value?: string; // comma-separated
  onChange: (value: string) => void;
  addLabel?: string;
}

const parseTags = (value?: string): string[] =>
  (value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

// Rotating pastel palette (bg/color/border), same idea as Utils/avatar.ts#avatarColor but
// for tag chips — deterministic per tag name, so a given tag always reads the same color.
const TAG_PALETTE = [
  { bg: "#eff6ff", color: "#1d4ed8", border: "#dbeafe" }, // blue
  { bg: "#faf5ff", color: "#7e22ce", border: "#f3e8ff" }, // purple
  { bg: "#f0fdf4", color: "#15803d", border: "#dcfce7" }, // green
  { bg: "#fff7ed", color: "#c2410c", border: "#ffedd5" }, // orange
  { bg: "#fdf2f8", color: "#be185d", border: "#fce7f3" }, // pink
];

const tagColor = (tag: string) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
};

/** Chip-based tag editor backed by a comma-separated string — matches the Jira-style
 * "chips + add" pattern used in both the create and detail task modals. */
const TagsInput: React.FC<TagsInputProps> = ({ value, onChange, addLabel = "+ Add tag" }) => {
  const tags = parseTags(value);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) ref.current?.focus();
  }, [adding]);

  const commitNew = () => {
    const next = draft.trim();
    if (next && !tags.includes(next)) onChange([...tags, next].join(","));
    setDraft("");
    setAdding(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag).join(","));
  };

  return (
    <Wrap spacing={2} align="center">
      {tags.map((tag) => {
        const c = tagColor(tag);
        return (
          <WrapItem key={tag}>
            <Tag
              size="sm"
              borderRadius="md"
              bg={c.bg}
              color={c.color}
              border="1px solid"
              borderColor={c.border}
              fontWeight={600}
              fontSize="xs"
              px={2.5}
              py={1}
            >
              <TagLabel>{tag.toUpperCase()}</TagLabel>
              <TagCloseButton onClick={() => removeTag(tag)} />
            </Tag>
          </WrapItem>
        );
      })}
      <WrapItem>
        {adding ? (
          <Input
            ref={ref}
            size="sm"
            w="120px"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitNew}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNew();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="Tag name"
          />
        ) : (
          <Box
            as="button"
            type="button"
            onClick={() => setAdding(true)}
            fontSize="xs"
            fontWeight={500}
            color="neutral.500"
            border="1px dashed"
            borderColor="neutral.300"
            borderRadius="md"
            px={2}
            py={1}
            _hover={{ bg: "white", borderColor: "neutral.400" }}
          >
            {addLabel}
          </Box>
        )}
      </WrapItem>
    </Wrap>
  );
};

export default TagsInput;
