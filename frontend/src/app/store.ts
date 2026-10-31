import { combineReducers, configureStore } from "@reduxjs/toolkit";
import storageSession from "redux-persist/lib/storage/session";
import { userApi } from "Services/user.api";
import persistReducer from "redux-persist/es/persistReducer";
import { schedulerReducer } from "./slices/scheduler.slice";


const persistConfig = {
  key: `STORE_${import.meta.env.VITE_APP_ENV}`,
  storage: storageSession,
  whitelist: ["scheduler"],
};

const reducers = combineReducers({
  [userApi.reducerPath]: userApi.reducer,
  scheduler: schedulerReducer,
});

const persistedReducer = persistReducer(persistConfig, reducers);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (gDM) =>
    gDM({ serializableCheck: false }).concat(userApi.middleware),
  devTools: import.meta.env.MODE !== "production",
  // devTools: true,
});

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
