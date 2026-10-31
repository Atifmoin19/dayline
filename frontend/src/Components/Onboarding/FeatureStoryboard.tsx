import React, { useState } from "react";
import { Box, Button, Flex, Heading, Icon, Text } from "@chakra-ui/react";
import {
  FaBolt,
  FaTasks,
  FaChartLine,
  FaRegBell,
  FaSitemap,
  FaChartBar,
} from "Utils/icons";
import { BRAND_GRADIENT } from "Styles";

interface Slide {
  icon: React.ComponentType<{ boxSize?: number | string; color?: string }>;
  title: string;
  description: string;
}

const SLIDES: Slide[] = [
  {
    icon: FaBolt,
    title: "Live timeline & scheduling",
    description:
      "See exactly what everyone is working on right now, with real work sessions on a live day timeline.",
  },
  {
    icon: FaTasks,
    title: "Create tasks & smart assignment",
    description:
      "Create a task in seconds — smart suggestions help you pick the right person based on their workload.",
  },
  {
    icon: FaChartLine,
    title: "Dashboards & AI insights",
    description:
      "A live overview of your work plus AI-generated summaries and recommendations tailored to your team.",
  },
  {
    icon: FaRegBell,
    title: "Stay in the loop",
    description:
      "Get notified in-app, by email, on Slack, or via browser push whenever something needs your attention.",
  },
  {
    icon: FaSitemap,
    title: "Organization view",
    description:
      "Browse the full company hierarchy — see who reports to whom, at a glance.",
  },
  {
    icon: FaChartBar,
    title: "Reports",
    description:
      "Track throughput, status distribution and team load over time.",
  },
];

interface FeatureStoryboardProps {
  onDone: () => void;
}

const FeatureStoryboard: React.FC<FeatureStoryboardProps> = ({ onDone }) => {
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  return (
    <Box position="relative">
      <Button
        position="absolute"
        top={-2}
        right={0}
        variant="link"
        colorScheme="brand"
        fontSize="sm"
        onClick={onDone}
      >
        Skip
      </Button>

      <Flex direction="column" align="center" textAlign="center" px={4} pt={6} pb={2}>
        <Flex
          w="72px"
          h="72px"
          borderRadius="full"
          align="center"
          justify="center"
          bg={BRAND_GRADIENT}
          mb={5}
        >
          <Icon as={slide.icon} boxSize={7} color="white" />
        </Flex>
        <Heading size="md" color="neutral.900" mb={2}>
          {slide.title}
        </Heading>
        <Text color="neutral.500" fontSize="sm" maxW="360px" mb={6}>
          {slide.description}
        </Text>

        <Flex gap={2} mb={6}>
          {SLIDES.map((s, i) => (
            <Box
              key={s.title}
              w={i === index ? "20px" : "8px"}
              h="8px"
              borderRadius="full"
              bg={i === index ? "brand.500" : "neutral.200"}
              transition="all 0.15s ease"
            />
          ))}
        </Flex>

        <Flex w="full" justify="space-between" gap={3}>
          <Button
            variant="outline"
            borderColor="neutral.200"
            isDisabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            Back
          </Button>
          <Button
            bg={BRAND_GRADIENT}
            color="white"
            _hover={{ opacity: 0.92 }}
            onClick={() => (isLast ? onDone() : setIndex((i) => i + 1))}
          >
            {isLast ? "Get Started" : "Next"}
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
};

export default FeatureStoryboard;
