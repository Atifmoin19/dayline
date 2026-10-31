import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { CompanyConfig, Employee, Task } from "types";


export interface SchedulerState {
    config: CompanyConfig;
    developers: Employee[];
    tasks: Task[];
    currentUser: Employee | null; // For simulating auth
    token: string
}

const baseInitialState: SchedulerState = {
    config: {
        startHour: 10,
        endHour: 19,
    },
    developers: [],
    tasks: [
    ],
    currentUser: null,
    token: ""
};

const initialState: SchedulerState = baseInitialState;

const schedulerSlice = createSlice({
    name: "scheduler",
    initialState,
    reducers: {
        addTask: (state, action: PayloadAction<Task[]>) => {
            state.tasks = action.payload
        },
        updateTask: (state, action: PayloadAction<Task>) => {
            const index = state.tasks.findIndex(t => t.id === action.payload.id);
            if (index !== -1) {
                state.tasks[index] = action.payload;
            }
        },
        updateConfig: (state, action: PayloadAction<CompanyConfig>) => {
            state.config = action.payload;
        },
        addDeveloper: (state, action: PayloadAction<Employee[]>) => {
            state.developers = action.payload;
        },
        deleteTask: (state, action: PayloadAction<string>) => {
            state.tasks = state.tasks.filter(t => t.id !== action.payload);
        },
        setCurrentUser: (state, action: PayloadAction<Employee | null>) => {
            state.currentUser = action.payload;
            if (action.payload && !state.developers.find(d => d.emp_id === action.payload?.emp_id)) {
                state.developers.push(action.payload);
            }
        },
        setToken: (state, action: PayloadAction<string>) => {
            state.token = action.payload
        },
        resetStore: () => baseInitialState

    },
});

const { reducer } = schedulerSlice;

const { addTask, updateTask, updateConfig, addDeveloper, deleteTask, setCurrentUser, resetStore, setToken } =
    schedulerSlice.actions;

export {
    reducer as schedulerReducer,
    addTask,
    updateTask,
    updateConfig,
    addDeveloper,
    deleteTask,
    setCurrentUser,
    resetStore,
    setToken,
};