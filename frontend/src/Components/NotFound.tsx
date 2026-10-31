import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";

/** Catch-all 404 page for unmatched routes (previously rendered blank). */
const NotFound: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box
      minH="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="gray.50"
      p={6}
    >
      <VStack spacing={4} textAlign="center" maxW="md">
        <Heading size="2xl" color="blue.500">
          404
        </Heading>
        <Text color="gray.600" fontSize="lg">
          This page doesn't exist.
        </Text>
        <Button colorScheme="blue" onClick={() => navigate("/")}>
          Go home
        </Button>
      </VStack>
    </Box>
  );
};

export default NotFound;
