import React, { useState } from "react";
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  SimpleGrid,
  Step,
  StepIcon,
  StepIndicator,
  StepNumber,
  StepStatus,
  Stepper,
  useSteps,
} from "@chakra-ui/react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppDispatch } from "app/hooks";
import { setCurrentUser, setToken } from "app/slices/scheduler.slice";
import {
  usePreviewOnboardingMutation,
  useRegisterMutation,
} from "Services/user.api";
import { getApiErrorMessage } from "Services/baseQuery";
import { BRAND_GRADIENT } from "Styles";
import AuthLayout from "Layouts/AuthLayout";
import FeatureStoryboard from "Components/Onboarding/FeatureStoryboard";
import type { OnboardingPreviewResponse } from "types";

const STEPS = [
  { title: "Verify" },
  { title: "Confirm" },
  { title: "Password" },
];

const MIN_PASSWORD_LENGTH = 6;

const ProfileRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <Box>
    <Text fontSize="xs" color="neutral.500" fontWeight={600} mb={0.5}>
      {label}
    </Text>
    <Text fontSize="sm" color="neutral.900">
      {value || "—"}
    </Text>
  </Box>
);

const Onboarding: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
  const redirectTarget = from ? `${from.pathname}${from.search || ""}` : "/";

  const { activeStep, setActiveStep } = useSteps({ index: 0, count: STEPS.length });
  const [showStoryboard, setShowStoryboard] = useState(false);

  const [empId, setEmpId] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [profile, setProfile] = useState<OnboardingPreviewResponse | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [previewOnboarding, { isLoading: isVerifying }] = usePreviewOnboardingMutation();
  const [register, { isLoading: isSettingPassword }] = useRegisterMutation();

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empId.trim() || !empEmail.trim()) {
      toast({ title: "Please fill both fields", status: "error" });
      return;
    }
    try {
      const result = await previewOnboarding({ emp_id: empId, emp_email: empEmail }).unwrap();
      setProfile(result);
      setActiveStep(1);
    } catch (error) {
      const errorMsg = getApiErrorMessage(error, "Could not verify your details. Try again.");
      toast({ title: "Verification failed", description: errorMsg, status: "error" });
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: "Password too short",
        description: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
        status: "error",
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", status: "error" });
      return;
    }
    try {
      const result = await register({ emp_id: empId, emp_email: empEmail, password }).unwrap();
      dispatch(setToken(result.token));
      dispatch(setCurrentUser(result.userData));
      setShowStoryboard(true);
    } catch (error) {
      const errorMsg = getApiErrorMessage(error, "Could not set your password. Try again.");
      toast({ title: "Something went wrong", description: errorMsg, status: "error" });
    }
  };

  if (showStoryboard) {
    return (
      <AuthLayout>
        <Box
          w={{ base: "100%", md: "560px" }}
          maxW="560px"
          bg="white"
          borderRadius="1.25rem"
          boxShadow="0 24px 64px rgba(15,23,42,0.16)"
          p={{ base: 6, md: 10 }}
        >
          <FeatureStoryboard onDone={() => navigate(redirectTarget, { replace: true })} />
        </Box>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Box
        w={{ base: "100%", md: "560px" }}
        maxW="560px"
        bg="white"
        borderRadius="1.25rem"
        boxShadow="0 24px 64px rgba(15,23,42,0.16)"
        p={{ base: 6, md: 10 }}
      >
        <Box mb={8}>
          <Heading size="lg" color="neutral.900" mb={1}>
            Welcome to TaskBoard
          </Heading>
          <Text color="neutral.500" fontSize="sm">
            Let's get your account set up.
          </Text>
        </Box>

        <Stepper index={activeStep} size="sm" colorScheme="brand" mb={8}>
          {STEPS.map((step) => (
            <Step key={step.title}>
              <StepIndicator>
                <StepStatus complete={<StepIcon />} incomplete={<StepNumber />} active={<StepNumber />} />
              </StepIndicator>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 && (
          <VStack spacing={4} as="form" onSubmit={handleVerify} align="stretch">
            <Text fontSize="sm" color="neutral.600">
              Enter the Employee ID and email your admin has on file so we can find your account.
            </Text>
            <FormControl isRequired>
              <FormLabel fontSize="sm" fontWeight={600}>Employee ID</FormLabel>
              <Input
                placeholder="e.g. EMP001"
                size="lg"
                bg="neutral.50"
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
              />
            </FormControl>
            <FormControl isRequired>
              <FormLabel fontSize="sm" fontWeight={600}>Email Address</FormLabel>
              <Input
                type="email"
                placeholder="you@company.com"
                size="lg"
                bg="neutral.50"
                value={empEmail}
                onChange={(e) => setEmpEmail(e.target.value)}
              />
            </FormControl>
            <Button
              type="submit"
              width="full"
              size="lg"
              mt={2}
              bg={BRAND_GRADIENT}
              color="white"
              _hover={{ opacity: 0.92 }}
              isLoading={isVerifying}
            >
              Continue
            </Button>
          </VStack>
        )}

        {activeStep === 1 && profile && (
          <VStack spacing={5} align="stretch">
            <Text fontSize="sm" color="neutral.600">
              Here's what we have on file. Make sure this is you before continuing.
            </Text>
            <SimpleGrid columns={2} spacing={4} bg="neutral.50" borderRadius="0.75rem" p={4}>
              <ProfileRow label="Name" value={profile.emp_name} />
              <ProfileRow label="Employee ID" value={profile.emp_id} />
              <ProfileRow label="Email" value={profile.emp_email} />
              <ProfileRow label="Phone" value={profile.emp_phone} />
              <ProfileRow label="Designation" value={profile.emp_designation} />
              <ProfileRow label="Department" value={profile.emp_department} />
            </SimpleGrid>
            <Flex gap={3}>
              <Button variant="outline" borderColor="neutral.200" onClick={() => setActiveStep(0)}>
                Back
              </Button>
              <Button
                flex="1"
                bg={BRAND_GRADIENT}
                color="white"
                _hover={{ opacity: 0.92 }}
                onClick={() => setActiveStep(2)}
              >
                This is me, continue
              </Button>
            </Flex>
          </VStack>
        )}

        {activeStep === 2 && (
          <VStack spacing={4} as="form" onSubmit={handleSetPassword} align="stretch">
            <Text fontSize="sm" color="neutral.600">
              Set a real password to replace the temporary one your admin gave you.
            </Text>
            <FormControl isRequired>
              <FormLabel fontSize="sm" fontWeight={600}>Create password</FormLabel>
              <Input
                type="password"
                placeholder="••••••••"
                size="lg"
                bg="neutral.50"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormControl>
            <FormControl isRequired>
              <FormLabel fontSize="sm" fontWeight={600}>Confirm password</FormLabel>
              <Input
                type="password"
                placeholder="••••••••"
                size="lg"
                bg="neutral.50"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </FormControl>
            <Flex gap={3} mt={2}>
              <Button variant="outline" borderColor="neutral.200" onClick={() => setActiveStep(1)}>
                Back
              </Button>
              <Button
                type="submit"
                flex="1"
                bg={BRAND_GRADIENT}
                color="white"
                _hover={{ opacity: 0.92 }}
                isLoading={isSettingPassword}
              >
                Set password
              </Button>
            </Flex>
          </VStack>
        )}
      </Box>
    </AuthLayout>
  );
};

export default Onboarding;
