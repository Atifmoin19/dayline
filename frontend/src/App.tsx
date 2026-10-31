import { AppRouter } from "AppRouter";
import ErrorBoundary from "Components/ErrorBoundary";
import SsoBootstrap from "Components/SsoBootstrap";
import { TaskDetailProvider } from "Contexts/TaskDetailContext";

function App() {
  return (
    <ErrorBoundary>
      <SsoBootstrap>
        <TaskDetailProvider>
          <AppRouter />
        </TaskDetailProvider>
      </SsoBootstrap>
    </ErrorBoundary>
  );
}

export default App;
