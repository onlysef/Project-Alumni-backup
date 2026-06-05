import { useAuth } from "../auth/AuthContext";

export default function AlumniDashboard() {
  const { user, logout } = useAuth();

  return (
    <div style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Alumni Dashboard</h1>
      <p>Welcome, {user?.firstName} {user?.lastName}!</p>
      <p>Role: <strong>{user?.role}</strong></p>
      <button onClick={logout} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>
        Logout
      </button>
    </div>
  );
}
