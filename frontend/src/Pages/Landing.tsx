import { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Icon,
  Link,
  List,
  ListIcon,
  ListItem,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Check, CircleCheck, Gauge, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useAppSelector } from "app/hooks";
import DemoLauncher from "Components/Demo/DemoLauncher";
import MiniTimeline from "Components/Landing/MiniTimeline";
import { BRAND_GLOW, BRAND_GRADIENT, HERO_GRADIENT } from "Styles";
import { APP_HOME, DEMO_ENABLED, GITHUB_URL, PORTFOLIO_URL } from "Utils/constants";
import { buildSampleDay } from "Utils/landingSample";

const STEPS = [
  { icon: Play, title: "Pick", body: "Start a task and a work session opens on your timeline. No timer to remember." },
  { icon: Pause, title: "Hold", body: "Switch to something urgent. The session closes and the task waits, time kept." },
  { icon: RotateCcw, title: "Resume", body: "Pick it back up and a new session starts. Every stretch of work is recorded." },
  { icon: CircleCheck, title: "Done", body: "Close it out. Time spent is the sum of real sessions, not a guess." },
];

const ROLES = [
  { who: "Individual contributors", sees: "Their own tasks and timeline." },
  { who: "Leads and managers", sees: "Everyone in their reporting line, however deep." },
  { who: "Admins", sees: "People and roles, with an audit log of every change." },
  { who: "Scoped grants", sees: "Department admins and read-only auditors, without full admin." },
];

