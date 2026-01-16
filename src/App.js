import { Routes, Route } from "react-router-dom";
import Admin from "./Admin";
import ProtectedRoute from "./auth/ProtectedRoute";
import Login from "./auth/Login";

function App() {
  return (
    <Routes>
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Login />} />
    </Routes>
  );
}

export default App;
