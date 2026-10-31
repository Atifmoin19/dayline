import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { schedulerReducer, setCurrentUser } from "app/slices/scheduler.slice";
import { RoleProtectedRoute } from "Components/RouteGuards";
import { Employee } from "types";

const cto: Employee = { emp_id: "w-QB0001", emp_name: "Odile", emp_email: "o@x.com", emp_designation: "Chief Technology Officer" };

const renderAt = (user: Employee) => {
  const store = configureStore({ reducer: { scheduler: schedulerReducer } });
  store.dispatch(setCurrentUser(user));
  render(
    <Provider store={store}>
      <ChakraProvider>
        <MemoryRouter initialEntries={["/dashboard/users"]}>
          <Routes>
            <Route element={<RoleProtectedRoute allowedRoles={["Chief Technology Officer"]} />}>
              <Route path="/dashboard/users" element={<div>admin page</div>} />
            </Route>
            <Route path="/app" element={<div>app home</div>} />
          </Routes>
        </MemoryRouter>
      </ChakraProvider>
    </Provider>,
  );
};

describe("RoleProtectedRoute", () => {
  it("lets a real admin through", () => {
    renderAt(cto);
    expect(screen.getByText("admin page")).toBeTruthy();
  });

  it("sends demo users home with a friendly note, even with an admin title", async () => {
    renderAt({ ...cto, is_demo: true });
    expect(screen.getByText("app home")).toBeTruthy();
    expect(await screen.findByText(/Admin tools are turned off in the demo/)).toBeTruthy();
  });
});
