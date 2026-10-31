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
  Textarea,
  Select,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Button,
  useToast,
  SimpleGrid,
  GridItem,
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
  useCreateTaskMutation,
  useUploadTasksMutation,
  useUserListQuery,
} from "Services/user.api";
import { useAppDispatch, useAppSelector } from "app/hooks";
import { addTask } from "app/slices/scheduler.slice";
import { Priority } from "types";
import { PRIORITY_OPTIONS, PRIORITY_LABEL } from "Utils/priority";
import {
  FaCloudUploadAlt,
  FaFileCsv,
  FaDownload,
  FaTimes,
} from "Utils/icons";
import sampleCsv from "assets/sample_task_creation.csv?url";

const CreateTaskPage: React.FC = () => {
  const [createTask, { isLoading: isCreating }] = useCreateTaskMutation();
  const [uploadTasks, { isLoading: isUploading }] = useUploadTasksMutation();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const allTasks = useAppSelector((state) => state.scheduler.tasks);
  const developers = useAppSelector((state) => state.scheduler.developers);
  const currentUser = useAppSelector((state) => state.scheduler.currentUser);

  // Fetch users specifically for the dropdown (reportees/team members)
  const { data: apiDevelopers } = useUserListQuery(
    { user_id: currentUser?.emp_id },
    { skip: !currentUser?.emp_id, refetchOnMountOrArgChange: true }
  );

  const potentialAssignees = apiDevelopers || developers;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Single Task State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(1);
  const [priority, setPriority] = useState<Priority>("P1");
  const [status, setStatus] = useState<string>("todo");
  const [assigneeId, setAssigneeId] = useState("");

  // Bulk State
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
        const lines = text
          .split("\n")
          .map((line) => line.split(","))
          .filter((row) => row.some((cell) => cell.trim() !== ""));
        setCsvPreview(lines.slice(0, 6)); // Header + 5 rows
      };
      reader.readAsText(selectedFile);
    }
  };

  const handleClearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    setCsvPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSingleSubmit = async () => {
    if (!title || !assigneeId) {
      toast({ title: "Title and Assignee are required", status: "error" });
      return;
    }

    const newTask = {
      task_name: title,
      task_description: description,
      task_duration: String(duration),
      task_priority: priority,
      task_assigned_to: assigneeId,
      task_status: status,
      task_created_at: new Date().toISOString(),
    };

    const resp = await createTask(newTask);
    if (resp?.data) {
      if (resp.data.id) {
        dispatch(addTask([...allTasks, resp.data]));
      }
      toast({ title: "Task Created Successfully", status: "success" });
      // Reset form
      setTitle("");
      setDescription("");
      setDuration(1);
      setPriority("P1");
      setStatus("todo");
      setAssigneeId("");
    } else {
      toast({ title: "Failed to create task", status: "error" });
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
      await uploadTasks(formData).unwrap();
      toast({ title: "Tasks Uploaded Successfully", status: "success" });
      setFile(null);
      setCsvPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      toast({
        title: "Failed to upload tasks",
        description: "Check file format.",
        status: "error",
      });
    }
  };

  return (
    <SimpleLayout>
      <Container maxW="container.xl" py={8}>
        <Heading size="lg" mb={1} color="neutral.900">
          Create Task
        </Heading>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Create a single task or import many via CSV.
        </Text>
        <Tabs variant="soft-rounded" colorScheme="brand">
          <TabList mb={4}>
            <Tab>Single Task Creation</Tab>
            <Tab>Bulk Task Creation</Tab>
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
                  Task Details
                </Heading>
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
                  <GridItem colSpan={{ base: 1, md: 2 }}>
                    <FormControl isRequired>
                      <FormLabel>Task Title</FormLabel>
                      <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Fix Login Bug"
                      />
                    </FormControl>
                  </GridItem>

                  <FormControl isRequired>
                    <FormLabel>Duration (Hours)</FormLabel>
                    <NumberInput
                      min={0.5}
                      max={100}
                      value={duration}
                      onChange={(val) => setDuration(Number(val))}
                    >
                      <NumberInputField />
                      <NumberInputStepper>
                        <NumberIncrementStepper />
                        <NumberDecrementStepper />
                      </NumberInputStepper>
                    </NumberInput>
                  </FormControl>

                  <GridItem colSpan={{ base: 1, md: 3 }}>
                    <FormControl>
                      <FormLabel>Description</FormLabel>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Details..."
                        rows={4}
                      />
                    </FormControl>
                  </GridItem>

                  <FormControl>
                    <FormLabel>Priority</FormLabel>
                    <Select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as Priority)}
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p} - {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="backlog">Backlog</option>
                      <option value="todo">To Do</option>
                      {(currentUser?.emp_designation?.toUpperCase() === "L1" ||
                        status === "in-progress") && (
                        <option value="in-progress">In Progress</option>
                      )}
                      {(currentUser?.emp_designation?.toUpperCase() === "L1" ||
                        status === "done") && (
                        <option value="done">Done</option>
                      )}
                    </Select>
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Assign To</FormLabel>
                    <Select
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                      placeholder="Select User"
                    >
                      {potentialAssignees
                        ?.map((dev) => (
                          <option key={dev.id || dev.emp_id} value={dev.emp_id}>
                            {dev.emp_name} ({dev.emp_designation})
                          </option>
                        ))}
                    </Select>
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
                  Create Task
                </Button>
              </Box>
            </TabPanel>
            <TabPanel px={0}>
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={8}>
                {/* Left Side - 70% */}
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
                    Upload Tasks
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
                      <Box display="flex" alignItems="center" gap={2}>
                        <Box
                          as="span"
                          w="6px"
                          h="6px"
                          borderRadius="full"
                          bg="brand.400"
                        />
                        <Box fontSize="sm" color="brand.600">
                          Optional: row_ref + subtask_of columns stage subtasks in bulk
                          (subtask_of points at another row's row_ref, or an existing task
                          id); epic_id rolls a story into an existing Epic
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
                      download="sample_task_creation.csv"
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

export default CreateTaskPage;
