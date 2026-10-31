import React, { useState } from "react";
import {
  Box,
  Container,
  Heading,
  Text,
  FormControl,
  FormLabel,
  Input,
  Select,
  Button,
  useToast,
  VStack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  IconButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
} from "@chakra-ui/react";
import SimpleLayout from "Layouts/simpleLayout";
import {
  useUpdateUserMutation,
  useLazyUserListQuery,
  useUserListQuery,
  useDeleteUserMutation,
  useBulkDeleteUsersMutation,
} from "Services/user.api";
import { DESIGNATIONS, ROLE_RANK } from "Utils/constants";
import { useAppSelector } from "app/hooks";
import { FaEdit, FaTrash } from "Utils/icons";
import { Employee } from "types";

const UserManagementPage: React.FC = () => {
  const [updateUser, { isLoading: isUpdatingUser }] = useUpdateUserMutation();
  const [deleteUser] = useDeleteUserMutation();
  const [bulkDeleteUsers] = useBulkDeleteUsersMutation();
  const toast = useToast();

  const { developers: reduxDevelopers, currentUser } = useAppSelector(
    (state) => state.scheduler,
  );

  // Fetch users specifically for the list
  const { data: userList, refetch } = useUserListQuery(
    {},
    { refetchOnMountOrArgChange: true },
  );

  // Filter out users with higher or equal hierarchy
  const currentUserRank = ROLE_RANK[currentUser?.emp_designation || ""] || 0;

  const allUsers = userList || reduxDevelopers || [];
  const usersToDisplay = allUsers.filter((u: Employee) => {
    const userRank = ROLE_RANK[u.emp_designation] || 0;
    // Only show users with strictly LOWER rank
    // e.g. Rank 5 (CTO) sees Rank 4 (EM) and below
    // Rank 3 (L2) sees Rank 2 (L1) and below
    return userRank < currentUserRank;
  });

  const potentialManagers = usersToDisplay;

  const [triggerUserList] = useLazyUserListQuery();

  // Edit Modal State
  const {
    isOpen: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();
  const [editingUser, setEditingUser] = useState<Employee | null>(null);

  // Selection State
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Edit Form State
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDesignation, setEditDesignation] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editManagerId, setEditManagerId] = useState("");

  const editRank = ROLE_RANK[editDesignation] || 0;
  const showEditManager = editRank < 5;
  const validEditManagers = potentialManagers.filter(
    (m: Employee) => (ROLE_RANK[m.emp_designation] || 0) > editRank,
  );

  const handleEditClick = (user: Employee) => {
    setEditingUser(user);
    setEditName(user.emp_name);
    setEditEmail(user.emp_email);
    setEditPhone(user.emp_phone || "");
    setEditDesignation(user.emp_designation);
    setEditDepartment(user.emp_department || "");
    setEditManagerId(user.manager_id || "");
    onEditOpen();
  };

  const handleUpdateSubmit = async () => {
    if (!editingUser) return;

    if (!editName || !editEmail || !editDesignation) {
      toast({ title: "Please fill required fields", status: "error" });
      return;
    }

    const updatedUser = {
      ...editingUser,
      emp_name: editName,
      emp_email: editEmail,
      emp_phone: editPhone,
      emp_designation: editDesignation,
      emp_department: editDepartment,
      manager_id: showEditManager ? editManagerId : undefined,
    };

    try {
      await updateUser(updatedUser).unwrap();
      toast({ title: "User Updated Successfully", status: "success" });
      onEditClose();
      refetch();
    } catch {
      toast({ title: "Failed to update user", status: "error" });
    }
  };

  // Selection Handlers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = potentialManagers.map((u: Employee) => u.emp_id);
      setSelectedUserIds(allIds);
    } else {
      setSelectedUserIds([]);
    }
  };

  const handleSelectOne = (empId: string) => {
    if (selectedUserIds.includes(empId)) {
      setSelectedUserIds(selectedUserIds.filter((id) => id !== empId));
    } else {
      setSelectedUserIds([...selectedUserIds, empId]);
    }
  };

  // Delete Handlers
  const handleDeleteOne = async (empId: string) => {
    if (!window.confirm(`Are you sure you want to delete user ${empId}?`))
      return;
    try {
      await deleteUser(empId).unwrap();
      toast({ title: "User Deleted", status: "success" });
      refetch();
    } catch {
      toast({ title: "Delete Failed", status: "error" });
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedUserIds.length} users?`)) return;
    try {
      await bulkDeleteUsers({ emp_ids: selectedUserIds }).unwrap();
      toast({ title: "Bulk Delete Successful", status: "success" });
      setSelectedUserIds([]);
      refetch();
    } catch {
      toast({ title: "Bulk Delete Failed", status: "error" });
    }
  };

  React.useEffect(() => {
    if (reduxDevelopers.length === 0) {
      triggerUserList({});
    }
  }, [reduxDevelopers.length, triggerUserList]);

  return (
    <SimpleLayout>
      <Container maxW="container.xl" py={8}>
        <Heading size="lg" mb={1} color="neutral.900">
          User Management
        </Heading>
        <Text color="neutral.500" fontSize="sm" mb={6}>
          Manage existing users and their details.
        </Text>

        {selectedUserIds.length > 0 && (
          <Button
            colorScheme="red"
            mb={4}
            onClick={handleBulkDelete}
            leftIcon={<FaTrash />}
          >
            Delete Selected ({selectedUserIds.length})
          </Button>
        )}

        <Box
          bg="surface.card"
          p={6}
          borderRadius="card"
          boxShadow="card"
          border="1px solid"
          borderColor="surface.border"
          overflowX="auto"
        >
          <Table variant="simple" size="sm">
            <Thead>
              <Tr>
                <Th>
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={
                      potentialManagers.length > 0 &&
                      selectedUserIds.length === potentialManagers.length
                    }
                  />
                </Th>
                <Th>Name</Th>
                <Th>Emp ID</Th>
                <Th>Designation</Th>
                <Th>Manager</Th>
                <Th>Email</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {potentialManagers?.map((user: Employee) => (
                <Tr key={user.emp_id} _hover={{ bg: "neutral.50" }}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.emp_id)}
                      onChange={() => handleSelectOne(user.emp_id)}
                    />
                  </Td>
                  <Td fontWeight="medium">{user.emp_name}</Td>
                  <Td>{user.emp_id}</Td>
                  <Td>{user.emp_designation}</Td>
                  <Td>{user.manager_id || "-"}</Td>
                  <Td>{user.emp_email}</Td>
                  <Td>
                    <IconButton
                      aria-label="Edit User"
                      icon={<FaEdit />}
                      size="sm"
                      colorScheme="brand"
                      variant="ghost"
                      mr={2}
                      onClick={() => handleEditClick(user)}
                    />
                    <IconButton
                      aria-label="Delete User"
                      icon={<FaTrash />}
                      size="sm"
                      colorScheme="red"
                      variant="ghost"
                      onClick={() => handleDeleteOne(user.emp_id)}
                    />
                  </Td>
                </Tr>
              ))}
              {potentialManagers.length === 0 && (
                <Tr>
                  <Td colSpan={7} textAlign="center" py={8} color="neutral.500">
                    No users to manage. You can only view users ranked below you.
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </Box>

        {/* Edit User Modal */}
        <Modal isOpen={isEditOpen} onClose={onEditClose} size="lg">
          <ModalOverlay backdropFilter="blur(4px)" />
          <ModalContent>
            <ModalHeader>Update User</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <VStack spacing={4}>
                <FormControl isRequired>
                  <FormLabel>Designation</FormLabel>
                  <Select
                    value={editDesignation}
                    onChange={(e) => setEditDesignation(e.target.value)}
                    placeholder="Select Designation"
                  >
                    {DESIGNATIONS.map((des) => (
                      <option key={des} value={des}>
                        {des}
                      </option>
                    ))}
                  </Select>
                </FormControl>

                {showEditManager && editDesignation && (
                  <FormControl isRequired>
                    <FormLabel>Manager</FormLabel>
                    <Select
                      value={editManagerId}
                      onChange={(e) => setEditManagerId(e.target.value)}
                      placeholder="Select Manager"
                    >
                      {validEditManagers.map((dev) => (
                        <option key={dev.id || dev.emp_id} value={dev.emp_id}>
                          {dev.emp_name} ({dev.emp_designation})
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <FormControl isRequired>
                  <FormLabel>Employee Name</FormLabel>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </FormControl>

                <FormControl isDisabled>
                  <FormLabel>Employee ID</FormLabel>
                  <Input value={editingUser?.emp_id} isReadOnly />
                </FormControl>

                <FormControl isRequired>
                  <FormLabel>Email</FormLabel>
                  <Input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel>Phone</FormLabel>
                  <Input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel>Department</FormLabel>
                  <Input
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                  />
                </FormControl>

              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" mr={3} onClick={onEditClose}>
                Cancel
              </Button>
              <Button
                colorScheme="brand"
                onClick={handleUpdateSubmit}
                isLoading={isUpdatingUser}
                loadingText="Updating..."
              >
                Update User
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Container>
    </SimpleLayout>
  );
};

export default UserManagementPage;
