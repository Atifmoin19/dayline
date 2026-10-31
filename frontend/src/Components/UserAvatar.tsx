import React from "react";
import { Avatar, AvatarProps } from "@chakra-ui/react";
import { avatarColor } from "Utils/avatar";

interface UserAvatarProps extends Omit<AvatarProps, "name" | "src"> {
  name?: string;
  /** HRIS profile_pic — a URL is used as the photo; a non-URL (e.g. "MK" initials) is ignored. */
  photo?: string | null;
}

/** True only for real image URLs (some HR systems store initials like "MK" in the same field). */
const isImageUrl = (v?: string | null): boolean =>
  !!v && (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("data:"));

/**
 * Avatar that prefers the real HRIS photo and falls back to coloured initials (Chakra also
 * auto-falls-back if the image fails to load). Single place so every avatar behaves the same.
 */
const UserAvatar: React.FC<UserAvatarProps> = ({ name, photo, ...rest }) => (
  <Avatar
    name={name}
    src={isImageUrl(photo) ? (photo as string) : undefined}
    bg={avatarColor(name)}
    color="white"
    {...rest}
  />
);

export default UserAvatar;
