import React, { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import AuthLayout from "Layouts/AuthLayout";
import { useDelayedFlag } from "hooks/useDelayedFlag";
import { WAKING_AFTER_MS } from "hooks/useDemoLaunch";
import {
  sendWorkspaceRequest,
  splitName,
  TEAM_SIZES,
  type WorkspaceRequest,
  type WorkspaceRequestField,
} from "Services/contact";
import { BRAND_GRADIENT } from "Styles";
import { DEMO_ENABLED } from "Utils/constants";

type Errors = Partial<Record<WorkspaceRequestField, string>>;

const EMPTY: WorkspaceRequest = { name: "", email: "", company: "", teamSize: "", message: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_MESSAGE = 10;

const validate = (f: WorkspaceRequest): Errors => {
  const e: Errors = {};
  if (!f.name.trim()) e.name = "Tell us your name.";
  else if (f.name.trim().length > 160) e.name = "Keep your name under 160 characters.";
  if (!f.email.trim()) e.email = "Enter your work email.";
  else if (!EMAIL_RE.test(f.email.trim()) || f.email.trim().length > 254) e.email = "That email doesn't look right.";
  if (!f.company.trim()) e.company = "Tell us your company.";
  else if (f.company.trim().length > 120) e.company = "Keep the company name under 120 characters.";
  if (!f.teamSize) e.teamSize = "Pick a team size.";
  if (f.message.trim().length < MIN_MESSAGE) e.message = `Add a short message (at least ${MIN_MESSAGE} characters).`;
  else if (f.message.length > 5000) e.message = "Keep the message under 5,000 characters.";
  return e;
};

const FAILURE_TEXT = {
  rate_limited: "You've sent a few requests already. Please wait a minute and try again.",
  network: "We couldn't reach the server. Check your connection and try again; what you typed is still here.",
  server: "Something went wrong on our side. Please try again in a moment.",
  validation: "Please check the highlighted fields.",
} as const;

/** Public "Request a workspace" form: sends the request to the shared contact API. */
const RequestWorkspace: React.FC = () => {
  const [form, setForm] = useState<WorkspaceRequest>(EMPTY);
  const [website, setWebsite] = useState(""); // honeypot: people never see or fill it
  const [errors, setErrors] = useState<Errors>({});
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<keyof typeof FAILURE_TEXT | null>(null);
  const [sent, setSent] = useState(false);
  const waking = useDelayedFlag(sending, WAKING_AFTER_MS);

  const update = (field: WorkspaceRequestField) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const next = { ...form, [field]: e.target.value };
    setForm(next);
    if (attempted) setErrors(validate(next));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setAttempted(true);
    setFailure(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (website) {
      // A bot filled the hidden field: look successful, send nothing.
      setSent(true);
      return;
    }
    setSending(true);
    const result = await sendWorkspaceRequest(form);
    setSending(false);
    if (result.ok) {
      setSent(true);
    } else {
      if (result.kind === "validation") setErrors((prev) => ({ ...prev, ...result.fieldErrors }));
      setFailure(result.kind);
    }
  };

  const field = (name: WorkspaceRequestField) => ({ isInvalid: Boolean(errors[name]), isDisabled: sending });

  return (
    <AuthLayout>
      <Box
        w="100%"
        maxW="640px"
        bg="white"
        borderRadius="1.25rem"
        boxShadow="0 24px 64px rgba(15,23,42,0.16)"
        p={{ base: 6, md: 10 }}
      >
        <Flex as={RouterLink} to="/" align="center" gap={2} mb={6} w="fit-content" aria-label="Dayline home">
          <img src="/dayline.svg" alt="" width={24} height={24} />
          <Text fontWeight={700} color="neutral.900">
            Dayline
          </Text>
        </Flex>

        {sent ? (
          <VStack align="stretch" spacing={4} role="status">
            <Heading as="h1" size="lg" color="neutral.900">
              Thanks, {splitName(form.name).first_name || "there"}! Your request is in.
            </Heading>
            <Text color="neutral.600">
              We&apos;ll reply to <strong>{form.email.trim()}</strong> within a couple of working days to set up a
              workspace for {form.company.trim() || "your team"}.
            </Text>
            <Flex gap={3} wrap="wrap" pt={2}>
              {DEMO_ENABLED && (
                <Button as={RouterLink} to="/login" bg={BRAND_GRADIENT} color="white" _hover={{ opacity: 0.92 }}>
                  Try the demo meanwhile
                </Button>
              )}
              <Button as={RouterLink} to="/" variant="outline">
                Back to home
              </Button>
            </Flex>
          </VStack>
        ) : (
          <>
            <Box mb={6}>
              <Heading as="h1" size="lg" color="neutral.900" mb={2}>
                Request a workspace
              </Heading>
              <Text color="neutral.600" fontSize="sm">
                Dayline workspaces are set up for each team. Tell us a little about yours and we&apos;ll get back to you.
              </Text>
            </Box>

            {failure && (
              <Alert status={failure === "validation" ? "warning" : "error"} borderRadius="md" mb={5}>
                <AlertIcon />
                <AlertDescription fontSize="sm">{FAILURE_TEXT[failure]}</AlertDescription>
              </Alert>
            )}

            <VStack as="form" noValidate onSubmit={handleSubmit} spacing={4} align="stretch">
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <FormControl {...field("name")}>
                  <FormLabel fontSize="sm" fontWeight={600}>Your name</FormLabel>
                  <Input name="name" autoComplete="name" value={form.name} onChange={update("name")} />
                  <FormErrorMessage>{errors.name}</FormErrorMessage>
                </FormControl>
                <FormControl {...field("email")}>
                  <FormLabel fontSize="sm" fontWeight={600}>Work email</FormLabel>
                  <Input name="email" type="email" autoComplete="email" value={form.email} onChange={update("email")} />
                  <FormErrorMessage>{errors.email}</FormErrorMessage>
                </FormControl>
                <FormControl {...field("company")}>
                  <FormLabel fontSize="sm" fontWeight={600}>Company</FormLabel>
                  <Input name="company" autoComplete="organization" value={form.company} onChange={update("company")} />
                  <FormErrorMessage>{errors.company}</FormErrorMessage>
                </FormControl>
                <FormControl {...field("teamSize")}>
                  <FormLabel fontSize="sm" fontWeight={600}>Team size</FormLabel>
                  <Select name="team_size" placeholder="Select" value={form.teamSize} onChange={update("teamSize")}>
                    {TEAM_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} people
                      </option>
                    ))}
                  </Select>
                  <FormErrorMessage>{errors.teamSize}</FormErrorMessage>
                </FormControl>
              </SimpleGrid>
              <FormControl {...field("message")}>
                <FormLabel fontSize="sm" fontWeight={600}>What should we know?</FormLabel>
                <Textarea
                  name="message"
                  rows={4}
                  placeholder="How your team plans work today, and what you'd like Dayline to help with."
                  value={form.message}
                  onChange={update("message")}
                />
                <FormErrorMessage>{errors.message}</FormErrorMessage>
              </FormControl>

              {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
              <Box position="absolute" left="-10000px" top="auto" w="1px" h="1px" overflow="hidden" aria-hidden="true">
                <label>
                  Website
                  <input
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </Box>

              <Button
                type="submit"
                size="lg"
                bg={BRAND_GRADIENT}
                color="white"
                _hover={{ opacity: 0.92 }}
                isLoading={sending}
                loadingText={waking ? "Waking the server…" : "Sending…"}
              >
                Send request
              </Button>
              {waking && (
                <Text fontSize="xs" color="neutral.500" role="status">
                  Waking the server: the first request after a quiet spell can take up to a minute.
                </Text>
              )}
            </VStack>

            <Flex justify="center" gap={4} wrap="wrap" mt={6} fontSize="sm">
              {DEMO_ENABLED && (
                <Button as={RouterLink} to="/login" variant="link" colorScheme="brand" fontSize="sm">
                  Look around the demo first
                </Button>
              )}
              <Button as={RouterLink} to="/login" variant="link" color="neutral.600" fontSize="sm">
                Already invited? Sign in
              </Button>
            </Flex>
          </>
        )}
      </Box>
    </AuthLayout>
  );
};

export default RequestWorkspace;
