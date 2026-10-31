import { Box, Text } from "@chakra-ui/react";
import { useAppSelector } from "app/hooks";
import { hoursUntil } from "Utils/demo";

/** Slim notice shown across the app shell while signed in to a POST /demo workspace. */
const DemoBanner = () => {
  const user = useAppSelector((state) => state.scheduler.currentUser);
  if (!user?.is_demo) return null;
  const hours = hoursUntil(user.demo_expires_at);
  return (
    <Box role="status" bg="brand.50" borderWidth="1px" borderColor="brand.100" borderRadius="md" px={3} py={1.5} mb={4}>
      <Text fontSize="sm" color="brand.800" textAlign="center">
        {`Demo workspace. Resets in ${hours} ${hours === 1 ? "hour" : "hours"}. Emails and notifications are off.`}
      </Text>
    </Box>
  );
};

export default DemoBanner;
