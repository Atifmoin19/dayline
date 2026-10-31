import { useState } from "react";
import { Box, Button, Heading, SimpleGrid, Spinner, Text, VStack } from "@chakra-ui/react";
import { useDemoLaunch } from "hooks/useDemoLaunch";
import { DEMO_PERSONAS } from "Utils/demoPersonas";
import type { DemoPersona } from "types";

/** "Try the demo as": one button per persona, each saying what that person sees. */
const DemoPersonaPicker = () => {
  const { launch, isLoading, waking } = useDemoLaunch();
  const [chosen, setChosen] = useState<DemoPersona | null>(null);

  const start = (persona: DemoPersona) => {
    setChosen(persona);
    void launch(persona);
  };

  return (
    <VStack as="section" align="stretch" spacing={3} aria-labelledby="demo-picker-title">
      <Box>
        <Heading as="h2" id="demo-picker-title" size="md" color="neutral.900">
          Try the demo as
        </Heading>
        <Text fontSize="sm" color="neutral.500" mt={1}>
          A private copy of a sample company, ready in seconds. No account needed.
        </Text>
      </Box>
      <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={2}>
        {DEMO_PERSONAS.map((p) => {
          const busy = isLoading && chosen === p.persona;
          return (
            <Button
              key={p.persona}
              type="button"
              variant="outline"
              borderColor="neutral.200"
              h="auto"
              py={3}
              px={4}
              display="flex"
              flexDirection="column"
              alignItems="flex-start"
              textAlign="left"
              whiteSpace="normal"
              gap={0.5}
              isDisabled={isLoading && !busy}
              aria-busy={busy}
              onClick={() => !isLoading && start(p.persona)}
              _hover={{ borderColor: "brand.400", bg: "brand.50" }}
            >
              <Text as="span" fontSize="sm" fontWeight={700} color="neutral.900">
                {p.label}
                {busy && <Spinner size="xs" ml={2} />}
              </Text>
              <Text as="span" fontSize="xs" fontWeight={600} color="brand.700">
                {busy ? (waking ? "Waking the server…" : "Setting up your demo…") : p.who}
              </Text>
              <Text as="span" fontSize="xs" fontWeight={400} color="neutral.600">
                {p.sees}
              </Text>
            </Button>
          );
        })}
      </SimpleGrid>
      {waking && (
        <Text fontSize="xs" color="neutral.500" role="status">
          Waking the server: it sleeps when nobody is using it, so the first request after a quiet spell can take up to a minute.
        </Text>
      )}
    </VStack>
  );
};

export default DemoPersonaPicker;
