import React from "react";
import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Catches render/runtime errors anywhere in the tree and shows a fallback instead of
 * a blank white screen. Without this, an uncaught error unmounts the whole app.
 */
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Hook a real reporter (e.g. Sentry) here later.
    console.error("Uncaught error:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
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
            <Heading size="lg" color="gray.700">
              Something went wrong
            </Heading>
            <Text color="gray.600">
              An unexpected error occurred. You can reload and try again.
            </Text>
            <Button colorScheme="blue" onClick={this.handleReset}>
              Reload app
            </Button>
          </VStack>
        </Box>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
