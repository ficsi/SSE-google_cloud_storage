import { useContext } from "react";
import { AuthContext } from "./AuthProvider";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }) {
  const { user, initializing } = useContext(AuthContext);

  if (initializing) return null; // or spinner
  if (!user) return <Navigate to="/login" replace />;

  return children;
}
