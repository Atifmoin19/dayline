import { Button, Flex, Text } from "@chakra-ui/react";
import { useDemoLaunch } from "hooks/useDemoLaunch";
import { BRAND_GLOW } from "Styles";

/** "Try the demo": a manager demo by default, with a link to an employee persona. */
const DemoLauncher = ({ tone = "outline" }: { tone?: "outline" | "solid" }) => {
  const { launch, isLoading, waking } = useDemoLaunch();

  return (
    <Flex direction="column" align="center" gap={1}>
      <Button
        type="button"
        width="full"
        size="lg"
        variant={tone}
        colorScheme="brand"
        {...(tone === "solid"
          ? { bg: "brand.600", color: "white", boxShadow: BRAND_GLOW, _hover: { bg: "brand.700" }, _active: { bg: "brand.800" } }
          : {})}
        isLoading={isLoading}
        loadingText={waking ? "Waking the server…" : "Setting up your demo…"}
        onClick={() => launch("manager")}
      >
        Try the demo
      </Button>
      <Button
        type="button"
        variant="link"
        size="sm"
        colorScheme="brand"
        color={tone === "solid" ? "inherit" : "brand.700"}
        isDisabled={isLoading}
        onClick={() => launch("employee_1")}
      >
        or explore as an employee
      </Button>
      {waking && (
        <Text fontSize="xs" color={tone === "solid" ? "inherit" : "neutral.500"} role="status">
          The first request after a quiet spell can take up to a minute.
        </Text>
      )}
    </Flex>
  );
};

export default DemoLauncher;
