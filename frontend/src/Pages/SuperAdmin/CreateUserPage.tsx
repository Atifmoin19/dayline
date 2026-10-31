import React, { useState, useRef } from "react";
import {
  Box,
  Container,
  Heading,
  Text,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  FormControl,
  FormLabel,
  Input,
  Select,
  Button,
  useToast,
  SimpleGrid,
  Icon,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
} from "@chakra-ui/react";
import SimpleLayout from "Layouts/simpleLayout";
import {
  useCreateUserMutation,
  useUploadUsersMutation,
  useLazyUserListQuery,
  useUserListQuery,
} from "Services/user.api";
import { DESIGNATIONS, ROLE_RANK } from "Utils/constants";
import { useAppSelector } from "app/hooks";
import { Employee } from "types";
import {
  FaCloudUploadAlt,
  FaFileCsv,
  FaDownload,
  FaTimes,
} from "Utils/icons";
import sampleCsv from "assets/sample_user_creation.csv?url";

const CreateUserPage: React.FC = () => {
  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();
  const [uploadUsers, { isLoading: isUploading }] = useUploadUsersMutation();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { developers: reduxDevelopers } = useAppSelector(
    (state) => state.scheduler
  );

  // Fetch users specifically for the list to ensure we have all potential managers
  const { data: userList } = useUserListQuery(
    {},
    { refetchOnMountOrArgChange: true }
  );

  const [triggerUserList] = useLazyUserListQuery();
  // If userList is available, use it. Otherwise fall back to reduxDevelopers (though userList is preferred)
  const potentialManagers = userList || reduxDevelopers;

  // Single User State
  const [empName, setEmpName] = useState("");
  const [empId, setEmpId] = useState("");
  const [empEmail, setEmpEmail] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [empDesignation, setEmpDesignation] = useState("");
  const [empDepartment, setEmpDepartment] = useState("");
  const [managerId, setManagerId] = useState("");
  // Enriched (optional) profile fields
  const [company, setCompany] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [linkedin, setLinkedin] = useState("");

  const createRank = ROLE_RANK[empDesignation] || 0;
  const showCreateManager = createRank < 5;
  const validCreateManagers = potentialManagers.filter(
    (m: Employee) => (ROLE_RANK[m.emp_designation] || 0) > createRank
  );

  React.useEffect(() => {
    if (reduxDevelopers.length === 0) {
      triggerUserList({});
    }
  }, [reduxDevelopers.length, triggerUserList]);

  // Bulk Upload State
  const [file, setFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<string[][] | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];

      // Check file size (4MB)
      if (selectedFile.size > 4 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "File size must be less than 4MB",
          status: "error",
          duration: 3000,
        });
        return;
      }

      setFile(selectedFile);

      // Simple CSV Preview Parser
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        // Basic split by newline and comma.
        // For production apps, consider a robust parser like papaparse if complex CSVs are needed.
        const lines = text
          .split("\n")
          .map((line) => line.split(","))
          .filter((row) => row.some((cell) => cell.trim() !== "")); // Basic empty row filter
        setCsvPreview(lines.slice(0, 6)); // Header + 5 rows
      };
      reader.readAsText(selectedFile);
    }
  };

  const handleClearFile = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering parent click events if any
    setFile(null);
    setCsvPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSingleSubmit = async () => {
    if (!empName || !empId || !empEmail || !empDesignation) {
      toast({ title: "Please fill all required fields", status: "error" });
      return;
    }

    const newUser = {
      emp_name: empName,
      emp_id: empId,
      emp_email: empEmail,
      emp_phone: empPhone || undefined,
      emp_designation: empDesignation,
      emp_department: empDepartment || undefined,
      manager_id: showCreateManager ? managerId : undefined,
      company: company || undefined,
      work_location: workLocation || undefined,
      date_of_joining: dateOfJoining || undefined,
      linkedin: linkedin || undefined,
    };

    try {
      await createUser(newUser).unwrap();
      toast({ title: "User Created Successfully", status: "success" });
      // Reset form
      setEmpName("");
      setEmpId("");
      setEmpEmail("");
      setEmpPhone("");
      setEmpDesignation("");
      setEmpDepartment("");
      setManagerId("");
      setCompany("");
      setWorkLocation("");
      setDateOfJoining("");
      setLinkedin("");
    } catch {
      toast({
        title: "Failed to create user",
        description: "Something went wrong",
        status: "error",
      });
    }
  };

  const handleBulkUpload = async () => {
    if (!file) {
      toast({ title: "Please select a CSV file", status: "warning" });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      await uploadUsers(formData).unwrap();
      toast({ title: "Users Uploaded Successfully", status: "success" });
      setFile(null);
      setCsvPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      toast({
        title: "Failed to upload users",
        description: "Check file format.",
        status: "error",
      });
    }
  };

  return (
    <SimpleLayout>
      <Container maxW="container.xl" py={2}>
        <Heading size="lg" mb={1} color="neutral.900">
          Create User
        </Heading>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Onboard a single user or import many via CSV.
        </Text>
        <Tabs variant="soft-rounded" colorScheme="brand">
          <TabList mb={5}>
            <Tab>Single User Creation</Tab>
            <Tab>Bulk User Creation</Tab>
          </TabList>

          <TabPanels>
            <TabPanel px={0}>
              <Box
                bg="surface.card"
                p={8}
                borderRadius="card"
                boxShadow="card"
                border="1px solid"
                borderColor="surface.border"
              >
                <Heading size="md" color="neutral.900" mb={6}>
                  User Details
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
                  <FormControl isRequired>
                    <FormLabel>Employee Name</FormLabel>
                    <Input
                      value={empName}
                      onChange={(e) => setEmpName(e.target.value)}
                      placeholder="e.g. Jane Doe"
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Employee ID</FormLabel>
                    <Input
                      value={empId}
                      onChange={(e) => setEmpId(e.target.value)}
                      placeholder="e.g. EMP001"
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Email</FormLabel>
                    <Input
                      type="email"
                      value={empEmail}
                      onChange={(e) => setEmpEmail(e.target.value)}
                      placeholder="e.g. jane.doe@example.com"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Phone</FormLabel>
                    <Input
                      value={empPhone}
                      onChange={(e) => setEmpPhone(e.target.value)}
                      placeholder="e.g. 555-0100"
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Designation</FormLabel>
                    <Select
                      value={empDesignation}
                      onChange={(e) => setEmpDesignation(e.target.value)}
                      placeholder="Select Designation"
                    >
                      {DESIGNATIONS.map((des) => (
                        <option key={des} value={des}>
                          {des}
                        </option>
                      ))}
                    </Select>
                  </FormControl>

                  {showCreateManager && empDesignation && (
                    <FormControl isRequired>
                      <FormLabel>Manager</FormLabel>
                      <Select
                        value={managerId}
                        onChange={(e) => setManagerId(e.target.value)}
                        placeholder="Select Manager"
                      >
                        {validCreateManagers.map((dev) => (
                          <option key={dev.id || dev.emp_id} value={dev.emp_id}>
                            {dev.emp_name} ({dev.emp_designation})
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  <FormControl>
                    <FormLabel>Department</FormLabel>
                    <Input
                      value={empDepartment}
                      onChange={(e) => setEmpDepartment(e.target.value)}
                      placeholder="e.g. Technology"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Company</FormLabel>
                    <Input
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="e.g. Example Corp"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Work Location</FormLabel>
                    <Input
                      value={workLocation}
                      onChange={(e) => setWorkLocation(e.target.value)}
                      placeholder="e.g. Remote"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>Date of Joining</FormLabel>
                    <Input
                      value={dateOfJoining}
                      onChange={(e) => setDateOfJoining(e.target.value)}
                      placeholder="DD-MM-YYYY"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel>LinkedIn</FormLabel>
                    <Input
                      value={linkedin}
                      onChange={(e) => setLinkedin(e.target.value)}
                      placeholder="https://linkedin.com/in/…"
                    />
                  </FormControl>
                </SimpleGrid>

                <Button
                  colorScheme="brand"
                  onClick={handleSingleSubmit}
                  isLoading={isCreating}
                  loadingText="Creating..."
                  width="full"
                  mt={8}
                  size="lg"
                >
                  Create User
                </Button>
              </Box>
            </TabPanel>
            <TabPanel px={0}>
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
                {/* Left Side - 70% (approx 2/3 cols in 3-col grid) */}
                <Box
                  gridColumn={{ md: "span 2" }}
                  bg="surface.card"
                  p={6}
                  borderRadius="card"
                  border="1px solid"
                  borderColor="surface.border"
                  boxShadow="card"
                >
                  <Heading size="md" mb={6} color="neutral.900">
                    Upload CSV
                  </Heading>

                  <Box
                    border="2px dashed"
                    borderColor={file ? "brand.300" : "surface.border"}
                    borderRadius="lg"
                    bg={file ? "brand.50" : "neutral.50"}
                    p={8}
                    textAlign="center"
                    transition="all 0.2s"
                    _hover={{ borderColor: "brand.400", bg: "neutral.100" }}
                    position="relative"
                  >
                    {file && (
                      <IconButton
                        aria-label="Clear file"
                        icon={<FaTimes />}
                        size="sm"
                        position="absolute"
                        top={2}
                        right={2}
                        colorScheme="red"
                        variant="ghost"
                        onClick={handleClearFile}
                        zIndex={2}
                      />
                    )}
                    <Icon
                      as={file ? FaFileCsv : FaCloudUploadAlt}
                      w={12}
                      h={12}
                      color={file ? "brand.500" : "neutral.500"}
                      mb={4}
                    />
                    <Box>
                      <Button
                        onClick={() => fileInputRef.current?.click()}
                        colorScheme="brand"
                        variant="outline"
                        size="sm"
                        mb={2}
                      >
                        {file ? "Change File" : "Select File"}
                      </Button>
                      <Input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        display="none"
                        onChange={handleFileChange}
                      />
                      <Box fontSize="sm" color="neutral.500">
                        {file ? file.name : "Drag and drop or click to upload"}
                      </Box>
                    </Box>
                  </Box>

                  {/* Preview Section */}
                  {csvPreview && (
                    <Box mt={6} overflowX="auto">
                      <Heading size="sm" mb={4} color="neutral.700">
                        File Preview
                      </Heading>
                      <Table variant="simple" size="sm">
                        <Thead bg="neutral.50">
                          <Tr>
                            {csvPreview[0]?.map((header, idx) => (
                              <Th key={idx}>{header}</Th>
                            ))}
                          </Tr>
                        </Thead>
                        <Tbody>
                          {csvPreview.slice(1).map((row, rowIdx) => (
                            <Tr key={rowIdx}>
                              {row.map((cell, cellIdx) => (
                                <Td key={cellIdx}>{cell}</Td>
                              ))}
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}

                  <Button
                    mt={6}
                    colorScheme="brand"
                    onClick={handleBulkUpload}
                    isLoading={isUploading}
                    isDisabled={!file}
                    width="full"
                    leftIcon={<FaCloudUploadAlt />}
                  >
                    Upload Users
                  </Button>
                </Box>

                {/* Right Side - 30% */}
                <Box>
                  <Box
                    bg="brand.50"
                    p={6}
                    borderRadius="card"
                    border="1px solid"
                    borderColor="brand.100"
                    mb={6}
                  >
                    <Heading size="sm" mb={4} color="brand.700">
                      Instructions
                    </Heading>
                    <SimpleGrid spacing={3}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Box
                          as="span"
                          w="6px"
                          h="6px"
                          borderRadius="full"
                          bg="brand.400"
                        />
                        <Box fontSize="sm" color="brand.600">
                          File must be in .csv format
                        </Box>
                      </Box>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Box
                          as="span"
                          w="6px"
                          h="6px"
                          borderRadius="full"
                          bg="brand.400"
                        />
                        <Box fontSize="sm" color="brand.600">
                          Max file size: 4MB
                        </Box>
                      </Box>
                    </SimpleGrid>
                  </Box>

                  <Box
                    bg="surface.card"
                    p={6}
                    borderRadius="card"
                    border="1px solid"
                    borderColor="surface.border"
                    textAlign="center"
                  >
                    <Icon as={FaFileCsv} w={8} h={8} color="brand.500" mb={3} />
                    <Heading size="xs" mb={2} color="neutral.900">
                      Need a template?
                    </Heading>
                    <Box fontSize="xs" color="neutral.500" mb={4}>
                      Download the sample CSV file to ensure your data is
                      formatted correctly.
                    </Box>
                    <Button
                      as="a"
                      href={sampleCsv}
                      download="sample_user_creation.csv"
                      size="sm"
                      width="full"
                      variant="outline"
                      leftIcon={<FaDownload />}
                    >
                      Download Sample
                    </Button>
                  </Box>
                </Box>
              </SimpleGrid>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Container>
    </SimpleLayout>
  );
};
export default CreateUserPage;