const Section = ({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) => (
  <Box as="section" aria-labelledby={`${id}-title`} py={{ base: 12, md: 20 }}>
    <Container maxW="6xl" px={{ base: 4, md: 8 }}>
      <Text fontSize="xs" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" color="brand.600" mb={2}>
        {eyebrow}
      </Text>
      <Heading id={`${id}-title`} as="h2" fontSize={{ base: "2xl", md: "3xl" }} color="neutral.900" mb={{ base: 6, md: 8 }} maxW="2xl">
        {title}
      </Heading>
      {children}
    </Container>
  </Box>
);

const Card = (props: React.ComponentProps<typeof Box>) => (
  <Box bg="white" borderWidth="1px" borderColor="neutral.200" borderRadius="xl" p={{ base: 4, md: 6 }} boxShadow="sm" {...props} />
);

/** Public landing page at "/". Signed-in visitors get "Open app" instead of the sign-in buttons. */
const Landing = () => {
  const signedIn = useAppSelector((state) => Boolean(state.scheduler.currentUser));
  const sample = useMemo(() => buildSampleDay(), []);

  const primary = signedIn ? (
    <Button as={RouterLink} to={APP_HOME} size="lg" bg={BRAND_GRADIENT} color="white" boxShadow={BRAND_GLOW} _hover={{ opacity: 0.92 }}>
      Open app
    </Button>
  ) : null;

  return (
    <Box bg="surface.page" minH="100vh" sx={{ "@media (prefers-reduced-motion: reduce)": { "*": { transition: "none !important", animation: "none !important" } } }}>
      <Box as="header" borderBottomWidth="1px" borderColor="neutral.200" bg="whiteAlpha.900" position="sticky" top={0} zIndex={10} backdropFilter="saturate(180%) blur(8px)">
        <Container maxW="6xl" px={{ base: 4, md: 8 }}>
          <Flex h="60px" align="center" justify="space-between">
            <Flex align="center" gap={2}>
              <Flex w="30px" h="30px" borderRadius="lg" bg={BRAND_GRADIENT} align="center" justify="center" color="white">
                <Icon as={Check} boxSize={4} />
              </Flex>
              <Text fontWeight={800} fontSize="lg" color="neutral.900">Dayline</Text>
            </Flex>
            {signedIn ? (
              <Button as={RouterLink} to={APP_HOME} size="sm" colorScheme="brand">Open app</Button>
            ) : (
              <Button as={RouterLink} to="/login" size="sm" variant="ghost" colorScheme="brand">Sign in</Button>
            )}
          </Flex>
        </Container>
      </Box>

      <Box as="main">
        <Box bg={HERO_GRADIENT} pt={{ base: 12, md: 20 }} pb={{ base: 10, md: 16 }}>
          <Container maxW="6xl" px={{ base: 4, md: 8 }}>
            <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={{ base: 10, lg: 14 }} alignItems="center">
              <Stack spacing={6}>
                <Badge alignSelf="flex-start" colorScheme="brand" variant="subtle" borderRadius="full" px={3} py={1} textTransform="none" fontWeight={600}>
                  Task scheduling for teams
                </Badge>
                <Heading as="h1" fontSize={{ base: "3xl", sm: "4xl", md: "5xl" }} lineHeight={1.1} color="neutral.900" letterSpacing="-0.02em">
                  See your team&apos;s day as it actually happens.
                </Heading>
                <Text fontSize={{ base: "md", md: "lg" }} color="neutral.600" maxW="xl">
                  Dayline plans tasks onto a live day timeline, records real work sessions as people pick,
                  hold and finish work, and warns you about overload and overdue work before it bites.
                </Text>
                {primary ?? (
                  <Stack direction={{ base: "column", sm: "row" }} spacing={3} align={{ base: "stretch", sm: "flex-start" }}>
                    {DEMO_ENABLED && (
                      <Box minW={{ sm: "240px" }}>
                        <DemoLauncher />
                      </Box>
                    )}
                    <Button
                      as={RouterLink}
                      to="/login"
                      size="lg"
                      {...(DEMO_ENABLED
                        ? { variant: "ghost", colorScheme: "brand" }
                        : { bg: BRAND_GRADIENT, color: "white", boxShadow: BRAND_GLOW, _hover: { opacity: 0.92 } })}
                    >
                      Sign in
                    </Button>
                  </Stack>
                )}
              </Stack>
              <Card p={{ base: 3, md: 5 }}>
                <Flex justify="space-between" align="center" mb={3}>
                  <Text fontSize="sm" fontWeight={700} color="neutral.800">Today, Platform and Mobile</Text>
                  <Badge colorScheme="gray" variant="subtle" borderRadius="full">Sample day</Badge>
                </Flex>
                <MiniTimeline sample={sample} />
              </Card>
            </SimpleGrid>
          </Container>
        </Box>

        <Section id="timeline" eyebrow="The live day timeline" title="One row per person, one bar per stretch of real work.">
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
            <Card>
              <Heading as="h3" size="sm" mb={2}>Built from sessions</Heading>
              <Text color="neutral.600" fontSize="sm">Bars come from actual pick and hold events, so the timeline shows what happened, not what was planned.</Text>
            </Card>
            <Card>
              <Heading as="h3" size="sm" mb={2}>Colored by priority</Heading>
              <Text color="neutral.600" fontSize="sm">P0 to P4 at a glance. Dashed bars are tasks on hold, waiting to be resumed.</Text>
            </Card>
            <Card>
              <Heading as="h3" size="sm" mb={2}>Your timezone, your hours</Heading>
              <Text color="neutral.600" fontSize="sm">Days are cut by the business timezone and each person&apos;s own timezone, inside working hours.</Text>
            </Card>
          </SimpleGrid>
        </Section>

        <Box bg="white" borderTopWidth="1px" borderBottomWidth="1px" borderColor="neutral.200">
          <Section id="flow" eyebrow="How a task moves" title="Four actions. Time tracking takes care of itself.">
            <SimpleGrid as="ol" listStyleType="none" columns={{ base: 1, sm: 2, lg: 4 }} spacing={4}>
              {STEPS.map((step, i) => (
                <Card as="li" key={step.title} bg="surface.page">
                  <Flex align="center" gap={3} mb={3}>
                    <Flex w="36px" h="36px" borderRadius="lg" bg="brand.50" color="brand.600" align="center" justify="center">
                      <Icon as={step.icon} boxSize={4} />
                    </Flex>
                    <Text fontSize="xs" color="neutral.600" fontWeight={600}>Step {i + 1}</Text>
                  </Flex>
                  <Heading as="h3" size="sm" mb={1}>{step.title}</Heading>
                  <Text color="neutral.600" fontSize="sm">{step.body}</Text>
                </Card>
              ))}
            </SimpleGrid>
            <Text mt={6} fontSize="sm" color="neutral.600" maxW="3xl">
              A session left running past the end of the day is held automatically, and work that slips past its due date
              moves back to the backlog, so the board stays honest without anyone policing it.
            </Text>
          </Section>
        </Box>

        <Section id="insight" eyebrow="Capacity and overdue insight" title="Know who is overloaded before the deadline does.">
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
            <Card>
              <Flex align="center" gap={2} mb={3}>
                <Icon as={Gauge} color="brand.600" />
                <Heading as="h3" size="sm">Capacity per person</Heading>
              </Flex>
              <Text color="neutral.600" fontSize="sm" mb={4}>
                Logged time plus unstarted work, spread over the coming days against the business day.
              </Text>
              <Stack spacing={2}>
                {[
                  { label: "Available", note: "under 70%", color: "green.400", w: "45%" },
                  { label: "At capacity", note: "70 to 100%", color: "orange.300", w: "85%" },
                  { label: "Over capacity", note: "over 100%", color: "red.400", w: "100%" },
                ].map((row) => (
                  <Box key={row.label}>
                    <Flex justify="space-between" fontSize="xs" color="neutral.600" mb={1}>
                      <Text fontWeight={600}>{row.label}</Text>
                      <Text>{row.note}</Text>
                    </Flex>
                    <Box h="8px" bg="neutral.100" borderRadius="full">
                      <Box h="full" w={row.w} bg={row.color} borderRadius="full" />
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Card>
            <Card>
              <Heading as="h3" size="sm" mb={3}>What the insight panel tells you</Heading>
              <List spacing={3} fontSize="sm" color="neutral.700">
                {[
                  "Tasks at risk of missing their due date, ranked by how close and how much is left.",
                  "Suggested rebalancing: who is over capacity and who has room, preferring shared skills.",
                  "Assignee suggestions when creating a task, based on skills, load and priority.",
                  "An optional AI summary of the week when a model key is configured.",
                ].map((line) => (
                  <ListItem key={line} display="flex" gap={2}>
                    <ListIcon as={Check} color="brand.600" mt={1} />
                    <Text>{line}</Text>
                  </ListItem>
                ))}
              </List>
            </Card>
          </SimpleGrid>
        </Section>

        <Box bg="white" borderTopWidth="1px" borderBottomWidth="1px" borderColor="neutral.200">
          <Section id="roles" eyebrow="Roles and visibility" title="People see their part of the org chart, and nothing else.">
            <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4}>
              {ROLES.map((role) => (
                <Card key={role.who} bg="surface.page">
                  <Flex align="center" gap={2} mb={1}>
                    <Icon as={ShieldCheck} color="brand.600" />
                    <Heading as="h3" size="sm">{role.who}</Heading>
                  </Flex>
                  <Text color="neutral.600" fontSize="sm">{role.sees}</Text>
                </Card>
              ))}
            </SimpleGrid>
          </Section>
        </Box>

        <Box py={{ base: 12, md: 16 }}>
          <Container maxW="3xl" px={{ base: 4, md: 8 }} textAlign="center">
            <Heading as="h2" fontSize={{ base: "2xl", md: "3xl" }} mb={3}>Ready to see a real day?</Heading>
            <Text color="neutral.600" mb={6}>
              {DEMO_ENABLED && !signedIn
                ? "The demo gives you a private copy of a sample company. Nothing to install, nothing to sign up for."
                : "Sign in to open your team's timeline."}
            </Text>
            <Flex justify="center">
              {primary ?? (DEMO_ENABLED ? (
                <Box w="full" maxW="280px"><DemoLauncher /></Box>
              ) : (
                <Button as={RouterLink} to="/login" size="lg" bg={BRAND_GRADIENT} color="white" _hover={{ opacity: 0.92 }}>
                  Sign in
                </Button>
              ))}
            </Flex>
          </Container>
        </Box>
      </Box>

      <Box as="footer" borderTopWidth="1px" borderColor="neutral.200" bg="white">
        <Container maxW="6xl" px={{ base: 4, md: 8 }} py={6}>
          <Flex direction={{ base: "column", sm: "row" }} gap={3} justify="space-between" align={{ base: "flex-start", sm: "center" }} fontSize="sm" color="neutral.600">
            <Text>
              Built by{" "}
              <Link href={PORTFOLIO_URL} color="brand.600" fontWeight={600} isExternal>
                Atif Moin
              </Link>
            </Text>
            <Link href={GITHUB_URL} color="brand.600" fontWeight={600} isExternal>
              Source on GitHub
            </Link>
          </Flex>
        </Container>
      </Box>
    </Box>
  );
};

export default Landing;
